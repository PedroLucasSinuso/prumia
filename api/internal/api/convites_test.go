package api

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
)

// --- helpers deste arquivo -------------------------------------------------

// newUser cria um usuário direto pelo serviço (sem passar pelo limite de cadastro por IP do handler) e devolve
// o cookie de sessão e o id. Cria também a casa própria dele (como o cadastro livre faz).
func (a *app) newUser(name, email string) (*http.Cookie, string) {
	a.t.Helper()
	user, tok, err := a.auth.Register(context.Background(), auth.RegisterInput{
		Name: name, Email: email, Password: "senha-muito-segura", HouseholdName: "Casa de " + name,
	}, auth.Meta{})
	if err != nil {
		a.t.Fatalf("newUser %s: %v", email, err)
	}
	return &http.Cookie{Name: "prumia_session", Value: tok}, user.ID.String()
}

func (a *app) userID(email string) string {
	var id string
	a.db.Raw("SELECT id::text FROM users WHERE email = ?", email).Scan(&id)
	return id
}

// invite cria um convite e devolve (token em claro, id do convite).
func (a *app) invite(c *http.Cookie, house, role string) (string, string) {
	a.t.Helper()
	r := a.do("POST", "/api/households/"+house+"/invites", map[string]any{"role": role}, c)
	if r.Code != http.StatusCreated {
		a.t.Fatalf("criar convite: %d %s", r.Code, r.Body.String())
	}
	var out struct{ Id, Token, Role string }
	r.json(&out)
	return out.Token, out.Id
}

// join leva um usuário já existente para a casa com o papel dado, via convite + aceite.
func (a *app) join(admin *http.Cookie, house, role string, user *http.Cookie) {
	a.t.Helper()
	tok, _ := a.invite(admin, house, role)
	if r := a.do("POST", "/api/invites/accept", map[string]any{"token": tok}, user); r.Code != 200 {
		a.t.Fatalf("aceitar convite: %d %s", r.Code, r.Body.String())
	}
}

func (a *app) code(r resp) string {
	var p problemBody
	r.json(&p)
	return p.Code
}

func (a *app) role(house, user string) string {
	var role string
	a.db.Raw("SELECT role FROM household_members WHERE household_id = ? AND user_id = ? AND left_at IS NULL", house, user).Scan(&role)
	return role
}

// --- convites --------------------------------------------------------------

func TestConviteCadastroEntraNaCasaSemCriarOutra(t *testing.T) {
	a := newApp(t, opts{}) // cadastro livre FECHADO: o convite é a única porta
	admin, house := a.register("Ana", "ana@x.com", "Casa da Ana")
	tok, inviteID := a.invite(admin, house, "member")

	// o token em claro nunca vai para o banco; só o SHA-256
	var plain int64
	a.db.Raw("SELECT count(*) FROM household_invites WHERE encode(token_hash,'escape') = ?", tok).Scan(&plain)
	if plain != 0 {
		t.Fatal("token em claro no banco")
	}
	sum := sha256.Sum256([]byte(tok))
	var hashed int64
	a.db.Raw("SELECT count(*) FROM household_invites WHERE token_hash = ?", sum[:]).Scan(&hashed)
	if hashed != 1 {
		t.Fatal("o hash SHA-256 do token deveria estar no banco")
	}

	// cadastro com convite: 201, entra na casa da Ana como member, SEM casa nova
	r := a.do("POST", "/api/auth/register", map[string]any{
		"name": "Beto", "email": "beto@x.com", "password": "senha-muito-segura", "inviteToken": tok, "householdName": "Ignorada",
	}, nil)
	if r.Code != 201 {
		t.Fatalf("register com convite: %d %s", r.Code, r.Body.String())
	}
	var me struct {
		Households []struct{ Id, Name, Role string }
	}
	r.json(&me)
	if len(me.Households) != 1 || me.Households[0].Id != house || me.Households[0].Role != "member" {
		t.Errorf("deveria estar só na casa da Ana como member: %+v", me.Households)
	}
	var houses int64
	a.db.Raw("SELECT count(*) FROM households").Scan(&houses)
	if houses != 1 {
		t.Errorf("casas = %d, o cadastro com convite não pode criar casa", houses)
	}
	var usedBy string
	a.db.Raw("SELECT used_by::text FROM household_invites WHERE id = ? AND used_at IS NOT NULL", inviteID).Scan(&usedBy)
	if usedBy != a.userID("beto@x.com") {
		t.Errorf("used_by = %q", usedBy)
	}

	// uso único: o mesmo token não serve de novo (nem para cadastrar, nem para aceitar)
	r = a.do("POST", "/api/auth/register", map[string]any{"name": "Cris", "email": "cris@x.com", "password": "senha-muito-segura", "inviteToken": tok}, nil)
	if r.Code != 400 || a.code(r) != "invalid_invite" {
		t.Errorf("reuso no cadastro: %d %s", r.Code, r.Body.String())
	}
	var cris int64
	a.db.Raw("SELECT count(*) FROM users WHERE email = 'cris@x.com'").Scan(&cris)
	if cris != 0 {
		t.Error("convite inválido não pode deixar usuário criado")
	}
	tokDora, _ := a.invite(admin, house, "member")
	rd := a.do("POST", "/api/auth/register", map[string]any{"name": "Dora", "email": "dora@x.com", "password": "senha-muito-segura", "inviteToken": tokDora}, nil)
	cDora := rd.sessionCookie()
	if r := a.do("POST", "/api/invites/accept", map[string]any{"token": tok}, cDora); r.Code != 400 || a.code(r) != "invalid_invite" {
		t.Errorf("reuso no aceite: %d %s", r.Code, r.Body.String())
	}
}

