package api

import (
	"net/http"
	"strings"
	"testing"
)

type walletOut struct {
	ID                  string  `json:"id"`
	Name                string  `json:"name"`
	Kind                string  `json:"kind"`
	Institution         *string `json:"institution"`
	OwnerUserID         *string `json:"ownerUserId"`
	IsDefault           bool    `json:"isDefault"`
	WarnOnOverdraft     bool    `json:"warnOnOverdraft"`
	OpeningBalanceCents int64   `json:"openingBalanceCents"`
	OpeningBalanceMonth *string `json:"openingBalanceMonth"`
	SortOrder           int     `json:"sortOrder"`
	Archived            bool    `json:"archived"`
}

func (a *app) wallets(c *http.Cookie, house string, includeArchived bool) []walletOut {
	a.t.Helper()
	q := ""
	if includeArchived {
		q = "?includeArchived=true"
	}
	r := a.do("GET", "/api/households/"+house+"/wallets"+q, nil, c)
	if r.Code != http.StatusOK {
		a.t.Fatalf("listar carteiras: %d %s", r.Code, r.Body)
	}
	var out []walletOut
	r.json(&out)
	return out
}

func (a *app) newWallet(c *http.Cookie, house string, body map[string]any) (walletOut, resp) {
	a.t.Helper()
	r := a.do("POST", "/api/households/"+house+"/wallets", body, c)
	var w walletOut
	if r.Code == http.StatusCreated {
		r.json(&w)
	}
	return w, r
}

func (a *app) patchWallet(c *http.Cookie, house, id string, body map[string]any) (walletOut, resp) {
	a.t.Helper()
	r := a.do("PATCH", "/api/households/"+house+"/wallets/"+id, body, c)
	var w walletOut
	if r.Code == http.StatusOK {
		r.json(&w)
	}
	return w, r
}

// walletAction chama POST .../wallets/{id}/archive ou /restore.
func (a *app) walletAction(c *http.Cookie, house, id, action string) (walletOut, resp) {
	a.t.Helper()
	r := a.do("POST", "/api/households/"+house+"/wallets/"+id+"/"+action, nil, c)
	var w walletOut
	if r.Code == http.StatusOK {
		r.json(&w)
	}
	return w, r
}

// postAvulsa cria uma receita avulsa (sem repetição) de outubro de 2026, "other" por padrão.
func (a *app) postAvulsa(c *http.Cookie, house string, extra map[string]any) (incT, resp) {
	a.t.Helper()
	body := map[string]any{
		"userId": a.uid("ana@x.com"), "kind": "other", "description": "Avulsa", "competenceMonth": "2026-10-01",
		"expectedDate": "2026-10-05", "grossAmountCents": 1000,
	}
	for k, v := range extra {
		body[k] = v
	}
	r := a.do("POST", "/api/households/"+house+"/incomes", body, c)
	var out incT
	if r.Code == http.StatusCreated {
		r.json(&out)
	}
	return out, r
}

const fakeID = "00000000-0000-0000-0000-000000000001"

func TestCasaNovaNasceComGeralEBeneficio(t *testing.T) {
	a, c, house, _ := casa(t)
	ws := a.wallets(c, house, false)
	if len(ws) != 2 {
		t.Fatalf("carteiras da casa nova: %+v", ws)
	}
	geral, ben := ws[0], ws[1]
	if geral.Name != "Geral" || !geral.IsDefault || geral.WarnOnOverdraft || geral.Archived || geral.OpeningBalanceCents != 0 {
		t.Errorf("Geral: %+v", geral)
	}
	if ben.Name != "Benefício" || ben.IsDefault || !ben.WarnOnOverdraft || ben.Archived {
		t.Errorf("Benefício: %+v", ben)
	}
	// uma segunda casa do mesmo usuário também ganha as suas (cada uma com ids próprios)
	r := a.do("POST", "/api/households", map[string]any{"name": "Casa da Praia"}, c)
	var h struct{ Id string }
	r.json(&h)
	other := a.wallets(c, h.Id, false)
	if r.Code != 201 || len(other) != 2 || other[0].ID == geral.ID || !other[0].IsDefault {
		t.Errorf("segunda casa: %d %+v", r.Code, other)
	}
	// o resumo lista as duas desde o primeiro dia, a padrão primeiro
	s := a.summaryOf(c, house, "2026-10-01")
	if len(s.Wallets) != 2 || s.Wallets[0].Name != "Geral" || !s.Wallets[0].IsDefault || s.Wallets[1].Name != "Benefício" {
		t.Errorf("resumo: %+v", s.Wallets)
	}
}

