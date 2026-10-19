package api

import (
	"net/http"
	"testing"
	"time"
)

type problemBody struct {
	Code   string            `json:"code"`
	Fields map[string]string `json:"fields"`
}

func TestCadastroEFluxoDeSessao(t *testing.T) {
	a := newApp(t, opts{})
	c, houseID := a.register("Pedro", "Pedro@Exemplo.com", "Casa do Pedro")

	if c == nil || !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.MaxAge <= 0 {
		t.Fatalf("cookie de sessão mal configurado: %+v", c)
	}
	if c.Secure {
		t.Error("fora de produção o cookie não deve ser Secure (sem HTTPS local)")
	}

	// /me com sessão: usuário e casa com papel admin
	r := a.do("GET", "/api/auth/me", nil, c)
	if r.Code != 200 {
		t.Fatalf("me: %d %s", r.Code, r.Body.String())
	}
	var me struct {
		Name, Email string
		Households  []struct{ Id, Name, Role string }
	}
	r.json(&me)
	if me.Email != "pedro@exemplo.com" || len(me.Households) != 1 || me.Households[0].Role != "admin" || me.Households[0].Id != houseID {
		t.Errorf("me inesperado: %+v", me)
	}

	// sem sessão => 401
	if r := a.do("GET", "/api/auth/me", nil, nil); r.Code != 401 {
		t.Errorf("sem cookie deveria ser 401, veio %d", r.Code)
	}

	// as 10 categorias padrão foram criadas junto
	var n int64
	a.db.Raw("SELECT count(*) FROM categories WHERE household_id = ?", houseID).Scan(&n)
	if n != 10 {
		t.Errorf("categorias padrão = %d, quer 10", n)
	}

	// logout encerra a sessão no servidor (não só no cookie)
	if r := a.do("POST", "/api/auth/logout", nil, c); r.Code != 204 {
		t.Fatalf("logout: %d", r.Code)
	}
	if r := a.do("GET", "/api/auth/me", nil, c); r.Code != 401 {
		t.Errorf("token antigo ainda funciona depois do logout: %d", r.Code)
	}
}

func TestSessaoNoBancoGuardaSoOHash(t *testing.T) {
	a := newApp(t, opts{})
	c, _ := a.register("Pedro", "p@x.com", "Casa")
	var n int64
	a.db.Raw("SELECT count(*) FROM sessions WHERE encode(token_hash,'escape') = ?", c.Value).Scan(&n)
	if n != 0 {
		t.Error("o token em claro não pode estar no banco")
	}
	a.db.Raw("SELECT count(*) FROM sessions").Scan(&n)
	if n != 1 {
		t.Errorf("sessões = %d", n)
	}
}

func TestCadastroSemConviteFechadoDepoisDoPrimeiro(t *testing.T) {
	a := newApp(t, opts{})
	a.register("Pedro", "p@x.com", "Casa")
	r := a.do("POST", "/api/auth/register", map[string]any{"name": "Intruso", "email": "i@x.com", "password": "senha-muito-segura"}, nil)
	var p problemBody
	r.json(&p)
	if r.Code != 403 || p.Code != "registration_closed" {
		t.Errorf("segundo cadastro livre deveria ser 403 registration_closed: %d %s", r.Code, r.Body.String())
	}
}

func TestCadastroAbertoEEmailDuplicado(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	a.register("Pedro", "p@x.com", "Casa A")
	a.register("Ana", "ana@x.com", "Casa B") // aberto: permitido

	r := a.do("POST", "/api/auth/register", map[string]any{"name": "Outro", "email": "P@X.com", "password": "senha-muito-segura"}, nil)
	var p problemBody
	r.json(&p)
	if r.Code != 409 || p.Code != "email_taken" {
		t.Errorf("e-mail repetido (sem caixa) deveria ser 409: %d %s", r.Code, r.Body.String())
	}
	var n int64
	a.db.Raw("SELECT count(*) FROM users").Scan(&n)
	if n != 2 {
		t.Errorf("o cadastro falho não pode deixar usuário órfão: users=%d", n)
	}
}

func TestCadastroValidacao(t *testing.T) {
	a := newApp(t, opts{})
	r := a.do("POST", "/api/auth/register", map[string]any{"name": " ", "email": "nao-e-email", "password": "curta"}, nil)
	var p problemBody
	r.json(&p)
	if r.Code != 400 || p.Code != "validation_error" {
		t.Fatalf("%d %s", r.Code, r.Body.String())
	}
	for _, f := range []string{"name", "email", "password"} {
		if p.Fields[f] == "" {
			t.Errorf("faltou erro no campo %s: %v", f, p.Fields)
		}
	}
	var n int64
	a.db.Raw("SELECT count(*) FROM users").Scan(&n)
	if n != 0 {
		t.Error("cadastro inválido não pode gravar nada")
	}
}

