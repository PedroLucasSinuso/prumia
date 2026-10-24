package boleto

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// Todos os textos abaixo são SINTÉTICOS (empresas e CNPJs inventados, com dígitos verificadores válidos).

var refJul2026 = time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)

func fmtDate(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format("2006-01-02")
}

// Foto de conta de consumo SEM código de barras: cabeçalho de tabela numa linha, valores na seguinte.
const contaSemBoleto = `Gasco Distribuidora SA
CNPJ 11.222.333/0001-81
REF: MÊS / ANO | VENCIMENTO | TOTAL A PAGAR
JUN/2026 | 17/07/2026 | R$ 130,43
Consumo do mês 12 m3`

func TestAnalyzeContaSemBoletoEmTabela(t *testing.T) {
	for name, body := range map[string]string{
		"com barras":       contaSemBoleto,
		"OCR sem barras":   "Gasco Distribuidora SA\nREF: MÊS/ANO VENCIMENTO TOTAL A PAGAR\nJUN/2026 17/07/2026 RS 130,43",
		"pdftotext célula": "Gasco Distribuidora SA\nREF: MÊS/ANO\nVENCIMENTO\nTOTAL A PAGAR\nJUN/2026\n17/07/2026\nR$130,43",
	} {
		t.Run(name, func(t *testing.T) {
			d, ok := analyze(body)
			if !ok || d.Kind != KindBill || len(d.Items) != 1 {
				t.Fatalf("%+v %v", d, ok)
			}
			it := d.Items[0]
			if it.AmountCents != 13043 || fmtDate(it.DueDate) != "2026-07-17" || fmtDate(it.Competence) != "2026-06-01" {
				t.Errorf("valor %d venc %s comp %s", it.AmountCents, fmtDate(it.DueDate), fmtDate(it.Competence))
			}
			if it.Description != "Gasco Distribuidora SA" {
				t.Errorf("descrição = %q", it.Description)
			}
		})
	}
	// Sem rótulo de beneficiário, o CNPJ é o primeiro válido.
	d, _ := analyze(contaSemBoleto)
	if d.Items[0].BeneficiaryCNPJ != "11222333000181" {
		t.Errorf("cnpj = %q", d.Items[0].BeneficiaryCNPJ)
	}
}

// Conta de luz em PDF com o mesmo layout: o vencimento vem da tabela, inclusive quando há linha digitável.
func TestVencimentoEmTabelaNoBoleto(t *testing.T) {
	line := "83630000001-2 23451112223-1 33444555666-8 77788899900-3" // arrecadação: sem vencimento na linha
	body := "LUMEN ENERGIA S.A.\nREF: MÊS / ANO | VENCIMENTO | TOTAL A PAGAR\nJUN/2026 | 17/07/2026 | R$ 130,43\n" + line
	b, ok := FindInText(body, refJul2026)
	if !ok {
		t.Fatal("linha não encontrada")
	}
	if fmtDate(b.DueDate) != "2026-07-17" || fmtDate(b.Competence) != "2026-06-01" {
		t.Errorf("venc %s comp %s", fmtDate(b.DueDate), fmtDate(b.Competence))
	}
	if b.Beneficiary != "LUMEN ENERGIA S.A." {
		t.Errorf("beneficiário = %q", b.Beneficiary)
	}
}

func TestRazaoSocial(t *testing.T) {
	for name, tc := range map[string]struct{ text, want string }{
		"SA sem barra":          {"Gasco Distribuidora SA\nRua Exemplo, 100", "Gasco Distribuidora SA"},
		"Ltda caixa mista":      {"Fatura emitida por Netlink Provedor Ltda - CNPJ 45.678.901/0001-75", "Netlink Provedor Ltda"},
		"LTDA maiúsculo":        {"NETLINK PROVEDOR LTDA\n", "NETLINK PROVEDOR LTDA"},
		"S/A":                   {"GASCO DISTRIBUIDORA S/A − Rua", "GASCO DISTRIBUIDORA S/A"},
		"Eireli":                {"Padaria Pão de Ouro Eireli, Rua", "Padaria Pão de Ouro Eireli"},
		"ME":                    {"Mercadinho do Bairro ME\n", "Mercadinho do Bairro ME"},
		"rótulo Nome / Razão":   {"Nome / Razão Social: Netlink Provedor Ltda\nCNPJ 45.678.901/0001-75", "Netlink Provedor Ltda"},
		"rótulo linha de baixo": {"Nome / Razão Social\nGasco Distribuidora SA\n", "Gasco Distribuidora SA"},
		"rótulo em tabela":      {"Nome / Razão Social   CNPJ\nGasco Distribuidora SA   11.222.333/0001-81", "Gasco Distribuidora SA"},
		"sa minúsculo não vale": {"tudo isa bem\n", ""},
	} {
		if got := findBeneficiary(tc.text); got != tc.want {
			t.Errorf("%s: %q, quer %q", name, got, tc.want)
		}
	}
}