func TestCarteirasPermissoesPorPapel(t *testing.T) {
	a, c, house, _ := casa(t) // Ana é admin (o Responsável)
	davi, _ := a.newUser("Davi", "davi@x.com")
	carla, _ := a.newUser("Carla", "carla@x.com")
	a.join(c, house, "member", davi)
	a.join(c, house, "viewer", carla)

	w, r := a.newWallet(c, house, map[string]any{"name": "Reserva", "openingBalanceCents": 5000})
	if r.Code != 201 || w.Name != "Reserva" || w.OpeningBalanceCents != 5000 || !w.WarnOnOverdraft || w.IsDefault || w.Archived {
		t.Fatalf("admin cria: %d %s", r.Code, r.Body)
	}
	// todos os membros leem
	for name, ck := range map[string]*http.Cookie{"admin": c, "member": davi, "viewer": carla} {
		if got := a.wallets(ck, house, false); len(got) != 3 {
			t.Errorf("%s lista %d carteiras", name, len(got))
		}
	}
	// member: nada de escrita (403 `forbidden`, regra no service)
	writes := map[string]func() resp{
		"criar":    func() resp { _, r := a.newWallet(davi, house, map[string]any{"name": "Do Davi"}); return r },
		"renomear": func() resp { _, r := a.patchWallet(davi, house, w.ID, map[string]any{"name": "Outro"}); return r },
		"saldo": func() resp {
			_, r := a.patchWallet(davi, house, w.ID, map[string]any{"openingBalanceCents": 1})
			return r
		},
		"padrão":    func() resp { _, r := a.patchWallet(davi, house, w.ID, map[string]any{"isDefault": true}); return r },
		"arquivar":  func() resp { _, r := a.walletAction(davi, house, w.ID, "archive"); return r },
		"restaurar": func() resp { _, r := a.walletAction(davi, house, w.ID, "restore"); return r },
	}
	for name, do := range writes {
		if r := do(); r.Code != 403 || a.code(r) != "forbidden" {
			t.Errorf("member %s: %d %s (quer 403 forbidden)", name, r.Code, r.Body)
		}
	}
	// viewer: 403 `read_only` (porteiro)
	if _, r := a.newWallet(carla, house, map[string]any{"name": "Da Carla"}); r.Code != 403 || a.code(r) != "read_only" {
		t.Errorf("viewer criando: %d %s", r.Code, r.Body)
	}
	if _, r := a.patchWallet(carla, house, w.ID, map[string]any{"name": "X"}); r.Code != 403 {
		t.Errorf("viewer editando: %d", r.Code)
	}
	// nada mudou
	if got := a.wallets(c, house, false); len(got) != 3 || got[2].Name != "Reserva" || got[2].OpeningBalanceCents != 5000 || got[2].IsDefault {
		t.Errorf("carteiras depois das tentativas: %+v", got)
	}
	// sem sessão: 401
	if r := a.do("GET", "/api/households/"+house+"/wallets", nil, nil); r.Code != 401 {
		t.Errorf("sem login: %d", r.Code)
	}
}