func TestConviteCadastroComEmailRepetidoNaoConsomeOConvite(t *testing.T) {
	a := newApp(t, opts{})
	admin, house := a.register("Ana", "ana@x.com", "Casa")
	tok, id := a.invite(admin, house, "viewer")
	r := a.do("POST", "/api/auth/register", map[string]any{"name": "Outra", "email": "ANA@x.com", "password": "senha-muito-segura", "inviteToken": tok}, nil)
	if r.Code != 409 {
		t.Fatalf("e-mail repetido: %d", r.Code)
	}
	var used int64
	a.db.Raw("SELECT count(*) FROM household_invites WHERE id = ? AND used_at IS NOT NULL", id).Scan(&used)
	if used != 0 {
		t.Error("a transação deveria ter desfeito o consumo do convite")
	}
}

func TestConviteValidadeExpiracaoERole(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	admin, house := a.register("Ana", "ana@x.com", "Casa")
	base := "/api/households/" + house + "/invites"

	for _, h := range []int{0, -1, 169} {
		r := a.do("POST", base, map[string]any{"role": "member", "expiresInHours": h}, admin)
		if r.Code != 400 || a.code(r) != "validation_error" {
			t.Errorf("expiresInHours=%d deveria ser 400: %d", h, r.Code)
		}
	}
	if r := a.do("POST", base, map[string]any{"role": "dono"}, admin); r.Code != 400 {
		t.Errorf("role inválido: %d", r.Code)
	}
	if r := a.do("POST", base, map[string]any{"role": "member", "expiresInHours": 168}, admin); r.Code != 201 {
		t.Errorf("168h deveria valer: %d", r.Code)
	}

	// padrão = 48h
	_, id := a.invite(admin, house, "member")
	var hours float64
	a.db.Raw("SELECT round(extract(epoch FROM expires_at - created_at)/3600) FROM household_invites WHERE id = ?", id).Scan(&hours)
	if hours != 48 {
		t.Errorf("validade padrão = %vh, quer 48", hours)
	}

	// expirado => 400 (no aceite e no cadastro)
	tok, id := a.invite(admin, house, "member")
	a.db.Exec("UPDATE household_invites SET expires_at = now() - interval '1 minute' WHERE id = ?", id)
	cB, _ := a.newUser("Beto", "beto@x.com")
	if r := a.do("POST", "/api/invites/accept", map[string]any{"token": tok}, cB); r.Code != 400 || a.code(r) != "invalid_invite" {
		t.Errorf("expirado no aceite: %d", r.Code)
	}
	r := a.do("POST", "/api/auth/register", map[string]any{"name": "C", "email": "c@x.com", "password": "senha-muito-segura", "inviteToken": tok}, nil)
	if r.Code != 400 {
		t.Errorf("expirado no cadastro: %d", r.Code)
	}
	// token inventado
	if r := a.do("POST", "/api/invites/accept", map[string]any{"token": "nao-existe"}, cB); r.Code != 400 {
		t.Errorf("token inventado: %d", r.Code)
	}
	// aceite exige login
	if r := a.do("POST", "/api/invites/accept", map[string]any{"token": tok}, nil); r.Code != 401 {
		t.Errorf("sem login: %d", r.Code)
	}
}

