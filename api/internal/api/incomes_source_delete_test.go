package api

import (
	"net/http"
	"strings"
	"testing"
)

// Excluir e desfazer uma repetição inteira (DELETE/POST restore em /income-sources/{id}). "Hoje" = 18/10/2026.
// Nomes e valores inventados.

func TestExcluirRepeticaoPreservaRecebidosEDesfazSoOLote(t *testing.T) {
	a, c, house, _, _ := serie(t)
	base := "/api/households/" + house
	// 2º dia útil: outubro/2026 já caiu sozinho; novembro em diante é previsão
	a.postIncome(c, house, nil)
	src := a.sourcesOf(c, house)[0]
	has := func(m string) bool {
		for _, i := range a.incomesOf(c, house, m) {
			if i.Description == "Salário Ana" {
				return true
			}
		}
		return false
	}
	// uma exclusão avulsa ANTERIOR (dezembro): não pode voltar com o desfazer da repetição
	dec := a.incomeNamed(c, house, "2026-12-01", "Salário Ana")
	if r := a.do("DELETE", base+"/incomes/"+dec.ID, nil, c); r.Code != 204 {
		t.Fatalf("excluir dezembro: %d", r.Code)
	}

	if r := a.do("DELETE", base+"/income-sources/"+src.ID, nil, c); r.Code != 204 {
		t.Fatalf("excluir repetição: %d %s", r.Code, r.Body)
	}
	if !has("2026-10-01") {
		t.Error("o recebido de outubro não pode sumir")
	}
	for _, m := range []string{"2026-11-01", "2027-01-01", "2027-10-01"} {
		if has(m) {
			t.Errorf("%s (previsto) deveria ter sumido", m)
		}
	}
	got := a.sourcesOf(c, house)
	if len(got) != 1 || got[0].EndMonth == nil || *got[0].EndMonth != "2026-10-01" {
		t.Errorf("a repetição deveria terminar em outubro: %+v", got)
	}
	// o horizonte não recria o que foi excluído
	a.incomesOf(c, house, "2028-06-01")
	if has("2026-11-01") || has("2028-06-01") {
		t.Error("a previsão ressuscitou meses excluídos")
	}

	if r := a.do("POST", base+"/income-sources/"+src.ID+"/restore", nil, c); r.Code != 200 {
		t.Fatalf("desfazer: %d %s", r.Code, r.Body)
	}
	if !has("2026-11-01") || !has("2027-10-01") || !has("2026-10-01") {
		t.Error("o desfazer deveria devolver os meses previstos")
	}
	if has("2026-12-01") {
		t.Error("a exclusão avulsa anterior (dezembro) não pode voltar junto")
	}
	if s := a.sourcesOf(c, house)[0]; s.EndMonth != nil {
		t.Errorf("o fim deveria ter voltado a ser aberto: %+v", s)
	}
	// nada mais a desfazer
	if r := a.do("POST", base+"/income-sources/"+src.ID+"/restore", nil, c); r.Code != 409 || !strings.Contains(r.Body.String(), "not_deleted") {
		t.Errorf("segundo desfazer: %d %s", r.Code, r.Body)
	}
}

func TestExcluirRepeticaoInteiraEJaRecebida(t *testing.T) {
	a, c, house, _, _ := serie(t)
	base := "/api/households/" + house
	// começa em novembro: tudo é previsão, então a repetição inteira é excluída
	a.postIncome(c, house, map[string]any{"description": "Nova", "competenceMonth": "2026-11-01"})
	nova := a.sourcesOf(c, house)[0]
	if r := a.do("DELETE", base+"/income-sources/"+nova.ID, nil, c); r.Code != 204 {
		t.Fatalf("%d", r.Code)
	}
	if len(a.sourcesOf(c, house)) != 0 || len(a.incomesOf(c, house, "2027-03-01")) != 0 {
		t.Error("a repetição e a previsão deveriam ter sumido")
	}
	if r := a.do("DELETE", base+"/income-sources/"+nova.ID, nil, c); r.Code != 404 {
		t.Errorf("excluir de novo: %d (quer 404)", r.Code)
	}
	if r := a.do("POST", base+"/income-sources/"+nova.ID+"/restore", nil, c); r.Code != 200 {
		t.Fatalf("desfazer: %d %s", r.Code, r.Body)
	}
	if len(a.sourcesOf(c, house)) != 1 || len(a.incomesOf(c, house, "2027-03-01")) != 1 {
		t.Error("a repetição deveria ter voltado inteira")
	}

	// um mês só, já recebido (termina em outubro): não há previsão; a repetição sai e o recebido fica no histórico
	a.postIncome(c, house, map[string]any{"description": "Curta", "competenceMonth": "2026-10-01", "repeatsUntil": "2026-10-01"})
	var curta srcT
	for _, s := range a.sourcesOf(c, house) {
		if s.Name == "Curta" {
			curta = s
		}
	}
	if curta.ID == "" {
		t.Fatal("a repetição 'Curta' deveria existir")
	}
	if r := a.do("DELETE", base+"/income-sources/"+curta.ID, nil, c); r.Code != 204 {
		t.Fatalf("%d", r.Code)
	}
	if got := a.incomeNamed(c, house, "2026-10-01", "Curta"); !got.Received {
		t.Errorf("o recebido deveria continuar no histórico: %+v", got)
	}
	if r := a.do("POST", base+"/income-sources/"+curta.ID+"/restore", nil, c); r.Code != 200 {
		t.Errorf("desfazer: %d %s", r.Code, r.Body)
	}
}

func TestExcluirRepeticaoIsolamentoEPapeis(t *testing.T) {
	a, cA, houseA, _, _ := serie(t)
	baseA := "/api/households/" + houseA
	a.postIncome(cA, houseA, nil)
	src := a.sourcesOf(cA, houseA)[0]
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")
	baseB := "/api/households/" + houseB
	// ids da casa A na URL da casa B: 404, e nada muda
	if r := a.do("DELETE", baseB+"/income-sources/"+src.ID, nil, cB); r.Code != http.StatusNotFound {
		t.Errorf("excluir de outra casa: %d", r.Code)
	}
	if r := a.do("POST", baseB+"/income-sources/"+src.ID+"/restore", nil, cB); r.Code != http.StatusNotFound {
		t.Errorf("restaurar de outra casa: %d", r.Code)
	}
	if len(a.incomesOf(cA, houseA, "2026-11-01")) != 1 {
		t.Error("a previsão da casa A mudou")
	}
	// viewer não escreve
	cC, _ := a.register("Carla", "carla@x.com", "Casa C")
	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'viewer')", houseA, a.uid("carla@x.com"))
	if r := a.do("DELETE", baseA+"/income-sources/"+src.ID, nil, cC); r.Code != http.StatusForbidden {
		t.Errorf("viewer excluindo: %d (quer 403)", r.Code)
	}
	if r := a.do("POST", baseA+"/income-sources/"+src.ID+"/restore", nil, cC); r.Code != http.StatusForbidden {
		t.Errorf("viewer restaurando: %d (quer 403)", r.Code)
	}
	if len(a.incomesOf(cA, houseA, "2026-11-01")) != 1 {
		t.Error("o viewer não pode ter excluído nada")
	}
}
