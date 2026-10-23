package api

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func batchItem(catID, desc string, cents int, extra map[string]any) map[string]any {
	it := map[string]any{"categoryId": catID, "description": desc, "amountCents": cents, "dueDate": "2026-10-20"}
	for k, v := range extra {
		it[k] = v
	}
	return it
}

func (a *app) countInvoices(house string) int64 {
	var n int64
	a.db.Raw("SELECT count(*) FROM invoices WHERE household_id = ?", house).Scan(&n)
	return n
}

func (a *app) batch(house string, c *http.Cookie, items ...any) resp {
	a.t.Helper()
	return a.do("POST", "/api/households/"+house+"/invoices/batch", map[string]any{"items": items}, c)
}

func TestLoteCriaTodas(t *testing.T) {
	a, c, house, catID := casa(t)
	r := a.batch(house, c,
		batchItem(catID, "Gás", 15782, nil),
		batchItem(catID, "Mercado", 56899, map[string]any{"competenceMonth": "2026-09-01"}),
		batchItem(catID, "Loja", 100, map[string]any{
			"boleto":   map[string]any{"digitableLine": lineDigits, "beneficiaryCnpj": "45678901000175", "beneficiaryName": "LOJA EXEMPLO LTDA"},
			"newPayee": map[string]any{"name": "Loja"},
		}),
	)
	if r.Code != http.StatusCreated {
		t.Fatalf("lote: %d %s", r.Code, r.Body)
	}
	var out struct {
		Items []struct {
			Description     string                          `json:"description"`
			CompetenceMonth string                          `json:"competenceMonth"`
			PayeeID         *string                         `json:"payeeId"`
			Boleto          *struct{ DigitableLine string } `json:"boleto"`
		} `json:"items"`
	}
	r.json(&out)
	if len(out.Items) != 3 || out.Items[0].Description != "Gás" || out.Items[1].CompetenceMonth != "2026-09-01" || out.Items[2].Boleto == nil || out.Items[2].PayeeID == nil {
		t.Fatalf("resposta: %s", r.Body)
	}
	if n := a.countInvoices(house); n != 3 {
		t.Errorf("gravadas %d", n)
	}
}

// Um item inválido derruba o lote inteiro, com o erro apontando o índice.
func TestLoteTudoOuNada(t *testing.T) {
	a, c, house, catID := casa(t)
	r := a.batch(house, c,
		batchItem(catID, "Gás", 15782, nil),
		batchItem(catID, "Mercado", 56899, nil),
		batchItem(catID, "Ração", 0, nil),
	)
	assertField(t, r, http.StatusBadRequest, "items.2.amountCents")
	if n := a.countInvoices(house); n != 0 {
		t.Errorf("gravou %d contas de um lote inválido", n)
	}

	// Erro no meio da transação (favorecido com nome repetido no item 1): o item 0, já inserido, é desfeito.
	a.do("POST", "/api/households/"+house+"/payees", map[string]any{"name": "Gás"}, c)
	r = a.batch(house, c,
		batchItem(catID, "Mercado", 56899, nil),
		batchItem(catID, "Gás", 15782, map[string]any{"newPayee": map[string]any{"name": "gás"}}),
	)
	assertCode(t, r, http.StatusConflict, "payee_exists")
	if n := a.countInvoices(house); n != 0 {
		t.Errorf("gravou %d contas apesar do conflito", n)
	}

	// Lote vazio e grande demais
	assertField(t, a.batch(house, c), http.StatusBadRequest, "items")
	many := make([]any, 51)
	for i := range many {
		many[i] = batchItem(catID, fmt.Sprint("x", i), 100, nil)
	}
	assertField(t, a.batch(house, c, many...), http.StatusBadRequest, "items")
}

func TestLoteBoletoRepetidoEFavorecidoNovoCompartilhado(t *testing.T) {
	a, c, house, catID := casa(t)
	bol := map[string]any{"digitableLine": lineDigits}
	r := a.batch(house, c,
		batchItem(catID, "A", 100, map[string]any{"boleto": bol}),
		batchItem(catID, "B", 100, map[string]any{"boleto": bol}),
	)
	assertField(t, r, http.StatusBadRequest, "items.1.boleto.digitableLine")

	// Linha inválida aponta o item.
	bad := strings.Replace(lineDigits, "816069", "816060", 1)
	r = a.batch(house, c,
		batchItem(catID, "A", 100, nil),
		batchItem(catID, "B", 100, map[string]any{"boleto": map[string]any{"digitableLine": bad}}),
	)
	assertField(t, r, http.StatusBadRequest, "items.1.boleto.digitableLine")

	// O mesmo favorecido novo em dois itens: um favorecido só, as duas contas apontando para ele.
	r = a.batch(house, c,
		batchItem(catID, "Luz junho", 100, map[string]any{"newPayee": map[string]any{"name": "Luz"}}),
		batchItem(catID, "Luz julho", 100, map[string]any{"newPayee": map[string]any{"name": "luz"}}),
	)
	if r.Code != http.StatusCreated {
		t.Fatalf("lote: %d %s", r.Code, r.Body)
	}
	var list []payeeOut
	a.do("GET", "/api/households/"+house+"/payees", nil, c).json(&list)
	if len(list) != 1 {
		t.Fatalf("favorecidos: %+v", list)
	}
	var n int64
	a.db.Raw("SELECT count(*) FROM invoices WHERE payee_id = ?", list[0].ID).Scan(&n)
	if n != 2 {
		t.Errorf("contas com o favorecido: %d", n)
	}
}

func TestLotePapeisEIsolamento(t *testing.T) {
	a, cA, houseA, catA := casa(t)
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")
	item := batchItem(catA, "Gás", 100, nil)

	// casa B na rota da casa A: 404; na própria casa com a categoria da A: categoria inválida
	if r := a.batch(houseA, cB, item); r.Code != http.StatusNotFound {
		t.Errorf("casa B escreveu na A: %d", r.Code)
	}
	assertField(t, a.batch(houseB, cB, item), http.StatusBadRequest, "items.0.categoryId")

	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'viewer')", houseA, a.uid("beto@x.com"))
	if r := a.batch(houseA, cB, item); r.Code != http.StatusForbidden {
		t.Errorf("viewer: %d", r.Code)
	}
	if n := a.countInvoices(houseA); n != 0 {
		t.Errorf("gravou %d", n)
	}
	if r := a.batch(houseA, cA, item); r.Code != http.StatusCreated {
		t.Errorf("admin: %d %s", r.Code, r.Body)
	}
}

// O lote tem limite de corpo próprio (512 KB): 50 contas com observação longa passam dos 64 KB do JSON comum.
func TestLoteCorpoGrande(t *testing.T) {
	a, c, house, catID := casa(t)
	items := make([]any, 50)
	for i := range items {
		items[i] = batchItem(catID, fmt.Sprint("Conta ", i), 100, map[string]any{"notes": strings.Repeat("a", 500)})
	}
	if r := a.batch(house, c, items...); r.Code != http.StatusCreated {
		t.Fatalf("lote de 50: %d %s", r.Code, r.Body)
	}
}
