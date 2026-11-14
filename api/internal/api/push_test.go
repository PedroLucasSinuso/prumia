package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/PedroLucasSinuso/prumia/api/internal/push"
)

// fakeSender guarda o que seria enviado ao serviço de push. status por endpoint (padrão 201); err simula rede fora.
type fakeSender struct {
	mu     sync.Mutex
	sent   []sentPush
	status map[string]int
	err    error
}

type sentPush struct {
	endpoint string
	msg      push.Message
}

func (f *fakeSender) Send(_ context.Context, sub push.Subscription, payload []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return 0, f.err
	}
	var m push.Message
	_ = json.Unmarshal(payload, &m)
	f.sent = append(f.sent, sentPush{sub.Endpoint, m})
	if s, ok := f.status[sub.Endpoint]; ok {
		return s, nil
	}
	return http.StatusCreated, nil
}

const pushEndpoint = "https://push.exemplo.test/aparelho-1" // host aceito só nos testes (helpers_test.go)

func subBody(endpoint string) map[string]any {
	return map[string]any{"endpoint": endpoint, "keys": map[string]any{"p256dh": "chave-publica-ficticia", "auth": "segredo-ficticio"}}
}

func pushCasa(t *testing.T) (*app, *fakeSender, *http.Cookie, string, string) {
	t.Helper()
	f := &fakeSender{status: map[string]int{}}
	a := newApp(t, opts{openRegistration: true, now: func() time.Time { return today }, pushSender: f})
	c, house := a.register("Ana", "ana@x.com", "Casa A")
	var cats []cat
	a.do("GET", "/api/households/"+house+"/categories", nil, c).json(&cats)
	return a, f, c, house, cats[0].ID
}

func (a *app) subscribe(c *http.Cookie, endpoint string) {
	a.t.Helper()
	if r := a.do("PUT", "/api/push/subscriptions", subBody(endpoint), c); r.Code != http.StatusNoContent {
		a.t.Fatalf("assinar: %d %s", r.Code, r.Body)
	}
}

func (a *app) runDue() int {
	a.t.Helper()
	n, err := a.push.RunDue(context.Background())
	if err != nil {
		a.t.Fatal(err)
	}
	return n
}

func (a *app) subCount() int {
	var n int
	a.db.Raw(`SELECT count(*) FROM push_subscriptions`).Scan(&n)
	return n
}

// Sem chaves VAPID o servidor declara os avisos desligados e recusa assinatura e teste com 503.
func TestPushDesligadoSemChaves(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	c, _ := a.register("Ana", "ana@x.com", "Casa A")
	var cfg struct {
		Enabled   bool
		PublicKey *string
	}
	a.do("GET", "/api/push/config", nil, c).json(&cfg)
	if cfg.Enabled || cfg.PublicKey != nil {
		t.Errorf("config: %+v", cfg)
	}
	if r := a.do("PUT", "/api/push/subscriptions", subBody(pushEndpoint), c); r.Code != http.StatusServiceUnavailable || a.code(r) != "push_disabled" {
		t.Errorf("assinar: %d %s", r.Code, r.Body)
	}
	if r := a.do("POST", "/api/push/test", nil, c); r.Code != http.StatusServiceUnavailable {
		t.Errorf("teste: %d", r.Code)
	}
	if n := a.runDue(); n != 0 {
		t.Errorf("RunDue desligado enviou %d", n)
	}
}

func TestPushExigeSessao(t *testing.T) {
	a, _, _, _, _ := pushCasa(t)
	for _, r := range []resp{
		a.do("GET", "/api/push/config", nil, nil),
		a.do("PUT", "/api/push/subscriptions", subBody(pushEndpoint), nil),
		a.do("POST", "/api/push/unsubscribe", map[string]any{"endpoint": pushEndpoint}, nil),
		a.do("POST", "/api/push/test", nil, nil),
	} {
		if r.Code != http.StatusUnauthorized {
			t.Errorf("sem sessão: %d %s", r.Code, r.Body)
		}
	}
}

// O endpoint é uma URL que o servidor vai chamar: só serviços de push conhecidos entram (SSRF).
func TestPushRecusaEndpointDesconhecido(t *testing.T) {
	a, _, c, _, _ := pushCasa(t)
	for _, e := range []string{"https://exemplo.test/x", "http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://db:5432/", ""} {
		r := a.do("PUT", "/api/push/subscriptions", subBody(e), c)
		if r.Code != http.StatusBadRequest || a.code(r) != "validation_error" {
			t.Errorf("%q: %d %s", e, r.Code, r.Body)
		}
	}
	if r := a.do("PUT", "/api/push/subscriptions", map[string]any{"endpoint": pushEndpoint, "keys": map[string]any{"p256dh": "", "auth": "x"}}, c); r.Code != http.StatusBadRequest {
		t.Errorf("chave vazia: %d", r.Code)
	}
	if a.subCount() != 0 {
		t.Error("nada deveria ter sido gravado")
	}
}

