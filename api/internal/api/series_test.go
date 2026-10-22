package api

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
)

// Testes de ponta a ponta de compras parceladas e contas recorrentes (Postgres real).
// "Hoje" = 18/10/2026, salvo quando o teste move o relógio.

type seriesRef struct {
	Kind              string  `json:"kind"`
	PurchaseID        *string `json:"purchaseId"`
	InstallmentNumber *int    `json:"installmentNumber"`
	InstallmentsCount *int    `json:"installmentsCount"`
	RecurrenceID      *string `json:"recurrenceId"`
}

type sinv struct {
	inv
	Series *seriesRef `json:"series"`
}

type purchaseT struct {
	ID                string `json:"id"`
	Description       string `json:"description"`
	PurchaseDate      string `json:"purchaseDate"`
	TotalAmountCents  int64  `json:"totalAmountCents"`
	InstallmentsCount int    `json:"installmentsCount"`
	Installments      []sinv `json:"installments"`
}

type recT struct {
	ID               string  `json:"id"`
	Description      string  `json:"description"`
	AmountCents      int64   `json:"amountCents"`
	DayOfMonth       int     `json:"dayOfMonth"`
	StartMonth       string  `json:"startMonth"`
	EndMonth         *string `json:"endMonth"`
	GeneratedThrough string  `json:"generatedThrough"`
}

// serie prepara uma casa com relógio móvel (o teste muda *clock para "passar o tempo").
func serie(t *testing.T) (a *app, c *http.Cookie, house, catID string, clock *time.Time) {
	t.Helper()
	now := today
	clock = &now
	a = newApp(t, opts{openRegistration: true, now: func() time.Time { return *clock }})
	c, house = a.register("Ana", "ana@x.com", "Casa A")
	var cats []cat
	a.do("GET", "/api/households/"+house+"/categories", nil, c).json(&cats)
	return a, c, house, cats[0].ID, clock
}

// travel move o relógio do teste; a sessão ganha validade extra para continuar logada depois da viagem
// (e "nasce" de novo no destino, senão a validade absoluta da sessão a derrubaria).
func (a *app) travel(clock *time.Time, to time.Time) {
	a.t.Helper()
	*clock = to
	a.db.Exec("UPDATE sessions SET expires_at = expires_at + interval '3 years', created_at = ?", to)
}

func (a *app) newPurchase(c *http.Cookie, house, catID string, extra map[string]any) (purchaseT, resp) {
	a.t.Helper()
	body := map[string]any{
		"categoryId": catID, "description": "Notebook", "purchaseDate": "2026-08-01", "totalAmountCents": 396000,
		"installmentsCount": 6, "firstDueDate": "2026-08-20",
	}
	for k, v := range extra {
		body[k] = v
	}
	r := a.do("POST", "/api/households/"+house+"/purchases", body, c)
	var p purchaseT
	if r.Code == http.StatusCreated {
		r.json(&p)
	}
	return p, r
}

func (a *app) newRecurrence(c *http.Cookie, house, catID string, extra map[string]any) (recT, resp) {
	a.t.Helper()
	body := map[string]any{
		"categoryId": catID, "description": "Aluguel", "amountCents": 150000, "dayOfMonth": 31, "startMonth": "2026-09-01",
	}
	for k, v := range extra {
		body[k] = v
	}
	r := a.do("POST", "/api/households/"+house+"/recurrences", body, c)
	var rec recT
	if r.Code == http.StatusCreated {
		r.json(&rec)
	}
	return rec, r
}

// invoicesOf lista todas as invoices da casa (uma página grande), opcionalmente de um mês de competência.
func (a *app) invoicesOf(c *http.Cookie, house, query string) []sinv {
	a.t.Helper()
	var page struct{ Items []sinv }
	r := a.do("GET", "/api/households/"+house+"/invoices?limit=200"+query, nil, c)
	if r.Code != 200 {
		a.t.Fatalf("listar invoices: %d %s", r.Code, r.Body)
	}
	r.json(&page)
	return page.Items
}

func (a *app) getPurchase(c *http.Cookie, house, id string) (purchaseT, int) {
	a.t.Helper()
	var p purchaseT
	r := a.do("GET", "/api/households/"+house+"/purchases/"+id, nil, c)
	if r.Code == 200 {
		r.json(&p)
	}
	return p, r.Code
}

func (a *app) recurrences(c *http.Cookie, house string) []recT {
	a.t.Helper()
	var recs []recT
	a.do("GET", "/api/households/"+house+"/recurrences", nil, c).json(&recs)
	return recs
}