func TestValoresEMeses(t *testing.T) {
	for name, tc := range map[string]struct {
		text   string
		cents  int64
		strong bool
	}{
		"R$ com espaço e milhar": {"Total a pagar: R$ 1.234,56", 123456, true},
		"R$ colado":              {"VALOR A PAGAR R$1.234,56", 123456, true},
		"linha de baixo":         {"Valor do documento\n130,43", 13043, true},
		"total fraco":            {"Total R$ 99,90", 9990, false},
		"OCR com ponto":          {"TOTAL A PAGAR RS 130.43", 13043, true},
	} {
		cents, strong := findAmount(tc.text)
		if cents != tc.cents || strong != tc.strong {
			t.Errorf("%s: %d %v", name, cents, strong)
		}
	}
	for text, want := range map[string]string{
		"REF: JUN/2026":              "2026-06-01",
		"Mês de referência: 06/2026": "2026-06-01",
		"Competência: junho/2026":    "2026-06-01",
	} {
		if got := fmtDate(findCompetence(text)); got != want {
			t.Errorf("%q: %s", text, got)
		}
	}
}

// Print de conversa com uma lista de gastos, um por linha.
func TestAnalyzeLista(t *testing.T) {
	for name, body := range map[string]string{
		"uma por linha":  "Amor, as contas do mês:\nGás R$157,82\nMercado R$568,99\nRação gatos: R$199,99 14:32 ✓✓\nTotal R$ 926,80",
		"na mesma linha": "Gás R$157,82 / Mercado R$568,99 / Ração gatos: R$199,99",
		"com marcadores": "- Gás - R$ 157,82\n• Mercado: R$ 568,99\n* Ração gatos = R$ 199,99",
	} {
		t.Run(name, func(t *testing.T) {
			d, ok := analyze(body)
			if !ok || d.Kind != KindList {
				t.Fatalf("%+v %v", d, ok)
			}
			want := []Item{{Description: "Gás", AmountCents: 15782}, {Description: "Mercado", AmountCents: 56899}, {Description: "Ração gatos", AmountCents: 19999}}
			if len(d.Items) != len(want) {
				t.Fatalf("itens: %+v", d.Items)
			}
			for i, w := range want {
				if d.Items[i].Description != w.Description || d.Items[i].AmountCents != w.AmountCents {
					t.Errorf("item %d: %+v", i, d.Items[i])
				}
			}
		})
	}
}

func TestAnalyzeOrdemDeDecisao(t *testing.T) {
	// Conta detalhada (itens + "total a pagar") é UMA conta, não lista.
	d, _ := analyze("Netlink Provedor Ltda\nInternet 500 mega R$ 99,90\nTV R$ 30,00\nTotal a pagar R$ 129,90")
	if d.Kind != KindBill || d.Items[0].AmountCents != 12990 || d.Items[0].Description != "Netlink Provedor Ltda" {
		t.Errorf("conta detalhada: %+v", d)
	}
	// Um item só vira conta com a descrição do item.
	d, _ = analyze("Gás R$157,82")
	if d.Kind != KindBill || d.Items[0].Description != "Gás" || d.Items[0].AmountCents != 15782 {
		t.Errorf("um item: %+v", d)
	}
	// Valor sem rótulo, no meio do texto: o maior R$.
	d, _ = analyze("Seu pedido de R$ 12,00 de frete e R$ 340,50 de produtos")
	if d.Kind != KindBill || d.Items[0].AmountCents != 34050 {
		t.Errorf("maior valor: %+v", d)
	}
	// Valor com vencimento (rótulo fraco) é conta.
	d, _ = analyze("Total R$ 80,00\nVencimento: 10/08/2026\nAluguel R$ 10,00\nCondomínio R$ 70,00")
	if d.Kind != KindBill || fmtDate(d.Items[0].DueDate) != "2026-08-10" {
		t.Errorf("com vencimento: %+v", d)
	}
	if _, ok := analyze("Bom dia! Tudo certo por aí?"); ok {
		t.Error("texto sem valor virou conta")
	}
}

