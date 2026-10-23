package api

import (
	"encoding/csv"
	"net/http"
	"strings"
	"testing"
)

// readCSV confere o envelope (BOM, tipo, anexo) e devolve as linhas do CSV.
func readCSV(t *testing.T, r resp) [][]string {
	t.Helper()
	if r.Code != http.StatusOK {
		t.Fatalf("export: %d %s", r.Code, r.Body)
	}
	if ct := r.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Errorf("Content-Type = %q", ct)
	}
	if cd := r.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment;") {
		t.Errorf("Content-Disposition = %q", cd)
	}
	body := r.Body.String()
	if !strings.HasPrefix(body, "\xEF\xBB\xBF") {
		t.Fatalf("sem BOM UTF-8 no início")
	}
	rd := csv.NewReader(strings.NewReader(strings.TrimPrefix(body, "\xEF\xBB\xBF")))
	rd.Comma = ';'
	rows, err := rd.ReadAll()
	if err != nil {
		t.Fatalf("CSV inválido: %v\n%s", err, body)
	}
	return rows
}

func TestExportarContasCSV(t *testing.T) {
	a, c, house, moradia := casa(t)
	base := "/api/households/" + house

	// subcategoria + favorecido (fixtures sintéticos)
	var gas struct{ Id string }
	if r := a.do("POST", base+"/categories", map[string]any{"name": "Gás", "parentId": moradia}, c); r.Code != 201 {
		t.Fatalf("subcategoria: %d %s", r.Code, r.Body)
	} else {
		r.json(&gas)
	}
	var gasco struct{ Id string }
	a.do("POST", base+"/payees", map[string]any{"name": "Gás", "cnpj": "11.222.333/0001-81", "legalName": "Gasco Distribuidora S/A"}, c).json(&gasco)

	a.newInvoice(c, house, moradia, map[string]any{"description": "Aluguel", "amountCents": 150000, "dueDate": "2026-10-20"})
	paga, _ := a.newInvoice(c, house, gas.Id, map[string]any{"description": "Botijão", "amountCents": 15782, "dueDate": "2026-10-05", "payeeId": gasco.Id})
	a.pay(c, house, paga.ID, "benefit", map[string]any{"paidAt": "2026-10-06", "amountCents": 15800})
	a.newInvoice(c, house, moradia, map[string]any{"description": "Condomínio", "amountCents": 123456, "dueDate": "2026-10-10"}) // atrasada (hoje = 18/10)
	a.newInvoice(c, house, moradia, map[string]any{"description": "=HYPERLINK(\"x\")", "amountCents": 100, "dueDate": "2026-10-25"})
	excluida, _ := a.newInvoice(c, house, moradia, map[string]any{"description": "Excluída", "dueDate": "2026-10-12"})
	a.do("DELETE", base+"/invoices/"+excluida.ID, nil, c)
	a.newInvoice(c, house, moradia, map[string]any{"description": "Fora do período", "dueDate": "2026-12-01"})

	rows := readCSV(t, a.do("GET", base+"/export/invoices.csv?from=2026-10-01&to=2026-10-31", nil, c))
	want := [][]string{
		{"vencimento", "competência", "descrição", "categoria", "favorecido", "valor", "status", "pago em", "carteira", "valor pago"},
		{"05/10/2026", "10/2026", "Botijão", "Moradia › Gás", "Gás", "157,82", "paga", "06/10/2026", "benefício", "158,00"},
		{"10/10/2026", "10/2026", "Condomínio", "Moradia", "", "1234,56", "atrasada", "", "", ""},
		{"20/10/2026", "10/2026", "Aluguel", "Moradia", "", "1500,00", "pendente", "", "", ""},
		{"25/10/2026", "10/2026", "'=HYPERLINK(\"x\")", "Moradia", "", "1,00", "pendente", "", "", ""},
	}
	if len(rows) != len(want) {
		t.Fatalf("linhas = %d, quer %d:\n%v", len(rows), len(want), rows)
	}
	for i := range want {
		if strings.Join(rows[i], "|") != strings.Join(want[i], "|") {
			t.Errorf("linha %d:\n tem %v\n quer %v", i, rows[i], want[i])
		}
	}

	// sem período: tudo (inclusive dezembro), nunca as excluídas
	all := readCSV(t, a.do("GET", base+"/export/invoices.csv", nil, c))
	if len(all) != 1+5 {
		t.Errorf("sem período: %d linhas", len(all))
	}
	for _, r := range all {
		if r[2] == "Excluída" {
			t.Error("conta excluída exportada")
		}
	}

	// período invertido: 400
	assertField(t, a.do("GET", base+"/export/invoices.csv?from=2026-10-31&to=2026-10-01", nil, c), 400, "to")
}

func TestExportarCSVLeituraPodeEOutraCasaNao(t *testing.T) {
	a, c, house, cat := casa(t)
	a.newInvoice(c, house, cat, nil)

	// viewer exporta
	leitor, _ := a.register("Carla", "carla@x.com", "Casa C")
	a.join(c, house, "viewer", leitor)
	if rows := readCSV(t, a.do("GET", "/api/households/"+house+"/export/invoices.csv", nil, leitor)); len(rows) != 2 {
		t.Errorf("viewer: %d linhas", len(rows))
	}

	// outra casa: 404 pela URL da casa A; e o export da própria casa B não traz nada da A
	beto, houseB := a.register("Beto", "beto@x.com", "Casa B")
	if r := a.do("GET", "/api/households/"+house+"/export/invoices.csv", nil, beto); r.Code != 404 {
		t.Errorf("outra casa: %d (quer 404)", r.Code)
	}
	if rows := readCSV(t, a.do("GET", "/api/households/"+houseB+"/export/invoices.csv", nil, beto)); len(rows) != 1 {
		t.Errorf("casa B exportou %d linhas (quer só o cabeçalho)", len(rows))
	}
}
