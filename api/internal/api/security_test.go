package api

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"
)

// Testes de segurança "de varredura": em vez de listar rotas à mão (e esquecer a próxima), percorrem TODAS as rotas
// registradas no roteador. Rota nova sob /households/{householdId} entra no teste sozinha.

// mundo é o cenário: a casa A tem um exemplar de cada recurso; Beto é admin só da casa B; na casa A, Carla é viewer e
// Davi é member.
type mundo struct {
	a                   *app
	houseA, houseB      string
	ana, beto           *http.Cookie
	carla, davi         *http.Cookie
	ids                 map[string]string // parâmetro da rota -> id do recurso da casa A
	anaID, carlaID      string
	householdScopedPath []string
}

func novoMundo(t *testing.T) *mundo {
	t.Helper()
	a := newApp(t, opts{openRegistration: true, now: func() time.Time { return today }})
	m := &mundo{a: a}
	m.ana, m.houseA = a.register("Ana", "ana@x.com", "Casa A")
	m.beto, m.houseB = a.register("Beto", "beto@x.com", "Casa B")
	m.carla, _ = a.register("Carla", "carla@x.com", "Casa C")
	m.davi, _ = a.register("Davi", "davi@x.com", "Casa D")
	m.anaID, m.carlaID = a.uid("ana@x.com"), a.uid("carla@x.com")
	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'viewer')", m.houseA, m.carlaID)
	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')", m.houseA, a.uid("davi@x.com"))

	catA := mustCat(a, m.ana, m.houseA)
	invA, r := a.newInvoice(m.ana, m.houseA, catA, nil)
	if r.Code != 201 {
		t.Fatalf("invoice: %d %s", r.Code, r.Body)
	}
	p, r := a.newPurchase(m.ana, m.houseA, catA, nil)
	if r.Code != 201 {
		t.Fatalf("compra: %d %s", r.Code, r.Body)
	}
	rec, r := a.newRecurrence(m.ana, m.houseA, catA, nil)
	if r.Code != 201 {
		t.Fatalf("recorrência: %d %s", r.Code, r.Body)
	}
	src, r := a.newSource(m.ana, m.houseA, m.anaID, nil)
	if r.Code != 201 {
		t.Fatalf("fonte: %d %s", r.Code, r.Body)
	}
	inc := a.incomeOf(m.ana, m.houseA, "2026-10-01")
	var invite struct{ Id string }
	r = a.do("POST", "/api/households/"+m.houseA+"/invites", map[string]any{"role": "member"}, m.ana)
	if r.Code != 201 {
		t.Fatalf("convite: %d %s", r.Code, r.Body)
	}
	r.json(&invite)
	var c struct{ Id string }
	r = a.do("POST", "/api/households/"+m.houseA+"/categories", map[string]any{"name": "Só da Ana"}, m.ana)
	if r.Code != 201 {
		t.Fatalf("categoria: %d %s", r.Code, r.Body)
	}
	r.json(&c)
	var pe struct{ Id string }
	r = a.do("POST", "/api/households/"+m.houseA+"/payees", map[string]any{"name": "Só da Ana", "cnpj": "11.802.875/0001-23"}, m.ana)
	if r.Code != 201 {
		t.Fatalf("favorecido: %d %s", r.Code, r.Body)
	}
	r.json(&pe)
	// a invoice paga também (exercita "desfazer pagamento")
	a.pay(m.ana, m.houseA, p.Installments[0].ID, "free", nil)

	m.ids = map[string]string{
		"categoryId": c.Id, "payeeId": pe.Id, "invoiceId": invA.ID, "purchaseId": p.ID, "recurrenceId": rec.ID,
		"incomeId": inc.ID, "sourceId": src.ID, "inviteId": invite.Id, "userId": m.anaID,
	}
	for _, rt := range a.router.Routes() {
		if strings.HasPrefix(rt.Path, "/api/households/:householdId") {
			m.householdScopedPath = append(m.householdScopedPath, rt.Method+" "+rt.Path)
		}
	}
	sort.Strings(m.householdScopedPath)
	if len(m.householdScopedPath) < 30 {
		t.Fatalf("poucas rotas encontradas (%d): o teste não está varrendo o roteador", len(m.householdScopedPath))
	}
	return m
}

// url troca os parâmetros da rota: householdId pela casa pedida e os demais pelos ids dos recursos da casa A.
// A query cobre os parâmetros obrigatórios de algumas listagens (sem eles a resposta seria 400 e o teste não diria nada).
func (m *mundo) url(route, house string) (method, path string, otherIDs bool) {
	method, path, _ = strings.Cut(route, " ")
	path = strings.Replace(path, ":householdId", house, 1)
	for k, v := range m.ids {
		if strings.Contains(path, ":"+k) {
			path = strings.Replace(path, ":"+k, v, 1)
			otherIDs = true
		}
	}
	if strings.Contains(path, ":") {
		panic("parâmetro de rota sem id no cenário: " + path)
	}
	return method, path + "?month=2026-10-01&applyFrom=2026-10-01", otherIDs
}

// corpo genérico e plausível: o suficiente para a requisição chegar ao serviço em vez de parar no JSON.
var corpoGenerico = map[string]any{
	"name": "x", "description": "x", "amountCents": 1, "grossAmountCents": 1, "wallet": "free", "role": "member",
}

