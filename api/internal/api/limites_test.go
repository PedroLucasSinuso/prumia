package api

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"
)

// --- limite de casas por usuário ---------------------------------------------

func TestLimiteDeCasasPorUsuario(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	c, _ := a.register("Pedro", "p@x.com", "Casa 1") // o cadastro cria a 1ª casa

	var ids []string
	for i := 2; i <= 5; i++ {
		r := a.do("POST", "/api/households", map[string]any{"name": fmt.Sprintf("Casa %d", i)}, c)
		if r.Code != http.StatusCreated {
			t.Fatalf("casa %d: %d %s", i, r.Code, r.Body.String())
		}
		var h struct{ Id string }
		r.json(&h)
		ids = append(ids, h.Id)
	}
	// a 6ª passa do limite padrão (5)
	r := a.do("POST", "/api/households", map[string]any{"name": "Casa 6"}, c)
	if r.Code != http.StatusConflict || a.code(r) != "household_limit" {
		t.Fatalf("6ª casa: quer 409 household_limit, veio %d %s", r.Code, r.Body.String())
	}

	// casa excluída não conta: excluir uma libera a vaga
	if r := a.do("DELETE", "/api/households/"+ids[0], nil, c); r.Code != http.StatusNoContent {
		t.Fatalf("excluir: %d", r.Code)
	}
	if r := a.do("POST", "/api/households", map[string]any{"name": "Casa 6"}, c); r.Code != http.StatusCreated {
		t.Fatalf("após excluir deveria criar: %d %s", r.Code, r.Body.String())
	}

	// casa em que só se entrou por convite não conta no limite de quem entrou
	ana, _ := a.newUser("Ana", "a@x.com")
	var anaHouse string
	a.db.Raw("SELECT id::text FROM households WHERE name = 'Casa de Ana'").Scan(&anaHouse)
	tok, _ := a.invite(ana, anaHouse, "member")
	if r := a.do("POST", "/api/invites/accept", map[string]any{"token": tok}, c); r.Code != 200 {
		t.Fatalf("aceitar: %d %s", r.Code, r.Body.String())
	}
	// Pedro tem 5 próprias + 1 convidada: continua no limite (409), e a Ana segue criando normalmente
	if r := a.do("POST", "/api/households", map[string]any{"name": "Mais uma"}, c); r.Code != http.StatusConflict {
		t.Errorf("Pedro deveria continuar no limite: %d", r.Code)
	}
	if r := a.do("POST", "/api/households", map[string]any{"name": "Casa 2 da Ana"}, ana); r.Code != http.StatusCreated {
		t.Errorf("limite é por usuário: %d %s", r.Code, r.Body.String())
	}
}

func TestLimiteDeCasasConfiguravelESobConcorrencia(t *testing.T) {
	a := newApp(t, opts{})
	a.hs.MaxPerUser = 2
	c, _ := a.register("Pedro", "p@x.com", "Casa 1")

	// 6 criações simultâneas: só 1 cabe (limite 2, já há 1). A trava por usuário serializa a contagem.
	var wg sync.WaitGroup
	codes := make(chan int, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes <- a.do("POST", "/api/households", map[string]any{"name": fmt.Sprintf("C%d", i)}, c).Code
		}(i)
	}
	wg.Wait()
	close(codes)
	created, conflicts := 0, 0
	for code := range codes {
		switch code {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			conflicts++
		}
	}
	if created != 1 || conflicts != 5 {
		t.Errorf("quer 1 criada e 5 conflitos, veio %d e %d", created, conflicts)
	}
	var n int64
	a.db.Raw("SELECT count(*) FROM households WHERE deleted_at IS NULL").Scan(&n)
	if n != 2 {
		t.Errorf("deveria haver 2 casas, há %d", n)
	}
}

// --- validade absoluta da sessão ----------------------------------------------

func TestSessaoMorreNaValidadeAbsolutaMesmoEmUso(t *testing.T) {
	clk := &clock{now: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	a := newApp(t, opts{now: clk.Now})
	c, _ := a.register("Pedro", "p@x.com", "Casa")
	created := clk.now

	// uso a cada 20 dias: a renovação deslizante manteria a sessão viva para sempre
	for i := 0; i < 4; i++ { // 80 dias
		clk.Advance(20 * 24 * time.Hour)
		if r := a.do("GET", "/api/auth/me", nil, c); r.Code != 200 {
			t.Fatalf("dia %d: sessão em uso deveria valer: %d", (i+1)*20, r.Code)
		}
	}
	// a renovação nunca empurra expires_at além de criação + 90 dias
	var expires time.Time
	a.db.Raw("SELECT expires_at FROM sessions").Scan(&expires)
	if want := created.Add(90 * 24 * time.Hour); !expires.Equal(want) {
		t.Errorf("expires_at = %s, quer o teto %s", expires, want)
	}

	clk.Advance(9*24*time.Hour + 23*time.Hour) // 89d23h: ainda vale
	if r := a.do("GET", "/api/auth/me", nil, c); r.Code != 200 {
		t.Fatalf("antes dos 90 dias deveria valer: %d", r.Code)
	}
	clk.Advance(time.Hour) // 90 dias exatos: morre
	r := a.do("GET", "/api/auth/me", nil, c)
	if r.Code != http.StatusUnauthorized {
		t.Fatalf("após 90 dias quer 401, veio %d", r.Code)
	}
	ck := r.sessionCookie()
	if ck == nil || ck.MaxAge >= 0 || ck.Value != "" {
		t.Errorf("o 401 deveria apagar o cookie: %+v", ck)
	}
}

func TestSessaoMaxAgeVaiAoBancoAntigo(t *testing.T) {
	// sessão gravada antes da regra (expires_at além do teto): a checagem pela criação a derruba mesmo assim
	clk := &clock{now: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	a := newApp(t, opts{now: clk.Now})
	c, _ := a.register("Pedro", "p@x.com", "Casa")
	a.db.Exec("UPDATE sessions SET expires_at = ?", clk.now.Add(400*24*time.Hour))
	clk.Advance(91 * 24 * time.Hour)
	if r := a.do("GET", "/api/auth/me", nil, c); r.Code != http.StatusUnauthorized {
		t.Fatalf("quer 401, veio %d", r.Code)
	}
	var n int64
	a.db.Raw("SELECT count(*) FROM sessions").Scan(&n)
	if n != 0 {
		t.Errorf("a sessão vencida deveria ser apagada, sobraram %d", n)
	}
}

func TestSem401NaoApagaCookieQuandoNaoHaCookie(t *testing.T) {
	a := newApp(t, opts{})
	r := a.do("GET", "/api/auth/me", nil, nil)
	if r.Code != http.StatusUnauthorized || r.sessionCookie() != nil {
		t.Errorf("sem cookie: quer 401 sem Set-Cookie, veio %d %+v", r.Code, r.sessionCookie())
	}
}