func TestCarteirasValidacoes(t *testing.T) {
	a, c, house, _ := casa(t)
	beto, betoID := a.newUser("Beto", "beto@x.com") // não é da casa
	_ = beto
	anaID := a.userID("ana@x.com")

	for name, body := range map[string]map[string]any{
		"nome vazio":     {"name": "  "},
		"nome longo":     {"name": strings.Repeat("a", 41)},
		"sem nome":       {},
		"dono de fora":   {"name": "X", "ownerUserId": betoID},
		"dono inventado": {"name": "X", "ownerUserId": fakeID},
	} {
		_, r := a.newWallet(c, house, body)
		field := "name"
		if strings.HasPrefix(name, "dono") {
			field = "ownerUserId"
		}
		assertField(t, r, 400, field)
	}
	assertField(t, mustResp(a.newWallet(c, house, map[string]any{"name": "X", "openingBalanceCents": int64(10_000_000_000_000)})), 400, "openingBalanceCents")
	if r := a.do("POST", "/api/households/"+house+"/wallets", "isto não é um objeto", c); r.Code != 400 || a.code(r) != "bad_request" {
		t.Errorf("JSON inválido: %d %s", r.Code, r.Body)
	}

	// nome repetido, sem diferenciar maiúsculas e ignorando espaços nas pontas
	if _, r := a.newWallet(c, house, map[string]any{"name": " GERAL "}); r.Code != 409 || a.code(r) != "wallet_exists" {
		t.Errorf("nome repetido: %d %s", r.Code, r.Body)
	}
	// dono: membro da casa; saldo inicial negativo vale; limpar com null
	w, r := a.newWallet(c, house, map[string]any{"name": "  Da Ana ", "ownerUserId": anaID, "openingBalanceCents": -2500, "warnOnOverdraft": false})
	if r.Code != 201 || w.Name != "Da Ana" || w.OwnerUserID == nil || *w.OwnerUserID != anaID || w.OpeningBalanceCents != -2500 || w.WarnOnOverdraft {
		t.Fatalf("criar com dono: %d %s", r.Code, r.Body)
	}
	if w2, _ := a.newWallet(c, house, map[string]any{"name": "Outra"}); w2.SortOrder != w.SortOrder+1 {
		t.Errorf("nova carteira vai para o fim da lista: %d depois de %d", w2.SortOrder, w.SortOrder)
	}
	upd, r := a.patchWallet(c, house, w.ID, map[string]any{"ownerUserId": nil})
	if r.Code != 200 || upd.OwnerUserID != nil || upd.Name != "Da Ana" {
		t.Errorf("limpar o dono: %d %s", r.Code, r.Body)
	}
	upd, _ = a.patchWallet(c, house, w.ID, map[string]any{"name": "Renomeada", "warnOnOverdraft": true, "openingBalanceCents": 0, "sortOrder": 9})
	if upd.Name != "Renomeada" || !upd.WarnOnOverdraft || upd.OpeningBalanceCents != 0 || upd.SortOrder != 9 {
		t.Errorf("editar vários campos (zero e false valem): %+v", upd)
	}
	upd, _ = a.patchWallet(c, house, w.ID, map[string]any{"notes": "campo desconhecido"})
	if upd.Name != "Renomeada" {
		t.Errorf("patch vazio não muda nada: %+v", upd)
	}
	if _, r := a.patchWallet(c, house, w.ID, map[string]any{"name": "geral"}); r.Code != 409 || a.code(r) != "wallet_exists" {
		t.Errorf("renomear para nome de outra: %d %s", r.Code, r.Body)
	}
	assertField(t, mustResp(a.patchWallet(c, house, w.ID, map[string]any{"name": ""})), 400, "name")
	assertField(t, mustResp(a.patchWallet(c, house, w.ID, map[string]any{"ownerUserId": betoID})), 400, "ownerUserId")
	if _, r := a.patchWallet(c, house, fakeID, map[string]any{"name": "Z"}); r.Code != 404 {
		t.Errorf("carteira inexistente: %d", r.Code)
	}
}

// mustResp descarta o primeiro valor de (walletOut, resp), para encadear em assertField.
func mustResp(_ walletOut, r resp) resp { return r }

