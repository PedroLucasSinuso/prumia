package api

import (
	"net/http"
	"testing"
	"time"
)

type pointT struct {
	Month       string `json:"month"`
	TotalCents  int64  `json:"totalCents"`
	PaidCents   int64  `json:"paidCents"`
	SeriesCents int64  `json:"seriesCents"`
}

type historyT struct {
	Months []string `json:"months"`
	Series []struct {
		CategoryID string   `json:"categoryId"`
		Points     []pointT `json:"points"`
	} `json:"series"`
}

func (a *app) historyOf(c *http.Cookie, house, query string) historyT {
	a.t.Helper()
	r := a.do("GET", "/api/households/"+house+"/summary/categories"+query, nil, c)
	if r.Code != http.StatusOK {
		a.t.Fatalf("histórico %s: %d %s", query, r.Code, r.Body)
	}
	var h historyT
	r.json(&h)
	return h
}

// point acha o ponto da categoria no mês (zero se a categoria não veio).
func (h historyT) point(catID, month string) pointT {
	for _, s := range h.Series {
		if s.CategoryID != catID {
			continue
		}
		for _, p := range s.Points {
			if p.Month == month {
				return p
			}
		}
	}
	return pointT{Month: month}
}

func TestHistoricoPorCategoria(t *testing.T) {
	a, c, house, _, _ := serie(t) // hoje = 18/10/2026
	var cats []cat
	a.do("GET", "/api/households/"+house+"/categories", nil, c).json(&cats)
	moradia, mercado, lazer := cats[0].ID, cats[1].ID, cats[2].ID

	// aluguel de outubro pago com juros (vale o valor efetivo)
	aluguel, _ := a.newInvoice(c, house, moradia, map[string]any{"amountCents": 150000, "dueDate": "2026-10-20"})
	a.pay(c, house, aluguel.ID, "free", map[string]any{"amountCents": 148000})
	// competência ≠ vencimento: vence em outubro, mas é gasto de setembro
	a.newInvoice(c, house, mercado, map[string]any{"amountCents": 40000, "dueDate": "2026-10-05", "competenceMonth": "2026-09-01"})
	// excluída não conta
	apagada, _ := a.newInvoice(c, house, moradia, map[string]any{"amountCents": 99999, "dueDate": "2026-10-10"})
	if r := a.do("DELETE", "/api/households/"+house+"/invoices/"+apagada.ID, nil, c); r.Code != 204 {
		t.Fatalf("excluir: %d %s", r.Code, r.Body)
	}
	// parcelas: 6 x 660,00 de agosto a janeiro, no mercado
	if _, r := a.newPurchase(c, house, mercado, nil); r.Code != 201 {
		t.Fatal(r.Body)
	}
	// conta fixa no lazer desde setembro
	if _, r := a.newRecurrence(c, house, lazer, map[string]any{"amountCents": 5000, "dayOfMonth": 10}); r.Code != 201 {
		t.Fatal(r.Body)
	}

	h := a.historyOf(c, house, "") // padrão: maio a outubro
	if len(h.Months) != 6 || h.Months[0] != "2026-05-01" || h.Months[5] != "2026-10-01" {
		t.Fatalf("meses padrão: %v", h.Months)
	}
	for _, s := range h.Series {
		if len(s.Points) != 6 {
			t.Fatalf("toda série tem um ponto por mês: %+v", s)
		}
	}
	if p := h.point(moradia, "2026-10-01"); p.TotalCents != 148000 || p.PaidCents != 148000 || p.SeriesCents != 0 {
		t.Errorf("moradia outubro: %+v", p)
	}
	if p := h.point(mercado, "2026-09-01"); p.TotalCents != 106000 || p.PaidCents != 0 || p.SeriesCents != 66000 {
		t.Errorf("mercado setembro (competência + parcela): %+v", p)
	}
	if p := h.point(mercado, "2026-10-01"); p.TotalCents != 66000 {
		t.Errorf("mercado outubro só tem a parcela: %+v", p)
	}
	// meses vazios aparecem com zero
	if p := h.point(mercado, "2026-05-01"); p.TotalCents != 0 || p.Month != "2026-05-01" {
		t.Errorf("maio vazio: %+v", p)
	}
	if h.Series[0].CategoryID != mercado {
		t.Errorf("maior soma primeiro: %+v", h.Series[0])
	}

	// futuro: estende o horizonte das contas fixas até `to`
	f := a.historyOf(c, house, "?from=2028-02-01&to=2028-03-01")
	if p := f.point(lazer, "2028-03-01"); p.TotalCents != 5000 || p.SeriesCents != 5000 {
		t.Errorf("conta fixa em 2028 (horizonte): %+v", f)
	}
	if p := a.historyOf(c, house, "?from=2026-11-01&to=2027-01-01").point(mercado, "2027-01-01"); p.SeriesCents != 66000 {
		t.Errorf("última parcela em janeiro: %+v", p)
	}

	for _, q := range []string{"?from=2026-10-15", "?from=2024-01-01&to=2026-10-01", "?from=2026-10-01&to=2026-09-01", "?to=xx"} {
		if r := a.do("GET", "/api/households/"+house+"/summary/categories"+q, nil, c); r.Code != 400 {
			t.Errorf("%s deveria ser 400: %d", q, r.Code)
		}
	}

	// viewer lê
	vc, _ := a.newUser("Vera", "vera@x.com")
	a.join(c, house, "viewer", vc)
	if v := a.historyOf(vc, house, ""); len(v.Series) != len(h.Series) {
		t.Errorf("viewer: %+v", v)
	}
}

