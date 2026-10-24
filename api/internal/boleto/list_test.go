package boleto

import (
	"errors"
	"testing"
)

type want struct {
	desc  string
	cents int64
}

// Textos sintéticos (nomes e valores inventados) do padrão "descrição: valor".
func TestPadraoDeLista(t *testing.T) {
	chat := "Amor\n22:45\nGás: R$150\nInternet: R$119,90\nRação Gatos: R$24,99\nTeste: 567\n" +
		"http://192.168.0.10:8080/convite\n?token=a0vGxxxxxxxxxxxxxxxx\nAgora abriu\nEstava aparecendo westgroup 727\n" +
		"Estava aparecendo algo 7:18 7\nq w e r t y u i o p\n"
	for name, tc := range map[string]struct {
		body string
		kind Kind
		want []want
	}{
		"so a ultima tem R$":     {"Gás: 98,40\nMédico: 250,00\nRemédio: R$45,90", KindList, []want{{"Gás", 9840}, {"Médico", 25000}, {"Remédio", 4590}}},
		"R$ sem centavos+fraco":  {"Gás: R$150\nInternet: R$119,90\nRação Gatos: R$24,99\nTeste: 567", KindList, []want{{"Gás", 15000}, {"Internet", 11990}, {"Ração Gatos", 2499}, {"Teste", 56700}}},
		"screenshot de conversa": {chat, KindList, []want{{"Gás", 15000}, {"Internet", 11990}, {"Ração Gatos", 2499}, {"Teste", 56700}}},
		"hífen":                  {"Gás - 98,40\nLuz - 120,10", KindList, []want{{"Gás", 9840}, {"Luz", 12010}}},
		"marcador":               {"• Mercado: 310,25\n• Padaria: 20,5 \n- Gás: R$ 1.234,56", KindList, []want{{"Mercado", 31025}, {"Padaria", 2050}, {"Gás", 123456}}},
		"R$ sem separador":       {"Ração gatos R$24,99\nGás R$ 150", KindList, []want{{"Ração gatos", 2499}, {"Gás", 15000}}},
		"igual":                  {"Gás = 98,40\nLuz = R$120", KindList, []want{{"Gás", 9840}, {"Luz", 12000}}},
		"barra":                  {"Gás: 98,40 / Médico: 250,00 / Remédio: R$45,90", KindList, []want{{"Gás", 9840}, {"Médico", 25000}, {"Remédio", 4590}}},
		"ponto e vírgula":        {"Gás R$157,82; Mercado R$568,99", KindList, []want{{"Gás", 15782}, {"Mercado", 56899}}},
		"pipe":                   {"Gás R$157,82 | Mercado R$568,99 | Luz R$ 90", KindList, []want{{"Gás", 15782}, {"Mercado", 56899}, {"Luz", 9000}}},
		"lixo no fim e começo":   {"& Gás: 98,40 M\n> Luz: R$120,00 2519 ,\n1 Ração gatos: R$24,99 | |", KindList, []want{{"Gás", 9840}, {"Luz", 12000}, {"Ração gatos", 2499}}},
		"hora no fim da linha":   {"Gás: R$98,40 14:32 ✓✓\nLuz: R$ 12,00 14:33", KindList, []want{{"Gás", 9840}, {"Luz", 1200}}},
		"1 só item vira conta":   {"Gás: R$150", KindBill, []want{{"Gás", 15000}}},
		"fraco sozinho ignorado": {"Medidor: 3789363\nCliente: 46198", "", nil},
		"fraco com 1 forte":      {"Gás: R$150\nTeste: 567\nBom dia", KindBill, []want{{"Gás", 15000}}},
		"fraco acima do teto":    {"Gás: 98,40\nLuz: 12,00\nCarro: 250000", KindList, []want{{"Gás", 9840}, {"Luz", 1200}}},
		"R$ sem centavos 2":      {"Gás: R$150\nLuz R$ 90", KindList, []want{{"Gás", 15000}, {"Luz", 9000}}},
		"CNPJ nao e valor":       {"Gás: 98,40\nLuz: 12,00\nEmpresa CNPJ 12.345.678/0001-90", KindList, []want{{"Gás", 9840}, {"Luz", 1200}}},
		"lixo colado no valor":   {"Gás: R$150\nInternet: R$119,90\nRação Gatos: R$24,99\nTeste: 567| |", KindList, []want{{"Gás", 15000}, {"Internet", 11990}, {"Ração Gatos", 2499}, {"Teste", 56700}}},
		"lixo colado em fortes":  {"Gás: R$150|\nInternet: 119,90]\nLuz: R$ 90_ )", KindList, []want{{"Gás", 15000}, {"Internet", 11990}, {"Luz", 9000}}},
		"fraco colado sozinho":   {"Medidor: 123456|", "", nil},
		"total nao e item":       {"Gás: R$ 100,00\nLuz: R$ 50,00\nTotal: R$ 150,00", KindList, []want{{"Gás", 10000}, {"Luz", 5000}}},
	} {
		t.Run(name, func(t *testing.T) {
			d, ok := analyze(tc.body)
			if tc.want == nil {
				if ok && d.Kind == KindList {
					t.Fatalf("não devia ser lista: %+v", d)
				}
				return
			}
			if !ok || d.Kind != tc.kind || len(d.Items) != len(tc.want) {
				t.Fatalf("kind=%v ok=%v itens=%+v", d.Kind, ok, d.Items)
			}
			for i, w := range tc.want {
				if d.Items[i].Description != w.desc || d.Items[i].AmountCents != w.cents {
					t.Errorf("item %d: %+v (quer %+v)", i, d.Items[i], w)
				}
			}
		})
	}
}