func TestCarteiraPadraoUnica(t *testing.T) {
	a, c, house, _ := casa(t)
	ws := a.wallets(c, house, false)
	geral, ben := ws[0], ws[1]

	// trocar a padrão: a antiga deixa de ser, e há sempre exatamente uma
	upd, r := a.patchWallet(c, house, ben.ID, map[string]any{"isDefault": true})
	if r.Code != 200 || !upd.IsDefault {
		t.Fatalf("trocar a padrão: %d %s", r.Code, r.Body)
	}
	ws = a.wallets(c, house, false)
	if ws[0].ID != ben.ID || !ws[0].IsDefault || ws[1].ID != geral.ID || ws[1].IsDefault {
		t.Errorf("a nova padrão vem primeiro: %+v", ws)
	}
	var n int
	a.db.Raw("SELECT count(*) FROM wallets WHERE household_id = ? AND is_default", house).Scan(&n)
	if n != 1 {
		t.Errorf("padrões na casa: %d", n)
	}
	// receita sem carteira cai na nova padrão
	in, r := a.postIncome(c, house, map[string]any{"kind": "salary", "dateRule": ruleBody("day_of_month", 5, ""), "grossAmountCents": 100000})
	if r.Code != 201 || in.WalletID != ben.ID {
		t.Errorf("receita sem carteira vai para a padrão: %d %s", r.Code, r.Body)
	}
	// pedir "não padrão" para a padrão é 400 (escolha outra); repetir isDefault=true não muda nada
	assertField(t, mustResp(a.patchWallet(c, house, ben.ID, map[string]any{"isDefault": false})), 400, "isDefault")
	if _, r := a.patchWallet(c, house, ben.ID, map[string]any{"isDefault": true}); r.Code != 200 {
		t.Errorf("repetir isDefault=true: %d", r.Code)
	}
	// a padrão não se arquiva
	if _, r := a.walletAction(c, house, ben.ID, "archive"); r.Code != 409 || a.code(r) != "wallet_is_default" {
		t.Errorf("arquivar a padrão: %d %s", r.Code, r.Body)
	}
	// arquivada não vira padrão
	if _, r := a.walletAction(c, house, geral.ID, "archive"); r.Code != 200 {
		t.Fatalf("arquivar a Geral (já não é a padrão): %d %s", r.Code, r.Body)
	}
	assertField(t, mustResp(a.patchWallet(c, house, geral.ID, map[string]any{"isDefault": true})), 400, "isDefault")
}

func TestArquivarERestaurarCarteira(t *testing.T) {
	a, c, house, cat := casa(t)
	ana := a.userID("ana@x.com")
	antiga, _ := a.newWallet(c, house, map[string]any{"name": "Antiga"})

	// com movimento em outubro (receita recebida), a carteira é arquivada, nunca apagada
	_, r := a.postAvulsa(c, house, map[string]any{"description": "Freela", "walletId": antiga.ID, "grossAmountCents": 50000})
	if r.Code != 201 {
		t.Fatalf("receita na carteira nova: %d %s", r.Code, r.Body)
	}
	if r := a.do("DELETE", "/api/households/"+house+"/wallets/"+antiga.ID, nil, c); r.Code == 204 || r.Code == 200 {
		t.Errorf("não existe exclusão de carteira: %d", r.Code)
	}
	arq, r := a.walletAction(c, house, antiga.ID, "archive")
	if r.Code != 200 || !arq.Archived {
		t.Fatalf("arquivar: %d %s", r.Code, r.Body)
	}
	if again, r := a.walletAction(c, house, antiga.ID, "archive"); r.Code != 200 || !again.Archived { // idempotente
		t.Errorf("arquivar de novo: %d", r.Code)
	}
	// some da lista normal, aparece com includeArchived
	for _, w := range a.wallets(c, house, false) {
		if w.ID == antiga.ID {
			t.Error("arquivada na lista padrão")
		}
	}
	found := false
	for _, w := range a.wallets(c, house, true) {
		found = found || (w.ID == antiga.ID && w.Archived)
	}
	if !found {
		t.Error("arquivada deveria vir com includeArchived")
	}
	// não recebe lançamentos novos: receita, fonte, pagamento, categoria (400 no campo certo)
	body := map[string]any{"kind": "other", "description": "Outra", "walletId": antiga.ID, "competenceMonth": "2026-10-01",
		"expectedDate": "2026-10-06", "grossAmountCents": 1000, "userId": ana}
	assertField(t, a.do("POST", "/api/households/"+house+"/incomes", body, c), 400, "walletId")
	_, r = a.newSource(c, house, ana, map[string]any{"walletId": antiga.ID})
	assertField(t, r, 400, "walletId")
	inv, _ := a.newInvoice(c, house, cat, nil)
	_, r = a.pay(c, house, inv.ID, antiga.ID, nil)
	assertField(t, r, 400, "walletId")
	_, r = a.newCat(c, house, map[string]any{"name": "Cat nova", "defaultWalletId": antiga.ID})
	assertField(t, r, 400, "defaultWalletId")
	// mas continua no histórico e no resumo de outubro (tem movimento); em janeiro (sem nada) não aparece
	if w := a.summaryOf(c, house, "2026-10-01").named("Antiga"); w.WalletID != antiga.ID || !w.Archived || w.ReceivedIncomeCents != 50000 || w.BalanceCents != 50000 {
		t.Errorf("arquivada com movimento no resumo: %+v", w)
	}
	if w := a.summaryOf(c, house, "2026-01-01").named("Antiga"); w.WalletID != "" {
		t.Errorf("arquivada sem saldo nem movimento não aparece: %+v", w)
	}
	// com saldo anterior diferente de zero, aparece mesmo sem movimento no mês (novembro herda os 500,00 de outubro)
	if w := a.summaryOf(c, house, "2026-11-01").named("Antiga"); w.WalletID != antiga.ID || w.CarryOverCents != 50000 {
		t.Errorf("arquivada com saldo anterior: %+v", w)
	}
	// o histórico de receitas mantém o vínculo
	if got := a.incomeNamed(c, house, "2026-10-01", "Freela"); got.WalletID != antiga.ID {
		t.Errorf("a receita continua na carteira arquivada: %+v", got)
	}

	// restaurar: volta a valer; com o nome tomado por outra ativa, 409 wallet_exists
	if _, r := a.newWallet(c, house, map[string]any{"name": "antiga"}); r.Code != 201 {
		t.Fatalf("nome liberado pelo arquivamento: %d %s", r.Code, r.Body)
	}
	if _, r := a.walletAction(c, house, antiga.ID, "restore"); r.Code != 409 || a.code(r) != "wallet_exists" {
		t.Errorf("restaurar com nome tomado: %d %s", r.Code, r.Body)
	}
	a.patchWallet(c, house, a.walletID(house, "antiga"), map[string]any{"name": "Nova"})
	if w, r := a.walletAction(c, house, antiga.ID, "restore"); r.Code != 200 || w.Archived {
		t.Errorf("restaurar: %d %s", r.Code, r.Body)
	}
	if _, r := a.pay(c, house, inv.ID, antiga.ID, nil); r.Code != 200 {
		t.Errorf("restaurada volta a receber pagamentos: %d %s", r.Code, r.Body)
	}
	// VR sem walletId usa a "Benefício" ativa; arquivada ela, cai na padrão
	if _, r := a.walletAction(c, house, a.vr(house), "archive"); r.Code != 200 {
		t.Fatal(r.Body)
	}
	vr, r := a.postIncome(c, house, map[string]any{"kind": "benefit", "description": "VR sem carteira", "dateRule": ruleBody("day_of_month", 5, ""), "grossAmountCents": 1000})
	if r.Code != 201 || vr.WalletID != a.free(house) {
		t.Errorf("VR sem Benefício ativa vai para a padrão: %d %s", r.Code, r.Body)
	}
	if _, r := a.walletAction(c, house, fakeID, "archive"); r.Code != 404 {
		t.Errorf("arquivar inexistente: %d", r.Code)
	}
}