func TestConviteRevogacaoEIsolamento(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h1 := a.register("Ana", "ana@x.com", "Casa 1")
	cris, h2 := a.newUser("Cris", "cris@x.com") // admin da própria casa
	_ = cris
	var h2id string
	a.db.Raw("SELECT household_id::text FROM household_members WHERE user_id = ?", a.userID("cris@x.com")).Scan(&h2id)
	h2 = h2id
	beto, _ := a.newUser("Beto", "beto@x.com")

	tok, id := a.invite(ana, h1, "member")

	// admin de OUTRA casa não revoga (a casa da URL é a dele: o convite não existe nela => 404) nem usa a rota da casa 1 (não é membro => 404)
	if r := a.do("DELETE", "/api/households/"+h2+"/invites/"+id, nil, cris); r.Code != 404 {
		t.Errorf("revogar convite de outra casa pela casa dele: %d", r.Code)
	}
	if r := a.do("DELETE", "/api/households/"+h1+"/invites/"+id, nil, cris); r.Code != 404 {
		t.Errorf("não-membro revogando: %d", r.Code)
	}
	if r := a.do("POST", "/api/households/"+h1+"/invites", map[string]any{"role": "admin"}, cris); r.Code != 404 {
		t.Errorf("não-membro criando convite: %d", r.Code)
	}

	// admin revoga: depois disso o token não entra mais
	if r := a.do("DELETE", "/api/households/"+h1+"/invites/"+id, nil, ana); r.Code != 204 {
		t.Fatalf("revogar: %d", r.Code)
	}
	if r := a.do("DELETE", "/api/households/"+h1+"/invites/"+id, nil, ana); r.Code != 204 {
		t.Errorf("revogar de novo é idempotente: %d", r.Code)
	}
	if r := a.do("POST", "/api/invites/accept", map[string]any{"token": tok}, beto); r.Code != 400 {
		t.Errorf("aceitar revogado: %d", r.Code)
	}
	if r := a.do("DELETE", "/api/households/"+h1+"/invites/00000000-0000-0000-0000-000000000000", nil, ana); r.Code != 404 {
		t.Errorf("convite inexistente: %d", r.Code)
	}

	// convite já usado não pode ser revogado: 409
	tok2, id2 := a.invite(ana, h1, "member")
	if r := a.do("POST", "/api/invites/accept", map[string]any{"token": tok2}, beto); r.Code != 200 {
		t.Fatalf("aceitar: %d", r.Code)
	}
	if r := a.do("DELETE", "/api/households/"+h1+"/invites/"+id2, nil, ana); r.Code != 409 || a.code(r) != "invite_used" {
		t.Errorf("revogar usado: %d", r.Code)
	}
}

func TestConviteSoAdminGera(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h := a.register("Ana", "ana@x.com", "Casa")
	mem, _ := a.newUser("Mem", "mem@x.com")
	vw, _ := a.newUser("Vw", "vw@x.com")
	a.join(ana, h, "member", mem)
	a.join(ana, h, "viewer", vw)
	tok, id := a.invite(ana, h, "member")

	for name, c := range map[string]*http.Cookie{"member": mem, "viewer": vw} {
		if r := a.do("POST", "/api/households/"+h+"/invites", map[string]any{"role": "admin"}, c); r.Code != 403 {
			t.Errorf("%s criando convite: %d", name, r.Code)
		}
		if r := a.do("DELETE", "/api/households/"+h+"/invites/"+id, nil, c); r.Code != 403 {
			t.Errorf("%s revogando convite: %d", name, r.Code)
		}
	}
	// o convite continua válido depois das tentativas
	cNew, _ := a.newUser("Novo", "novo@x.com")
	if r := a.do("POST", "/api/invites/accept", map[string]any{"token": tok}, cNew); r.Code != 200 {
		t.Errorf("convite deveria seguir válido: %d", r.Code)
	}
}

func TestConviteJaMembroDa409ENaoConsome(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h := a.register("Ana", "ana@x.com", "Casa")
	tok, id := a.invite(ana, h, "viewer")
	// a própria Ana já é admin: aceitar um convite viewer não pode rebaixá-la
	if r := a.do("POST", "/api/invites/accept", map[string]any{"token": tok}, ana); r.Code != 409 || a.code(r) != "already_member" {
		t.Fatalf("já membro: %d %s", r.Code, r.Body.String())
	}
	if a.role(h, a.userID("ana@x.com")) != "admin" {
		t.Error("o papel não pode mudar")
	}
	var used int64
	a.db.Raw("SELECT count(*) FROM household_invites WHERE id = ? AND used_at IS NOT NULL", id).Scan(&used)
	if used != 0 {
		t.Error("convite não deveria ter sido consumido")
	}
}