func TestExtractDocumentCascata(t *testing.T) {
	ctx := context.Background()
	t.Run("boleto no texto do PDF vence tudo", func(t *testing.T) {
		e := extractor()
		e.PDFText = func(context.Context, []byte, string) (string, error) {
			return "Total a pagar R$ 1,00\n" + exampleLine, nil
		}
		d, err := e.ExtractDocument(ctx, pdfBytes, "")
		if err != nil || d.Kind != KindBoleto || d.Method != MethodPDFText || d.Items[0].Boleto == nil || d.Items[0].AmountCents != 100 {
			t.Fatalf("%+v %v", d, err)
		}
	})
	t.Run("código de barras da página vence a conta do texto", func(t *testing.T) {
		e := extractor()
		e.PDFText = func(context.Context, []byte, string) (string, error) { return contaSemBoleto, nil }
		e.Rasterize = func(_ context.Context, _ []byte, _ string, page int) ([]byte, error) {
			if page > 1 {
				return nil, errors.New("sem página")
			}
			return pngBytes, nil
		}
		e.Barcode = func([]byte) (string, error) { return exampleBarcode, nil }
		d, err := e.ExtractDocument(ctx, pdfBytes, "")
		if err != nil || d.Kind != KindBoleto || d.Method != MethodBarcodeImage {
			t.Fatalf("%+v %v", d, err)
		}
		// o texto do PDF completa o que o código de barras não traz
		if d.Items[0].Beneficiary != "Gasco Distribuidora SA" {
			t.Errorf("beneficiário = %q", d.Items[0].Beneficiary)
		}
	})
	t.Run("PDF com texto sem boleto: conta, sem OCR", func(t *testing.T) {
		e := extractor()
		e.PDFText = func(context.Context, []byte, string) (string, error) { return contaSemBoleto, nil }
		e.OCR = func(context.Context, []byte) (string, error) { t.Error("OCR não devia rodar"); return "", nil }
		e.Rasterize = func(context.Context, []byte, string, int) ([]byte, error) { return nil, errors.New("sem página") }
		d, err := e.ExtractDocument(ctx, pdfBytes, "")
		if err != nil || d.Kind != KindBill || d.Method != MethodPDFText {
			t.Fatalf("%+v %v", d, err)
		}
	})
	t.Run("foto sem código de barras: OCR lê a lista", func(t *testing.T) {
		e := extractor()
		e.Barcode = func([]byte) (string, error) { return "", errors.New("nada") }
		e.OCR = func(context.Context, []byte) (string, error) { return "Gás R$157,82\nMercado R$568,99", nil }
		d, err := e.ExtractDocument(ctx, pngBytes, "")
		if err != nil || d.Kind != KindList || d.Method != MethodOCR || len(d.Items) != 2 {
			t.Fatalf("%+v %v", d, err)
		}
	})
	t.Run("boleto no OCR da 2ª página vence a conta da 1ª", func(t *testing.T) {
		e := extractor()
		e.Rasterize = func(_ context.Context, _ []byte, _ string, page int) ([]byte, error) {
			return append([]byte(nil), append(pngBytes, byte(page))...), nil
		}
		e.OCR = func(_ context.Context, img []byte) (string, error) {
			if img[len(img)-1] == 1 {
				return contaSemBoleto, nil
			}
			return exampleLine, nil
		}
		d, err := e.ExtractDocument(ctx, pdfBytes, "")
		if err != nil || d.Kind != KindBoleto || d.Method != MethodOCR {
			t.Fatalf("%+v %v", d, err)
		}
	})
	t.Run("nada", func(t *testing.T) {
		e := extractor()
		e.OCR = func(context.Context, []byte) (string, error) { return "Bom dia", nil }
		if _, err := e.ExtractDocument(ctx, pngBytes, ""); !errors.Is(err, ErrNotFound) {
			t.Fatalf("erro = %v", err)
		}
	})
	t.Run("senha e formato", func(t *testing.T) {
		e := extractor()
		e.PDFText = func(context.Context, []byte, string) (string, error) { return "", ErrPasswordRequired }
		if _, err := e.ExtractDocument(ctx, pdfBytes, ""); !errors.Is(err, ErrPasswordRequired) {
			t.Errorf("senha: %v", err)
		}
		if _, err := e.ExtractDocument(ctx, []byte("MZ"), ""); !errors.Is(err, ErrUnsupported) {
			t.Errorf("formato: %v", err)
		}
	})
	t.Run("imagem gigante não chega ao OCR", func(t *testing.T) {
		e := extractor()
		e.OCR = func(context.Context, []byte) (string, error) { t.Error("OCR chamado"); return "", nil }
		if _, err := e.ExtractDocument(ctx, pngComDimensoes(t, 60000, 60000), ""); !errors.Is(err, ErrNotFound) {
			t.Errorf("erro = %v", err)
		}
	})
}