func TestCarteiraDeOutraCasaEhRecusada(t *testing.T) {
	a, c, house, cat := casa(t)
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")
	ana, beto := a.userID("ana@x.com"), a.userID("beto@x.com")
	alheia := a.free(houseB)

	body := map[string]any{"kind": "other", "description": "X", "walletId": alheia, "competenceMonth": "2026-10-01",
		"expectedDate": "2026-10-06", "grossAmountCents": 1000, "userId": ana}
	assertField(t, a.do("POST", "/api/households/"+house+"/incomes", body, c), 400, "walletId")
	_, r := a.newSource(c, house, ana, map[string]any{"walletId": alheia})
	assertField(t, r, 400, "walletId")
	inv, _ := a.newInvoice(c, house, cat, nil)
	_, r = a.pay(c, house, inv.ID, alheia, nil)
	assertField(t, r, 400, "walletId")
	_, r = a.newCat(c, house, map[string]any{"name": "Nova", "defaultWalletId": alheia})
	assertField(t, r, 400, "defaultWalletId")
	cats := a.cats(c, house)
	for id := range cats {
		assertField(t, a.do("PATCH", "/api/households/"+house+"/categories/"+id, map[string]any{"defaultWalletId": alheia}, c), 400, "defaultWalletId")
		break
	}
	own, _ := a.postIncome(c, house, map[string]any{"description": "Para editar", "dateRule": ruleBody("day_of_month", 5, "")})
	assertField(t, a.do("PATCH", "/api/households/"+house+"/incomes/"+own.ID, map[string]any{"walletId": alheia}, c), 400, "walletId")
	if inv2, _ := a.newInvoice(c, house, cat, nil); inv2.ID != "" {
		if _, r := a.pay(c, house, inv2.ID, "free", nil); r.Code != 200 {
			t.Errorf("pagar com a própria carteira: %d", r.Code)
		}
	}

	// editar/arquivar carteira de outra casa pela URL da própria: 404 (e nada muda na outra)
	for name, r := range map[string]resp{
		"editar":    mustResp(a.patchWallet(c, house, alheia, map[string]any{"name": "Invasão"})),
		"arquivar":  mustResp(a.walletAction(c, house, alheia, "archive")),
		"restaurar": mustResp(a.walletAction(c, house, alheia, "restore")),
	} {
		if r.Code != 404 {
			t.Errorf("%s carteira alheia: %d %s", name, r.Code, r.Body)
		}
	}
	// pela URL da casa B, o Ana (que não é de lá) recebe 404 do porteiro
	if r := a.do("GET", "/api/households/"+houseB+"/wallets", nil, c); r.Code != 404 {
		t.Errorf("listar carteiras de casa alheia: %d", r.Code)
	}
	for _, w := range a.wallets(cB, houseB, true) {
		if w.Name == "Invasão" || w.Archived {
			t.Errorf("carteira da casa B mexida: %+v", w)
		}
	}
	// o dono tem de ser membro DA CASA: o Beto é de outra
	assertField(t, mustResp(a.patchWallet(c, house, a.free(house), map[string]any{"ownerUserId": beto})), 400, "ownerUserId")
}

