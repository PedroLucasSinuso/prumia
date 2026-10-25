package boleto

import (
	"errors"
	"testing"
	"time"
)

// testRef: data de referência fixa dos testes (quinta, 22/10/2026).
var testRef = time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)

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
		// ponto decimal sem R$ (teclado com ponto): forte quando a linha termina no valor
		"ponto decimal":              {"Gás: 98.40\nLuz: 210.35\nÁgua - 75.10", KindList, []want{{"Gás", 9840}, {"Luz", 21035}, {"Água", 7510}}},
		"ponto decimal misturado":    {"Gás: 98.40\nMercado: 310,25\nLuz: R$ 90", KindList, []want{{"Gás", 9840}, {"Mercado", 31025}, {"Luz", 9000}}},
		"ponto com unidade é fraco":  {"Consumo: 123.45 kWh\nLeitura: 4523.10 m3", "", nil},
		"ponto com unidade e fortes": {"Gás: R$ 98,40\nLuz: R$ 210,35\nConsumo: 123.45 kWh", KindList, []want{{"Gás", 9840}, {"Luz", 21035}, {"Consumo", 12345}}},
		// quantidade: o valor é o que está escrito; a quantidade vai para o fim da descrição
		"quantidade antes do valor":      {"Pão: 2x R$ 5,00\nLeite: 3 x 4,50\nCafé: R$ 18,90", KindList, []want{{"Pão (2x)", 500}, {"Leite (3x)", 450}, {"Café", 1890}}},
		"quantidade na descrição":        {"2x Pão: R$ 10,00\nRação 3x: 120,00\nPilha x4: R$ 20,00", KindList, []want{{"Pão (2x)", 1000}, {"Ração (3x)", 12000}, {"Pilha (4x)", 2000}}},
		"parcela não multiplica":         {"Notebook: 10x R$ 300,00\nCelular: 12x R$ 150,00", KindList, []want{{"Notebook (10x)", 30000}, {"Celular (12x)", 15000}}},
		"palavra com x não é quantidade": {"Táxi: R$ 35,00\nBox 2: R$ 80,00", KindList, []want{{"Táxi", 3500}, {"Box 2", 8000}}},
	} {
		t.Run(name, func(t *testing.T) {
			d, ok := analyze(tc.body, testRef)
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
	d, ok := analyze(fatura, testRef)
	if !ok || d.Kind != KindBill || d.Items[0].AmountCents != 13043 || len(d.Items) != 1 {
		t.Fatalf("fatura com total: %+v", d)
	}
	// sem "total a pagar": 1 valor forte + rótulos numéricos continua sendo uma conta só
	d, ok = analyze("Medidor: 123456\nCliente: 46198\nVencimento: 10/11/2026\nValor R$ 130,43", testRef)
	if !ok || d.Kind != KindBill || len(d.Items) != 1 || d.Items[0].AmountCents != 13043 {
		t.Fatalf("fatura sem total: %+v", d)
	}
	if d, ok := analyze("Medidor: 123456\nCliente: 46198\nVencimento: 10/11/2026", testRef); ok {
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

// Vencimento escrito na própria linha do item (texto colado ou OCR de print): a data vira Item.DueDate e sai da descrição.
// Referência fixa: testRef = 22/10/2026.
func TestListaComVencimento(t *testing.T) {
	d := func(y, m, day int) time.Time { return time.Date(y, time.Month(m), day, 0, 0, 0, 0, time.UTC) }
	type got struct {
		desc  string
		cents int64
		due   time.Time
	}
	for name, tc := range map[string]struct {
		body string
		want []got
	}{
		"dd/mm no fim":                {"Luz: R$ 210,35 10/11\nGás: R$ 150,00 12/11", []got{{"Luz", 21035, d(2026, 11, 10)}, {"Gás", 15000, d(2026, 11, 12)}}},
		"vence antes da data":         {"Luz: R$ 210,35 vence 10/11\nGás: 150,00 venc. 12/11", []got{{"Luz", 21035, d(2026, 11, 10)}, {"Gás", 15000, d(2026, 11, 12)}}},
		"data depois do nome":         {"Aluguel 05/12/2026: R$ 1.500,00\nInternet 10/11: 119,90", []got{{"Aluguel", 150000, d(2026, 12, 5)}, {"Internet", 11990, d(2026, 11, 10)}}},
		"data no começo":              {"10/11 Luz R$ 210,35\n12/11 Gás R$ 150,00", []got{{"Luz", 21035, d(2026, 11, 10)}, {"Gás", 15000, d(2026, 11, 12)}}},
		"hífen em volta":              {"Luz - 10/11 - R$ 210,35\nGás - 12/11 - R$ 150,00", []got{{"Luz", 21035, d(2026, 11, 10)}, {"Gás", 15000, d(2026, 11, 12)}}},
		"ano de 2 dígitos":            {"Luz: R$ 210,35 10/11/26\nGás: R$ 150,00 12/11/26", []got{{"Luz", 21035, d(2026, 11, 10)}, {"Gás", 15000, d(2026, 11, 12)}}},
		"dd-mm-aaaa":                  {"Luz: R$ 210,35 10-11-2026\nGás: R$ 150,00 12-11-2026", []got{{"Luz", 21035, d(2026, 11, 10)}, {"Gás", 15000, d(2026, 11, 12)}}},
		"sem ano passou: ano que vem": {"Luz: R$ 210,35 10/01\nGás: R$ 150,00 12/01", []got{{"Luz", 21035, d(2027, 1, 10)}, {"Gás", 15000, d(2027, 1, 12)}}},
		"sem ano há pouco: este ano":  {"Luz: R$ 210,35 05/10\nGás: R$ 150,00 12/11", []got{{"Luz", 21035, d(2026, 10, 5)}, {"Gás", 15000, d(2026, 11, 12)}}},
		"dia 10 (futuro neste mês)":   {"Luz: R$ 210,35 dia 25\nGás: R$ 150,00 vence dia 30", []got{{"Luz", 21035, d(2026, 10, 25)}, {"Gás", 15000, d(2026, 10, 30)}}},
		"dia já passou: mês seguinte": {"Luz: R$ 210,35 dia 10\nGás: R$ 150,00 dia 5", []got{{"Luz", 21035, d(2026, 11, 10)}, {"Gás", 15000, d(2026, 11, 5)}}},
		"dia 31 em mês curto":         {"Luz: R$ 210,35 dia 31\nGás: R$ 150,00 dia 29", []got{{"Luz", 21035, d(2026, 10, 31)}, {"Gás", 15000, d(2026, 10, 29)}}},
		"misto: uma sem data":         {"Luz: R$ 210,35 10/11\nGás: R$ 150,00", []got{{"Luz", 21035, d(2026, 11, 10)}, {"Gás", 15000, time.Time{}}}},
		"vários na mesma linha":       {"Luz: 210,35 10/11 / Gás: 150,00 12/11", []got{{"Luz", 21035, d(2026, 11, 10)}, {"Gás", 15000, d(2026, 11, 12)}}},
		"hora no fim é descartada":    {"Luz: R$ 210,35 10/11 14:32 ✓✓\nGás: R$ 150,00 12/11 14:33", []got{{"Luz", 21035, d(2026, 11, 10)}, {"Gás", 15000, d(2026, 11, 12)}}},
	} {
		t.Run(name, func(t *testing.T) {
			doc, ok := analyze(tc.body, testRef)
			if !ok || doc.Kind != KindList || len(doc.Items) != len(tc.want) {
				t.Fatalf("%q -> %+v", tc.body, doc)
			}
			for i, w := range tc.want {
				it := doc.Items[i]
				if it.Description != w.desc || it.AmountCents != w.cents || !it.DueDate.Equal(w.due) {
					t.Errorf("item %d = %q %d %v; quero %q %d %v", i, it.Description, it.AmountCents, it.DueDate, w.desc, w.cents, w.due)
				}
			}
		})
	}
}

// Datas que NÃO são vencimento ou são impossíveis não derrubam o item nem inventam data; documentos continuam ignorados.
func TestListaVencimentoArmadilhas(t *testing.T) {
	// 31/02 não existe: a linha fica como está (sem data) e, com "/" colado ao número, o item sem R$ cai fora como antes.
	doc, ok := analyze("Luz: R$ 210,35 31/02\nGás: R$ 150,00", testRef)
	if ok && doc.Kind == KindList {
		for _, it := range doc.Items {
			if !it.DueDate.IsZero() {
				t.Errorf("data impossível virou vencimento: %+v", it)
			}
		}
	}
	// CNPJ continua sendo ignorado
	if d, ok := analyze("Fornecedor 11.222.333/0001-81: R$ 100,00\nGás: R$ 150,00", testRef); ok {
		for _, it := range d.Items {
			if it.Description != "Gás" && !it.DueDate.IsZero() {
				t.Errorf("CNPJ virou data: %+v", it)
			}
		}
	}
	// "dia" no meio do nome da conta sem número não vira data
	d, ok := analyze("Dia de campo: R$ 80,00\nGás: R$ 150,00", testRef)
	if !ok || len(d.Items) != 2 || !d.Items[0].DueDate.IsZero() {
		t.Errorf("'Dia de campo' virou data: %+v", d)
	}
	// valor com ponto de milhar e decimal não é lido como data
	d, ok = analyze("Aluguel: R$ 1.500,00\nCondomínio: R$ 480,00", testRef)
	if !ok || len(d.Items) != 2 || !d.Items[0].DueDate.IsZero() || d.Items[0].AmountCents != 150000 {
		t.Errorf("valor virou data: %+v", d)
	}
}