func TestHistoricoIsolamentoEntreCasas(t *testing.T) {
	a := newApp(t, opts{openRegistration: true, now: func() time.Time { return today }})
	cA, houseA := a.register("Ana", "ana@x.com", "Casa A")
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")
	var catsA []cat
	a.do("GET", "/api/households/"+houseA+"/categories", nil, cA).json(&catsA)
	a.newInvoice(cA, houseA, catsA[0].ID, nil)

	if h := a.historyOf(cA, houseA, ""); len(h.Series) != 1 {
		t.Fatalf("Ana vê a dela: %+v", h)
	}
	if h := a.historyOf(cB, houseB, ""); len(h.Series) != 0 || len(h.Months) != 6 {
		t.Errorf("vazou para a casa B: %+v", h)
	}
	if r := a.do("GET", "/api/households/"+houseA+"/summary/categories", nil, cB); r.Code != 404 {
		t.Errorf("casa alheia: %d", r.Code)
	}
}

func TestResumoProjetadoEAtraso(t *testing.T) {
	a, c, house, _, _ := serie(t) // hoje = 18/10/2026
	ana := a.uid("ana@x.com")
	var cats []cat
	a.do("GET", "/api/households/"+house+"/categories", nil, c).json(&cats)
	moradia, mercado := cats[0].ID, cats[1].ID
	if cats[1].DefaultWallet == nil || *cats[1].DefaultWallet != "benefit" {
		t.Fatalf("pré-condição: mercado sugere benefício: %+v", cats[1])
	}

	a.newSource(c, house, ana, map[string]any{"dayOfMonth": 28}) // salário líquido 608410, cai dia 28: ainda a receber
	atrasada, _ := a.newInvoice(c, house, moradia, map[string]any{"amountCents": 150000, "dueDate": "2026-10-10"})
	a.newInvoice(c, house, mercado, map[string]any{"amountCents": 40000, "dueDate": "2026-10-25"})
	// filha sem carteira padrão herda a da mãe (mercado → benefício)
	filha, r := a.newCat(c, house, map[string]any{"name": "Feira", "parentId": mercado})
	if r.Code != 201 {
		t.Fatal(r.Body)
	}
	a.newInvoice(c, house, filha.ID, map[string]any{"amountCents": 1000, "dueDate": "2026-10-25"})
	paga, _ := a.newInvoice(c, house, moradia, map[string]any{"amountCents": 20000, "dueDate": "2026-10-05"})
	a.pay(c, house, paga.ID, "free", nil)

	var s struct {
		summaryT
		OverdueCents int64 `json:"overdueCents"`
		OverdueCount int   `json:"overdueCount"`
		Wallets      struct {
			Free    struct{ PendingCents, ProjectedCents, BalanceCents int64 } `json:"free"`
			Benefit struct{ PendingCents, ProjectedCents, BalanceCents int64 } `json:"benefit"`
		} `json:"wallets"`
	}
	r = a.do("GET", "/api/households/"+house+"/summary?month=2026-10-01", nil, c)
	r.json(&s)
	// realizado da livre é negativo (salário ainda não marcado), mas o projetado não: 608410 - 20000 - 150000
	if f := s.Wallets.Free; f.BalanceCents != -20000 || f.PendingCents != 150000 || f.ProjectedCents != 438410 {
		t.Errorf("livre: %+v", f)
	}
	if b := s.Wallets.Benefit; b.PendingCents != 41000 || b.ProjectedCents != -41000 {
		t.Errorf("benefício: %+v", b)
	}
	if s.OverdueCents != 150000 || s.OverdueCount != 1 {
		t.Errorf("atraso: %d em %d", s.OverdueCents, s.OverdueCount)
	}
	// pagar a atrasada tira do atraso e do a pagar
	a.pay(c, house, atrasada.ID, "free", nil)
	r = a.do("GET", "/api/households/"+house+"/summary?month=2026-10-01", nil, c)
	r.json(&s)
	if s.OverdueCount != 0 || s.Wallets.Free.PendingCents != 0 || s.Wallets.Free.ProjectedCents != 438410 {
		t.Errorf("depois de pagar: %+v", s)
	}
}