// Saldo anterior: o que sobra (ou falta) de cada mês entra no mês seguinte, inclusive negativo e com saldo inicial.
func TestSaldoAnteriorAcumulaEntreMeses(t *testing.T) {
	a, c, house, cat, _ := serie(t) // hoje = 18/10/2026
	poup, r := a.newWallet(c, house, map[string]any{"name": "Poupança", "openingBalanceCents": 100000})
	if r.Code != 201 {
		t.Fatal(r.Body)
	}
	newIncome := func(month, date string, gross int64) {
		t.Helper()
		_, r := a.postAvulsa(c, house, map[string]any{"description": "Entrada " + month, "walletId": poup.ID,
			"competenceMonth": month, "expectedDate": date, "grossAmountCents": gross})
		if r.Code != 201 {
			t.Fatalf("receita %s: %d %s", month, r.Code, r.Body)
		}
	}
	newIncome("2026-08-01", "2026-08-05", 300000)
	newIncome("2026-10-01", "2026-10-05", 200000)
	newIncome("2026-11-01", "2026-11-05", 80000) // ainda não caiu (hoje é 18/10): só previsto

	// conta de setembro (450.000) paga com a Poupança: estoura o saldo e avisa com a carteira
	set, _ := a.newInvoice(c, house, cat, map[string]any{"amountCents": 450000, "dueDate": "2026-09-10", "competenceMonth": "2026-09-01"})
	p, r := a.pay(c, house, set.ID, poup.ID, nil)
	if r.Code != 200 || len(p.Warnings) != 1 || len(p.WarningDetails) != 1 || p.WarningDetails[0].WalletID != poup.ID {
		t.Errorf("aviso de saldo da Poupança: %d %s", r.Code, r.Body)
	}

	type want struct{ carry, received, paid, balance, month, expected, projected int64 }
	check := func(month string, w want) {
		t.Helper()
		got := a.summaryOf(c, house, month).named("Poupança")
		have := want{got.CarryOverCents, got.ReceivedIncomeCents, got.PaidCents, got.BalanceCents, got.MonthBalanceCents, got.ExpectedIncomeCents, got.ProjectedCents}
		if have != w || got.OpeningBalanceCents != 100000 {
			t.Errorf("%s: %+v, quer %+v", month, have, w)
		}
	}
	//        anterior  recebido  pago    saldo    do mês   previsto projetado
	check("2026-07-01", want{100000, 0, 0, 100000, 0, 0, 100000}) // antes de tudo: só o saldo inicial
	check("2026-08-01", want{100000, 300000, 0, 400000, 300000, 300000, 400000})
	check("2026-09-01", want{400000, 0, 450000, -50000, -450000, 0, -50000})     // negativo
	check("2026-10-01", want{-50000, 200000, 0, 150000, 200000, 200000, 150000}) // o negativo é descontado
	check("2026-11-01", want{150000, 0, 0, 150000, 0, 80000, 230000})            // a de novembro ainda não caiu
	check("2027-03-01", want{150000, 0, 0, 150000, 0, 0, 150000})                // meses sem movimento só carregam

	// as outras carteiras não recebem nada disso
	if g := a.summaryOf(c, house, "2026-10-01").Free(); g.CarryOverCents != 0 || g.BalanceCents != 0 {
		t.Errorf("Geral: %+v", g)
	}
	// mudar o saldo inicial muda o saldo anterior de todos os meses
	a.patchWallet(c, house, poup.ID, map[string]any{"openingBalanceCents": -20000})
	if got := a.summaryOf(c, house, "2026-10-01").named("Poupança"); got.CarryOverCents != -170000 || got.OpeningBalanceCents != -20000 {
		t.Errorf("novo saldo inicial: %+v", got)
	}
	// desfazer o pagamento de setembro devolve os 4.500,00
	a.do("DELETE", "/api/households/"+house+"/invoices/"+set.ID+"/pay", nil, c)
	if got := a.summaryOf(c, house, "2026-10-01").named("Poupança"); got.CarryOverCents != 280000 {
		t.Errorf("sem o pagamento de setembro: %+v", got)
	}
	// "não caiu" na receita de agosto tira do saldo
	ago := a.incomeNamed(c, house, "2026-08-01", "Entrada 2026-08-01")
	a.do("DELETE", "/api/households/"+house+"/incomes/"+ago.ID+"/receive", nil, c)
	if got := a.summaryOf(c, house, "2026-10-01").named("Poupança"); got.CarryOverCents != -20000 {
		t.Errorf("sem a receita de agosto: %+v", got)
	}
}