func TestLoginNaoRevelaSeOEmailExiste(t *testing.T) {
	a := newApp(t, opts{})
	a.register("Pedro", "p@x.com", "Casa")

	wrongPass := a.do("POST", "/api/auth/login", map[string]any{"email": "p@x.com", "password": "senha-errada-123"}, nil)
	unknown := a.do("POST", "/api/auth/login", map[string]any{"email": "fantasma@x.com", "password": "senha-errada-123"}, nil)
	if wrongPass.Code != 401 || unknown.Code != 401 || wrongPass.Body.String() != unknown.Body.String() {
		t.Errorf("respostas devem ser idênticas:\n%d %s\n%d %s", wrongPass.Code, wrongPass.Body, unknown.Code, unknown.Body)
	}

	ok := a.do("POST", "/api/auth/login", map[string]any{"email": "P@X.com", "password": "senha-muito-segura"}, nil)
	if ok.Code != 200 || ok.sessionCookie() == nil {
		t.Errorf("login válido: %d %s", ok.Code, ok.Body)
	}
}

func TestLimiteDeTentativasDeLogin(t *testing.T) {
	a := newApp(t, opts{})
	var last int
	for i := 0; i < 15; i++ {
		last = a.do("POST", "/api/auth/login", map[string]any{"email": "x@x.com", "password": "errada-errada"}, nil).Code
	}
	if last != http.StatusTooManyRequests {
		t.Errorf("depois de muitas tentativas deveria dar 429, deu %d", last)
	}
}

func TestOrigemDiferenteEhBloqueadaNaEscrita(t *testing.T) {
	a := newApp(t, opts{})
	body := map[string]any{"email": "x@x.com", "password": "errada-errada"}
	if r := a.do("POST", "/api/auth/login", body, nil, "Origin", "http://evil.example"); r.Code != 403 {
		t.Errorf("origem externa deveria ser 403, deu %d", r.Code)
	}
	if r := a.do("POST", "/api/auth/login", body, nil, "Origin", "http://example.com"); r.Code == 403 {
		t.Error("mesma origem (Host=example.com) não pode ser bloqueada")
	}
}

func TestIsolamentoEntreCasas(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	cA, houseA := a.register("Ana", "ana@x.com", "Casa A")
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")

	if r := a.do("GET", "/api/households/"+houseA, nil, cA); r.Code != 200 {
		t.Fatalf("dono acessa a própria casa: %d", r.Code)
	}
	// Beto tenta ler a casa e os membros da Ana: 404 (não revela que existe)
	for _, p := range []string{"/api/households/" + houseA, "/api/households/" + houseA + "/members"} {
		if r := a.do("GET", p, nil, cB); r.Code != 404 {
			t.Errorf("%s por não-membro deveria ser 404, deu %d", p, r.Code)
		}
	}
	if r := a.do("GET", "/api/households/"+houseB, nil, cA); r.Code != 404 {
		t.Errorf("Ana lendo a casa do Beto: %d", r.Code)
	}
	// sem login: 401, antes de qualquer checagem de casa
	if r := a.do("GET", "/api/households/"+houseA, nil, nil); r.Code != 401 {
		t.Errorf("sem login: %d", r.Code)
	}

	var members []struct {
		Name, Role string
		JoinedAt   time.Time
	}
	r := a.do("GET", "/api/households/"+houseA+"/members", nil, cA)
	r.json(&members)
	if len(members) != 1 || members[0].Name != "Ana" || members[0].Role != "admin" {
		t.Fatalf("membros: %+v", members)
	}
	if members[0].JoinedAt.Year() < 2026 {
		t.Errorf("joinedAt deveria ser a data de entrada, veio %s", members[0].JoinedAt)
	}
}

func TestCriarOutraCasa(t *testing.T) {
	a := newApp(t, opts{})
	c, _ := a.register("Pedro", "p@x.com", "Casa 1")
	r := a.do("POST", "/api/households", map[string]any{"name": "Casa da Mãe"}, c)
	if r.Code != 201 {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	var me struct{ Households []struct{ Name, Role string } }
	a.do("GET", "/api/auth/me", nil, c).json(&me)
	if len(me.Households) != 2 {
		t.Errorf("deveria ter 2 casas: %+v", me.Households)
	}
	if r := a.do("POST", "/api/households", map[string]any{"name": "  "}, c); r.Code != 400 {
		t.Errorf("nome vazio deveria ser 400: %d", r.Code)
	}
	if r := a.do("POST", "/api/households", map[string]any{"name": "X"}, nil); r.Code != 401 {
		t.Errorf("sem login: %d", r.Code)
	}
}

func TestCookieSecureEmProducao(t *testing.T) {
	a := newApp(t, opts{secureCookie: true})
	c, _ := a.register("Pedro", "p@x.com", "Casa")
	if !c.Secure {
		t.Error("em produção o cookie deve ser Secure")
	}
}
