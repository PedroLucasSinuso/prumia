package api

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Testes de ponta a ponta de receitas, fontes (previsão), carteiras e resumo (Postgres real).
// "Hoje" = 18/10/2026, salvo quando o teste move o relógio.

type dedT struct {
	Kind        string `json:"kind"`
	Name        string `json:"name"`
	AmountCents int64  `json:"amountCents"`
}

type incT struct {
	ID               string  `json:"id"`
	SourceID         *string `json:"sourceId"`
	UserID           string  `json:"userId"`
	Kind             string  `json:"kind"`
	Description      string  `json:"description"`
	WalletID         string  `json:"walletId"`
	CompetenceMonth  string  `json:"competenceMonth"`
	ExpectedDate     string  `json:"expectedDate"`
	GrossAmountCents int64   `json:"grossAmountCents"`
	Deductions       []dedT  `json:"deductions"`
	NetAmountCents   int64   `json:"netAmountCents"`
	Received         bool    `json:"received"`
	ReceivedAt       *string `json:"receivedAt"`
	Held             bool    `json:"held"`
	Repeats          bool    `json:"repeats"`
	RepeatsUntil     *string `json:"repeatsUntil"`
	AmountMode       string  `json:"amountMode"`
	Quantity         *int    `json:"quantity"`
	UnitPriceCents   *int64  `json:"unitPriceCents"`
	UnitLabel        *string `json:"unitLabel"`
	DateRule         *ruleT  `json:"dateRule"`
	Notes            *string `json:"notes"`
}

func (i incT) RepeatsUntilOrEmpty() string {
	if i.RepeatsUntil == nil {
		return ""
	}
	return *i.RepeatsUntil
}

type ruleT struct {
	Rule          string `json:"rule"`
	N             *int   `json:"n"`
	WeekendAdjust string `json:"weekendAdjust"`
	MonthOffset   *int   `json:"monthOffset"`
}

type srcT struct {
	ID               string  `json:"id"`
	UserID           string  `json:"userId"`
	Kind             string  `json:"kind"`
	WalletID         string  `json:"walletId"`
	Name             string  `json:"name"`
	GrossAmountCents int64   `json:"grossAmountCents"`
	DayOfMonth       int     `json:"dayOfMonth"`
	AmountMode       string  `json:"amountMode"`
	DateRule         ruleT   `json:"dateRule"`
	StartMonth       string  `json:"startMonth"`
	EndMonth         *string `json:"endMonth"`
	GeneratedThrough string  `json:"generatedThrough"`
	Notes            *string `json:"notes"`
	Deductions       []dedT  `json:"deductions"`
}

type walletT struct {
	WalletID            string  `json:"walletId"`
	Name                string  `json:"name"`
	Kind                string  `json:"kind"`
	IsDefault           bool    `json:"isDefault"`
	Archived            bool    `json:"archived"`
	OpeningBalanceCents int64   `json:"openingBalanceCents"`
	OpeningBalanceMonth *string `json:"openingBalanceMonth"`
	CarryOverCents      int64   `json:"carryOverCents"`
	ExpectedIncomeCents int64   `json:"expectedIncomeCents"`
	ReceivedIncomeCents int64   `json:"receivedIncomeCents"`
	PaidCents           int64   `json:"paidCents"`
	TransfersInCents    int64   `json:"transfersInCents"`
	TransfersOutCents   int64   `json:"transfersOutCents"`
	AdjustmentsCents    int64   `json:"adjustmentsCents"`
	BalanceCents        int64   `json:"balanceCents"`
	MonthBalanceCents   int64   `json:"monthBalanceCents"`
	PendingCents        int64   `json:"pendingCents"`
	ProjectedCents      int64   `json:"projectedCents"`
}

type summaryT struct {
	Month             string    `json:"month"`
	Wallets           []walletT `json:"wallets"`
	TotalPaidCents    int64     `json:"totalPaidCents"`
	TotalPendingCents int64     `json:"totalPendingCents"`
	ByCategory        []struct {
		CategoryID string `json:"categoryId"`
		TotalCents int64  `json:"totalCents"`
		PaidCents  int64  `json:"paidCents"`
	} `json:"byCategory"`
}

// named devolve a carteira do resumo com este nome (vazia se não aparece).
func (s summaryT) named(name string) walletT {
	for _, w := range s.Wallets {
		if w.Name == name {
			return w
		}
	}
	return walletT{}
}

// Free é a carteira "Geral" (a padrão das duas que toda casa ganha) e Benefit a "Benefício".
func (s summaryT) Free() walletT    { return s.named("Geral") }
func (s summaryT) Benefit() walletT { return s.named("Benefício") }

type payResultT struct {
	Invoice        inv      `json:"invoice"`
	Warnings       []string `json:"warnings"`
	WarningDetails []struct {
		Code     string `json:"code"`
		WalletID string `json:"walletId"`
	} `json:"warningDetails"`
}

// salarioPadrao: bruto R$ 8.000,00, INSS 908, IRRF 612, plano 350 e coparticipação média 45,90 => líquido R$ 6.084,10.
func salarioPadrao() []dedT {
	return []dedT{
		{"inss", "INSS", 90800}, {"irrf", "IRRF", 61200}, {"health_plan", "Plano de saúde", 35000}, {"health_copay", "Coparticipação", 4590},
	}
}

func (a *app) uid(email string) string {
	a.t.Helper()
	var id string
	a.db.Raw("SELECT id::text FROM users WHERE email = ?", email).Scan(&id)
	return id
}

func (a *app) newSource(c *http.Cookie, house, userID string, extra map[string]any) (srcT, resp) {
	a.t.Helper()
	body := map[string]any{
		"userId": userID, "kind": "salary", "name": "Salário Ana", "grossAmountCents": 800000, "dayOfMonth": 5,
		"startMonth": "2026-10-01", "deductions": salarioPadrao(),
	}
	for k, v := range extra {
		body[k] = v
	}
	r := a.do("POST", "/api/households/"+house+"/income-sources", body, c)
	var s srcT
	if r.Code == http.StatusCreated {
		r.json(&s)
	}
	return s, r
}

func (a *app) incomesOf(c *http.Cookie, house, month string) []incT {
	a.t.Helper()
	r := a.do("GET", "/api/households/"+house+"/incomes?month="+month, nil, c)
	if r.Code != http.StatusOK {
		a.t.Fatalf("listar receitas %s: %d %s", month, r.Code, r.Body)
	}
	var out []incT
	r.json(&out)
	return out
}