func TestAvisoDeSaldoPorCarteira(t *testing.T) {
	a, c, house, cat, _ := serie(t)
	mercado, _ := a.newWallet(c, house, map[string]any{"name": "Cartão do mercado"})
	inv := func(amount int64) inv {
		i, _ := a.newInvoice(c, house, cat, map[string]any{"amountCents": amount})
		return i
	}
	// qualquer carteira nova avisa por padrão (sem saldo, qualquer pagamento estoura)
	i1 := inv(10000)
	p, r := a.pay(c, house, i1.ID, mercado.ID, nil)
	if r.Code != 200 || len(p.Warnings) != 1 || p.Warnings[0] != "wallet_balance_insufficient" || p.WarningDetails[0].WalletID != mercado.ID {
		t.Fatalf("carteira nova avisa: %d %s", r.Code, r.Body)
	}
	if p.Invoice.Status != "paid" {
		t.Errorf("o aviso nunca bloqueia: %+v", p.Invoice)
	}
	// desligado o aviso, não avisa mais
	a.do("DELETE", "/api/households/"+house+"/invoices/"+i1.ID+"/pay", nil, c)
	a.patchWallet(c, house, mercado.ID, map[string]any{"warnOnOverdraft": false})
	if p, _ := a.pay(c, house, i1.ID, mercado.ID, nil); len(p.Warnings) != 0 || p.Warnings == nil {
		t.Errorf("aviso desligado: %v", p.Warnings)
	}
	// a Geral nasce com o aviso desligado; ligando, avisa
	i2 := inv(5000)
	if p, _ := a.pay(c, house, i2.ID, "free", nil); len(p.Warnings) != 0 {
		t.Errorf("Geral não avisa por padrão: %v", p.Warnings)
	}
	a.do("DELETE", "/api/households/"+house+"/invoices/"+i2.ID+"/pay", nil, c)
	a.patchWallet(c, house, a.free(house), map[string]any{"warnOnOverdraft": true})
	if p, _ := a.pay(c, house, i2.ID, "free", nil); len(p.Warnings) != 1 || p.WarningDetails[0].WalletID != a.free(house) {
		t.Errorf("Geral com aviso ligado: %+v", p)
	}
	// carteira sem walletId no pagamento: 400
	i3 := inv(100)
	r = a.do("POST", "/api/households/"+house+"/invoices/"+i3.ID+"/pay", map[string]any{"amountCents": 100}, c)
	assertField(t, r, 400, "walletId")
}