func TestPushAssinarTestarEDesligar(t *testing.T) {
	a, f, c, _, _ := pushCasa(t)
	var cfg struct {
		Enabled   bool
		PublicKey *string
	}
	a.do("GET", "/api/push/config", nil, c).json(&cfg)
	if !cfg.Enabled || cfg.PublicKey == nil || *cfg.PublicKey == "" {
		t.Fatalf("config: %+v", cfg)
	}
	a.subscribe(c, pushEndpoint)
	a.subscribe(c, pushEndpoint) // idempotente
	if a.subCount() != 1 {
		t.Fatalf("assinaturas = %d", a.subCount())
	}
	var out struct{ Sent int }
	a.do("POST", "/api/push/test", nil, c).json(&out)
	if out.Sent != 1 || len(f.sent) != 1 || f.sent[0].endpoint != pushEndpoint || f.sent[0].msg.Title != "prumia" {
		t.Errorf("teste: %+v %+v", out, f.sent)
	}
	// limite do aviso de teste: folga de 3
	a.do("POST", "/api/push/test", nil, c)
	a.do("POST", "/api/push/test", nil, c)
	if r := a.do("POST", "/api/push/test", nil, c); r.Code != http.StatusTooManyRequests {
		t.Errorf("4º teste seguido: %d", r.Code)
	}
	if r := a.do("POST", "/api/push/unsubscribe", map[string]any{"endpoint": pushEndpoint}, c); r.Code != http.StatusNoContent {
		t.Errorf("desligar: %d", r.Code)
	}
	if a.subCount() != 0 {
		t.Error("assinatura deveria ter sumido")
	}
}

// Outra pessoa não consegue apagar a assinatura de alguém só por conhecer o endpoint.
func TestPushDesligarSoApagaADaPropriaPessoa(t *testing.T) {
	a, _, c, _, _ := pushCasa(t)
	a.subscribe(c, pushEndpoint)
	bia, _ := a.register("Bia", "bia@x.com", "Casa B")
	a.do("POST", "/api/push/unsubscribe", map[string]any{"endpoint": pushEndpoint}, bia)
	if a.subCount() != 1 {
		t.Error("a assinatura da Ana não podia ser apagada pela Bia")
	}
}

// hoje = 18/10/2026 12:00. Um aviso por casa e por dia, com atrasadas, de hoje e de amanhã; pagas e futuras ficam fora.
func TestPushAvisoDoDia(t *testing.T) {
	a, f, c, house, catID := pushCasa(t)
	a.subscribe(c, pushEndpoint)
	mk := func(due string, cents int64) inv {
		t.Helper()
		i, r := a.newInvoice(c, house, catID, map[string]any{"amountCents": cents, "dueDate": due})
		if r.Code != 201 {
			t.Fatal(r.Body)
		}
		return i
	}
	if n := a.runDue(); n != 0 || len(f.sent) != 0 {
		t.Fatalf("sem contas não há aviso: %d %+v", n, f.sent)
	}
	mk("2026-10-10", 10000)         // atrasada
	mk("2026-10-15", 5050)          // atrasada
	mk("2026-10-18", 9990)          // hoje
	mk("2026-10-19", 20000)         // amanhã
	mk("2026-10-25", 99900)         // futura: fora
	paga := mk("2026-10-12", 77700) // atrasada, mas paga: fora
	a.pay(c, house, paga.ID, "free", nil)

	// Antes da hora do aviso nada sai.
	a.push.DigestHour = 13
	if n := a.runDue(); n != 0 || len(f.sent) != 0 {
		t.Fatalf("antes da hora: %d", n)
	}
	a.push.DigestHour = 9
	if n := a.runDue(); n != 1 || len(f.sent) != 1 {
		t.Fatalf("aviso do dia: %d %+v", n, f.sent)
	}
	want := "2 contas atrasadas (R$ 150,50) · 1 vence hoje (R$ 99,90) · 1 vence amanhã (R$ 200,00)"
	if m := f.sent[0].msg; m.Title != "prumia" || m.Body != want || m.URL != "/" {
		t.Errorf("mensagem: %+v", m)
	}
	// No mesmo dia não repete (nem com conta nova).
	mk("2026-10-18", 100)
	if n := a.runDue(); n != 0 || len(f.sent) != 1 {
		t.Errorf("repetiu no mesmo dia: %d", n)
	}
}

