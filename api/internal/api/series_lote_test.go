package api

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"
)

// Testes de ponta a ponta (Postgres real) da listagem de compras com parcelas e do "Desfazer" em lote
// (POST /invoices/{id}/restore?scope=following).

type purchasePageT struct {
	Items      []purchaseT `json:"items"`
	NextCursor string      `json:"nextCursor"`
}

func (a *app) listPurchases(c *http.Cookie, house, query string) purchasePageT {
	a.t.Helper()
	var page purchasePageT
	r := a.do("GET", "/api/households/"+house+"/purchases"+query, nil, c)
	if r.Code != 200 {
		a.t.Fatalf("listar compras: %d %s", r.Code, r.Body)
	}
	r.json(&page)
	return page
}

// numbers devolve os números das parcelas, na ordem recebida.
func numbers(items []sinv) string {
	out := make([]int, len(items))
	for i, it := range items {
		if it.Series == nil || it.Series.InstallmentNumber == nil {
			return "sem série"
		}
		out[i] = *it.Series.InstallmentNumber
	}
	return fmt.Sprint(out)
}

func TestListaDeComprasTrazParcelas(t *testing.T) {
	a, c, house, catID, _ := serie(t)
	base := "/api/households/" + house + "/invoices/"
	nb, _ := a.newPurchase(c, house, catID, nil) // 6x, comprada em 2026-08-01
	a.do("POST", base+nb.Installments[0].ID+"/pay", map[string]any{"wallet": "free"}, c)
	a.do("POST", base+nb.Installments[1].ID+"/pay", map[string]any{"wallet": "free"}, c)
	if r := a.do("DELETE", base+nb.Installments[2].ID, nil, c); r.Code != 204 {
		t.Fatal(r.Code)
	}
	for _, d := range []string{"2026-06-01", "2026-07-01"} {
		if _, r := a.newPurchase(c, house, catID, map[string]any{"description": "Geladeira " + d, "purchaseDate": d, "installmentsCount": 3}); r.Code != 201 {
			t.Fatal(r.Body)
		}
	}
	// outra casa com compra: não aparece na lista da casa A
	cB, houseB := a.register("Bia", "bia@x.com", "Casa B")
	if _, r := a.newPurchase(cB, houseB, mustCat(a, cB, houseB), map[string]any{"description": "Notebook da B"}); r.Code != 201 {
		t.Fatal(r.Body)
	}

	page := a.listPurchases(c, house, "?q=note")
	if len(page.Items) != 1 || page.Items[0].ID != nb.ID {
		t.Fatalf("busca: %+v", page.Items)
	}
	got := page.Items[0].Installments
	if numbers(got) != "[1 2 4 5 6]" {
		t.Errorf("parcelas (sem a excluída, em ordem): %s", numbers(got))
	}
	paid := 0
	for _, i := range got {
		if i.Paid != nil {
			paid++
		}
		if i.Series.InstallmentsCount == nil || *i.Series.InstallmentsCount != 6 {
			t.Error("cada parcela sabe o total (n de N)")
		}
	}
	if paid != 2 {
		t.Errorf("pagas: %d", paid)
	}

	// paginação: cada página traz as parcelas da sua compra, sem pular nem repetir
	var seen []string
	cursor := ""
	for i := 0; i < 5; i++ {
		q := "?limit=1"
		if cursor != "" {
			q += "&cursor=" + cursor
		}
		p := a.listPurchases(c, house, q)
		for _, it := range p.Items {
			seen = append(seen, fmt.Sprintf("%s:%d", it.PurchaseDate, len(it.Installments)))
		}
		if p.NextCursor == "" {
			break
		}
		cursor = p.NextCursor
	}
	if fmt.Sprint(seen) != "[2026-08-01:5 2026-07-01:3 2026-06-01:3]" {
		t.Errorf("paginação: %v", seen)
	}

	// sem N+1: o número de consultas não cresce com o tamanho da página
	var queries, nanos atomic.Int64
	a.db.Logger = countingLogger{Interface: a.db.Logger, n: &queries, ns: &nanos}
	count := func(q string) int64 {
		queries.Store(0)
		a.listPurchases(c, house, q)
		return queries.Load()
	}
	one, three := count("?limit=1"), count("?limit=3")
	if one != three {
		t.Errorf("consultas crescem com a página (N+1): limit=1 → %d, limit=3 → %d", one, three)
	}
	t.Logf("consultas por listagem de compras: %d", three)
}

