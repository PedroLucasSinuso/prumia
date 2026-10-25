package api

import (
	"crypto/sha256"
	"net/http"
	"testing"
	"time"
)

type signupInviteT struct {
	ID        string `json:"id"`
	Token     string `json:"token"`
	CreatedAt string `json:"createdAt"`
	ExpiresAt string `json:"expiresAt"`
}

type signupMeT struct {
	ID            string `json:"id"`
	IsSystemOwner bool   `json:"isSystemOwner"`
	Households    []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Role string `json:"role"`
	} `json:"households"`
}

func (a *app) newSignupInvite(c *http.Cookie, body map[string]any) (signupInviteT, resp) {
	a.t.Helper()
	var b any
	if body != nil {
		b = body
	}
	r := a.do("POST", "/api/auth/signup-invites", b, c)
	var out signupInviteT
	if r.Code == http.StatusCreated {
		r.json(&out)
	}
	return out, r
}

func (a *app) signupInvites(c *http.Cookie) []signupInviteT {
	a.t.Helper()
	r := a.do("GET", "/api/auth/signup-invites", nil, c)
	if r.Code != http.StatusOK {
		a.t.Fatalf("listar convites de cadastro: %d %s", r.Code, r.Body)
	}
	var out []signupInviteT
	r.json(&out)
	return out
}

func (a *app) signup(token, email, house string) resp {
	a.t.Helper()
	return a.do("POST", "/api/auth/register", map[string]any{
		"name": "Nova", "email": email, "password": "senha-muito-segura", "householdName": house, "signupToken": token,
	}, nil)
}

func meOf(r resp) signupMeT {
	var m signupMeT
	r.json(&m)
	return m
}

// O fluxo do plano: o dono do sistema gera o link; quem abre cria a PRÓPRIA conta e a própria casa (com carteiras e
// categorias padrão), mesmo com o cadastro livre fechado. O link é de uso único.
func TestConviteDeCadastroCriaContaECasaPropria(t *testing.T) {
	a := newApp(t, opts{now: func() time.Time { return today }})
	owner, _ := a.register("Ana", "ana@x.com", "Casa A")
	if me := meOf(a.do("GET", "/api/auth/me", nil, owner)); !me.IsSystemOwner {
		t.Fatalf("a primeira conta deveria ser a dona do sistema: %+v", me)
	}
	// sem convite, o cadastro continua fechado
	if r := a.do("POST", "/api/auth/register", map[string]any{"name": "X", "email": "x@x.com", "password": "senha-muito-segura"}, nil); r.Code != 403 || a.code(r) != "registration_closed" {
		t.Fatalf("cadastro sem convite: %d %s", r.Code, r.Body)
	}

	inv, r := a.newSignupInvite(owner, nil)
	if r.Code != 201 || inv.Token == "" || inv.ExpiresAt == "" {
		t.Fatalf("gerar convite de cadastro: %d %s", r.Code, r.Body)
	}
	if got, _ := time.Parse(time.RFC3339, inv.ExpiresAt); got.Sub(today) != 48*time.Hour {
		t.Errorf("validade padrão deveria ser 48h: %s", inv.ExpiresAt)
	}
	if n := len(a.signupInvites(owner)); n != 1 {
		t.Errorf("pendentes: %d", n)
	}
	// só o hash vai para o banco
	var plain int64
	a.db.Raw("SELECT count(*) FROM signup_invites WHERE token_hash = ?", []byte(inv.Token)).Scan(&plain)
	sum := sha256.Sum256([]byte(inv.Token))
	var hashed int64
	a.db.Raw("SELECT count(*) FROM signup_invites WHERE token_hash = ?", sum[:]).Scan(&hashed)
	if plain != 0 || hashed != 1 {
		t.Errorf("token em claro=%d hash=%d", plain, hashed)
	}

	r = a.signup(inv.Token, "bia@x.com", "Casa da Bia")
	if r.Code != 201 {
		t.Fatalf("cadastro com convite: %d %s", r.Code, r.Body)
	}
	bia := r.sessionCookie()
	me := meOf(r)
	if me.IsSystemOwner || len(me.Households) != 1 || me.Households[0].Name != "Casa da Bia" || me.Households[0].Role != "admin" {
		t.Errorf("conta nova: %+v", me)
	}
	// casa própria, com carteiras e categorias padrão, e sem acesso à casa de quem convidou
	house := me.Households[0].ID
	if a.free(house) == "" || a.vr(house) == "" {
		t.Error("a casa nova deveria ter as carteiras padrão")
	}
	var cats []cat
	a.do("GET", "/api/households/"+house+"/categories", nil, bia).json(&cats)
	if len(cats) == 0 {
		t.Error("a casa nova deveria ter as categorias padrão")
	}
	if n := len(meOf(a.do("GET", "/api/auth/me", nil, owner)).Households); n != 1 {
		t.Errorf("a dona do sistema não ganha casa nova: %d", n)
	}
	// uso único
	if r := a.signup(inv.Token, "caio@x.com", "Casa do Caio"); r.Code != 400 || a.code(r) != "invalid_signup_invite" {
		t.Errorf("reusar o convite: %d %s", r.Code, r.Body)
	}
	if n := len(a.signupInvites(owner)); n != 0 {
		t.Errorf("usado não é pendente: %d", n)
	}
	// quem não é dono do sistema não gera, não lista e não revoga
	if _, r := a.newSignupInvite(bia, nil); r.Code != 403 {
		t.Errorf("não dono gerando: %d", r.Code)
	}
	if r := a.do("GET", "/api/auth/signup-invites", nil, bia); r.Code != 403 {
		t.Errorf("não dono listando: %d", r.Code)
	}
	if r := a.do("DELETE", "/api/auth/signup-invites/"+inv.ID, nil, bia); r.Code != 403 {
		t.Errorf("não dono revogando: %d", r.Code)
	}
	if r := a.do("POST", "/api/auth/signup-invites", nil, nil); r.Code != 401 {
		t.Errorf("sem login: %d", r.Code)
	}
}