func TestConviteUsoUnicoSobConcorrencia(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h := a.register("Ana", "ana@x.com", "Casa")
	tok, _ := a.invite(ana, h, "member")

	const n = 8
	cookies := make([]*http.Cookie, n)
	for i := range cookies {
		cookies[i], _ = a.newUser(fmt.Sprintf("U%d", i), fmt.Sprintf("u%d@x.com", i))
	}
	codes := make([]int, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i] = a.do("POST", "/api/invites/accept", map[string]any{"token": tok}, cookies[i]).Code
		}()
	}
	wg.Wait()
	ok, bad := 0, 0
	for _, c := range codes {
		switch c {
		case 200:
			ok++
		case 400:
			bad++
		}
	}
	if ok != 1 || bad != n-1 {
		t.Errorf("deveria haver exatamente 1 sucesso: códigos %v", codes)
	}
	var members int64
	a.db.Raw("SELECT count(*) FROM household_members WHERE household_id = ? AND left_at IS NULL", h).Scan(&members)
	if members != 2 {
		t.Errorf("membros = %d, quer 2 (Ana + 1)", members)
	}
}

// --- membros ---------------------------------------------------------------

func TestMembroPapeisEPermissoes(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h := a.register("Ana", "ana@x.com", "Casa")
	mem, memID := a.newUser("Mem", "mem@x.com")
	vw, vwID := a.newUser("Vw", "vw@x.com")
	a.join(ana, h, "member", mem)
	a.join(ana, h, "viewer", vw)
	stranger, strangerID := a.newUser("Estranho", "e@x.com")
	base := "/api/households/" + h + "/members/"

	// não-admin não muda papel nem remove outro
	if r := a.do("PATCH", base+vwID, map[string]any{"role": "admin"}, mem); r.Code != 403 {
		t.Errorf("member mudando papel: %d", r.Code)
	}
	if r := a.do("PATCH", base+memID, map[string]any{"role": "admin"}, vw); r.Code != 403 {
		t.Errorf("viewer mudando papel (auto-promoção): %d", r.Code)
	}
	if r := a.do("DELETE", base+vwID, nil, mem); r.Code != 403 {
		t.Errorf("member removendo outro: %d", r.Code)
	}
	if r := a.do("DELETE", base+memID, nil, vw); r.Code != 403 {
		t.Errorf("viewer removendo outro: %d", r.Code)
	}

	// admin muda papel; valida valor e alvo
	r := a.do("PATCH", base+memID, map[string]any{"role": "viewer"}, ana)
	var m struct{ UserId, Role string }
	r.json(&m)
	if r.Code != 200 || m.Role != "viewer" || m.UserId != memID {
		t.Errorf("PATCH role: %d %s", r.Code, r.Body.String())
	}
	if r := a.do("PATCH", base+memID, map[string]any{"role": "chefe"}, ana); r.Code != 400 {
		t.Errorf("role inválido: %d", r.Code)
	}
	if r := a.do("PATCH", base+strangerID, map[string]any{"role": "member"}, ana); r.Code != 404 {
		t.Errorf("alvo de outra casa: %d", r.Code)
	}
	if r := a.do("DELETE", base+strangerID, nil, ana); r.Code != 404 {
		t.Errorf("remover quem não é da casa: %d", r.Code)
	}
	_ = stranger

	// o viewer rebaixado não escreve mais (checado pelo middleware com o papel atual)
	if r := a.do("POST", "/api/households/"+h+"/categories", map[string]any{"name": "X"}, mem); r.Code != 403 {
		t.Errorf("viewer escrevendo: %d", r.Code)
	}

	// viewer sai sozinho
	if r := a.do("DELETE", base+vwID, nil, vw); r.Code != 204 {
		t.Fatalf("viewer saindo: %d", r.Code)
	}
	// ex-membro perde o acesso na hora, mas a linha continua (left_at)
	if r := a.do("GET", "/api/households/"+h, nil, vw); r.Code != 404 {
		t.Errorf("ex-membro lendo a casa: %d", r.Code)
	}
	if r := a.do("GET", "/api/households/"+h+"/invoices", nil, vw); r.Code != 404 {
		t.Errorf("ex-membro lendo invoices: %d", r.Code)
	}
	var rows int64
	a.db.Raw("SELECT count(*) FROM household_members WHERE household_id = ? AND user_id = ? AND left_at IS NOT NULL", h, vwID).Scan(&rows)
	if rows != 1 {
		t.Error("a linha do membro deve permanecer, com left_at")
	}
	// não aparece na listagem de membros
	var list []struct{ UserId string }
	a.do("GET", "/api/households/"+h+"/members", nil, ana).json(&list)
	for _, x := range list {
		if x.UserId == vwID {
			t.Error("ex-membro na listagem")
		}
	}
}