// Textos que o Tesseract devolve para FOTOS reais (psm 6): lixo no fim das linhas, barra do mês lida como "I",
// cabeçalho de tabela com texto de outra coluna colado. Valores e nomes aqui são inventados.
func TestOCRDeLista(t *testing.T) {
	text := "\" Gás R$98,40\n' Mercado R$310,25 M\n1 Ração gatos: R$120,00 2519 ,\nqA\n"
	d, ok := analyze(text)
	if !ok || d.Kind != KindList || len(d.Items) != 3 {
		t.Fatalf("lista: %+v ok=%v", d, ok)
	}
	want := []struct {
		desc  string
		cents int64
	}{{"Gás", 9840}, {"Mercado", 31025}, {"Ração gatos", 12000}}
	for i, w := range want {
		if d.Items[i].Description != w.desc || d.Items[i].AmountCents != w.cents {
			t.Errorf("item %d = %q %d, quer %q %d", i, d.Items[i].Description, d.Items[i].AmountCents, w.desc, w.cents)
		}
	}
}

func TestOCRDeContaComCabecalhoSujo(t *testing.T) {
	text := "DANF3E - DOCUMENTO AUXILIAR DA NOTA\n" +
		"REF: MÊS / ANO | VENCIMENTO TOTAL A PAGAR E rªtj;% Protocolo de autorização: 3332600044341839 - 25/06/2028 às\n" +
		"SET/2026 | 12/10/2026 | R$ 88,15 [) RRAA\n"
	d, ok := analyze(text)
	if !ok || d.Kind != KindBill || len(d.Items) != 1 {
		t.Fatalf("conta: %+v ok=%v", d, ok)
	}
	it := d.Items[0]
	if it.AmountCents != 8815 || it.DueDate.Format("2006-01-02") != "2026-10-12" || it.Competence.Format("2006-01") != "2026-09" {
		t.Errorf("campos: %d %v %v", it.AmountCents, it.DueDate, it.Competence)
	}
	// o mês também com a barra lida como "I" ("SETI2026")
	d, _ = analyze(strings.Replace(text, "SET/2026", "SETI2026", 1))
	if got := d.Items[0].Competence.Format("2006-01"); got != "2026-09" {
		t.Errorf("mês com barra trocada: %s", got)
	}
}

// Linha com rótulo e valor juntos NÃO é cabeçalho de tabela, mesmo com dois rótulos.
func TestRotuloEValorNaMesmaLinhaNaoEhCabecalho(t *testing.T) {
	if got := labelsOf("Vencimento: 10/11/2026 Total a pagar: R$ 50,00"); got != nil {
		t.Errorf("deveria ser linha de valores, não de rótulos: %v", got)
	}
}

func TestDescricaoPeloTipoDeServico(t *testing.T) {
	text := "DANF3E - DOCUMENTO AUXILIAR DA NOTA\nFISCAL DE ENERGIA ELÉTRICA ELETRÔNICA\nTOTAL A PAGAR\nR$ 88,15\n"
	d, ok := analyze(text)
	if !ok || d.Items[0].Description != "Luz" {
		t.Fatalf("descrição = %+v ok=%v", d, ok)
	}
	// com nome de empresa lido, o nome vence o tipo de serviço
	d, _ = analyze("RAZÃO SOCIAL: NETLINK PROVEDOR LTDA\nSERVIÇO DE COMUNICAÇÃO ELETRÔNICA\nTOTAL A PAGAR R$ 50,00\n")
	if d.Items[0].Description != "NETLINK PROVEDOR LTDA" {
		t.Errorf("descrição = %q", d.Items[0].Description)
	}
}