// incomeOf devolve o único lançamento do mês (falha se não houver exatamente um).
func (a *app) incomeOf(c *http.Cookie, house, month string) incT {
	a.t.Helper()
	list := a.incomesOf(c, house, month)
	if len(list) != 1 {
		a.t.Fatalf("esperava 1 receita em %s, vieram %d: %+v", month, len(list), list)
	}
	return list[0]
}

func (a *app) summaryOf(c *http.Cookie, house, month string) summaryT {
	a.t.Helper()
	r := a.do("GET", "/api/households/"+house+"/summary?month="+month, nil, c)
	if r.Code != http.StatusOK {
		a.t.Fatalf("resumo %s: %d %s", month, r.Code, r.Body)
	}
	var s summaryT
	r.json(&s)
	return s
}

func (a *app) sourcesOf(c *http.Cookie, house string) []srcT {
	a.t.Helper()
	var out []srcT
	a.do("GET", "/api/households/"+house+"/income-sources", nil, c).json(&out)
	return out
}

func (a *app) countIncomes(sourceID, where string) int {
	var n int
	a.db.Raw("SELECT count(*) FROM incomes WHERE source_id = ? "+where, sourceID).Scan(&n)
	return n
}

func (a *app) receive(c *http.Cookie, house, id string, body any) resp {
	return a.do("POST", "/api/households/"+house+"/incomes/"+id+"/receive", body, c)
}

// walletID devolve o id da carteira ATIVA da casa com este nome (toda casa nasce com "Geral" e "Benefício").
func (a *app) walletID(house, name string) string {
	a.t.Helper()
	var id string
	if err := a.db.Raw(`SELECT id::text FROM wallets WHERE household_id = ? AND name = ? AND archived_at IS NULL`, house, name).Scan(&id).Error; err != nil || id == "" {
		a.t.Fatalf("carteira %q da casa %s não encontrada: %v", name, house, err)
	}
	return id
}

func (a *app) free(house string) string { return a.walletID(house, "Geral") }
func (a *app) vr(house string) string   { return a.walletID(house, "Benefício") }

// pay paga a invoice. `wallet` é "free" (Geral), "benefit" (Benefício) ou o id de uma carteira.
func (a *app) pay(c *http.Cookie, house, invID, wallet string, extra map[string]any) (payResultT, resp) {
	a.t.Helper()
	switch wallet {
	case "free":
		wallet = a.free(house)
	case "benefit":
		wallet = a.vr(house)
	}
	body := map[string]any{"walletId": wallet}
	for k, v := range extra {
		body[k] = v
	}
	r := a.do("POST", "/api/households/"+house+"/invoices/"+invID+"/pay", body, c)
	var p payResultT
	if r.Code == http.StatusOK {
		r.json(&p)
	}
	return p, r
}

func TestSalarioBrutoComDescontosEPrevisao(t *testing.T) {
	a, c, house, _, _ := serie(t)
	ana := a.uid("ana@x.com")
	base := "/api/households/" + house

	src, r := a.newSource(c, house, ana, nil)
	if r.Code != 201 || src.WalletID != a.free(house) || src.GeneratedThrough != "2027-10-01" || len(src.Deductions) != 4 {
		t.Fatalf("criar fonte: %d %s", r.Code, r.Body)
	}
	// previsão gerada: de out/2026 a out/2027 = 13 lançamentos
	if n := a.countIncomes(src.ID, ""); n != 13 {
		t.Fatalf("lançamentos gerados: %d", n)
	}

	oct := a.incomeOf(c, house, "2026-10-01")
	// hoje é 18/10 e o salário cai no dia 5: o recebimento é automático (ninguém marcou nada)
	if !oct.Received || oct.ReceivedAt == nil || *oct.ReceivedAt != "2026-10-05" || oct.Held || oct.ExpectedDate != "2026-10-05" || oct.Description != "Salário Ana" ||
		oct.GrossAmountCents != 800000 || oct.NetAmountCents != 608410 || len(oct.Deductions) != 4 ||
		oct.SourceID == nil || *oct.SourceID != src.ID || oct.UserID != ana {
		t.Fatalf("lançamento previsto de outubro: %+v", oct)
	}
	if oct.Deductions[0].Kind != "inss" || oct.Deductions[3].Kind != "health_copay" {
		t.Errorf("ordem dos descontos: %+v", oct.Deductions)
	}

	// coparticipação variável: ajusta só novembro; o template e os outros meses não mudam
	nov := a.incomeOf(c, house, "2026-11-01")
	ds := salarioPadrao()
	ds[3].AmountCents = 19990
	r = a.do("PATCH", base+"/incomes/"+nov.ID, map[string]any{"deductions": ds, "notes": "consulta extra"}, c)
	var upd incT
	r.json(&upd)
	if r.Code != 200 || upd.NetAmountCents != 800000-90800-61200-35000-19990 || upd.Notes == nil || *upd.Notes != "consulta extra" {
		t.Fatalf("ajustar novembro: %d %s", r.Code, r.Body)
	}
	if got := a.sourcesOf(c, house)[0]; got.Deductions[3].AmountCents != 4590 {
		t.Errorf("editar o lançamento alterou a fonte: %+v", got.Deductions)
	}
	if dez := a.incomeOf(c, house, "2026-12-01"); dez.NetAmountCents != 608410 {
		t.Errorf("dezembro mudou: %+v", dez)
	}
	// PATCH sem deductions mantém os descontos; só o bruto muda e o líquido acompanha
	r = a.do("PATCH", base+"/incomes/"+nov.ID, map[string]any{"grossAmountCents": 850000}, c)
	r.json(&upd)
	if upd.NetAmountCents != 850000-90800-61200-35000-19990 || len(upd.Deductions) != 4 {
		t.Errorf("só o bruto: %+v", upd)
	}
	// lista vazia remove todos os descontos
	r = a.do("PATCH", base+"/incomes/"+nov.ID, map[string]any{"deductions": []dedT{}}, c)
	r.json(&upd)
	if upd.NetAmountCents != 850000 || len(upd.Deductions) != 0 {
		t.Errorf("remover descontos: %+v", upd)
	}

	// outubro já conta como recebido sozinho (a data passou): "caiu" de novo é 409
	if r := a.receive(c, house, oct.ID, nil); r.Code != 409 {
		t.Fatalf("receber o que já é automático: %d %s", r.Code, r.Body)
	}

	// reaplica o template novo a partir de outubro: outubro (recebido) NÃO muda; novembro e dezembro (a receber) mudam
	newTmpl := []dedT{{"inss", "INSS", 100000}, {"irrf", "IRRF", 70000}}
	r = a.do("PATCH", base+"/income-sources/"+src.ID+"?applyFrom=2026-10-01",
		map[string]any{"grossAmountCents": 900000, "dateRule": map[string]any{"rule": "day_of_month", "n": 10, "weekendAdjust": "none"}, "deductions": newTmpl}, c)
	var s2 srcT
	r.json(&s2)
	if r.Code != 200 || s2.GrossAmountCents != 900000 || len(s2.Deductions) != 2 {
		t.Fatalf("editar fonte: %d %s", r.Code, r.Body)
	}
	if o := a.incomeOf(c, house, "2026-10-01"); o.GrossAmountCents != 800000 || o.NetAmountCents != 608410 || o.ExpectedDate != "2026-10-05" || !o.Received {
		t.Errorf("lançamento recebido foi alterado pela reaplicação: %+v", o)
	}
	for _, m := range []string{"2026-11-01", "2026-12-01", "2027-10-01"} {
		p := a.incomeOf(c, house, m)
		if p.GrossAmountCents != 900000 || p.NetAmountCents != 730000 || len(p.Deductions) != 2 || p.ExpectedDate[8:] != "10" {
			t.Errorf("%s não recebeu o template novo: %+v", m, p)
		}
	}
	if n := a.countIncomes(src.ID, ""); n != 13 {
		t.Errorf("reaplicar não deve criar nem apagar: %d", n)
	}

	// sem applyFrom, só o template muda: os previstos existentes ficam como estão
	r = a.do("PATCH", base+"/income-sources/"+src.ID, map[string]any{"grossAmountCents": 950000}, c)
	if p := a.incomeOf(c, house, "2026-11-01"); r.Code != 200 || p.GrossAmountCents != 900000 {
		t.Errorf("sem applyFrom não reaplica: %d %+v", r.Code, p)
	}
	// applyFrom no meio: meses anteriores ficam
	a.do("PATCH", base+"/income-sources/"+src.ID+"?applyFrom=2027-01-01", map[string]any{"name": "Salário novo"}, c)
	if p := a.incomeOf(c, house, "2026-12-01"); p.Description != "Salário Ana" || p.GrossAmountCents != 900000 {
		t.Errorf("antes do applyFrom: %+v", p)
	}
	if p := a.incomeOf(c, house, "2027-01-01"); p.Description != "Salário novo" || p.GrossAmountCents != 950000 {
		t.Errorf("a partir do applyFrom: %+v", p)
	}
	// applyFrom inválido
	if r := a.do("PATCH", base+"/income-sources/"+src.ID+"?applyFrom=2027-01-15", map[string]any{"name": "x"}, c); r.Code != 400 {
		t.Errorf("applyFrom fora do dia 1: %d", r.Code)
	}
}