func TestReentradaReativaAMesmaLinha(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h := a.register("Ana", "ana@x.com", "Casa")
	beto, betoID := a.newUser("Beto", "beto@x.com")
	a.join(ana, h, "member", beto)
	if r := a.do("DELETE", "/api/households/"+h+"/members/"+betoID, nil, beto); r.Code != 204 {
		t.Fatalf("sair: %d", r.Code)
	}
	// o convite antigo-novo: reentra como viewer
	a.join(ana, h, "viewer", beto)
	if a.role(h, betoID) != "viewer" {
		t.Errorf("papel após reentrada = %q, quer viewer (o do novo convite)", a.role(h, betoID))
	}
	var rows int64
	a.db.Raw("SELECT count(*) FROM household_members WHERE household_id = ? AND user_id = ?", h, betoID).Scan(&rows)
	if rows != 1 {
		t.Errorf("linhas = %d, a PK (casa, usuário) mantém uma só", rows)
	}
	if r := a.do("GET", "/api/households/"+h, nil, beto); r.Code != 200 {
		t.Errorf("acesso após reentrada: %d", r.Code)
	}
}

func TestSempreUmAdminAtivo(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h := a.register("Ana", "ana@x.com", "Casa")
	anaID := a.userID("ana@x.com")
	beto, betoID := a.newUser("Beto", "beto@x.com")
	base := "/api/households/" + h + "/members/"

	// único admin: não sai, não é rebaixado, não é removido
	if r := a.do("DELETE", base+anaID, nil, ana); r.Code != 409 || a.code(r) != "last_admin" {
		t.Errorf("último admin saindo: %d %s", r.Code, r.Body.String())
	}
	if r := a.do("PATCH", base+anaID, map[string]any{"role": "member"}, ana); r.Code != 409 || a.code(r) != "last_admin" {
		t.Errorf("último admin rebaixando a si: %d", r.Code)
	}
	a.join(ana, h, "admin", beto)

	// dois admins: um pode sair; o que sobra fica protegido
	if r := a.do("DELETE", base+anaID, nil, ana); r.Code != 204 {
		t.Fatalf("Ana saindo com outro admin: %d", r.Code)
	}
	if r := a.do("DELETE", base+betoID, nil, beto); r.Code != 409 {
		t.Errorf("Beto agora é o último: %d", r.Code)
	}
}

func TestRebaixamentoSimultaneoNaoZeraOsAdmins(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h := a.register("Ana", "ana@x.com", "Casa")
	beto, betoID := a.newUser("Beto", "beto@x.com")
	a.join(ana, h, "admin", beto)
	anaID := a.userID("ana@x.com")

	var wg sync.WaitGroup
	codes := make([]int, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		codes[0] = a.do("PATCH", "/api/households/"+h+"/members/"+betoID, map[string]any{"role": "viewer"}, ana).Code
	}()
	go func() {
		defer wg.Done()
		codes[1] = a.do("PATCH", "/api/households/"+h+"/members/"+anaID, map[string]any{"role": "viewer"}, beto).Code
	}()
	wg.Wait()
	var admins int64
	a.db.Raw("SELECT count(*) FROM household_members WHERE household_id = ? AND role = 'admin' AND left_at IS NULL", h).Scan(&admins)
	if admins < 1 {
		t.Errorf("casa ficou sem admin! códigos %v", codes)
	}
}

func TestRemoverAdminRevogaConvitesPendentesDele(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h := a.register("Ana", "ana@x.com", "Casa")
	beto, betoID := a.newUser("Beto", "beto@x.com")
	a.join(ana, h, "admin", beto)
	tok, _ := a.invite(beto, h, "member")
	if r := a.do("DELETE", "/api/households/"+h+"/members/"+betoID, nil, ana); r.Code != 204 {
		t.Fatalf("remover: %d", r.Code)
	}
	cNew, _ := a.newUser("Novo", "novo@x.com")
	if r := a.do("POST", "/api/invites/accept", map[string]any{"token": tok}, cNew); r.Code != 400 {
		t.Errorf("convite de ex-admin deveria cair: %d", r.Code)
	}
}

