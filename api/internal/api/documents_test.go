package api

import (
	"net/http"
	"strings"
	"testing"
)

// Textos sintéticos: empresas e CNPJs inventados (dígitos verificadores válidos).

type documentOut struct {
	Kind   string `json:"kind"`
	Method string `json:"method"`
	Items  []struct {
		Description          *string                         `json:"description"`
		AmountCents          *int64                          `json:"amountCents"`
		DueDate              *string                         `json:"dueDate"`
		CompetenceMonth      *string                         `json:"competenceMonth"`
		BeneficiaryName      *string                         `json:"beneficiaryName"`
		BeneficiaryCnpj      *string                         `json:"beneficiaryCnpj"`
		Boleto               *struct{ DigitableLine string } `json:"boleto"`
		DuplicateOfInvoiceID *string                         `json:"duplicateOfInvoiceId"`
		Payee                *payeeOut                       `json:"payee"`
	} `json:"items"`
}

func (a *app) readDocument(house string, c *http.Cookie, text string) (documentOut, resp) {
	a.t.Helper()
	r := a.uploadTo("/api/households/"+house+"/documents/extract", c, fakePDF(text), "")
	var d documentOut
	if r.Code == http.StatusOK {
		r.json(&d)
	}
	return d, r
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func TestDocumentoBoletoContaELista(t *testing.T) {
	a, c, house, catID := casa(t)

	// boleto: 1 item com o boleto e a duplicidade, como no /boletos/extract
	d, r := a.readDocument(house, c, "Beneficiário: LOJA EXEMPLO LTDA\n"+lineMasked)
	if r.Code != http.StatusOK || d.Kind != "boleto" || d.Method != "pdf_text" || len(d.Items) != 1 {
		t.Fatalf("boleto: %d %s", r.Code, r.Body)
	}
	it := d.Items[0]
	if it.Boleto == nil || it.Boleto.DigitableLine != lineDigits || *it.AmountCents != 100 || str(it.Description) != "LOJA EXEMPLO LTDA" || it.DuplicateOfInvoiceID != nil {
		t.Errorf("item do boleto: %s", r.Body)
	}
	created, _ := a.newInvoice(c, house, catID, map[string]any{"boleto": map[string]any{"digitableLine": lineDigits}})
	d, _ = a.readDocument(house, c, lineMasked)
	if str(d.Items[0].DuplicateOfInvoiceID) != created.ID {
		t.Errorf("duplicidade: %+v", d.Items[0].DuplicateOfInvoiceID)
	}

	// conta sem boleto (tabela)
	d, r = a.readDocument(house, c, "Gasco Distribuidora SA\nCNPJ 11.222.333/0001-81\nREF: MÊS / ANO | VENCIMENTO | TOTAL A PAGAR\nJUN/2026 | 17/07/2026 | R$ 130,43")
	if r.Code != http.StatusOK || d.Kind != "bill" || len(d.Items) != 1 {
		t.Fatalf("conta: %d %s", r.Code, r.Body)
	}
	it = d.Items[0]
	if it.Boleto != nil || *it.AmountCents != 13043 || str(it.DueDate) != "2026-07-17" || str(it.CompetenceMonth) != "2026-06-01" ||
		str(it.Description) != "Gasco Distribuidora SA" || str(it.BeneficiaryCnpj) != "11222333000181" {
		t.Errorf("conta: %s", r.Body)
	}

	// lista
	d, r = a.readDocument(house, c, "Gás R$157,82\nMercado R$568,99\nRação gatos: R$199,99")
	if r.Code != http.StatusOK || d.Kind != "list" || len(d.Items) != 3 || str(d.Items[2].Description) != "Ração gatos" || *d.Items[1].AmountCents != 56899 {
		t.Fatalf("lista: %d %s", r.Code, r.Body)
	}

	// nada: 422 como no boleto
	_, r = a.readDocument(house, c, "Bom dia, tudo certo?")
	assertCode(t, r, http.StatusUnprocessableEntity, "boleto_not_found")
}

func TestDocumentoReconheceFavorecidoNaConta(t *testing.T) {
	a, c, house, _ := casa(t)
	var p payeeOut
	a.do("POST", "/api/households/"+house+"/payees", map[string]any{"name": "Gás", "cnpj": "11222333000181"}, c).json(&p)
	d, r := a.readDocument(house, c, "Gasco Distribuidora SA CNPJ 11.222.333/0001-81\nTotal a pagar: R$ 130,43")
	if r.Code != http.StatusOK || d.Items[0].Payee == nil || d.Items[0].Payee.ID != p.ID {
		t.Fatalf("favorecido não reconhecido: %s", r.Body)
	}
}

func TestDocumentoPapeisEIsolamento(t *testing.T) {
	a, cA, house, _ := casa(t)
	cB, _ := a.register("Beto", "beto@x.com", "Casa B")
	if _, r := a.readDocument(house, cB, lineMasked); r.Code != http.StatusNotFound {
		t.Errorf("casa B leu na casa A: %d", r.Code)
	}
	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'viewer')", house, a.uid("beto@x.com"))
	if _, r := a.readDocument(house, cB, lineMasked); r.Code != http.StatusForbidden {
		t.Errorf("viewer: %d", r.Code)
	}
	// senha e tamanho seguem as regras do boleto
	r := a.uploadTo("/api/households/"+house+"/documents/extract", cA, fakePDF("LOCKED "+lineMasked), "")
	assertCode(t, r, http.StatusUnprocessableEntity, "password_required")
	big := append([]byte("%PDF-"), []byte(strings.Repeat("a", 5<<20))...)
	r = a.uploadTo("/api/households/"+house+"/documents/extract", cA, big, "")
	assertCode(t, r, http.StatusRequestEntityTooLarge, "file_too_large")
}

// Ler documento e ler boleto dividem o mesmo limite por usuário.
func TestDocumentoLimiteDeRequisicoes(t *testing.T) {
	a, c, house, _ := casa(t)
	for i := 0; i < 10; i++ {
		a.upload(house, c, fakePDF("nada"), "")
	}
	_, r := a.readDocument(house, c, lineMasked)
	assertCode(t, r, http.StatusTooManyRequests, "too_many_requests")
}