func TestPrevisaoDia31ETravaEmMesCurto(t *testing.T) {
	a, c, house, _, _ := serie(t)
	ana := a.uid("ana@x.com")
	base := "/api/households/" + house
	// ajuste "none": a data é o dia N exato, travado no último dia do mês curto (o padrão forward anda para dia útil)
	rule := func(n int) map[string]any {
		return map[string]any{"rule": "day_of_month", "n": n, "weekendAdjust": "none"}
	}
	src, r := a.newSource(c, house, ana, map[string]any{"dateRule": rule(31), "startMonth": "2027-01-01"})
	if r.Code != 201 {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	want := map[string]string{"2027-01-01": "2027-01-31", "2027-02-01": "2027-02-28", "2027-03-01": "2027-03-31", "2027-04-01": "2027-04-30"}
	for m, d := range want {
		if got := a.incomeOf(c, house, m).ExpectedDate; got != d {
			t.Errorf("competência %s: data esperada %s, quer %s", m, got, d)
		}
	}
	// reaplicar com o dia 30: fevereiro continua 28 (trava), março vira 30
	a.do("PATCH", base+"/income-sources/"+src.ID+"?applyFrom=2027-02-01", map[string]any{"dateRule": rule(30)}, c)
	if got := a.incomeOf(c, house, "2027-02-01").ExpectedDate; got != "2027-02-28" {
		t.Errorf("fevereiro com dia 30: %s", got)
	}
	if got := a.incomeOf(c, house, "2027-03-01").ExpectedDate; got != "2027-03-30" {
		t.Errorf("março com dia 30: %s", got)
	}
	if got := a.incomeOf(c, house, "2027-01-01").ExpectedDate; got != "2027-01-31" {
		t.Errorf("janeiro (antes do applyFrom) mudou: %s", got)
	}
}

func TestExclusaoDeLancamentoNaoRessuscita(t *testing.T) {
	a, c, house, _, clock := serie(t)
	ana := a.uid("ana@x.com")
	base := "/api/households/" + house
	src, _ := a.newSource(c, house, ana, nil)

	nov := a.incomeOf(c, house, "2026-11-01")
	if r := a.do("DELETE", base+"/incomes/"+nov.ID, nil, c); r.Code != 204 {
		t.Fatalf("excluir: %d", r.Code)
	}
	if got := a.incomesOf(c, house, "2026-11-01"); len(got) != 0 {
		t.Fatalf("excluída continua na lista: %+v", got)
	}
	if r := a.do("DELETE", base+"/incomes/"+nov.ID, nil, c); r.Code != 404 {
		t.Errorf("excluir de novo: %d", r.Code)
	}
	if r := a.do("PATCH", base+"/incomes/"+nov.ID, map[string]any{"grossAmountCents": 1}, c); r.Code != 404 {
		t.Errorf("editar excluída: %d", r.Code)
	}

	// reaplicar o template não traz de volta
	a.do("PATCH", base+"/income-sources/"+src.ID+"?applyFrom=2026-10-01", map[string]any{"grossAmountCents": 810000}, c)
	if got := a.incomesOf(c, house, "2026-11-01"); len(got) != 0 {
		t.Errorf("applyFrom ressuscitou: %+v", got)
	}
	// avançar o relógio estende o horizonte (gera 2027-11 e 2027-12) e também não recria novembro/2026
	a.travel(clock, time.Date(2026, 12, 18, 12, 0, 0, 0, time.UTC))
	if got := a.incomesOf(c, house, "2027-12-01"); len(got) != 1 {
		t.Fatalf("horizonte não estendeu: %+v", got)
	}
	if got := a.incomesOf(c, house, "2026-11-01"); len(got) != 0 {
		t.Errorf("EnsureHorizon ressuscitou: %+v", got)
	}
	if n := a.countIncomes(src.ID, "AND competence_month = '2026-11-01'"); n != 1 {
		t.Errorf("deveria haver 1 linha (apagada) para nov/2026: %d", n)
	}
	if n := a.countIncomes(src.ID, "AND deleted_at IS NULL"); n != 14 { // 13 - 1 excluída + 2 novos (2027-11, 2027-12)
		t.Errorf("lançamentos ativos: %d", n)
	}
}

func TestPrevisaoHorizonteSobDemanda(t *testing.T) {
	a, c, house, _, _ := serie(t)
	ana := a.uid("ana@x.com")
	src, _ := a.newSource(c, house, ana, nil)
	if n := a.countIncomes(src.ID, ""); n != 13 {
		t.Fatalf("%d", n)
	}
	// olhar um mês bem à frente gera até ele
	if got := a.incomesOf(c, house, "2029-03-01"); len(got) != 1 || got[0].GrossAmountCents != 800000 || len(got[0].Deductions) != 4 {
		t.Fatalf("mar/2029: %+v", got)
	}
	if got := a.sourcesOf(c, house)[0].GeneratedThrough; got != "2029-03-01" {
		t.Errorf("generatedThrough: %s", got)
	}
	// além do teto de 60 meses (hoje + 60 = 2031-10): lista vazia, sem erro, sem gerar décadas
	if got := a.incomesOf(c, house, "2090-01-01"); len(got) != 0 {
		t.Errorf("mês remoto: %+v", got)
	}
	if got := a.sourcesOf(c, house)[0].GeneratedThrough; got != "2031-10-01" {
		t.Errorf("teto de horizonte: %s", got)
	}
	// o resumo de um mês futuro também estende
	a.summaryOf(c, house, "2032-01-01")
	// idempotente: pedir de novo não duplica
	before := a.countIncomes(src.ID, "")
	a.incomesOf(c, house, "2029-03-01")
	if after := a.countIncomes(src.ID, ""); after != before {
		t.Errorf("duplicou: %d -> %d", before, after)
	}
}

func TestEncerrarFonteSoAntecipa(t *testing.T) {
	a, c, house, _, _ := serie(t)
	ana := a.uid("ana@x.com")
	base := "/api/households/" + house
	src, _ := a.newSource(c, house, ana, nil)
	// recebe fevereiro/2027 antes de encerrar em dezembro/2026: o recebido fica
	fev := a.incomeOf(c, house, "2027-02-01")
	a.receive(c, house, fev.ID, map[string]any{"receivedAt": "2027-02-05"})

	r := a.do("PATCH", base+"/income-sources/"+src.ID, map[string]any{"endMonth": "2026-12-01"}, c)
	var s srcT
	r.json(&s)
	if r.Code != 200 || s.EndMonth == nil || *s.EndMonth != "2026-12-01" {
		t.Fatalf("encerrar: %d %s", r.Code, r.Body)
	}
	if n := a.countIncomes(src.ID, "AND deleted_at IS NULL"); n != 3+1 { // out, nov, dez + fev recebido
		t.Errorf("previstos após o fim deveriam ser excluídos: %d ativos", n)
	}
	if got := a.incomesOf(c, house, "2027-02-01"); len(got) != 1 || !got[0].Received {
		t.Errorf("recebido após o fim deve permanecer: %+v", got)
	}
	if got := a.incomesOf(c, house, "2027-06-01"); len(got) != 0 {
		t.Errorf("previsto após o fim: %+v", got)
	}
	// adiar o fim, reabrir e fim antes do início: 400
	for name, body := range map[string]map[string]any{
		"adiar":    {"endMonth": "2027-06-01"},
		"reabrir":  {"endMonth": nil},
		"antes":    {"endMonth": "2026-09-01"},
		"não dia1": {"endMonth": "2026-11-15"},
	} {
		if r := a.do("PATCH", base+"/income-sources/"+src.ID, body, c); r.Code != 400 {
			t.Errorf("%s: %d %s", name, r.Code, r.Body)
		}
	}
	// o horizonte respeita o fim: não gera mais nada depois de dezembro
	a.incomesOf(c, house, "2028-01-01")
	if n := a.countIncomes(src.ID, "AND competence_month > '2026-12-01' AND deleted_at IS NULL"); n != 1 {
		t.Errorf("gerou depois do fim: %d", n)
	}
}

func TestCarteiraDeBeneficioEValidacoes(t *testing.T) {
	a, c, house, _, _ := serie(t)
	ana := a.uid("ana@x.com")
	base := "/api/households/" + house

	// a coerência tipo <-> carteira caiu: VR pode ir para a Geral e salário para a Benefício
	geral := a.free(house)
	s1, r := a.newSource(c, house, ana, map[string]any{"kind": "benefit", "walletId": geral, "name": "VR", "deductions": []dedT{}})
	if r.Code != 201 || s1.WalletID != geral {
		t.Errorf("VR na carteira Geral deveria valer: %d %s", r.Code, r.Body)
	}
	s2, r := a.newSource(c, house, ana, map[string]any{"walletId": a.vr(house), "name": "Salário no VR"})
	if r.Code != 201 || s2.WalletID != a.vr(house) {
		t.Errorf("salário na carteira Benefício deveria valer: %d %s", r.Code, r.Body)
	}
	// carteira que não existe na casa: 400 no campo walletId (fonte e avulsa)
	_, r = a.newSource(c, house, ana, map[string]any{"walletId": "00000000-0000-0000-0000-000000000001"})
	assertField(t, r, 400, "walletId")
	avulsa := map[string]any{
		"userId": ana, "kind": "benefit", "walletId": "00000000-0000-0000-0000-000000000001", "description": "VR extra",
		"competenceMonth": "2026-10-01", "expectedDate": "2026-10-20", "grossAmountCents": 10000,
	}
	assertField(t, a.do("POST", base+"/incomes", avulsa, c), 400, "walletId")
	// sem informar a carteira, o VR vai para a carteira "Benefício" da casa
	delete(avulsa, "walletId")
	var vr incT
	if r := a.do("POST", base+"/incomes", avulsa, c); r.Code != 201 {
		t.Fatalf("VR avulso: %d %s", r.Code, r.Body)
	} else {
		r.json(&vr)
	}
	if vr.WalletID != a.vr(house) || vr.SourceID != nil || vr.Received || vr.NetAmountCents != 10000 || len(vr.Deductions) != 0 {
		t.Errorf("VR avulso: %+v", vr)
	}
	vrSrc, r := a.newSource(c, house, ana, map[string]any{"kind": "benefit", "name": "VR mensal", "grossAmountCents": 60000, "deductions": []dedT{}})
	if r.Code != 201 || vrSrc.WalletID != a.vr(house) {
		t.Fatalf("fonte VR: %d %s", r.Code, r.Body)
	}

	// descontos acima do bruto, valor zero, tipo inválido, nome vazio: 400 por campo
	bad := func(ds []dedT, gross int64) resp {
		_, r := a.newSource(c, house, ana, map[string]any{"grossAmountCents": gross, "deductions": ds})
		return r
	}
	assertField(t, bad([]dedT{{"inss", "INSS", 600}, {"irrf", "IRRF", 500}}, 1000), 400, "deductions")
	assertField(t, bad([]dedT{{"inss", "INSS", 0}}, 1000), 400, "deductions[0].amountCents")
	assertField(t, bad([]dedT{{"iptu", "IPTU", 5}}, 1000), 400, "deductions[0].kind")
	assertField(t, bad([]dedT{{"other", " ", 5}}, 1000), 400, "deductions[0].name")
	assertField(t, bad(nil, 0), 400, "grossAmountCents")
	assertField(t, bad(nil, 1_000_000_000_001), 400, "grossAmountCents")
}

func TestCarteiraValidacoesDeEdicao(t *testing.T) {
	a, c, house, _, _ := serie(t)
	ana := a.uid("ana@x.com")
	base := "/api/households/" + house
	src, _ := a.newSource(c, house, ana, nil)
	inc := a.incomeOf(c, house, "2026-10-01")

	assertField(t, a.do("PATCH", base+"/incomes/"+inc.ID, map[string]any{"grossAmountCents": 100000}, c), 400, "grossAmountCents")
	assertField(t, a.do("PATCH", base+"/incomes/"+inc.ID, map[string]any{"deductions": []dedT{{"other", "x", 900000}}}, c), 400, "deductions")
	assertField(t, a.do("PATCH", base+"/incomes/"+inc.ID, map[string]any{"description": " "}, c), 400, "description")
	assertField(t, a.do("PATCH", base+"/income-sources/"+src.ID, map[string]any{"grossAmountCents": 100000}, c), 400, "grossAmountCents")
	assertField(t, a.do("PATCH", base+"/income-sources/"+src.ID, map[string]any{"dayOfMonth": 32}, c), 400, "dayOfMonth")
	// a falha não deixa meia edição: o lançamento continua igual
	if got := a.incomeOf(c, house, "2026-10-01"); got.GrossAmountCents != 800000 || len(got.Deductions) != 4 {
		t.Errorf("edição inválida alterou dados: %+v", got)
	}
	// avulsa: competência fora do dia 1 e data ausente
	body := map[string]any{"userId": ana, "kind": "other", "description": "Freela", "competenceMonth": "2026-10-10", "grossAmountCents": 100}
	r := a.do("POST", base+"/incomes", body, c)
	assertField(t, r, 400, "competenceMonth")
	// mês da listagem inválido
	if r := a.do("GET", base+"/incomes?month=2026-10-15", nil, c); r.Code != 400 {
		t.Errorf("month fora do dia 1: %d", r.Code)
	}
	if r := a.do("GET", base+"/incomes", nil, c); r.Code != 400 {
		t.Errorf("sem month: %d", r.Code)
	}
	if r := a.do("GET", base+"/summary?month=2026-10-02", nil, c); r.Code != 400 {
		t.Errorf("summary fora do dia 1: %d", r.Code)
	}
}

func TestReceberDuasVezes(t *testing.T) {
	a, c, house, _, _ := serie(t)
	ana := a.uid("ana@x.com")
	a.newSource(c, house, ana, map[string]any{"dayOfMonth": 28}) // ainda não chegou: "a receber"
	inc := a.incomeOf(c, house, "2026-10-01")

	r := a.receive(c, house, inc.ID, map[string]any{"receivedAt": "2026-10-05"})
	var got incT
	r.json(&got)
	if r.Code != 200 || got.ReceivedAt == nil || *got.ReceivedAt != "2026-10-05" {
		t.Fatalf("receber com data: %d %s", r.Code, r.Body)
	}
	r = a.receive(c, house, inc.ID, nil)
	if r.Code != 409 || !strings.Contains(r.Body.String(), `"already_received"`) {
		t.Errorf("receber de novo: %d %s", r.Code, r.Body)
	}
	if g := a.incomeOf(c, house, "2026-10-01"); g.ReceivedAt == nil || *g.ReceivedAt != "2026-10-05" {
		t.Errorf("segunda tentativa alterou a data: %+v", g)
	}
	// "não caiu": deixa de contar como recebida; repetir é 409 not_received
	r = a.do("DELETE", "/api/households/"+house+"/incomes/"+inc.ID+"/receive", nil, c)
	got = incT{} // json.Unmarshal não zera campos ausentes
	r.json(&got)
	if r.Code != 200 || got.Received || got.ReceivedAt != nil || !got.Held {
		t.Fatalf("não caiu: %d %s", r.Code, r.Body)
	}
	r = a.do("DELETE", "/api/households/"+house+"/incomes/"+inc.ID+"/receive", nil, c)
	if r.Code != 409 || !strings.Contains(r.Body.String(), `"not_received"`) {
		t.Errorf("desfazer sem estar recebida: %d %s", r.Code, r.Body)
	}
	// corpo inválido / data impossível
	if r := a.receive(c, house, inc.ID, map[string]any{"receivedAt": "2026-02-30"}); r.Code != 400 {
		t.Errorf("data impossível: %d", r.Code)
	}
	// id inexistente
	if r := a.receive(c, house, "018f0000-0000-7000-8000-000000000000", nil); r.Code != 404 {
		t.Errorf("inexistente: %d", r.Code)
	}
}

func TestReceitaAvulsaCicloCompleto(t *testing.T) {
	a, c, house, _, _ := serie(t)
	ana := a.uid("ana@x.com")
	base := "/api/households/" + house
	body := map[string]any{
		"userId": ana, "kind": "other", "description": "Freela", "competenceMonth": "2026-10-01", "expectedDate": "2026-10-25",
		"grossAmountCents": 150000, "deductions": []dedT{{"other", "ISS", 7500}},
	}
	r := a.do("POST", base+"/incomes", body, c)
	var in incT
	r.json(&in)
	if r.Code != 201 || in.SourceID != nil || in.WalletID != a.free(house) || in.NetAmountCents != 142500 || in.Received {
		t.Fatalf("criar: %d %s", r.Code, r.Body)
	}
	r = a.do("PATCH", base+"/incomes/"+in.ID, map[string]any{"expectedDate": "2026-10-28", "description": "Freela de outubro", "notes": nil}, c)
	r.json(&in)
	if r.Code != 200 || in.ExpectedDate != "2026-10-28" || in.Description != "Freela de outubro" || in.Notes != nil {
		t.Fatalf("editar: %d %s", r.Code, r.Body)
	}
	if got := a.incomesOf(c, house, "2026-10-01"); len(got) != 1 {
		t.Fatalf("listar: %+v", got)
	}
	// outro mês não mostra
	if got := a.incomesOf(c, house, "2026-11-01"); len(got) != 0 {
		t.Errorf("vazou para outro mês: %+v", got)
	}
	if r := a.do("DELETE", base+"/incomes/"+in.ID, nil, c); r.Code != 204 {
		t.Fatalf("excluir: %d", r.Code)
	}
	if got := a.incomesOf(c, house, "2026-10-01"); len(got) != 0 {
		t.Errorf("excluída na lista: %+v", got)
	}
	// excluída não entra no resumo
	if s := a.summaryOf(c, house, "2026-10-01"); s.Free().ExpectedIncomeCents != 0 {
		t.Errorf("excluída no resumo: %+v", s.Free())
	}
}

func TestResumoComReceitaEDespesaEmCarteirasDiferentes(t *testing.T) {
	a, c, house, _, _ := serie(t)
	ana := a.uid("ana@x.com")
	var cats []cat
	a.do("GET", "/api/households/"+house+"/categories", nil, c).json(&cats)
	moradia, mercado, lazer := cats[0].ID, cats[1].ID, cats[2].ID

	// receitas de outubro: salário (líquido 608410) recebido, VR (600,00) recebido, bônus avulso só previsto (500,00)
	a.newSource(c, house, ana, nil)
	vrSrc, _ := a.newSource(c, house, ana, map[string]any{"kind": "benefit", "name": "VR", "grossAmountCents": 60000, "deductions": []dedT{}})
	_ = vrSrc
	a.do("POST", "/api/households/"+house+"/incomes", map[string]any{
		"userId": ana, "kind": "other", "description": "Bônus", "competenceMonth": "2026-10-01", "expectedDate": "2026-10-30", "grossAmountCents": 50000,
	}, c)
	for _, in := range a.incomesOf(c, house, "2026-10-01") {
		if in.Description != "Bônus" {
			a.receive(c, house, in.ID, nil)
		}
	}
	// receita de novembro não entra em outubro
	if got := a.incomesOf(c, house, "2026-11-01"); len(got) != 2 {
		t.Fatalf("novembro: %+v", got)
	}

	// despesas por competência: aluguel pago (juros: pagou 1.480,00 de 1.500,00) na livre; mercado pago no VR; lazer pendente e atrasado;
	// outra invoice com competência de setembro, paga em outubro, fica fora de outubro
	aluguel, _ := a.newInvoice(c, house, moradia, map[string]any{"amountCents": 150000, "dueDate": "2026-10-20"})
	super, _ := a.newInvoice(c, house, mercado, map[string]any{"amountCents": 40000, "dueDate": "2026-10-10"})
	a.newInvoice(c, house, lazer, map[string]any{"amountCents": 30000, "dueDate": "2026-10-10"}) // atrasada
	setembro, _ := a.newInvoice(c, house, moradia, map[string]any{"amountCents": 99900, "dueDate": "2026-09-20", "competenceMonth": "2026-09-01"})
	if _, r := a.pay(c, house, aluguel.ID, "free", map[string]any{"amountCents": 148000}); r.Code != 200 {
		t.Fatal(r.Body)
	}
	if p, r := a.pay(c, house, super.ID, "benefit", nil); r.Code != 200 || len(p.Warnings) != 0 {
		t.Fatalf("mercado no VR com saldo: %d %s", r.Code, r.Body)
	}
	a.pay(c, house, setembro.ID, "free", nil)

	s := a.summaryOf(c, house, "2026-10-01")
	// livre: previsto 608410 + 50000, recebido 608410, pago 148000 (valor efetivo, não 150000).
	// Saldo anterior: a conta de setembro (99900) foi paga com a livre e não houve receita em setembro => -99900.
	if f := s.Free(); f.ExpectedIncomeCents != 658410 || f.ReceivedIncomeCents != 608410 || f.PaidCents != 148000 ||
		f.CarryOverCents != -99900 || f.MonthBalanceCents != 460410 || f.BalanceCents != 360510 {
		t.Errorf("livre: %+v", f)
	}
	// benefício: recebido 60000, pago 40000
	if b := s.Benefit(); b.ExpectedIncomeCents != 60000 || b.ReceivedIncomeCents != 60000 || b.PaidCents != 40000 || b.CarryOverCents != 0 || b.BalanceCents != 20000 {
		t.Errorf("benefício: %+v", b)
	}
	if s.TotalPaidCents != 188000 || s.TotalPendingCents != 30000 || s.Month != "2026-10-01" {
		t.Errorf("totais: pago %d pendente %d", s.TotalPaidCents, s.TotalPendingCents)
	}
	if len(s.ByCategory) != 3 || s.ByCategory[0].CategoryID != moradia || s.ByCategory[0].TotalCents != 148000 || s.ByCategory[0].PaidCents != 148000 ||
		s.ByCategory[1].CategoryID != mercado || s.ByCategory[1].TotalCents != 40000 ||
		s.ByCategory[2].CategoryID != lazer || s.ByCategory[2].TotalCents != 30000 || s.ByCategory[2].PaidCents != 0 {
		t.Errorf("por categoria: %+v", s.ByCategory)
	}
	// setembro tem só a invoice paga de setembro (pagamento em outubro não conta para outubro)
	sep := a.summaryOf(c, house, "2026-09-01")
	if sep.TotalPaidCents != 99900 || sep.Free().PaidCents != 99900 || len(sep.ByCategory) != 1 {
		t.Errorf("setembro: %+v", sep)
	}
	// mês sem nada: zeros e lista vazia (não null)
	r := a.do("GET", "/api/households/"+house+"/summary?month=2025-01-01", nil, c)
	if r.Code != 200 || !strings.Contains(r.Body.String(), `"byCategory":[]`) {
		t.Errorf("mês vazio: %d %s", r.Code, r.Body)
	}
	// receber/estornar mexe no saldo: desfaz o recebimento do salário
	for _, in := range a.incomesOf(c, house, "2026-10-01") {
		if in.Kind == "salary" {
			a.do("DELETE", "/api/households/"+house+"/incomes/"+in.ID+"/receive", nil, c)
		}
	}
	if f := a.summaryOf(c, house, "2026-10-01").Free(); f.ReceivedIncomeCents != 0 || f.MonthBalanceCents != -148000 || f.BalanceCents != -247900 || f.ExpectedIncomeCents != 658410 {
		t.Errorf("livre após desfazer: %+v", f)
	}
}

func TestAvisoDeSaldoDeBeneficioAoPagar(t *testing.T) {
	a, c, house, _, _ := serie(t)
	ana := a.uid("ana@x.com")
	var cats []cat
	a.do("GET", "/api/households/"+house+"/categories", nil, c).json(&cats)
	mercado := cats[1].ID
	a.newSource(c, house, ana, map[string]any{"kind": "benefit", "name": "VR", "grossAmountCents": 60000, "deductions": []dedT{}, "dayOfMonth": 28})
	vr := a.incomeOf(c, house, "2026-10-01")

	i1, _ := a.newInvoice(c, house, mercado, map[string]any{"amountCents": 40000})
	i2, _ := a.newInvoice(c, house, mercado, map[string]any{"amountCents": 30000})

	// VR ainda previsto (não recebido): saldo estimado = 0 - 40000 => avisa, mas paga
	p, r := a.pay(c, house, i1.ID, "benefit", nil)
	if r.Code != 200 || p.Invoice.Status != "paid" || len(p.Warnings) != 1 || p.Warnings[0] != "wallet_balance_insufficient" {
		t.Fatalf("sem VR recebido: %d %s", r.Code, r.Body)
	}
	if len(p.WarningDetails) != 1 || p.WarningDetails[0].Code != "wallet_balance_insufficient" || p.WarningDetails[0].WalletID != a.vr(house) {
		t.Errorf("o aviso devolve a carteira: %+v", p.WarningDetails)
	}
	// desfaz, recebe o VR (600,00) e paga de novo: saldo 20000 >= 0, sem aviso
	a.do("DELETE", "/api/households/"+house+"/invoices/"+i1.ID+"/pay", nil, c)
	a.receive(c, house, vr.ID, nil)
	if p, r := a.pay(c, house, i1.ID, "benefit", nil); r.Code != 200 || len(p.Warnings) != 0 {
		t.Fatalf("com saldo: %d %s", r.Code, r.Body)
	}
	// segunda compra de 300,00: 60000 - 40000 - 30000 = -10000 => avisa (e o pagamento é feito)
	p, r = a.pay(c, house, i2.ID, "benefit", nil)
	if r.Code != 200 || len(p.Warnings) != 1 || p.Invoice.Paid == nil {
		t.Fatalf("estourou o saldo: %d %s", r.Code, r.Body)
	}
	// o aviso usa o valor efetivamente pago: se pagou menos, cabe
	a.do("DELETE", "/api/households/"+house+"/invoices/"+i2.ID+"/pay", nil, c)
	if p, _ := a.pay(c, house, i2.ID, "benefit", map[string]any{"amountCents": 20000}); len(p.Warnings) != 0 {
		t.Errorf("pagou 200,00 com saldo de 200,00: %v", p.Warnings)
	}
	// pagar com a carteira livre nunca avisa, mesmo com o benefício negativo
	a.do("DELETE", "/api/households/"+house+"/invoices/"+i2.ID+"/pay", nil, c)
	extra, _ := a.newInvoice(c, house, mercado, map[string]any{"amountCents": 90000})
	a.pay(c, house, extra.ID, "benefit", nil)
	if p, _ := a.pay(c, house, i2.ID, "free", nil); len(p.Warnings) != 0 || p.Warnings == nil {
		t.Errorf("carteira livre: %v", p.Warnings)
	}
	// o aviso olha a competência DA INVOICE: novembro tem VR previsto, mas ainda não recebido => saldo negativo => avisa
	nov, _ := a.newInvoice(c, house, mercado, map[string]any{"amountCents": 1000, "dueDate": "2026-11-10"})
	if p, _ := a.pay(c, house, nov.ID, "benefit", nil); len(p.Warnings) != 1 {
		t.Errorf("novembro sem VR recebido deveria avisar: %v", p.Warnings)
	}
}

func TestReceitasIsolamentoEntreCasas(t *testing.T) {
	a := newApp(t, opts{openRegistration: true, now: func() time.Time { return today }})
	cA, houseA := a.register("Ana", "ana@x.com", "Casa A")
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")
	ana, beto := a.uid("ana@x.com"), a.uid("beto@x.com")
	baseA, baseB := "/api/households/"+houseA, "/api/households/"+houseB
	var catsA []cat
	a.do("GET", baseA+"/categories", nil, cA).json(&catsA)

	srcA, _ := a.newSource(cA, houseA, ana, nil)
	incA := a.incomeOf(cA, houseA, "2026-10-01")
	a.receive(cA, houseA, incA.ID, nil)
	invA, _ := a.newInvoice(cA, houseA, catsA[0].ID, nil)
	a.pay(cA, houseA, invA.ID, "free", nil)

	// Beto não vê nada da Ana pela casa dele nem pela dela
	if got := a.incomesOf(cB, houseB, "2026-10-01"); len(got) != 0 {
		t.Errorf("lista de receitas vazou: %+v", got)
	}
	if got := a.sourcesOf(cB, houseB); len(got) != 0 {
		t.Errorf("lista de fontes vazou: %+v", got)
	}
	if s := a.summaryOf(cB, houseB, "2026-10-01"); s.Free().ExpectedIncomeCents != 0 || s.TotalPaidCents != 0 || len(s.ByCategory) != 0 {
		t.Errorf("resumo vazou: %+v", s)
	}
	for _, p := range []string{baseA + "/incomes?month=2026-10-01", baseA + "/income-sources", baseA + "/summary?month=2026-10-01"} {
		if r := a.do("GET", p, nil, cB); r.Code != 404 {
			t.Errorf("GET %s pela casa alheia: %d", p, r.Code)
		}
	}
	// por id, usando a casa dele: 404 (e nada muda)
	for name, r := range map[string]resp{
		"editar":     a.do("PATCH", baseB+"/incomes/"+incA.ID, map[string]any{"grossAmountCents": 1}, cB),
		"excluir":    a.do("DELETE", baseB+"/incomes/"+incA.ID, nil, cB),
		"receber":    a.receive(cB, houseB, incA.ID, nil),
		"desfazer":   a.do("DELETE", baseB+"/incomes/"+incA.ID+"/receive", nil, cB),
		"editar src": a.do("PATCH", baseB+"/income-sources/"+srcA.ID+"?applyFrom=2026-10-01", map[string]any{"grossAmountCents": 1}, cB),
	} {
		if r.Code != 404 {
			t.Errorf("%s alheia: %d %s", name, r.Code, r.Body)
		}
	}
	if g := a.incomeOf(cA, houseA, "2026-10-01"); g.GrossAmountCents != 800000 || !g.Received {
		t.Errorf("receita da Ana mexida: %+v", g)
	}
	// responsável de outra casa não vale (nem em fonte nem em avulsa)
	_, r := a.newSource(cB, houseB, ana, nil)
	assertField(t, r, 400, "userId")
	r = a.do("POST", baseB+"/incomes", map[string]any{
		"userId": ana, "kind": "other", "description": "x", "competenceMonth": "2026-10-01", "expectedDate": "2026-10-01", "grossAmountCents": 100,
	}, cB)
	assertField(t, r, 400, "userId")
	// o horizonte da casa B não gera nada para a casa A
	before := a.countIncomes(srcA.ID, "")
	a.newSource(cB, houseB, beto, nil)
	a.incomesOf(cB, houseB, "2030-01-01")
	if after := a.countIncomes(srcA.ID, ""); after != before {
		t.Errorf("casa B estendeu a fonte da casa A: %d -> %d", before, after)
	}
	// o job diário (todas as casas) é o único que olha tudo: estende as duas
	if err := a.inc.EnsureHorizonAll(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestReceitasPapeisEVisibilidade(t *testing.T) {
	a := newApp(t, opts{openRegistration: true, now: func() time.Time { return today }})
	cA, houseA := a.register("Ana", "ana@x.com", "Casa A")
	cB, _ := a.register("Beto", "beto@x.com", "Casa B")
	cD, _ := a.register("Duda", "duda@x.com", "Casa D")
	ana, beto, duda := a.uid("ana@x.com"), a.uid("beto@x.com"), a.uid("duda@x.com")
	base := "/api/households/" + houseA
	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'viewer')", houseA, beto)
	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')", houseA, duda)

	src, _ := a.newSource(cA, houseA, ana, nil)
	inc := a.incomeOf(cA, houseA, "2026-10-01")
	a.newInvoice(cA, houseA, mustCat(a, cA, houseA), nil)

	// decisão documentada: todos os membros (viewer e member) leem as receitas de todos
	for name, ck := range map[string]*http.Cookie{"viewer": cB, "member": cD} {
		if got := a.incomesOf(ck, houseA, "2026-10-01"); len(got) != 1 || got[0].UserID != ana || got[0].NetAmountCents != 608410 {
			t.Errorf("%s lendo receitas da Ana: %+v", name, got)
		}
		if got := a.sourcesOf(ck, houseA); len(got) != 1 {
			t.Errorf("%s lendo fontes: %+v", name, got)
		}
		if s := a.summaryOf(ck, houseA, "2026-10-01"); s.Free().ExpectedIncomeCents != 608410 {
			t.Errorf("%s lendo resumo: %+v", name, s.Free())
		}
	}
	// viewer não escreve nada
	newInc := map[string]any{"userId": beto, "kind": "other", "description": "x", "competenceMonth": "2026-10-01", "expectedDate": "2026-10-01", "grossAmountCents": 100}
	newSrc := map[string]any{"userId": beto, "kind": "salary", "name": "x", "grossAmountCents": 100, "dayOfMonth": 1, "startMonth": "2026-10-01"}
	for name, r := range map[string]resp{
		"criar receita": a.do("POST", base+"/incomes", newInc, cB),
		"criar fonte":   a.do("POST", base+"/income-sources", newSrc, cB),
		"editar":        a.do("PATCH", base+"/incomes/"+inc.ID, map[string]any{"grossAmountCents": 1}, cB),
		"excluir":       a.do("DELETE", base+"/incomes/"+inc.ID, nil, cB),
		"receber":       a.receive(cB, houseA, inc.ID, nil),
		"desfazer":      a.do("DELETE", base+"/incomes/"+inc.ID+"/receive", nil, cB),
		"editar fonte":  a.do("PATCH", base+"/income-sources/"+src.ID, map[string]any{"name": "x"}, cB),
	} {
		if r.Code != 403 {
			t.Errorf("viewer %s deveria ser 403: %d", name, r.Code)
		}
	}
	if got := a.incomeOf(cA, houseA, "2026-10-01"); got.Held || got.GrossAmountCents != 800000 {
		t.Errorf("viewer alterou dados: %+v", got)
	}
	// member escreve e pode lançar a receita de outro membro (a casa é a unidade de dados)
	newInc["userId"] = duda
	if r := a.do("POST", base+"/incomes", newInc, cD); r.Code != 201 {
		t.Errorf("member criando receita: %d %s", r.Code, r.Body)
	}
	// responsável: membro que saiu da casa, usuário inexistente
	a.db.Exec("UPDATE household_members SET left_at = now() WHERE household_id = ? AND user_id = ?", houseA, duda)
	newInc["userId"] = duda
	assertField(t, a.do("POST", base+"/incomes", newInc, cA), 400, "userId")
	newInc["userId"] = "018f0000-0000-7000-8000-000000000000"
	assertField(t, a.do("POST", base+"/incomes", newInc, cA), 400, "userId")
	_, r := a.newSource(cA, houseA, "018f0000-0000-7000-8000-000000000000", nil)
	assertField(t, r, 400, "userId")
	// sem sessão
	if r := a.do("GET", base+"/incomes?month=2026-10-01", nil, nil); r.Code != 401 {
		t.Errorf("sem sessão: %d", r.Code)
	}
}

func mustCat(a *app, c *http.Cookie, house string) string {
	var cats []cat
	a.do("GET", "/api/households/"+house+"/categories", nil, c).json(&cats)
	return cats[0].ID
}

// assertField confere o status e que o 400 trouxe erro no campo esperado.
func assertField(t *testing.T, r resp, status int, field string) {
	t.Helper()
	if r.Code != status {
		t.Errorf("status %d, quer %d: %s", r.Code, status, r.Body)
		return
	}
	var p struct {
		Fields map[string]string `json:"fields"`
	}
	r.json(&p)
	if p.Fields[field] == "" {
		t.Errorf("sem erro no campo %q: %s", field, r.Body)
	}
}