// --- casa ------------------------------------------------------------------

func TestRenomearEExcluirCasa(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h := a.register("Ana", "ana@x.com", "Casa")
	mem, _ := a.newUser("Mem", "mem@x.com")
	a.join(ana, h, "member", mem)
	url := "/api/households/" + h

	if r := a.do("PATCH", url, map[string]any{"name": "Nova"}, mem); r.Code != 403 {
		t.Errorf("member renomeando: %d", r.Code)
	}
	if r := a.do("DELETE", url, nil, mem); r.Code != 403 {
		t.Errorf("member excluindo: %d", r.Code)
	}
	if r := a.do("PATCH", url, map[string]any{"name": "   "}, ana); r.Code != 400 {
		t.Errorf("nome vazio: %d", r.Code)
	}
	r := a.do("PATCH", url, map[string]any{"name": "  Casa Nova  "}, ana)
	var got struct{ Name string }
	r.json(&got)
	if r.Code != 200 || got.Name != "Casa Nova" {
		t.Errorf("renomear: %d %s", r.Code, r.Body.String())
	}
	tok, _ := a.invite(ana, h, "member")

	if r := a.do("DELETE", url, nil, ana); r.Code != 204 {
		t.Fatalf("excluir: %d", r.Code)
	}
	for _, c := range []*http.Cookie{ana, mem} {
		if r := a.do("GET", url, nil, c); r.Code != 404 {
			t.Errorf("casa excluída: %d", r.Code)
		}
	}
	var deleted int64
	a.db.Raw("SELECT count(*) FROM households WHERE id = ? AND deleted_at IS NOT NULL", h).Scan(&deleted)
	if deleted != 1 {
		t.Error("exclusão deve ser lógica")
	}
	cNew, _ := a.newUser("Novo", "novo@x.com")
	if r := a.do("POST", "/api/invites/accept", map[string]any{"token": tok}, cNew); r.Code != 400 {
		t.Errorf("convite de casa excluída: %d", r.Code)
	}
}

// --- redefinição de senha --------------------------------------------------

func (a *app) login(email, password string) resp {
	return a.do("POST", "/api/auth/login", map[string]any{"email": email, "password": password}, nil)
}

func (a *app) resetLink(c *http.Cookie, house, user string) resp {
	return a.do("POST", "/api/households/"+house+"/members/"+user+"/password-reset-link", nil, c)
}

