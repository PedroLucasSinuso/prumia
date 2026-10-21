package api

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/PedroLucasSinuso/prumia/api/internal/boleto"
)

// Linha de exemplo da Febraban (fator 3737, R$ 1,00). "Hoje" do extrator = 2007, para o fator resolver em 2007-12-31.
const (
	lineMasked  = "00190.50095 40144.816069 06809.350314 3 37370000000100"
	lineDigits  = "00190500954014481606906809350314337370000000100"
	lineBarcode = "00193373700000001000500940144816060680935031"
)

// testExtractor troca o pdftotext por um dublê: o "PDF" de teste é "%PDF-" + o texto que a ferramenta devolveria.
// Assim os testes não dependem de poppler/tesseract instalados; as ferramentas reais têm testes próprios em internal/boleto.
func testExtractor() *boleto.Extractor {
	return &boleto.Extractor{
		Now: func() time.Time { return time.Date(2007, 12, 1, 0, 0, 0, 0, time.UTC) },
		PDFText: func(_ context.Context, pdf []byte, pw string) (string, error) {
			text := strings.TrimPrefix(string(pdf), "%PDF-")
			if strings.Contains(text, "LOCKED") {
				switch pw {
				case "":
					return "", boleto.ErrPasswordRequired
				case "segredo":
				default:
					return "", boleto.ErrWrongPassword
				}
			}
			return text, nil
		},
	}
}

func fakePDF(text string) []byte { return []byte("%PDF-" + text) }