func TestParseMoney(t *testing.T) {
	for in, w := range map[string]struct {
		rs    bool
		cents int64
		two   bool
		ok    bool
	}{
		"150": {false, 15000, false, true}, "150,5": {false, 15050, false, true}, "154,72": {false, 15472, true, true},
		"1.234,56": {false, 123456, true, true}, "1.234": {false, 123400, false, true}, "130.43": {true, 13043, false, true},
		"130.43,": {true, 13043, false, true}, "1.5": {false, 0, false, false}, "0": {false, 0, false, false}, "1,234,56": {false, 0, false, false},
	} {
		c, two, ok := parseMoney(in, w.rs)
		if c != w.cents || two != w.two || ok != w.ok {
			t.Errorf("%q: %d %v %v", in, c, two, ok)
		}
	}
}

// Linhas "Rótulo: número" de fatura não viram lista.
func TestFaturaNaoViraLista(t *testing.T) {
	fatura := "Companhia Exemplo de Energia SA\nMedidor: 123456\nCliente: 46198\nVencimento: 10/11/2026\nTotal a pagar: R$ 130,43\n"
	d, ok := analyze(fatura)
	if !ok || d.Kind != KindBill || d.Items[0].AmountCents != 13043 || len(d.Items) != 1 {
		t.Fatalf("fatura com total: %+v", d)
	}
	// sem "total a pagar": 1 valor forte + rótulos numéricos continua sendo uma conta só
	d, ok = analyze("Medidor: 123456\nCliente: 46198\nVencimento: 10/11/2026\nValor R$ 130,43")
	if !ok || d.Kind != KindBill || len(d.Items) != 1 || d.Items[0].AmountCents != 13043 {
		t.Fatalf("fatura sem total: %+v", d)
	}
	if d, ok := analyze("Medidor: 123456\nCliente: 46198\nVencimento: 10/11/2026"); ok {
		t.Fatalf("nada a ler: %+v", d)
	}
}

func TestExtractText(t *testing.T) {
	e := &Extractor{}
	d, err := e.ExtractText("Gás: 98,40\nLuz: R$ 120")
	if err != nil || d.Kind != KindList || d.Method != MethodText || len(d.Items) != 2 {
		t.Fatalf("lista: %+v %v", d, err)
	}
	if _, err := e.ExtractText("Bom dia, tudo certo?"); !errors.Is(err, ErrNotFound) {
		t.Errorf("erro = %v", err)
	}
}
