package api

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// nginxAddr simula a conexão vinda do nginx (rede interna do Docker), que é como toda requisição chega à API em produção.
const nginxAddr = "172.18.0.3:40000"

// Ataque: cliente atrás do nginx (com IP privado, como no acesso pelo próprio host ou por `tailscale serve`) manda um
// X-Forwarded-For diferente a cada tentativa, com um e-mail diferente a cada vez (para não esbarrar no limite por e-mail).
// O limite por IP tem de segurar mesmo assim.
func TestLimiteDeLoginNaoSeBurlaForjandoXForwardedFor(t *testing.T) {
	a := newApp(t, opts{})
	got429 := false
	for i := 0; i < 15; i++ {
		r := a.doFrom(nginxAddr, "POST", "/api/auth/login",
			map[string]any{"email": fmt.Sprintf("alvo%d@x.com", i), "password": "errada-errada"}, nil,
			"X-Real-IP", "172.18.0.1", // o nginx sobrescreve com o IP que viu
			"X-Forwarded-For", fmt.Sprintf("198.51.100.%d, 172.18.0.1", i)) // o cliente forjou o primeiro
		if r.Code == http.StatusTooManyRequests {
			got429 = true
			break
		}
	}
	if !got429 {
		t.Error("15 tentativas com X-Forwarded-For forjado e nenhum 429: o limite por IP foi burlado")
	}
}

// Ataque: variar maiúsculas/espaços do e-mail para cada tentativa cair num balde novo do limite por e-mail
// (o login normaliza o e-mail, então todas testam a mesma conta). Cada tentativa vem de um IP diferente.
func TestLimiteDeLoginPorEmailIgnoraMaiusculasEEspacos(t *testing.T) {
	a := newApp(t, opts{})
	a.register("Ana", "ana@x.com", "Casa")
	variants := []string{"ana@x.com", "Ana@x.com", "ANA@x.com", "aNa@x.com", " ana@x.com", "ana@X.com", "ANA@X.COM", "anA@x.com "}
	got429 := false
	for i, e := range variants {
		r := a.doFrom(fmt.Sprintf("203.0.113.%d:1000", 10+i), "POST", "/api/auth/login",
			map[string]any{"email": e, "password": "errada-errada"}, nil)
		if r.Code == http.StatusTooManyRequests {
			got429 = true
			break
		}
	}
	if !got429 {
		t.Errorf("%d tentativas na mesma conta variando o e-mail e nenhum 429", len(variants))
	}
}

// Ao entrar, a sessão que o navegador já tinha (de outro usuário ou antiga) é encerrada, não fica viva no banco.
func TestLoginEncerraASessaoAnteriorDoNavegador(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	old, _ := a.register("Ana", "ana@x.com", "Casa")
	a.register("Beto", "beto@x.com", "Outra")
	r := a.do("POST", "/api/auth/login", map[string]any{"email": "beto@x.com", "password": "senha-muito-segura"}, old)
	if r.Code != http.StatusOK {
		t.Fatalf("login: %d %s", r.Code, r.Body)
	}
	if r.sessionCookie() == nil || r.sessionCookie().Value == old.Value {
		t.Fatal("login deveria emitir um token novo")
	}
	if r := a.do("GET", "/api/auth/me", nil, old); r.Code != http.StatusUnauthorized {
		t.Errorf("a sessão anterior do navegador continuou valendo: %d", r.Code)
	}
}

// Busca `q` tem tamanho máximo (e % / _ continuam sendo texto, não curinga).
func TestBuscaTemLimiteETrataCuringas(t *testing.T) {
	a, c, house, catID := casa(t)
	a.newInvoice(c, house, catID, map[string]any{"description": "Conta 100% paga"})
	a.newInvoice(c, house, catID, map[string]any{"description": "Conta 1000 paga"})
	long := strings.Repeat("a", 121)
	for _, p := range []string{"/invoices?q=" + long, "/purchases?q=" + long} {
		assertField(t, a.do("GET", "/api/households/"+house+p, nil, c), 400, "q")
	}
	var page struct{ Items []inv }
	a.do("GET", "/api/households/"+house+"/invoices?q=100%25", nil, c).json(&page)
	if len(page.Items) != 1 {
		t.Errorf("%% deveria ser literal: %+v", page.Items)
	}
}

// Corpo JSON gigante é recusado antes de ser processado (o nginx deixa passar até 6 MB por causa do boleto).
func TestCorpoJSONGrandeEhRecusado(t *testing.T) {
	a := newApp(t, opts{})
	big := strings.Repeat("a", 2<<20)
	r := a.do("POST", "/api/auth/login", map[string]any{"email": "x@x.com", "password": big}, nil)
	if r.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("corpo de 2 MB: %d (quer 413)", r.Code)
	}
}