func TestRedefinicaoDeSenhaFluxoCompleto(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h := a.register("Ana", "ana@x.com", "Casa")
	beto, betoID := a.newUser("Beto", "beto@x.com")
	a.join(ana, h, "member", beto)
	// Beto tinha uma casa própria criada no cadastro; sem o convite ele só seria dela. Para o escopo, a Ana
	// precisa administrar TODAS as casas dele: a casa própria do Beto conta. Beto sai dela (é o único admin: apaga a casa).
	var own string
	a.db.Raw("SELECT household_id::text FROM household_members WHERE user_id = ? AND household_id <> ?", betoID, h).Scan(&own)
	if r := a.do("DELETE", "/api/households/"+own, nil, beto); r.Code != 204 {
		t.Fatalf("apagar casa própria do Beto: %d", r.Code)
	}

	// sessões extras do Beto
	a.login("beto@x.com", "senha-muito-segura")
	a.login("beto@x.com", "senha-muito-segura")

	// member não gera link
	if r := a.resetLink(beto, h, betoID); r.Code != 403 {
		t.Errorf("member gerando link: %d", r.Code)
	}
	r := a.resetLink(ana, h, betoID)
	var link struct {
		Token     string
		ExpiresAt string
	}
	r.json(&link)
	if r.Code != 201 || link.Token == "" || link.ExpiresAt == "" {
		t.Fatalf("gerar link: %d %s", r.Code, r.Body.String())
	}
	var plain int64
	a.db.Raw("SELECT count(*) FROM password_reset_tokens WHERE encode(token_hash,'escape') = ?", link.Token).Scan(&plain)
	if plain != 0 {
		t.Error("token de reset em claro no banco")
	}
	sum := sha256.Sum256([]byte(link.Token))
	var hashed int64
	a.db.Raw("SELECT count(*) FROM password_reset_tokens WHERE token_hash = ?", sum[:]).Scan(&hashed)
	if hashed != 1 {
		t.Error("hash do token ausente")
	}

	// rota pública: sem cookie. Senha curta => 400 e o token NÃO é gasto
	if r := a.do("POST", "/api/auth/password-reset", map[string]any{"token": link.Token, "newPassword": "curta"}, nil); r.Code != 400 || a.code(r) != "validation_error" {
		t.Errorf("senha curta: %d", r.Code)
	}
	if r := a.do("POST", "/api/auth/password-reset", map[string]any{"token": "inventado", "newPassword": "outra-senha-boa-123"}, nil); r.Code != 400 || a.code(r) != "invalid_reset_token" {
		t.Errorf("token inventado: %d", r.Code)
	}
	if r := a.do("POST", "/api/auth/password-reset", map[string]any{"token": link.Token, "newPassword": "outra-senha-boa-123"}, nil); r.Code != 204 {
		t.Fatalf("redefinir: %d %s", r.Code, r.Body.String())
	}

	// todas as sessões do Beto foram encerradas
	var sessions int64
	a.db.Raw("SELECT count(*) FROM sessions WHERE user_id = ?", betoID).Scan(&sessions)
	if sessions != 0 {
		t.Errorf("sessões restantes do Beto = %d", sessions)
	}
	if r := a.do("GET", "/api/auth/me", nil, beto); r.Code != 401 {
		t.Errorf("sessão antiga: %d", r.Code)
	}
	if r := a.login("beto@x.com", "senha-muito-segura"); r.Code != 401 {
		t.Errorf("senha antiga ainda vale: %d", r.Code)
	}
	if r := a.login("beto@x.com", "outra-senha-boa-123"); r.Code != 200 {
		t.Errorf("senha nova: %d", r.Code)
	}
	// a sessão da Ana (que gerou o link) segue viva
	if r := a.do("GET", "/api/auth/me", nil, ana); r.Code != 200 {
		t.Errorf("sessão da Ana: %d", r.Code)
	}
	// uso único
	if r := a.do("POST", "/api/auth/password-reset", map[string]any{"token": link.Token, "newPassword": "mais-uma-senha-boa"}, nil); r.Code != 400 || a.code(r) != "invalid_reset_token" {
		t.Errorf("reuso do token: %d", r.Code)
	}
}

func TestRedefinicaoExpiradaEUsoUnicoSobConcorrencia(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h := a.register("Ana", "ana@x.com", "Casa")
	_, betoID := a.newUser("Beto", "beto@x.com")
	a.db.Exec("UPDATE household_members SET left_at = now() WHERE user_id = ?", betoID) // some a casa própria dele
	tokOf := func() string {
		a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member') ON CONFLICT (household_id, user_id) DO UPDATE SET left_at = NULL", h, betoID)
		r := a.resetLink(ana, h, betoID)
		var l struct{ Token string }
		r.json(&l)
		if r.Code != 201 {
			t.Fatalf("link: %d %s", r.Code, r.Body.String())
		}
		return l.Token
	}

	// expirado
	tok := tokOf()
	a.db.Exec("UPDATE password_reset_tokens SET expires_at = now() - interval '1 second'")
	if r := a.do("POST", "/api/auth/password-reset", map[string]any{"token": tok, "newPassword": "outra-senha-boa-123"}, nil); r.Code != 400 {
		t.Errorf("expirado: %d", r.Code)
	}
	// validade curta: ~1h
	tok = tokOf()
	var mins float64
	a.db.Raw("SELECT round(extract(epoch FROM expires_at - created_at)/60) FROM password_reset_tokens WHERE used_at IS NULL").Scan(&mins)
	if mins != 60 {
		t.Errorf("validade = %v min, quer 60", mins)
	}

	// corrida: 6 tentativas simultâneas, só uma passa
	var wg sync.WaitGroup
	codes := make([]int, 6)
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i] = a.do("POST", "/api/auth/password-reset", map[string]any{"token": tok, "newPassword": fmt.Sprintf("senha-nova-numero-%d", i)}, nil).Code
		}()
	}
	wg.Wait()
	ok := 0
	for _, c := range codes {
		if c == 204 {
			ok++
		}
	}
	if ok != 1 {
		t.Errorf("exatamente 1 deveria passar: %v", codes)
	}
}

