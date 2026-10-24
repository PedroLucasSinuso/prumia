package api

import (
	"net/http"
	"testing"
)

// Ajustes > Minha conta e Aparência: PATCH /auth/me, POST /auth/password, DELETE /auth/sessions/others.

type meT struct {
	Name  string `json:"name"`
	Theme string `json:"theme"`
}

func TestTemaENomeDaConta(t *testing.T) {
	a := newApp(t, opts{})
	c, _ := a.register("Pedro", "p@x.com", "Casa")

	var me meT
	a.do("GET", "/api/auth/me", nil, c).json(&me)
	if me.Theme != "sistema" {
		t.Fatalf("tema padrão = %q, quer sistema", me.Theme)
	}

	// só o tema: o nome não muda
	r := a.do("PATCH", "/api/auth/me", map[string]any{"theme": "dracula"}, c)
	if r.Code != http.StatusOK {
		t.Fatalf("patch tema: %d %s", r.Code, r.Body)
	}
	r.json(&me)
	if me.Theme != "dracula" || me.Name != "Pedro" {
		t.Errorf("depois do patch: %+v", me)
	}

	// o tema vale para a conta: outro aparelho (novo login) já recebe dracula
	var other meT
	a.login("p@x.com", "senha-muito-segura").json(&other)
	if other.Theme != "dracula" {
		t.Errorf("login em outro aparelho: tema %q", other.Theme)
	}

	// só o nome (com espaços nas pontas): o tema não volta ao padrão
	a.do("PATCH", "/api/auth/me", map[string]any{"name": "  Pedro Lucas "}, c).json(&me)
	if me.Name != "Pedro Lucas" || me.Theme != "dracula" {
		t.Errorf("patch nome: %+v", me)
	}

	assertField(t, a.do("PATCH", "/api/auth/me", map[string]any{"theme": "neon"}, c), 400, "theme")
	// "grafite" foi o tema escuro antigo: deixou de existir (migration 00006); todos os atuais são aceitos
	assertField(t, a.do("PATCH", "/api/auth/me", map[string]any{"theme": "grafite"}, c), 400, "theme")
	for _, th := range []string{"marfim", "solarized", "latte", "dracula", "nord", "gruvbox", "rosepine", "contraste", "sistema"} {
		if r := a.do("PATCH", "/api/auth/me", map[string]any{"theme": th}, c); r.Code != 200 {
			t.Errorf("tema %s recusado: %d %s", th, r.Code, r.Body)
		}
	}
	assertField(t, a.do("PATCH", "/api/auth/me", map[string]any{"name": "   "}, c), 400, "name")
	if r := a.do("PATCH", "/api/auth/me", map[string]any{"theme": "marfim"}, nil); r.Code != 401 {
		t.Errorf("sem sessão: %d", r.Code)
	}
}

func TestTrocarSenhaEncerraAsOutrasSessoes(t *testing.T) {
	a := newApp(t, opts{})
	c, _ := a.register("Pedro", "p@x.com", "Casa")
	celular := a.login("p@x.com", "senha-muito-segura").sessionCookie()

	// senha atual errada: 400 no campo, nada muda
	assertField(t, a.do("POST", "/api/auth/password", map[string]any{"currentPassword": "errada-errada", "newPassword": "outra-senha-boa"}, c), 400, "currentPassword")
	// nova curta demais
	assertField(t, a.do("POST", "/api/auth/password", map[string]any{"currentPassword": "senha-muito-segura", "newPassword": "curta"}, c), 400, "newPassword")
	if r := a.do("GET", "/api/auth/me", nil, celular); r.Code != 200 {
		t.Fatalf("tentativas inválidas não podem derrubar sessões: %d", r.Code)
	}

	r := a.do("POST", "/api/auth/password", map[string]any{"currentPassword": "senha-muito-segura", "newPassword": "outra-senha-boa"}, c)
	if r.Code != http.StatusNoContent {
		t.Fatalf("trocar senha: %d %s", r.Code, r.Body)
	}
	if r := a.do("GET", "/api/auth/me", nil, c); r.Code != 200 {
		t.Errorf("a sessão atual deveria continuar: %d", r.Code)
	}
	if r := a.do("GET", "/api/auth/me", nil, celular); r.Code != 401 {
		t.Errorf("a outra sessão deveria cair: %d", r.Code)
	}
	if r := a.login("p@x.com", "senha-muito-segura"); r.Code != 401 {
		t.Errorf("senha antiga ainda entra: %d", r.Code)
	}
	if r := a.login("p@x.com", "outra-senha-boa"); r.Code != 200 {
		t.Errorf("senha nova não entra: %d", r.Code)
	}
	// o hash é argon2id (como no cadastro)
	var hash string
	a.db.Raw("SELECT password_hash FROM users WHERE email = 'p@x.com'").Scan(&hash)
	if len(hash) < 10 || hash[:10] != "$argon2id$" {
		t.Errorf("hash não é argon2id: %.12s", hash)
	}
}

func TestTrocarSenhaTemLimiteDeTentativas(t *testing.T) {
	a := newApp(t, opts{})
	c, _ := a.register("Pedro", "p@x.com", "Casa")
	last := 0
	for i := 0; i < 8; i++ {
		last = a.do("POST", "/api/auth/password", map[string]any{"currentPassword": "chute-errado", "newPassword": "outra-senha-boa"}, c).Code
	}
	if last != http.StatusTooManyRequests {
		t.Errorf("depois de 8 tentativas: %d, quer 429", last)
	}
}

func TestSairDosOutrosAparelhos(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	c, _ := a.register("Pedro", "p@x.com", "Casa")
	tablet := a.login("p@x.com", "senha-muito-segura").sessionCookie()
	celular := a.login("p@x.com", "senha-muito-segura").sessionCookie()
	// a sessão de outra pessoa não é tocada
	ana, _ := a.register("Ana", "ana@x.com", "Casa A")

	r := a.do("DELETE", "/api/auth/sessions/others", nil, c)
	if r.Code != http.StatusOK {
		t.Fatalf("sair dos outros: %d %s", r.Code, r.Body)
	}
	var out struct{ Ended int }
	r.json(&out)
	if out.Ended != 2 {
		t.Errorf("encerradas = %d, quer 2", out.Ended)
	}
	for name, ck := range map[string]*http.Cookie{"tablet": tablet, "celular": celular} {
		if r := a.do("GET", "/api/auth/me", nil, ck); r.Code != 401 {
			t.Errorf("%s continua logado: %d", name, r.Code)
		}
	}
	for name, ck := range map[string]*http.Cookie{"atual": c, "ana": ana} {
		if r := a.do("GET", "/api/auth/me", nil, ck); r.Code != 200 {
			t.Errorf("sessão %s caiu: %d", name, r.Code)
		}
	}
}
