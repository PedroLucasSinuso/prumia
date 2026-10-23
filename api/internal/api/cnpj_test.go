package api

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/PedroLucasSinuso/prumia/api/internal/boleto"
	"github.com/PedroLucasSinuso/prumia/api/internal/brasilapi"
)

// fakeLooker simula a BrasilAPI: um mapa de CNPJ -> empresa; ausente = não existe; unavailable = API fora do ar.
type fakeLooker struct {
	companies   map[string]brasilapi.Company
	unavailable bool
	calls       int
}

func (f *fakeLooker) Lookup(_ context.Context, cnpj string) (brasilapi.Company, error) {
	f.calls++
	if f.unavailable {
		return brasilapi.Company{}, brasilapi.ErrUnavailable
	}
	if c, ok := f.companies[cnpj]; ok {
		return c, nil
	}
	return brasilapi.Company{}, brasilapi.ErrNotFound
}

const (
	cegCNPJ = "01695370000153"
	netCNPJ = "11802875000123"
)

func companies() *fakeLooker {
	return &fakeLooker{companies: map[string]brasilapi.Company{
		cegCNPJ: {CNPJ: cegCNPJ, LegalName: "CEG RIO S/A", TradeName: "NATURGY"},
	}}
}

type extractedName struct {
	Boleto struct {
		BeneficiaryName     *string `json:"beneficiaryName"`
		BeneficiaryCnpj     *string `json:"beneficiaryCnpj"`
		BeneficiaryVerified *bool   `json:"beneficiaryVerified"`
	} `json:"boleto"`
}

func TestBoletoNomeEhConferidoPeloCNPJ(t *testing.T) {
	f := companies()
	a := newApp(t, opts{openRegistration: true, company: f})
	c, house := a.register("Ana", "ana@x.com", "Casa")

	// O texto do boleto traz o nome com erro de leitura; a BrasilAPI manda o nome certo.
	var ex extractedName
	a.upload(house, c, fakePDF("RAZÃO SOCIAL: CEC R10 S/A\nCNPJ: 01.695-370/0001-53\n"+lineMasked), "").json(&ex)
	if ex.Boleto.BeneficiaryName == nil || *ex.Boleto.BeneficiaryName != "CEG RIO S/A" {
		t.Fatalf("nome = %v", ex.Boleto.BeneficiaryName)
	}
	if ex.Boleto.BeneficiaryVerified == nil || !*ex.Boleto.BeneficiaryVerified || ex.Boleto.BeneficiaryCnpj == nil || *ex.Boleto.BeneficiaryCnpj != cegCNPJ {
		t.Fatalf("verificado/cnpj: %+v", ex.Boleto)
	}

	// CNPJ que a API não conhece (texto de PDF, que é confiável): mantém o nome e o CNPJ do documento, sem selo.
	ex = extractedName{}
	a.upload(house, c, fakePDF("RAZÃO SOCIAL: LOJA EXEMPLO LTDA\nCNPJ: 11.802.875/0001-23\n"+lineMasked), "").json(&ex)
	if ex.Boleto.BeneficiaryName == nil || *ex.Boleto.BeneficiaryName != "LOJA EXEMPLO LTDA" || ex.Boleto.BeneficiaryVerified != nil || ex.Boleto.BeneficiaryCnpj == nil {
		t.Fatalf("CNPJ desconhecido: %+v", ex.Boleto)
	}
}

func TestBoletoSegueSemABrasilAPI(t *testing.T) {
	f := companies()
	f.unavailable = true
	a := newApp(t, opts{openRegistration: true, company: f})
	c, house := a.register("Ana", "ana@x.com", "Casa")
	r := a.upload(house, c, fakePDF("RAZÃO SOCIAL: CEG RIO S/A\nCNPJ: 01.695-370/0001-53\n"+lineMasked), "")
	if r.Code != http.StatusOK {
		t.Fatalf("a falha da API não pode derrubar a leitura: %d %s", r.Code, r.Body)
	}
	var ex extractedName
	r.json(&ex)
	if ex.Boleto.BeneficiaryName == nil || *ex.Boleto.BeneficiaryName != "CEG RIO S/A" || ex.Boleto.BeneficiaryVerified != nil || ex.Boleto.BeneficiaryCnpj == nil {
		t.Fatalf("sem a API: %+v", ex.Boleto)
	}
}