// Isolamento por casa: cada pessoa só é avisada das casas de que participa, e quem saiu da casa deixa de ser.
func TestPushAvisoRespeitaACasa(t *testing.T) {
	a, f, ana, casaA, catA := pushCasa(t)
	bia, casaB := a.register("Bia", "bia@x.com", "Casa B")
	a.subscribe(ana, "https://push.exemplo.test/ana")
	a.subscribe(bia, "https://push.exemplo.test/bia")
	if _, r := a.newInvoice(ana, casaA, catA, map[string]any{"dueDate": "2026-10-18", "amountCents": 12300}); r.Code != 201 {
		t.Fatal(r.Body)
	}
	if n := a.runDue(); n != 1 || len(f.sent) != 1 || f.sent[0].endpoint != "https://push.exemplo.test/ana" {
		t.Fatalf("só a Ana tem conta: %d %+v", n, f.sent)
	}
	_ = casaB

	// A Bia entra na casa A: no dia seguinte as duas são avisadas; a Bia (duas casas) vê o nome da casa no título.
	a.join(ana, casaA, "viewer", bia)
	a.db.Exec(`DELETE FROM push_digests`)
	f.sent = nil
	if n := a.runDue(); n != 2 {
		t.Fatalf("Ana e Bia: %d %+v", n, f.sent)
	}
	titles := map[string]string{}
	for _, s := range f.sent {
		titles[s.endpoint] = s.msg.Title
	}
	if titles["https://push.exemplo.test/ana"] != "prumia" || titles["https://push.exemplo.test/bia"] != "prumia · Casa A" {
		t.Errorf("títulos: %+v", titles)
	}
}

// A assinatura fica presa à sessão: sair da conta desliga os avisos do aparelho mesmo sem o navegador avisar.
func TestPushSairDaContaDesligaOAparelho(t *testing.T) {
	a, f, c, house, catID := pushCasa(t)
	a.subscribe(c, pushEndpoint)
	a.newInvoice(c, house, catID, map[string]any{"dueDate": "2026-10-18"})
	if r := a.do("POST", "/api/auth/logout", nil, c); r.Code >= 300 {
		t.Fatalf("logout: %d", r.Code)
	}
	if a.subCount() != 0 {
		t.Errorf("assinatura deveria sumir com a sessão: %d", a.subCount())
	}
	if n := a.runDue(); n != 0 || len(f.sent) != 0 {
		t.Errorf("aviso para aparelho deslogado: %d", n)
	}
}

// 404/410 do serviço de push = assinatura morta (app desinstalado, permissão revogada): é apagada.
func TestPushAssinaturaMortaEhApagada(t *testing.T) {
	a, f, c, house, catID := pushCasa(t)
	a.subscribe(c, pushEndpoint)
	a.subscribe(c, "https://push.exemplo.test/vivo")
	f.status[pushEndpoint] = http.StatusGone
	a.newInvoice(c, house, catID, map[string]any{"dueDate": "2026-10-18"})
	if n := a.runDue(); n != 1 {
		t.Fatalf("o aparelho vivo recebe: %d", n)
	}
	if a.subCount() != 1 {
		t.Errorf("a assinatura morta deveria ter sido apagada: %d", a.subCount())
	}
}

// Falha passageira (rede fora) sem nenhuma entrega: não marca como enviado, e a próxima rodada entrega.
func TestPushFalhaPassageiraTentaDeNovo(t *testing.T) {
	a, f, c, house, catID := pushCasa(t)
	a.subscribe(c, pushEndpoint)
	a.newInvoice(c, house, catID, map[string]any{"dueDate": "2026-10-18"})
	f.err = errors.New("rede fora")
	if n := a.runDue(); n != 0 {
		t.Fatalf("com a rede fora: %d", n)
	}
	f.err = nil
	if n := a.runDue(); n != 1 || len(f.sent) != 1 {
		t.Errorf("segunda rodada deveria entregar: %d", n)
	}
	if a.subCount() != 1 {
		t.Error("falha passageira não apaga a assinatura")
	}
}

// Limite de aparelhos por pessoa: o mais antigo sai.
func TestPushLimiteDeAparelhos(t *testing.T) {
	a, _, c, _, _ := pushCasa(t)
	for i := 0; i < push.MaxPerUser+2; i++ {
		a.subscribe(c, "https://push.exemplo.test/aparelho-"+string(rune('a'+i)))
	}
	if a.subCount() != push.MaxPerUser {
		t.Errorf("assinaturas = %d, quer %d", a.subCount(), push.MaxPerUser)
	}
}