func TestRedefinicaoEscopoMultiCasa(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h1 := a.register("Ana", "ana@x.com", "Casa 1")
	carla, carlaID := a.newUser("Carla", "carla@x.com")
	var h2 string
	a.db.Raw("SELECT household_id::text FROM household_members WHERE user_id = ?", carlaID).Scan(&h2)
	beto, betoID := a.newUser("Beto", "beto@x.com")
	a.db.Exec("UPDATE household_members SET left_at = now() WHERE user_id = ?", betoID) // sem casa própria
	a.join(ana, h1, "member", beto)
	anaID := a.userID("ana@x.com")

	// Beto só está na casa 1 (Ana admin): permitido
	if r := a.resetLink(ana, h1, betoID); r.Code != 201 {
		t.Fatalf("escopo simples: %d %s", r.Code, r.Body.String())
	}

	// Beto também entra na casa 2 da Carla; Ana NÃO é membro de lá => 403 e nenhum token novo
	a.join(carla, h2, "member", beto)
	var before int64
	a.db.Raw("SELECT count(*) FROM password_reset_tokens").Scan(&before)
	r := a.resetLink(ana, h1, betoID)
	if r.Code != 403 || a.code(r) != "reset_not_allowed" {
		t.Errorf("Ana não administra a casa 2: %d %s", r.Code, r.Body.String())
	}
	var after int64
	a.db.Raw("SELECT count(*) FROM password_reset_tokens").Scan(&after)
	if after != before {
		t.Error("não pode gerar token quando negado")
	}

	// Ana membro (não admin) da casa 2: continua negado
	a.join(carla, h2, "member", ana)
	if r := a.resetLink(ana, h1, betoID); r.Code != 403 {
		t.Errorf("Ana só member na casa 2: %d", r.Code)
	}
	// promovida a admin da casa 2: permitido
	if r := a.do("PATCH", "/api/households/"+h2+"/members/"+anaID, map[string]any{"role": "admin"}, carla); r.Code != 200 {
		t.Fatalf("promover Ana: %d", r.Code)
	}
	if r := a.resetLink(ana, h1, betoID); r.Code != 201 {
		t.Errorf("Ana admin das duas: %d", r.Code)
	}

	// alvo que não é membro da casa da URL: 404 (mesmo existindo em outra casa)
	if r := a.resetLink(ana, h1, carlaID); r.Code != 404 {
		t.Errorf("alvo fora da casa: %d", r.Code)
	}
	// admin de outra casa não gera link pela casa alheia
	if r := a.resetLink(carla, h1, betoID); r.Code != 404 {
		t.Errorf("não-membro gerando link: %d", r.Code)
	}
}

func TestRedefinicaoRevalidaEscopoNoUso(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h1 := a.register("Ana", "ana@x.com", "Casa 1")
	carla, carlaID := a.newUser("Carla", "carla@x.com")
	var h2 string
	a.db.Raw("SELECT household_id::text FROM household_members WHERE user_id = ?", carlaID).Scan(&h2)
	beto, betoID := a.newUser("Beto", "beto@x.com")
	a.db.Exec("UPDATE household_members SET left_at = now() WHERE user_id = ?", betoID)
	a.join(ana, h1, "member", beto)

	r := a.resetLink(ana, h1, betoID)
	var l struct{ Token string }
	r.json(&l)
	if r.Code != 201 {
		t.Fatalf("link: %d", r.Code)
	}
	// depois do link, o Beto entra numa casa que a Ana não administra: o link deixa de valer
	a.join(carla, h2, "member", beto)
	if r := a.do("POST", "/api/auth/password-reset", map[string]any{"token": l.Token, "newPassword": "outra-senha-boa-123"}, nil); r.Code != 400 {
		t.Errorf("link deveria cair: %d", r.Code)
	}
	if r := a.login("beto@x.com", "senha-muito-segura"); r.Code != 200 {
		t.Error("a senha não pode ter mudado")
	}
}

func TestNovoLinkInvalidaOAnterior(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, h := a.register("Ana", "ana@x.com", "Casa")
	_, betoID := a.newUser("Beto", "beto@x.com")
	a.db.Exec("UPDATE household_members SET left_at = now() WHERE user_id = ?", betoID)
	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'viewer')", h, betoID)
	get := func() string {
		var l struct{ Token string }
		r := a.resetLink(ana, h, betoID)
		r.json(&l)
		return l.Token
	}
	t1, t2 := get(), get()
	if r := a.do("POST", "/api/auth/password-reset", map[string]any{"token": t1, "newPassword": "outra-senha-boa-123"}, nil); r.Code != 400 {
		t.Errorf("link antigo: %d", r.Code)
	}
	if r := a.do("POST", "/api/auth/password-reset", map[string]any{"token": t2, "newPassword": "outra-senha-boa-123"}, nil); r.Code != 204 {
		t.Errorf("link novo: %d", r.Code)
	}
}