// OCR pode ler um dígito errado e ainda assim passar nos dígitos verificadores (raro, mas possível): se a API diz que o
// CNPJ não existe, não oferecemos cadastrar um favorecido com um número lido errado.
func TestBoletoOCRComCNPJInexistenteDescartaOCNPJ(t *testing.T) {
	ocr := &boleto.Extractor{
		Now:       func() time.Time { return time.Date(2007, 12, 1, 0, 0, 0, 0, time.UTC) },
		PDFText:   func(context.Context, []byte, string) (string, error) { return "", nil },
		Rasterize: func(context.Context, []byte, string, int) ([]byte, error) { return []byte("img"), nil },
		OCR: func(context.Context, []byte) (string, error) {
			return "Beneficiário: LOJA EXEMPLO LTDA\nCNPJ 11.802.875/0001-23\n" + lineMasked, nil
		},
	}
	a := newApp(t, opts{openRegistration: true, company: companies(), extractor: ocr})
	c, house := a.register("Ana", "ana@x.com", "Casa")
	r := a.upload(house, c, fakePDF("x"), "")
	if r.Code != http.StatusOK {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	var ex extractedName
	r.json(&ex)
	if ex.Boleto.BeneficiaryCnpj != nil {
		t.Fatalf("CNPJ inexistente vindo de OCR deveria ser descartado: %v", *ex.Boleto.BeneficiaryCnpj)
	}
	if ex.Boleto.BeneficiaryName == nil || !strings.Contains(*ex.Boleto.BeneficiaryName, "LOJA EXEMPLO") {
		t.Errorf("o nome lido continua como sugestão: %v", ex.Boleto.BeneficiaryName)
	}
}

func TestConsultaDeCNPJ(t *testing.T) {
	f := companies()
	a := newApp(t, opts{openRegistration: true, company: f})
	c, _ := a.register("Ana", "ana@x.com", "Casa")

	r := a.do("GET", "/api/cnpj/"+cegCNPJ, nil, c)
	if r.Code != 200 {
		t.Fatalf("consulta: %d %s", r.Code, r.Body)
	}
	var co struct {
		Cnpj, LegalName string
		TradeName       *string
	}
	r.json(&co)
	if co.Cnpj != cegCNPJ || co.LegalName != "CEG RIO S/A" || co.TradeName == nil || *co.TradeName != "NATURGY" {
		t.Errorf("empresa = %+v", co)
	}

	// dígitos verificadores errados: 404 sem nem consultar
	calls := f.calls
	if r := a.do("GET", "/api/cnpj/01695370000154", nil, c); r.Code != 404 || f.calls != calls {
		t.Errorf("inválido: %d (consultas %d -> %d)", r.Code, calls, f.calls)
	}
	// válido mas inexistente: 404
	if r := a.do("GET", "/api/cnpj/"+netCNPJ, nil, c); r.Code != 404 {
		t.Errorf("inexistente: %d", r.Code)
	}
	// sem login: 401
	if r := a.do("GET", "/api/cnpj/"+cegCNPJ, nil, nil); r.Code != 401 {
		t.Errorf("sem sessão: %d", r.Code)
	}
	// API fora do ar: 503 com código próprio
	f.unavailable = true
	assertCode(t, a.do("GET", "/api/cnpj/"+cegCNPJ, nil, c), 503, "lookup_unavailable")
}

func TestConsultaDeCNPJTemLimite(t *testing.T) {
	a := newApp(t, opts{openRegistration: true, company: companies()})
	c, _ := a.register("Ana", "ana@x.com", "Casa")
	var limited bool
	for i := 0; i < 15; i++ {
		if a.do("GET", "/api/cnpj/"+cegCNPJ, nil, c).Code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Error("consultas ilimitadas: um laço poderia usar nossa saída de rede à vontade")
	}
}