// impressaoDigital resume (md5) todas as linhas da casa A, em todas as tabelas com household_id, mais a conta da Ana.
// Se qualquer requisição alheia alterar qualquer coisa, a impressão muda.
func (m *mundo) impressaoDigital(t *testing.T) string {
	t.Helper()
	tables := []string{"households", "household_members", "household_invites", "categories", "payees", "invoices", "purchases",
		"recurrences", "invoice_boletos", "income_sources", "income_source_deductions", "incomes", "income_deductions"}
	var parts []string
	for _, tb := range tables {
		col := "household_id"
		if tb == "households" {
			col = "id"
		}
		var h string
		err := m.a.db.Raw(fmt.Sprintf(
			"SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM %s t WHERE %s = ?", tb, col), m.houseA).Scan(&h).Error
		if err != nil {
			t.Fatal(err)
		}
		parts = append(parts, tb+"="+h)
	}
	var u string
	m.a.db.Raw("SELECT md5(t::text) FROM users t WHERE id = ?", m.anaID).Scan(&u)
	var sess, resets int
	m.a.db.Raw("SELECT count(*) FROM sessions WHERE user_id = ?", m.anaID).Scan(&sess)
	m.a.db.Raw("SELECT count(*) FROM password_reset_tokens WHERE user_id = ?", m.anaID).Scan(&resets)
	return strings.Join(parts, ",") + fmt.Sprintf(",user=%s,sess=%d,resets=%d", u, sess, resets)
}

func isWriteMethod(m string) bool { return m != "GET" && m != "HEAD" && m != "OPTIONS" }

// Casa B nunca lê nem altera dados da casa A: nem pela URL da casa A (o porteiro responde 404), nem usando ids da
// casa A na URL da própria casa B (cada serviço filtra por household_id e responde 404).
func TestVarreduraCasaBNuncaLeNemAlteraACasaA(t *testing.T) {
	m := novoMundo(t)
	before := m.impressaoDigital(t)

	for _, route := range m.householdScopedPath {
		method, path, _ := m.url(route, m.houseA)
		var body any
		if isWriteMethod(method) {
			body = corpoGenerico
		}
		if r := m.a.do(method, path, body, m.beto); r.Code != http.StatusNotFound {
			t.Errorf("%s pela URL da casa A: %d %s (quer 404)", route, r.Code, r.Body)
		}
	}
	for _, route := range m.householdScopedPath {
		method, path, otherIDs := m.url(route, m.houseB)
		if !otherIDs {
			continue // listagens e criação na própria casa B são legítimas
		}
		var body any
		if isWriteMethod(method) {
			body = corpoGenerico
		}
		r := m.a.do(method, path, body, m.beto)
		if r.Code != http.StatusNotFound {
			t.Errorf("%s na casa B com id da casa A: %d %s (quer 404)", route, r.Code, r.Body)
		}
	}
	if after := m.impressaoDigital(t); after != before {
		t.Errorf("dados da casa A mudaram por requisições da casa B:\nantes  %s\ndepois %s", before, after)
	}
}

// viewer não escreve em NENHUMA rota da casa (inclusive boleto, convites e membros), e nada muda.
func TestVarreduraViewerNuncaEscreve(t *testing.T) {
	m := novoMundo(t)
	before := m.impressaoDigital(t)
	n := 0
	for _, route := range m.householdScopedPath {
		method, path, _ := m.url(route, m.houseA)
		if !isWriteMethod(method) {
			continue
		}
		n++
		if r := m.a.do(method, path, corpoGenerico, m.carla); r.Code != http.StatusForbidden {
			t.Errorf("viewer em %s: %d %s (quer 403)", route, r.Code, r.Body)
		}
	}
	if n < 20 {
		t.Fatalf("só %d rotas de escrita varridas", n)
	}
	if after := m.impressaoDigital(t); after != before {
		t.Errorf("viewer alterou dados:\nantes  %s\ndepois %s", before, after)
	}
	// A única escrita permitida ao viewer: sair da casa (DELETE no próprio membro).
	if r := m.a.do("DELETE", "/api/households/"+m.houseA+"/members/"+m.carlaID, nil, m.carla); r.Code != http.StatusNoContent {
		t.Errorf("viewer saindo da casa: %d %s", r.Code, r.Body)
	}
}

// Operações só de admin respondem 403 para member, e nada muda.
func TestVarreduraMemberNaoFazOperacaoDeAdmin(t *testing.T) {
	m := novoMundo(t)
	adminOnly := map[string]bool{
		"PATCH /api/households/:householdId":                                    true,
		"DELETE /api/households/:householdId":                                   true,
		"PATCH /api/households/:householdId/members/:userId":                    true,
		"DELETE /api/households/:householdId/members/:userId":                   true, // userId = Ana (outra pessoa)
		"POST /api/households/:householdId/invites":                             true,
		"DELETE /api/households/:householdId/invites/:inviteId":                 true,
		"POST /api/households/:householdId/members/:userId/password-reset-link": true,
	}
	before := m.impressaoDigital(t)
	for route := range adminOnly {
		method, path, _ := m.url(route, m.houseA)
		if r := m.a.do(method, path, corpoGenerico, m.davi); r.Code != http.StatusForbidden {
			t.Errorf("member em %s: %d %s (quer 403)", route, r.Code, r.Body)
		}
	}
	if after := m.impressaoDigital(t); after != before {
		t.Errorf("member alterou dados de admin:\nantes  %s\ndepois %s", before, after)
	}
	// toda rota admin listada existe de fato (renomear uma rota não pode desligar o teste em silêncio)
	have := map[string]bool{}
	for _, r := range m.householdScopedPath {
		have[r] = true
	}
	for route := range adminOnly {
		if !have[route] {
			t.Errorf("rota admin não existe mais: %s", route)
		}
	}
}