func TestDesfazerExclusaoEmLoteDeParcelas(t *testing.T) {
	a, c, house, catID, _ := serie(t)
	base := "/api/households/" + house + "/invoices/"
	p, _ := a.newPurchase(c, house, catID, nil)
	in := p.Installments

	// exclusão avulsa ANTES (parcela 2) e depois o lote a partir da 4, com a 5 paga (fica)
	a.do("DELETE", base+in[1].ID, nil, c)
	a.do("POST", base+in[4].ID+"/pay", map[string]any{"wallet": "free"}, c)
	if r := a.do("DELETE", base+in[3].ID+"?scope=following", nil, c); r.Code != 204 {
		t.Fatal(r.Code)
	}
	if got, _ := a.getPurchase(c, house, p.ID); numbers(got.Installments) != "[1 3 5]" {
		t.Fatalf("depois do lote: %s", numbers(got.Installments))
	}
	r := a.do("POST", base+in[3].ID+"/restore?scope=following", nil, c)
	if r.Code != 200 {
		t.Fatalf("desfazer: %d %s", r.Code, r.Body)
	}
	if got, _ := a.getPurchase(c, house, p.ID); numbers(got.Installments) != "[1 3 4 5 6]" {
		t.Errorf("desfazer devolve 4 e 6 e NÃO a 2 (excluída antes): %s", numbers(got.Installments))
	}
	if r := a.do("POST", base+in[3].ID+"/restore?scope=following", nil, c); r.Code != 409 {
		t.Errorf("desfazer de novo: %d", r.Code)
	}

	// lote que esvazia a compra: o cabeçalho fecha e o Desfazer o reabre (a 2 continua excluída)
	a.do("DELETE", base+in[4].ID+"/pay", nil, c) // a 5 volta a pendente para o lote poder levá-la
	if r := a.do("DELETE", base+in[0].ID+"?scope=following", nil, c); r.Code != 204 {
		t.Fatal(r.Code)
	}
	if _, code := a.getPurchase(c, house, p.ID); code != 404 {
		t.Fatalf("compra sem parcelas deveria fechar: %d", code)
	}
	if r := a.do("POST", base+in[0].ID+"/restore?scope=following", nil, c); r.Code != 200 {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	got, code := a.getPurchase(c, house, p.ID)
	if code != 200 || numbers(got.Installments) != "[1 3 4 5 6]" {
		t.Errorf("reabrir compra: %d %s", code, numbers(got.Installments))
	}

	// scope=this continua restaurando só uma
	a.do("DELETE", base+in[3].ID+"?scope=following", nil, c)
	a.do("POST", base+in[3].ID+"/restore", nil, c)
	if got, _ := a.getPurchase(c, house, p.ID); numbers(got.Installments) != "[1 3 4]" {
		t.Errorf("restore só esta: %s", numbers(got.Installments))
	}
	// desfazer o lote a partir de uma do meio do lote restaura dela em diante
	a.do("POST", base+in[5].ID+"/restore?scope=following", nil, c)
	if got, _ := a.getPurchase(c, house, p.ID); numbers(got.Installments) != "[1 3 4 6]" {
		t.Errorf("a partir da 6: %s", numbers(got.Installments))
	}

	// isolamento: outra casa não desfaz (404) nem com o id certo
	a.do("DELETE", base+in[0].ID+"?scope=following", nil, c)
	cB, houseB := a.register("Bia", "bia@x.com", "Casa B")
	if r := a.do("POST", "/api/households/"+houseB+"/invoices/"+in[0].ID+"/restore?scope=following", nil, cB); r.Code != 404 {
		t.Errorf("outra casa: %d", r.Code)
	}
	if r := a.do("POST", base+in[0].ID+"/restore?scope=following", nil, cB); r.Code != 403 && r.Code != 404 {
		t.Errorf("rota da casa A com sessão da B: %d", r.Code)
	}
	if _, code := a.getPurchase(c, house, p.ID); code != 404 {
		t.Errorf("nada deveria ter sido restaurado: %d", code)
	}
}

func TestDesfazerExclusaoEmLoteDeRecorrencia(t *testing.T) {
	a, c, house, catID, _ := serie(t)
	base := "/api/households/" + house + "/invoices/"
	rec, _ := a.newRecurrence(c, house, catID, nil) // set/2026 em diante, sem fim
	byMonth := func(m string) sinv {
		items := a.invoicesOf(c, house, "&month="+m)
		if len(items) != 1 {
			t.Fatalf("mês %s: %d", m, len(items))
		}
		return items[0]
	}
	alive := func() int {
		var n int
		a.db.Raw("SELECT count(*) FROM invoices WHERE recurrence_id = ? AND deleted_at IS NULL", rec.ID).Scan(&n)
		return n
	}
	endOf := func() string {
		for _, r := range a.recurrences(c, house) {
			if r.ID != rec.ID {
				continue
			}
			if r.EndMonth == nil {
				return "sem fim"
			}
			return *r.EndMonth
		}
		return "excluída"
	}
	total := alive()
	nov, jan, mar, may, sep := byMonth("2026-11-01"), byMonth("2027-01-01"), byMonth("2027-03-01"), byMonth("2027-05-01"), byMonth("2026-09-01")

	// avulsa antes (nov), depois o lote a partir de jan: desfazer volta jan.. e o "sem fim", mas não nov
	a.do("DELETE", base+nov.ID, nil, c)
	a.do("DELETE", base+jan.ID+"?scope=following", nil, c)
	if endOf() != "2026-12-01" {
		t.Fatalf("encerrar: %s", endOf())
	}
	if r := a.do("POST", base+jan.ID+"/restore?scope=following", nil, c); r.Code != 200 {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	if endOf() != "sem fim" || alive() != total-1 {
		t.Errorf("desfazer: fim=%s vivas=%d (esperado %d)", endOf(), alive(), total-1)
	}

	// lotes empilhados: maio (fim abr) e depois março (fim fev). Desfazer o de maio primeiro = 409 sem mexer em nada;
	// desfazer na ordem inversa devolve fev → abr → sem fim.
	a.do("DELETE", base+may.ID+"?scope=following", nil, c)
	a.do("DELETE", base+mar.ID+"?scope=following", nil, c)
	before := alive()
	if r := a.do("POST", base+may.ID+"/restore?scope=following", nil, c); r.Code != 409 {
		t.Errorf("lote fora de ordem: %d %s", r.Code, r.Body)
	}
	if alive() != before || endOf() != "2027-02-01" {
		t.Errorf("409 não pode mudar nada: vivas %d→%d fim=%s", before, alive(), endOf())
	}
	a.do("POST", base+mar.ID+"/restore?scope=following", nil, c)
	if endOf() != "2027-04-01" {
		t.Errorf("desfazer março: %s", endOf())
	}
	a.do("POST", base+may.ID+"/restore?scope=following", nil, c)
	if endOf() != "sem fim" || alive() != total-1 {
		t.Errorf("desfazer maio: fim=%s vivas=%d", endOf(), alive())
	}

	// lote a partir da 1ª ocorrência exclui a recorrência inteira; Desfazer a traz de volta (nov segue excluída)
	a.do("DELETE", base+sep.ID+"?scope=following", nil, c)
	if endOf() != "excluída" {
		t.Fatalf("deveria excluir a recorrência: %s", endOf())
	}
	if r := a.do("POST", base+sep.ID+"/restore?scope=following", nil, c); r.Code != 200 {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	if endOf() != "sem fim" || alive() != total-1 {
		t.Errorf("reativar: fim=%s vivas=%d", endOf(), alive())
	}

	// recorrência com fim próprio: o Desfazer devolve o fim anterior (jun/2027), não "sem fim"
	r2, _ := a.newRecurrence(c, house, catID, map[string]any{"description": "Curso", "endMonth": "2027-06-01"})
	var cursoMar string
	a.db.Raw("SELECT id FROM invoices WHERE recurrence_id = ? AND occurrence_month = '2027-03-01'", r2.ID).Scan(&cursoMar)
	a.do("DELETE", base+cursoMar+"?scope=following", nil, c)
	a.do("POST", base+cursoMar+"/restore?scope=following", nil, c)
	var end string
	a.db.Raw("SELECT end_month::text FROM recurrences WHERE id = ?", r2.ID).Scan(&end)
	if end != "2027-06-01" {
		t.Errorf("fim anterior: %s", end)
	}

	// isolamento: outra casa não desfaz o lote da casa A
	a.do("DELETE", base+jan.ID+"?scope=following", nil, c)
	cB, houseB := a.register("Bia", "bia@x.com", "Casa B")
	if r := a.do("POST", "/api/households/"+houseB+"/invoices/"+jan.ID+"/restore?scope=following", nil, cB); r.Code != 404 {
		t.Errorf("outra casa: %d", r.Code)
	}
	if endOf() != "2026-12-01" {
		t.Errorf("a casa B não pode mexer na recorrência da A: %s", endOf())
	}
}