func TestCompraParceladaNotebook(t *testing.T) {
	a, c, house, catID, _ := serie(t)

	// Notebook 6x R$ 660, 1ª parcela em agosto (dia 20), hoje 18/out: as 6 aparecem; ago e set atrasadas, o resto pendente.
	p, r := a.newPurchase(c, house, catID, map[string]any{"notes": "  loja X  "})
	if r.Code != 201 {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	if p.TotalAmountCents != 396000 || p.InstallmentsCount != 6 || p.PurchaseDate != "2026-08-01" || len(p.Installments) != 6 {
		t.Fatalf("compra: %+v", p)
	}
	wantDue := []string{"2026-08-20", "2026-09-20", "2026-10-20", "2026-11-20", "2026-12-20", "2027-01-20"}
	wantStatus := []string{"overdue", "overdue", "pending", "pending", "pending", "pending"}
	for i, in := range p.Installments {
		if in.AmountCents != 66000 || in.DueDate != wantDue[i] || in.CompetenceMonth != wantDue[i][:7]+"-01" || in.Status != wantStatus[i] {
			t.Errorf("parcela %d: %+v", i+1, in.inv)
		}
		if in.Description != fmt.Sprintf("Notebook (%d/6)", i+1) {
			t.Errorf("descrição da parcela %d: %q", i+1, in.Description)
		}
		s := in.Series
		if s == nil || s.Kind != "installment" || s.PurchaseID == nil || *s.PurchaseID != p.ID ||
			s.InstallmentNumber == nil || *s.InstallmentNumber != i+1 || s.InstallmentsCount == nil || *s.InstallmentsCount != 6 {
			t.Errorf("series da parcela %d: %+v", i+1, s)
		}
		if in.Notes == nil || *in.Notes != "loja X" {
			t.Errorf("observação deve ser herdada: %v", in.Notes)
		}
	}

	// "Quando comprei o notebook e quanto custou?": busca por texto (case-insensitive) e detalhe com as parcelas
	var page struct {
		Items []purchaseT `json:"items"`
	}
	a.do("GET", "/api/households/"+house+"/purchases?q=NOTE", nil, c).json(&page)
	if len(page.Items) != 1 || page.Items[0].ID != p.ID || page.Items[0].PurchaseDate != "2026-08-01" || page.Items[0].TotalAmountCents != 396000 {
		t.Fatalf("busca: %+v", page.Items)
	}
	a.do("GET", "/api/households/"+house+"/purchases?q=geladeira", nil, c).json(&page)
	if len(page.Items) != 0 {
		t.Errorf("busca sem resultado: %+v", page.Items)
	}
	got, code := a.getPurchase(c, house, p.ID)
	if code != 200 || len(got.Installments) != 6 || got.Installments[2].Description != "Notebook (3/6)" {
		t.Fatalf("detalhe: %d %+v", code, got)
	}

	// as parcelas aparecem na lista do mês (competência) e filtram por compra; a atrasada é pagável
	if items := a.invoicesOf(c, house, "&month=2026-09-01"); len(items) != 1 || items[0].Description != "Notebook (2/6)" {
		t.Errorf("setembro: %+v", items)
	}
	if items := a.invoicesOf(c, house, "&purchaseId="+p.ID); len(items) != 6 {
		t.Errorf("por compra: %d", len(items))
	}
	if r := a.do("POST", "/api/households/"+house+"/invoices/"+p.Installments[0].ID+"/pay", map[string]any{"wallet": "free"}, c); r.Code != 200 {
		t.Errorf("pagar parcela atrasada: %d %s", r.Code, r.Body)
	}
	// GET de uma parcela também traz series completo
	var one sinv
	a.do("GET", "/api/households/"+house+"/invoices/"+p.Installments[3].ID, nil, c).json(&one)
	if one.Series == nil || *one.Series.InstallmentsCount != 6 || *one.Series.InstallmentNumber != 4 {
		t.Errorf("series no detalhe: %+v", one.Series)
	}
}

func TestCompraParceladaValoresEValidacao(t *testing.T) {
	a, c, house, catID, _ := serie(t)

	// resto de centavos na última: R$ 100,00 em 3x
	p, r := a.newPurchase(c, house, catID, map[string]any{"totalAmountCents": 10000, "installmentsCount": 3})
	if r.Code != 201 || p.Installments[0].AmountCents != 3333 || p.Installments[2].AmountCents != 3334 {
		t.Fatalf("resto: %d %s", r.Code, r.Body)
	}
	// valor da parcela informado (parcelado com juros): todas iguais, total informado preservado
	p, r = a.newPurchase(c, house, catID, map[string]any{"totalAmountCents": 10000, "installmentsCount": 3, "installmentAmountCents": 3500})
	if r.Code != 201 || p.TotalAmountCents != 10000 || p.Installments[0].AmountCents != 3500 || p.Installments[2].AmountCents != 3500 {
		t.Fatalf("valor de parcela informado: %d %s", r.Code, r.Body)
	}
	// 31 de janeiro: trava em fevereiro e volta ao 31
	p, _ = a.newPurchase(c, house, catID, map[string]any{"firstDueDate": "2027-01-31", "installmentsCount": 3})
	if d := []string{p.Installments[0].DueDate, p.Installments[1].DueDate, p.Installments[2].DueDate}; fmt.Sprint(d) != "[2027-01-31 2027-02-28 2027-03-31]" {
		t.Errorf("31 de janeiro: %v", d)
	}
	// 120 parcelas é o máximo
	p, r = a.newPurchase(c, house, catID, map[string]any{"installmentsCount": 120})
	if r.Code != 201 || len(p.Installments) != 120 || p.Installments[119].Description != "Notebook (120/120)" {
		t.Fatalf("120 parcelas: %d", r.Code)
	}
	var n int
	a.db.Raw("SELECT count(*) FROM invoices WHERE purchase_id = ?", p.ID).Scan(&n)
	if n != 120 {
		t.Errorf("no banco: %d", n)
	}

	for name, extra := range map[string]map[string]any{
		"1 parcela":           {"installmentsCount": 1},
		"121 parcelas":        {"installmentsCount": 121},
		"total zero":          {"totalAmountCents": 0},
		"descrição vazia":     {"description": "  "},
		"descrição longa":     {"description": strings.Repeat("a", 101)},
		"sem 1º vencimento":   {"firstDueDate": nil},
		"valor de parcela <0": {"installmentAmountCents": -1},
		"vencimento inválido": {"firstDueDate": "2026-02-30"},
	} {
		if _, r := a.newPurchase(c, house, catID, extra); r.Code != 400 {
			t.Errorf("%s deveria ser 400: %d %s", name, r.Code, r.Body)
		}
	}
	// nada foi gravado pelas tentativas inválidas (transação / validação antes de gravar)
	a.db.Raw("SELECT count(*) FROM purchases WHERE household_id = ?", house).Scan(&n)
	if n != 4 {
		t.Errorf("compras gravadas: %d, quer 4", n)
	}
}

func TestListaDeComprasPaginada(t *testing.T) {
	a, c, house, catID, _ := serie(t)
	for i, d := range []string{"2026-05-01", "2026-07-01", "2026-06-01"} {
		if _, r := a.newPurchase(c, house, catID, map[string]any{"description": fmt.Sprintf("Compra %d", i), "purchaseDate": d}); r.Code != 201 {
			t.Fatal(r.Body)
		}
	}
	var ids []string
	cursor := ""
	for i := 0; i < 5; i++ {
		var page struct {
			Items      []purchaseT `json:"items"`
			NextCursor string      `json:"nextCursor"`
		}
		q := "?limit=2"
		if cursor != "" {
			q += "&cursor=" + cursor
		}
		a.do("GET", "/api/households/"+house+"/purchases"+q, nil, c).json(&page)
		for _, p := range page.Items {
			ids = append(ids, p.Description)
			if len(p.Installments) != 6 {
				t.Errorf("a lista traz as parcelas: %d", len(p.Installments))
			}
		}
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}
	// mais recente primeiro, sem repetir nem pular
	if fmt.Sprint(ids) != "[Compra 1 Compra 2 Compra 0]" {
		t.Errorf("ordem/paginação: %v", ids)
	}
	if r := a.do("GET", "/api/households/"+house+"/purchases?cursor=lixo", nil, c); r.Code != 400 {
		t.Errorf("cursor inválido: %d", r.Code)
	}
}

func TestEscopoFollowingEmParcelas(t *testing.T) {
	a, c, house, catID, _ := serie(t)
	p, _ := a.newPurchase(c, house, catID, nil)
	base := "/api/households/" + house + "/invoices/"
	in := p.Installments

	// parcela 2 paga: nenhuma edição/exclusão em lote pode tocar nela
	a.do("POST", base+in[1].ID+"/pay", map[string]any{"wallet": "free"}, c)

	// em lote: vencimento e competência são recusados
	if r := a.do("PATCH", base+in[2].ID+"?scope=following", map[string]any{"dueDate": "2027-01-01"}, c); r.Code != 400 {
		t.Errorf("vencimento em lote: %d", r.Code)
	}
	if r := a.do("PATCH", base+in[2].ID+"?scope=following", map[string]any{"competenceMonth": "2027-01-01"}, c); r.Code != 400 {
		t.Errorf("competência em lote: %d", r.Code)
	}

	// editar a partir da parcela 3: valor e descrição valem para 3..6; 1 e 2 (paga) ficam
	r := a.do("PATCH", base+in[2].ID+"?scope=following", map[string]any{"amountCents": 70000, "description": "Notebook Dell (3/6)"}, c)
	if r.Code != 200 {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	items := a.invoicesOf(c, house, "&purchaseId="+p.ID)
	for i, it := range items {
		wantAmount, wantDesc := int64(70000), fmt.Sprintf("Notebook Dell (%d/6)", i+1)
		if i < 2 {
			wantAmount, wantDesc = 66000, fmt.Sprintf("Notebook (%d/6)", i+1)
		}
		if it.AmountCents != wantAmount || it.Description != wantDesc {
			t.Errorf("parcela %d: %d %q (quer %d %q)", i+1, it.AmountCents, it.Description, wantAmount, wantDesc)
		}
	}
	if items[1].Paid == nil || items[1].AmountCents != 66000 {
		t.Errorf("a paga não pode ser reescrita: %+v", items[1].inv)
	}

	// "só esta" continua só a própria
	a.do("PATCH", base+in[3].ID+"?scope=this", map[string]any{"amountCents": 1}, c)
	a.do("PATCH", base+in[4].ID, map[string]any{"notes": "só esta"}, c) // sem scope = this
	items = a.invoicesOf(c, house, "&purchaseId="+p.ID)
	if items[3].AmountCents != 1 || items[4].AmountCents != 70000 || items[4].Notes == nil || items[5].Notes != nil {
		t.Errorf("scope=this vazou: %+v", items)
	}

	// excluir a partir da 5: 5 e 6 somem; 1..4 ficam
	if r := a.do("DELETE", base+in[4].ID+"?scope=following", nil, c); r.Code != 204 {
		t.Fatalf("%d", r.Code)
	}
	if items = a.invoicesOf(c, house, "&purchaseId="+p.ID); len(items) != 4 {
		t.Errorf("após excluir 5+: %d", len(items))
	}
	// excluir a partir da 1: some tudo que está pendente; a paga (2) é preservada, e a compra continua existindo
	if r := a.do("DELETE", base+in[0].ID+"?scope=following", nil, c); r.Code != 204 {
		t.Fatalf("%d", r.Code)
	}
	items = a.invoicesOf(c, house, "&purchaseId="+p.ID)
	if len(items) != 1 || items[0].ID != in[1].ID || items[0].Paid == nil {
		t.Fatalf("só a paga deve restar: %+v", items)
	}
	if _, code := a.getPurchase(c, house, p.ID); code != 200 {
		t.Errorf("compra com parcela paga restante: %d", code)
	}
	// excluídas não ressuscitam sozinhas; excluir a última parcela viva (paga, escopo this) exclui a compra
	if r := a.do("DELETE", base+in[1].ID, nil, c); r.Code != 204 {
		t.Fatal(r.Code)
	}
	if _, code := a.getPurchase(c, house, p.ID); code != 404 {
		t.Errorf("compra sem parcelas vivas deve sumir: %d", code)
	}
	var page struct{ Items []purchaseT }
	a.do("GET", "/api/households/"+house+"/purchases", nil, c).json(&page)
	if len(page.Items) != 0 {
		t.Errorf("lista de compras: %+v", page.Items)
	}
	// restaurar uma parcela traz a compra de volta, com as parcelas restauradas
	if r := a.do("POST", base+in[1].ID+"/restore", nil, c); r.Code != 200 {
		t.Fatalf("restaurar: %d %s", r.Code, r.Body)
	}
	if got, code := a.getPurchase(c, house, p.ID); code != 200 || len(got.Installments) != 1 {
		t.Errorf("compra restaurada: %d %+v", code, got)
	}
	// following numa invoice avulsa age como "só esta" (não é série)
	solo, _ := a.newInvoice(c, house, catID, nil)
	if r := a.do("PATCH", base+solo.ID+"?scope=following", map[string]any{"description": "Avulsa"}, c); r.Code != 200 {
		t.Errorf("following em avulsa: %d", r.Code)
	}
}

func TestRecorrenciaGeraEmesesCurtos(t *testing.T) {
	a, c, house, catID, _ := serie(t)
	rec, r := a.newRecurrence(c, house, catID, nil)
	if r.Code != 201 {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	// início em set/2026, hoje out/2026: de set/2026 até 12 meses depois de outubro (out/2027) = 14 ocorrências
	if rec.GeneratedThrough != "2027-10-01" || rec.DayOfMonth != 31 || rec.EndMonth != nil {
		t.Fatalf("recorrência: %+v", rec)
	}
	items := a.invoicesOf(c, house, "")
	if len(items) != 14 {
		t.Fatalf("%d ocorrências, quer 14", len(items))
	}
	due := map[string]string{}
	for _, it := range items {
		due[it.CompetenceMonth] = it.DueDate
		s := it.Series
		if s == nil || s.Kind != "recurrence" || s.RecurrenceID == nil || *s.RecurrenceID != rec.ID || s.InstallmentNumber != nil {
			t.Fatalf("series: %+v", s)
		}
		if it.AmountCents != 150000 || it.Description != "Aluguel" {
			t.Errorf("molde: %+v", it.inv)
		}
	}
	for m, want := range map[string]string{
		"2026-09-01": "2026-09-30", "2026-10-01": "2026-10-31", "2026-11-01": "2026-11-30",
		"2027-02-01": "2027-02-28", "2027-03-01": "2027-03-31", "2027-10-01": "2027-10-31",
	} {
		if due[m] != want {
			t.Errorf("competência %s vence %s, quer %s", m, due[m], want)
		}
	}
	// set/2026 já venceu (atrasada); out/2026 vence dia 31 (pendente)
	if items[0].Status != "overdue" || items[1].Status != "pending" {
		t.Errorf("status: %s %s", items[0].Status, items[1].Status)
	}
	// entra na lista de recorrências
	if recs := a.recurrences(c, house); len(recs) != 1 || recs[0].ID != rec.ID {
		t.Errorf("lista: %+v", recs)
	}
	// validações
	for name, extra := range map[string]map[string]any{
		"dia 0":          {"dayOfMonth": 0},
		"dia 32":         {"dayOfMonth": 32},
		"início no meio": {"startMonth": "2026-09-15"},
		"fim antes":      {"endMonth": "2026-08-01"},
		"fim no meio":    {"endMonth": "2027-01-10"},
		"início longe":   {"startMonth": "2001-01-01"},
		"valor zero":     {"amountCents": 0},
	} {
		if _, r := a.newRecurrence(c, house, catID, extra); r.Code != 400 {
			t.Errorf("%s deveria ser 400: %d %s", name, r.Code, r.Body)
		}
	}
	// com fim: gera só até o fim
	short, r := a.newRecurrence(c, house, catID, map[string]any{"description": "Curso", "startMonth": "2026-10-01", "endMonth": "2027-01-01", "dayOfMonth": 5})
	if r.Code != 201 || short.GeneratedThrough != "2027-01-01" {
		t.Fatalf("com fim: %d %s", r.Code, r.Body)
	}
	if got := a.invoicesOf(c, house, "&q=Curso"); len(got) != 4 {
		t.Errorf("curso: %d, quer 4 (out a jan)", len(got))
	}
}

func TestRecorrenciaNaoRecriaExcluidas(t *testing.T) {
	a, c, house, catID, _ := serie(t)
	rec, _ := a.newRecurrence(c, house, catID, nil)
	base := "/api/households/" + house + "/invoices/"

	dec := a.invoicesOf(c, house, "&month=2026-12-01")
	if len(dec) != 1 {
		t.Fatal("falta dezembro")
	}
	if r := a.do("DELETE", base+dec[0].ID, nil, c); r.Code != 204 { // exclusão "só esta"
		t.Fatal(r.Code)
	}
	if got := a.invoicesOf(c, house, ""); len(got) != 13 {
		t.Fatalf("após excluir dezembro: %d", len(got))
	}

	// simula o pior caso: o marcador de horizonte "volta no tempo" e o gerador tenta refazer tudo desde o início
	if err := a.db.Exec("UPDATE recurrences SET generated_through = '2026-08-01' WHERE id = ?", rec.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := a.rec.EnsureHorizon(t.Context(), uuid.MustParse(house), caldate.Date{}); err != nil {
		t.Fatal(err)
	}
	if got := a.invoicesOf(c, house, ""); len(got) != 13 {
		t.Errorf("dezembro excluído foi recriado: %d ocorrências", len(got))
	}
	if got := a.invoicesOf(c, house, "&month=2026-12-01"); len(got) != 0 {
		t.Errorf("dezembro voltou: %+v", got)
	}
	var n int
	a.db.Raw("SELECT count(*) FROM invoices WHERE recurrence_id = ?", rec.ID).Scan(&n)
	if n != 14 { // a linha excluída continua lá (logicamente), ocupando o mês
		t.Errorf("linhas no banco: %d", n)
	}
	if recs := a.recurrences(c, house); recs[0].GeneratedThrough != "2027-10-01" {
		t.Errorf("generated_through: %s", recs[0].GeneratedThrough)
	}
	// restaurar traz de volta só aquela
	a.do("POST", base+dec[0].ID+"/restore", nil, c)
	if got := a.invoicesOf(c, house, ""); len(got) != 14 {
		t.Errorf("após restaurar: %d", len(got))
	}
}

func TestRecorrenciaHorizonteSobDemanda(t *testing.T) {
	a, c, house, catID, clock := serie(t)
	rec, _ := a.newRecurrence(c, house, catID, nil) // gerada até out/2027
	var n int
	count := func() int {
		a.db.Raw("SELECT count(*) FROM invoices WHERE recurrence_id = ?", rec.ID).Scan(&n)
		return n
	}
	if count() != 14 {
		t.Fatalf("inicial: %d", n)
	}
	// dois meses depois, listar qualquer mês estende o horizonte padrão (12 meses a partir de dez/2026 = dez/2027)
	a.travel(clock, time.Date(2026, 12, 18, 12, 0, 0, 0, time.UTC))
	if got := a.invoicesOf(c, house, "&month=2027-12-01"); len(got) != 1 || got[0].DueDate != "2027-12-31" {
		t.Fatalf("dezembro/2027 deveria ter sido gerado: %+v", got)
	}
	if count() != 16 {
		t.Errorf("após estender: %d, quer 16", n)
	}
	// olhar um mês futuro além do horizonte gera até ele (limitado a 5 anos)
	if got := a.invoicesOf(c, house, "&month=2028-06-01"); len(got) != 1 {
		t.Errorf("jun/2028: %+v", got)
	}
	if recs := a.recurrences(c, house); recs[0].GeneratedThrough != "2028-06-01" {
		t.Errorf("generated_through: %s", recs[0].GeneratedThrough)
	}
	// um mês absurdamente distante não gera décadas de linhas
	a.invoicesOf(c, house, "&month=2090-01-01")
	before := count()
	if before > 16+6+60 {
		t.Errorf("teto de 60 meses estourado: %d linhas", before)
	}
	// repetir não duplica (idempotente)
	a.invoicesOf(c, house, "&month=2028-06-01")
	if count() != before {
		t.Errorf("duplicou: %d -> %d", before, n)
	}
	// o job diário (todas as casas) também é idempotente
	if err := a.rec.EnsureHorizonAll(t.Context()); err != nil {
		t.Fatal(err)
	}
	if count() != before {
		t.Errorf("job duplicou: %d -> %d", before, n)
	}
}

func TestRecorrenciaEditarEEncerrar(t *testing.T) {
	a, c, house, catID, _ := serie(t)
	rec, _ := a.newRecurrence(c, house, catID, nil)
	url := "/api/households/" + house + "/recurrences/" + rec.ID
	base := "/api/households/" + house + "/invoices/"

	set := a.invoicesOf(c, house, "") // set/26 .. out/27
	// out/2026 paga; set/2026 é passada (atrasada) e nov/2026 será editada individualmente antes
	a.do("POST", base+set[1].ID+"/pay", map[string]any{"wallet": "free"}, c)

	r := a.do("PATCH", url, map[string]any{"amountCents": 160000, "dayOfMonth": 10, "description": "Aluguel apto"}, c)
	var got recT
	r.json(&got)
	if r.Code != 200 || got.AmountCents != 160000 || got.DayOfMonth != 10 || got.Description != "Aluguel apto" {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	items := a.invoicesOf(c, house, "")
	if len(items) != 14 {
		t.Fatalf("%d", len(items))
	}
	// passada (set) e paga (out) intactas
	for _, i := range []int{0, 1} {
		if items[i].AmountCents != 150000 || items[i].Description != "Aluguel" {
			t.Errorf("ocorrência %s não deveria mudar: %+v", items[i].CompetenceMonth, items[i].inv)
		}
	}
	if items[0].DueDate != "2026-09-30" || items[1].DueDate != "2026-10-31" {
		t.Errorf("vencimentos antigos mudaram: %s %s", items[0].DueDate, items[1].DueDate)
	}
	// futuras pendentes: novo valor, descrição e dia (competência não muda)
	for _, it := range items[2:] {
		if it.AmountCents != 160000 || it.Description != "Aluguel apto" || !strings.HasSuffix(it.DueDate, "-10") || it.DueDate[:7] != it.CompetenceMonth[:7] {
			t.Errorf("futura %s não foi atualizada: %+v", it.CompetenceMonth, it.inv)
		}
	}

	// valores inválidos
	for name, body := range map[string]map[string]any{
		"valor zero": {"amountCents": 0}, "dia 40": {"dayOfMonth": 40}, "fim no meio do mês": {"endMonth": "2027-03-15"},
		"fim antes do início": {"endMonth": "2026-08-01"},
	} {
		if r := a.do("PATCH", url, body, c); r.Code != 400 {
			t.Errorf("%s: %d", name, r.Code)
		}
	}

	// encerrar em mar/2027: pendentes futuras depois disso são excluídas; as até mar ficam
	r = a.do("PATCH", url, map[string]any{"endMonth": "2027-03-01"}, c)
	r.json(&got)
	if r.Code != 200 || got.EndMonth == nil || *got.EndMonth != "2027-03-01" {
		t.Fatalf("encerrar: %d %s", r.Code, r.Body)
	}
	if items = a.invoicesOf(c, house, ""); len(items) != 7 || items[6].CompetenceMonth != "2027-03-01" {
		t.Errorf("após encerrar: %d ocorrências", len(items))
	}
	// não reabre nem adia; encerrar mais cedo pode
	if r := a.do("PATCH", url, map[string]any{"endMonth": nil}, c); r.Code != 400 {
		t.Errorf("reabrir: %d", r.Code)
	}
	if r := a.do("PATCH", url, map[string]any{"endMonth": "2027-06-01"}, c); r.Code != 400 {
		t.Errorf("adiar: %d", r.Code)
	}
	if r := a.do("PATCH", url, map[string]any{"endMonth": "2027-02-01"}, c); r.Code != 200 {
		t.Errorf("antecipar: %d", r.Code)
	}
	// o horizonte respeita o fim: nada novo aparece
	a.invoicesOf(c, house, "&month=2027-09-01")
	if items = a.invoicesOf(c, house, ""); len(items) != 6 {
		t.Errorf("horizonte passou do fim: %d", len(items))
	}
}

func TestRecorrenciaEscopoFollowing(t *testing.T) {
	a, c, house, catID, clock := serie(t)
	rec, _ := a.newRecurrence(c, house, catID, nil)
	base := "/api/households/" + house + "/invoices/"
	byMonth := func(m string) sinv {
		items := a.invoicesOf(c, house, "&month="+m)
		if len(items) != 1 {
			t.Fatalf("mês %s: %d", m, len(items))
		}
		return items[0]
	}

	// janeiro/2027 em diante passa a R$ 1.700; dezembro já paga fica; "só esta" em fevereiro não vaza
	dec := byMonth("2026-12-01")
	a.do("POST", base+dec.ID+"/pay", map[string]any{"wallet": "free"}, c)
	jan := byMonth("2027-01-01")
	if r := a.do("PATCH", base+jan.ID+"?scope=following", map[string]any{"amountCents": 170000}, c); r.Code != 200 {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	if byMonth("2026-11-01").AmountCents != 150000 || byMonth("2026-12-01").AmountCents != 150000 {
		t.Error("anteriores não podem mudar")
	}
	if byMonth("2027-01-01").AmountCents != 170000 || byMonth("2027-10-01").AmountCents != 170000 {
		t.Error("seguintes deveriam mudar")
	}
	// o molde mudou: ocorrências geradas depois já nascem com o novo valor
	a.travel(clock, time.Date(2027, 1, 18, 12, 0, 0, 0, time.UTC))
	if got := byMonth("2028-01-01"); got.AmountCents != 170000 {
		t.Errorf("molde não propagou: %d", got.AmountCents)
	}

	// pagas no meio da série são preservadas por escopo following
	mar := byMonth("2027-03-01")
	a.do("POST", base+byMonth("2027-05-01").ID+"/pay", map[string]any{"wallet": "free"}, c)
	if r := a.do("DELETE", base+mar.ID+"?scope=following", nil, c); r.Code != 204 {
		t.Fatalf("%d", r.Code)
	}
	if items := a.invoicesOf(c, house, "&month=2027-04-01"); len(items) != 0 {
		t.Errorf("abril deveria ter sido excluída: %+v", items)
	}
	if p := byMonth("2027-05-01"); p.Paid == nil {
		t.Error("a paga de maio deve ser preservada")
	}
	// a recorrência foi encerrada em fev/2027: o horizonte não recria nada
	recs := a.recurrences(c, house)
	if len(recs) != 1 || recs[0].EndMonth == nil || *recs[0].EndMonth != "2027-02-01" {
		t.Fatalf("encerramento: %+v", recs)
	}
	var total int
	a.db.Raw("SELECT count(*) FROM invoices WHERE recurrence_id = ? AND deleted_at IS NULL", rec.ID).Scan(&total)
	a.invoicesOf(c, house, "&month=2029-01-01")
	var after int
	a.db.Raw("SELECT count(*) FROM invoices WHERE recurrence_id = ? AND deleted_at IS NULL", rec.ID).Scan(&after)
	if after != total {
		t.Errorf("recriou ocorrências: %d -> %d", total, after)
	}

	// excluir a partir da primeira ocorrência exclui a recorrência inteira
	first := byMonth("2026-09-01")
	if r := a.do("DELETE", base+first.ID+"?scope=following", nil, c); r.Code != 204 {
		t.Fatalf("%d", r.Code)
	}
	if recs := a.recurrences(c, house); len(recs) != 0 {
		t.Errorf("recorrência deveria ter sido excluída: %+v", recs)
	}
	if r := a.do("PATCH", "/api/households/"+house+"/recurrences/"+rec.ID, map[string]any{"amountCents": 1}, c); r.Code != 404 {
		t.Errorf("editar recorrência excluída: %d", r.Code)
	}
}

func TestSeriesIsolamentoEPapeis(t *testing.T) {
	a := newApp(t, opts{openRegistration: true, now: func() time.Time { return today }})
	cA, houseA := a.register("Ana", "ana@x.com", "Casa A")
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")
	var catsA, catsB []cat
	a.do("GET", "/api/households/"+houseA+"/categories", nil, cA).json(&catsA)
	a.do("GET", "/api/households/"+houseB+"/categories", nil, cB).json(&catsB)

	p, _ := a.newPurchase(cA, houseA, catsA[0].ID, nil)
	rec, _ := a.newRecurrence(cA, houseA, catsA[0].ID, nil)

	// Beto não enxerga nada da Ana, nem pela casa dele nem pela dela
	if _, code := a.getPurchase(cB, houseB, p.ID); code != 404 {
		t.Errorf("compra alheia pela casa dele: %d", code)
	}
	if _, code := a.getPurchase(cB, houseA, p.ID); code != 404 {
		t.Errorf("compra alheia pela casa dela: %d", code)
	}
	if r := a.do("PATCH", "/api/households/"+houseB+"/recurrences/"+rec.ID, map[string]any{"amountCents": 1}, cB); r.Code != 404 {
		t.Errorf("editar recorrência alheia: %d", r.Code)
	}
	if recs := a.recurrences(cB, houseB); len(recs) != 0 {
		t.Errorf("lista de recorrências vazou: %+v", recs)
	}
	var page struct{ Items []purchaseT }
	a.do("GET", "/api/households/"+houseB+"/purchases", nil, cB).json(&page)
	if len(page.Items) != 0 {
		t.Errorf("lista de compras vazou: %+v", page.Items)
	}
	if got := a.invoicesOf(cB, houseB, ""); len(got) != 0 {
		t.Errorf("invoices vazaram: %d", len(got))
	}
	// follow em invoice alheia pelo id: 404, e a série da Ana fica intacta
	if r := a.do("DELETE", "/api/households/"+houseB+"/invoices/"+p.Installments[0].ID+"?scope=following", nil, cB); r.Code != 404 {
		t.Errorf("following em parcela alheia: %d", r.Code)
	}
	if got, _ := a.getPurchase(cA, houseA, p.ID); len(got.Installments) != 6 {
		t.Errorf("série da Ana mexida: %d", len(got.Installments))
	}
	// categoria de outra casa não vale em compra nem recorrência
	if _, r := a.newPurchase(cB, houseB, catsA[0].ID, nil); r.Code != 400 {
		t.Errorf("compra com categoria alheia: %d", r.Code)
	}
	if _, r := a.newRecurrence(cB, houseB, catsA[0].ID, nil); r.Code != 400 {
		t.Errorf("recorrência com categoria alheia: %d", r.Code)
	}
	// o horizonte da casa B não gera nada para a casa A (e vice-versa): contagem inalterada
	var n int
	a.db.Raw("SELECT count(*) FROM invoices WHERE recurrence_id = ?", rec.ID).Scan(&n)
	a.invoicesOf(cB, houseB, "&month=2028-01-01")
	var n2 int
	a.db.Raw("SELECT count(*) FROM invoices WHERE recurrence_id = ?", rec.ID).Scan(&n2)
	if n != n2 {
		t.Errorf("listar a casa B estendeu recorrência da casa A: %d -> %d", n, n2)
	}

	// viewer lê (inclusive compras e recorrências), mas não escreve
	var betoID string
	a.db.Raw("SELECT id::text FROM users WHERE email='beto@x.com'").Scan(&betoID)
	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'viewer')", houseA, betoID)
	if _, code := a.getPurchase(cB, houseA, p.ID); code != 200 {
		t.Errorf("viewer lendo compra: %d", code)
	}
	if recs := a.recurrences(cB, houseA); len(recs) != 1 {
		t.Errorf("viewer lendo recorrências: %d", len(recs))
	}
	for name, req := range map[string]func() resp{
		"criar compra":      func() resp { _, r := a.newPurchase(cB, houseA, catsA[0].ID, nil); return r },
		"criar recorrência": func() resp { _, r := a.newRecurrence(cB, houseA, catsA[0].ID, nil); return r },
		"editar recorrência": func() resp {
			return a.do("PATCH", "/api/households/"+houseA+"/recurrences/"+rec.ID, map[string]any{"amountCents": 1}, cB)
		},
		"excluir seguintes": func() resp {
			return a.do("DELETE", "/api/households/"+houseA+"/invoices/"+p.Installments[0].ID+"?scope=following", nil, cB)
		},
		"editar seguintes": func() resp {
			return a.do("PATCH", "/api/households/"+houseA+"/invoices/"+p.Installments[0].ID+"?scope=following", map[string]any{"amountCents": 1}, cB)
		},
	} {
		if r := req(); r.Code != 403 {
			t.Errorf("viewer %s deveria ser 403: %d", name, r.Code)
		}
	}
}
