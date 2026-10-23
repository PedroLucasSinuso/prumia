package api

import (
	"net/http"
	"testing"
)

type payeeOut struct {
	ID                string  `json:"id"`
	Name              string  `json:"name"`
	CNPJ              *string `json:"cnpj"`
	LegalName         *string `json:"legalName"`
	DefaultCategoryID *string `json:"defaultCategoryId"`
	Archived          bool    `json:"archived"`
}

func TestFavorecidoCriarListarEditar(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, house := a.register("Ana", "ana@x.com", "Casa A")
	base := "/api/households/" + house + "/payees"
	cat := mustCat(a, ana, house)

	// CNPJ com a máscara fora do padrão, como aparece em PDFs; o servidor guarda só dígitos.
	r := a.do("POST", base, map[string]any{"name": "  Gás ", "cnpj": "11.222-333/0001-81", "legalName": "GASCO DISTRIBUIDORA S/A", "defaultCategoryId": cat}, ana)
	if r.Code != http.StatusCreated {
		t.Fatalf("criar: %d %s", r.Code, r.Body)
	}
	var p payeeOut
	r.json(&p)
	if p.Name != "Gás" || p.CNPJ == nil || *p.CNPJ != "11222333000181" || p.DefaultCategoryID == nil || *p.DefaultCategoryID != cat {
		t.Fatalf("favorecido = %+v", p)
	}

	// nome repetido (sem diferenciar caixa) e CNPJ repetido: 409 com códigos próprios
	r = a.do("POST", base, map[string]any{"name": "gás"}, ana)
	assertCode(t, r, 409, "payee_exists")
	r = a.do("POST", base, map[string]any{"name": "Gasco", "cnpj": "11222333000181"}, ana)
	assertCode(t, r, 409, "payee_cnpj_exists")

	// validações
	assertField(t, a.do("POST", base, map[string]any{"name": "Y", "cnpj": "45.678.901/0001-76"}, ana), 400, "cnpj")
	assertField(t, a.do("POST", base, map[string]any{"name": ""}, ana), 400, "name")
	assertField(t, a.do("POST", base, map[string]any{"name": "Z", "defaultCategoryId": "00000000-0000-4000-8000-000000000000"}, ana), 400, "defaultCategoryId")

	// editar: limpar o CNPJ (null) e trocar o nome; sem CNPJ, o mesmo CNPJ pode ir para outro
	r = a.do("PATCH", base+"/"+p.ID, map[string]any{"name": "Gasco", "cnpj": nil}, ana)
	if r.Code != 200 {
		t.Fatalf("editar: %d %s", r.Code, r.Body)
	}
	var q payeeOut
	r.json(&q)
	if q.Name != "Gasco" || q.CNPJ != nil || q.LegalName == nil {
		t.Fatalf("depois de editar = %+v", q)
	}

	var list []payeeOut
	a.do("GET", base, nil, ana).json(&list)
	if len(list) != 1 {
		t.Fatalf("lista = %+v", list)
	}
}

func TestFavorecidoEmUsoArquivaEmVezDeExcluir(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, house := a.register("Ana", "ana@x.com", "Casa A")
	base := "/api/households/" + house + "/payees"
	cat := mustCat(a, ana, house)

	var p payeeOut
	a.do("POST", base, map[string]any{"name": "Internet"}, ana).json(&p)
	r := a.do("POST", "/api/households/"+house+"/invoices", map[string]any{
		"categoryId": cat, "description": "Internet", "amountCents": 5000, "dueDate": "2026-10-10", "payeeId": p.ID,
	}, ana)
	if r.Code != http.StatusCreated {
		t.Fatalf("invoice com favorecido: %d %s", r.Code, r.Body)
	}
	var inv struct {
		ID      string  `json:"id"`
		PayeeID *string `json:"payeeId"`
	}
	r.json(&inv)
	if inv.PayeeID == nil || *inv.PayeeID != p.ID {
		t.Fatalf("payeeId = %v", inv.PayeeID)
	}

	assertCode(t, a.do("DELETE", base+"/"+p.ID, nil, ana), 409, "payee_in_use")

	// arquivado: some da lista, deixa de ser aceito em contas novas, mas a conta antiga o mantém
	if r := a.do("PATCH", base+"/"+p.ID, map[string]any{"archived": true}, ana); r.Code != 200 {
		t.Fatalf("arquivar: %d %s", r.Code, r.Body)
	}
	var list []payeeOut
	a.do("GET", base, nil, ana).json(&list)
	if len(list) != 0 {
		t.Fatalf("arquivado ainda na lista: %+v", list)
	}
	assertField(t, a.do("POST", "/api/households/"+house+"/invoices", map[string]any{
		"categoryId": cat, "description": "x", "amountCents": 100, "dueDate": "2026-10-10", "payeeId": p.ID,
	}, ana), 400, "payeeId")

	// editar a conta: limpar o favorecido (null) e voltar a ter
	r = a.do("PATCH", "/api/households/"+house+"/invoices/"+inv.ID, map[string]any{"payeeId": nil}, ana)
	if r.Code != 200 {
		t.Fatalf("limpar favorecido: %d %s", r.Code, r.Body)
	}
	var after struct {
		PayeeID *string `json:"payeeId"`
	}
	r.json(&after)
	if after.PayeeID != nil {
		t.Fatalf("payeeId deveria ter sido limpo: %v", *after.PayeeID)
	}
	// sem uso, exclui de verdade
	if r := a.do("DELETE", base+"/"+p.ID, nil, ana); r.Code != http.StatusNoContent {
		t.Fatalf("excluir: %d %s", r.Code, r.Body)
	}
}

// Favorecido de outra casa não pode ser usado em conta nem como padrão (a FK composta é a segunda barreira).
func TestFavoritoDeOutraCasaEhRecusado(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, houseA := a.register("Ana", "ana@x.com", "Casa A")
	beto, houseB := a.register("Beto", "beto@x.com", "Casa B")
	var p payeeOut
	a.do("POST", "/api/households/"+houseA+"/payees", map[string]any{"name": "Só da A"}, ana).json(&p)

	assertField(t, a.do("POST", "/api/households/"+houseB+"/invoices", map[string]any{
		"categoryId": mustCat(a, beto, houseB), "description": "x", "amountCents": 100, "dueDate": "2026-10-10", "payeeId": p.ID,
	}, beto), 400, "payeeId")

	// o mesmo CNPJ pode existir em casas diferentes
	a.do("PATCH", "/api/households/"+houseA+"/payees/"+p.ID, map[string]any{"cnpj": "45678901000175"}, ana)
	if r := a.do("POST", "/api/households/"+houseB+"/payees", map[string]any{"name": "Internet", "cnpj": "45678901000175"}, beto); r.Code != 201 {
		t.Fatalf("mesmo CNPJ em outra casa: %d %s", r.Code, r.Body)
	}
}

// assertCode confere o status e o `code` do problema (o contrato de erro de negócio).
func assertCode(t *testing.T, r resp, status int, code string) {
	t.Helper()
	if r.Code != status {
		t.Errorf("status %d, quer %d: %s", r.Code, status, r.Body)
		return
	}
	var p struct {
		Code string `json:"code"`
	}
	r.json(&p)
	if p.Code != code {
		t.Errorf("code %q, quer %q: %s", p.Code, code, r.Body)
	}
}