func TestConviteDeCadastroInvalidoNaoGravaNada(t *testing.T) {
	clock := today
	a := newApp(t, opts{now: func() time.Time { return clock }})
	owner, _ := a.register("Ana", "ana@x.com", "Casa A")
	var before int64
	a.db.Raw("SELECT count(*) FROM users").Scan(&before)

	// token inexistente
	if r := a.signup("token-que-nao-existe", "x@x.com", "Casa X"); r.Code != 400 || a.code(r) != "invalid_signup_invite" {
		t.Errorf("inexistente: %d %s", r.Code, r.Body)
	}
	// vencido
	short, _ := a.newSignupInvite(owner, map[string]any{"expiresInHours": 1})
	clock = today.Add(2 * time.Hour)
	if r := a.signup(short.Token, "y@x.com", "Casa Y"); r.Code != 400 || a.code(r) != "invalid_signup_invite" {
		t.Errorf("vencido: %d %s", r.Code, r.Body)
	}
	// revogado (e revogar de novo é idempotente)
	rev, _ := a.newSignupInvite(owner, nil)
	if r := a.do("DELETE", "/api/auth/signup-invites/"+rev.ID, nil, owner); r.Code != 204 {
		t.Fatalf("revogar: %d", r.Code)
	}
	if r := a.do("DELETE", "/api/auth/signup-invites/"+rev.ID, nil, owner); r.Code != 204 {
		t.Errorf("revogar de novo: %d", r.Code)
	}
	if r := a.signup(rev.Token, "z@x.com", "Casa Z"); r.Code != 400 || a.code(r) != "invalid_signup_invite" {
		t.Errorf("revogado: %d %s", r.Code, r.Body)
	}
	if r := a.do("DELETE", "/api/auth/signup-invites/"+fakeID, nil, owner); r.Code != 404 {
		t.Errorf("revogar inexistente: %d", r.Code)
	}
	var after int64
	a.db.Raw("SELECT count(*) FROM users").Scan(&after)
	if after != before {
		t.Errorf("convite inválido não pode criar conta: antes %d, depois %d", before, after)
	}
	// e-mail repetido com convite válido: nada é gravado e o convite NÃO é consumido
	ok, _ := a.newSignupInvite(owner, nil)
	if r := a.signup(ok.Token, "ana@x.com", "Casa Repetida"); r.Code != 409 {
		t.Errorf("e-mail repetido: %d %s", r.Code, r.Body)
	}
	var used int64
	a.db.Raw("SELECT count(*) FROM signup_invites WHERE id = ? AND used_at IS NOT NULL", ok.ID).Scan(&used)
	if used != 0 {
		t.Error("o convite não deveria ser consumido quando o cadastro falha")
	}
}

func TestConviteDeCadastroValidacoesETeto(t *testing.T) {
	a := newApp(t, opts{now: func() time.Time { return today }})
	owner, house := a.register("Ana", "ana@x.com", "Casa A")
	for _, h := range []int{0, -1, 169} {
		_, r := a.newSignupInvite(owner, map[string]any{"expiresInHours": h})
		assertField(t, r, 400, "expiresInHours")
	}
	if inv, r := a.newSignupInvite(owner, map[string]any{"expiresInHours": 168}); r.Code != 201 || inv.Token == "" {
		t.Errorf("7 dias: %d %s", r.Code, r.Body)
	}
	for i := 0; i < 4; i++ {
		if _, r := a.newSignupInvite(owner, nil); r.Code != 201 {
			t.Fatalf("convite %d: %d %s", i+2, r.Code, r.Body)
		}
	}
	_, r := a.newSignupInvite(owner, nil)
	if r.Code != 409 || a.code(r) != "signup_invite_limit" {
		t.Errorf("6º pendente: %d %s", r.Code, r.Body)
	}
	pend := a.signupInvites(owner)
	if len(pend) != 5 {
		t.Fatalf("pendentes: %d", len(pend))
	}
	a.do("DELETE", "/api/auth/signup-invites/"+pend[0].ID, nil, owner)
	if _, r := a.newSignupInvite(owner, nil); r.Code != 201 {
		t.Errorf("depois de revogar um: %d", r.Code)
	}
	// convite de casa e de cadastro juntos: escolha um
	tok, _ := a.invite(owner, house, "member")
	r = a.do("POST", "/api/auth/register", map[string]any{
		"name": "X", "email": "x@x.com", "password": "senha-muito-segura", "inviteToken": tok, "signupToken": "abc",
	}, nil)
	assertField(t, r, 400, "signupToken")
}