func (a *app) upload(house string, c *http.Cookie, file []byte, password string) resp {
	a.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if file != nil {
		fw, _ := mw.CreateFormFile("file", "boleto.pdf")
		fw.Write(file)
	}
	if password != "" {
		mw.WriteField("password", password)
	}
	mw.Close()
	req := httptest.NewRequest("POST", "/api/households/"+house+"/boletos/extract", &body)
	req.RemoteAddr = "203.0.113.7:1234"
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if c != nil {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	a.router.ServeHTTP(w, req)
	return resp{w}
}

type extraction struct {
	Boleto struct {
		DigitableLine       string  `json:"digitableLine"`
		Barcode             string  `json:"barcode"`
		BeneficiaryName     *string `json:"beneficiaryName"`
		DocumentAmountCents *int64  `json:"documentAmountCents"`
		DocumentDueDate     *string `json:"documentDueDate"`
	} `json:"boleto"`
	Method               string  `json:"method"`
	DuplicateOfInvoiceID *string `json:"duplicateOfInvoiceId"`
}

func TestBoletoExtrairEDetectarDuplicidade(t *testing.T) {
	a, c, house, catID := casa(t)

	r := a.upload(house, c, fakePDF("Beneficiário: LOJA EXEMPLO LTDA\n"+lineMasked), "")
	if r.Code != http.StatusOK {
		t.Fatalf("extract: %d %s", r.Code, r.Body.String())
	}
	var ex extraction
	r.json(&ex)
	if ex.Boleto.DigitableLine != lineDigits || ex.Boleto.Barcode != lineBarcode || ex.Method != "pdf_text" {
		t.Errorf("leitura: %+v", ex)
	}
	if ex.Boleto.DocumentAmountCents == nil || *ex.Boleto.DocumentAmountCents != 100 || ex.Boleto.DocumentDueDate == nil || *ex.Boleto.DocumentDueDate != "2007-12-31" {
		t.Errorf("valor/vencimento: %+v", ex.Boleto)
	}
	if ex.Boleto.BeneficiaryName == nil || *ex.Boleto.BeneficiaryName != "LOJA EXEMPLO LTDA" {
		t.Errorf("beneficiário: %v", ex.Boleto.BeneficiaryName)
	}
	if ex.DuplicateOfInvoiceID != nil {
		t.Errorf("ainda não deveria ser duplicado")
	}

	// Salvar a invoice com o boleto: o servidor valida a linha e guarda valor/vencimento calculados dela.
	created, cr := a.newInvoice(c, house, catID, map[string]any{
		"description": "Loja", "amountCents": 100,
		"boleto": map[string]any{"digitableLine": lineDigits, "beneficiaryName": "LOJA EXEMPLO LTDA", "documentAmountCents": 999999},
	})
	if cr.Code != http.StatusCreated {
		t.Fatalf("criar: %d %s", cr.Code, cr.Body.String())
	}
	var got struct {
		Boleto *struct {
			DigitableLine       string `json:"digitableLine"`
			Barcode             string `json:"barcode"`
			DocumentAmountCents int64  `json:"documentAmountCents"`
			DocumentDueDate     string `json:"documentDueDate"`
			BeneficiaryName     string `json:"beneficiaryName"`
		} `json:"boleto"`
	}
	a.do("GET", "/api/households/"+house+"/invoices/"+created.ID, nil, c).json(&got)
	if got.Boleto == nil || got.Boleto.DigitableLine != lineDigits || got.Boleto.Barcode != lineBarcode {
		t.Fatalf("boleto da invoice: %+v", got.Boleto)
	}
	if got.Boleto.DocumentAmountCents != 100 { // 999999 enviado pelo cliente é ignorado
		t.Errorf("valor do boleto veio do cliente: %d", got.Boleto.DocumentAmountCents)
	}

	// também aparece na lista do mês (sem N+1)
	var page struct {
		Items []struct {
			ID     string                          `json:"id"`
			Boleto *struct{ DigitableLine string } `json:"boleto"`
		} `json:"items"`
	}
	a.do("GET", "/api/households/"+house+"/invoices?month=2026-10-01", nil, c).json(&page)
	if len(page.Items) != 1 || page.Items[0].Boleto == nil {
		t.Errorf("lista sem boleto: %+v", page)
	}

	// Duplicidade: mesma linha de novo.
	r = a.upload(house, c, fakePDF(lineMasked), "")
	r.json(&ex)
	if ex.DuplicateOfInvoiceID == nil || *ex.DuplicateOfInvoiceID != created.ID {
		t.Errorf("duplicidade não detectada: %+v", ex.DuplicateOfInvoiceID)
	}

	// Excluída a invoice, o boleto pode ser lançado de novo.
	a.do("DELETE", "/api/households/"+house+"/invoices/"+created.ID, nil, c)
	ex = extraction{}
	a.upload(house, c, fakePDF(lineMasked), "").json(&ex)
	if ex.DuplicateOfInvoiceID != nil {
		t.Errorf("invoice excluída ainda conta como duplicada")
	}
}

func TestBoletoDuplicidadeNaoVazaEntreCasas(t *testing.T) {
	a, cA, houseA, catA := casa(t)
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")
	var catsB []cat
	a.do("GET", "/api/households/"+houseB+"/categories", nil, cB).json(&catsB)

	a.newInvoice(cA, houseA, catA, map[string]any{"boleto": map[string]any{"digitableLine": lineDigits}})
	var ex extraction
	a.upload(houseB, cB, fakePDF(lineMasked), "").json(&ex)
	if ex.DuplicateOfInvoiceID != nil {
		t.Error("a casa B enxergou a invoice da casa A")
	}
	// e a casa B não consegue usar a rota da casa A
	if r := a.upload(houseA, cB, fakePDF(lineMasked), ""); r.Code == http.StatusOK {
		t.Errorf("casa B leu na casa A: %d", r.Code)
	}
}

func TestBoletoLinhaInvalidaNaInvoiceEhRecusada(t *testing.T) {
	a, c, house, catID := casa(t)
	bad := strings.Replace(lineDigits, "816069", "816060", 1)
	_, r := a.newInvoice(c, house, catID, map[string]any{"boleto": map[string]any{"digitableLine": bad}})
	if r.Code != http.StatusBadRequest {
		t.Fatalf("esperava 400, veio %d %s", r.Code, r.Body.String())
	}
	if !strings.Contains(r.Body.String(), "boleto.digitableLine") {
		t.Errorf("sem o campo no erro: %s", r.Body.String())
	}
	// nada foi gravado pela metade
	var n int64
	a.db.Raw("SELECT count(*) FROM invoices").Scan(&n)
	if n != 0 {
		t.Errorf("invoice criada apesar do boleto inválido: %d", n)
	}
}

func TestBoletoSenhaDoPDF(t *testing.T) {
	a, c, house, _ := casa(t)
	locked := fakePDF("LOCKED " + lineMasked)

	code := func(r resp) string {
		var p struct{ Code string }
		r.json(&p)
		return p.Code
	}
	if r := a.upload(house, c, locked, ""); r.Code != http.StatusUnprocessableEntity || code(r) != "password_required" {
		t.Errorf("sem senha: %d %s", r.Code, r.Body.String())
	}
	if r := a.upload(house, c, locked, "errada"); r.Code != http.StatusUnprocessableEntity || code(r) != "wrong_password" {
		t.Errorf("senha errada: %d %s", r.Code, r.Body.String())
	}
	r := a.upload(house, c, locked, "segredo")
	if r.Code != http.StatusOK {
		t.Fatalf("senha certa: %d %s", r.Code, r.Body.String())
	}
	// a senha nunca volta na resposta
	if strings.Contains(r.Body.String(), "segredo") {
		t.Error("a senha apareceu na resposta")
	}
}

func TestBoletoErros(t *testing.T) {
	a, c, house, _ := casa(t)
	code := func(r resp) string {
		var p struct{ Code string }
		r.json(&p)
		return p.Code
	}
	if r := a.upload(house, c, []byte("MZ executável"), ""); r.Code != 422 || code(r) != "unsupported_file" {
		t.Errorf("formato: %d %s", r.Code, r.Body.String())
	}
	if r := a.upload(house, c, fakePDF("nada de boleto aqui 123"), ""); r.Code != 422 || code(r) != "boleto_not_found" {
		t.Errorf("sem boleto: %d %s", r.Code, r.Body.String())
	}
	big := append([]byte("%PDF-"), bytes.Repeat([]byte("a"), 5<<20)...)
	if r := a.upload(house, c, big, ""); r.Code != http.StatusRequestEntityTooLarge || code(r) != "file_too_large" {
		t.Errorf("grande: %d %s", r.Code, r.Body.String())
	}
	if r := a.upload(house, c, nil, ""); r.Code != http.StatusBadRequest {
		t.Errorf("sem arquivo: %d", r.Code)
	}
	if r := a.upload(house, nil, fakePDF(lineMasked), ""); r.Code != http.StatusUnauthorized {
		t.Errorf("sem sessão: %d", r.Code)
	}
}

func TestBoletoSoMembroEscreve(t *testing.T) {
	a, cA, house, _ := casa(t)
	cB, _ := a.register("Beto", "beto@x.com", "Casa B")
	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'viewer')", house, a.uid("beto@x.com"))
	if r := a.upload(house, cB, fakePDF(lineMasked), ""); r.Code != http.StatusForbidden {
		t.Errorf("viewer: %d (queria 403)", r.Code)
	}
	if r := a.upload(house, cA, fakePDF(lineMasked), ""); r.Code != http.StatusOK {
		t.Errorf("admin: %d", r.Code)
	}
}

func TestBoletoLimiteDeRequisicoes(t *testing.T) {
	a, c, house, _ := casa(t)
	var last int
	for i := 0; i < 12; i++ {
		last = a.upload(house, c, fakePDF("sem boleto"), "").Code
	}
	if last != http.StatusTooManyRequests {
		t.Errorf("a 12ª leitura seguida deveria ser barrada, veio %d", last)
	}
}
