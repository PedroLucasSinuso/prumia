package api

import (
	"testing"
)

// Receita que cai no MÊS ANTERIOR à competência (monthOffset = -1): o vale de outubro (dias úteis de outubro) é recebido
// no último dia útil de setembro. A competência e o resumo seguem o mês de outubro. "Hoje" = 18/10/2026.

func offsetRule(rule string, n int, offset int) map[string]any {
	r := ruleBody(rule, n, "")
	r["monthOffset"] = offset
	return r
}

func TestReceitaNoMesAnteriorRepeticaoEResumo(t *testing.T) {
	a, c, house, _, _ := serie(t)
	vr, r := a.postIncome(c, house, map[string]any{
		"description": "VR do mês seguinte", "kind": "benefit", "grossAmountCents": nil, "amountMode": "per_unit",
		"unitPriceCents": 4000, "unitLabel": "dia útil", "dateRule": offsetRule("last_business_day", 0, -1),
	})
	if r.Code != 201 {
		t.Fatalf("criar: %d %s", r.Code, r.Body)
	}
	// competência fica em outubro; a data cai em 30/09; a quantidade é a de dias úteis de OUTUBRO (21)
	if vr.CompetenceMonth != "2026-10-01" || vr.ExpectedDate != "2026-09-30" {
		t.Errorf("competência/data: %+v", vr)
	}
	if vr.Quantity == nil || *vr.Quantity != 21 || vr.GrossAmountCents != 84000 {
		t.Errorf("quantidade padrão = dias úteis da competência: %+v", vr)
	}
	if vr.DateRule == nil || vr.DateRule.MonthOffset == nil || *vr.DateRule.MonthOffset != -1 {
		t.Errorf("a regra devolve o offset: %+v", vr.DateRule)
	}
	// os meses da repetição seguem a regra: novembro cai em 30/10, dezembro em 30/11, e a quantidade é a da competência
	type want struct {
		date string
		qty  int
		cent int64
	}
	for m, w := range map[string]want{
		"2026-11-01": {"2026-10-30", 19, 76000},
		"2026-12-01": {"2026-11-30", 22, 88000},
	} {
		x := a.incomeNamed(c, house, m, "VR do mês seguinte")
		if x.ExpectedDate != w.date || x.Quantity == nil || *x.Quantity != w.qty || x.GrossAmountCents != w.cent {
			t.Errorf("%s: %+v", m, x)
		}
		if x.DateRule == nil || x.DateRule.MonthOffset == nil || *x.DateRule.MonthOffset != -1 {
			t.Errorf("%s: o lançamento copia o offset da fonte: %+v", m, x.DateRule)
		}
	}
	if s := a.sourcesOf(c, house)[0]; s.DateRule.MonthOffset == nil || *s.DateRule.MonthOffset != -1 {
		t.Errorf("fonte: %+v", s.DateRule)
	}
	// a data (setembro) já passou: outubro conta como RECEBIDO no resumo de outubro; novembro (30/10) ainda não
	if !vr.Received {
		t.Errorf("a data de 30/09 já chegou: %+v", vr)
	}
	if b := a.summaryOf(c, house, "2026-10-01").Benefit(); b.ReceivedIncomeCents != 84000 || b.ExpectedIncomeCents != 84000 {
		t.Errorf("resumo de outubro: %+v", b)
	}
	if b := a.summaryOf(c, house, "2026-11-01").Benefit(); b.ReceivedIncomeCents != 0 || b.ExpectedIncomeCents != 76000 {
		t.Errorf("resumo de novembro (cai em 30/10, ainda não chegou): %+v", b)
	}
	// nada entra no resumo de setembro: quem vale é a competência
	if b := a.summaryOf(c, house, "2026-09-01").Benefit(); b.ExpectedIncomeCents != 0 {
		t.Errorf("resumo de setembro não deveria ter o vale de outubro: %+v", b)
	}
}

func TestReceitaNoMesAnteriorViradaDeAno(t *testing.T) {
	a, c, house, _, _ := serie(t)
	a.postIncome(c, house, map[string]any{
		"description": "VR virada", "kind": "benefit", "competenceMonth": "2026-12-01", "dateRule": offsetRule("nth_business_day", 2, -1),
	})
	// 2º dia útil de novembro/2026 = 04/11 (dia 2 é feriado); janeiro/2027 usa dezembro/2026 (2º dia útil = 02/12)
	if x := a.incomeNamed(c, house, "2026-12-01", "VR virada"); x.ExpectedDate != "2026-11-04" {
		t.Errorf("dezembro: %+v", x)
	}
	if x := a.incomeNamed(c, house, "2027-01-01", "VR virada"); x.ExpectedDate != "2026-12-02" || x.CompetenceMonth != "2027-01-01" {
		t.Errorf("janeiro: %+v", x)
	}
}

func TestMesAnteriorSoComRegraEValoresValidos(t *testing.T) {
	a, c, house, _, _ := serie(t)
	_, r := a.postIncome(c, house, map[string]any{"dateRule": offsetRule("last_business_day", 0, 1)})
	assertField(t, r, 400, "dateRule.monthOffset")
	_, r = a.postIncome(c, house, map[string]any{"dateRule": offsetRule("last_business_day", 0, -2)})
	assertField(t, r, 400, "dateRule.monthOffset")
	// avulsa com data digitada: não há regra, logo não há offset (a data digitada vale como está)
	x, r := a.postIncome(c, house, map[string]any{
		"description": "Avulsa", "repeats": false, "dateRule": nil, "expectedDate": "2026-09-20",
	})
	if r.Code != 201 || x.ExpectedDate != "2026-09-20" || x.DateRule != nil {
		t.Errorf("data digitada: %d %s", r.Code, r.Body)
	}
	// avulsa com regra e offset: calcula no mês anterior
	y, r := a.postIncome(c, house, map[string]any{
		"description": "Avulsa regra", "repeats": false, "dateRule": offsetRule("last_business_day", 0, -1),
	})
	if r.Code != 201 || y.ExpectedDate != "2026-09-30" {
		t.Errorf("avulsa com regra: %d %s", r.Code, r.Body)
	}
}

func TestEditarOffsetEmLoteEPrevia(t *testing.T) {
	a, c, house, _, _ := serie(t)
	base := "/api/households/" + house
	a.postIncome(c, house, map[string]any{"description": "Vale", "kind": "benefit", "dateRule": offsetRule("last_business_day", 0, 0)})
	nov := a.incomeNamed(c, house, "2026-11-01", "Vale")
	if nov.ExpectedDate != "2026-11-30" {
		t.Fatalf("antes: %+v", nov)
	}
	// "este e os seguintes": o molde e novembro em diante passam para o mês anterior; outubro (recebido) não muda
	r := a.do("PATCH", base+"/incomes/"+nov.ID+"?scope=following", map[string]any{"dateRule": offsetRule("last_business_day", 0, -1)}, c)
	if r.Code != 200 {
		t.Fatalf("following: %d %s", r.Code, r.Body)
	}
	for m, want := range map[string]string{"2026-10-01": "2026-10-30", "2026-11-01": "2026-10-30", "2026-12-01": "2026-11-30", "2027-01-01": "2026-12-31"} {
		if got := a.incomeNamed(c, house, m, "Vale").ExpectedDate; got != want {
			t.Errorf("%s: %s, quer %s", m, got, want)
		}
	}
	if s := a.sourcesOf(c, house)[0]; s.DateRule.MonthOffset == nil || *s.DateRule.MonthOffset != -1 {
		t.Errorf("o molde deveria ter o offset: %+v", s.DateRule)
	}
	// só este mês: volta o offset 0 em dezembro apenas
	dez := a.incomeNamed(c, house, "2026-12-01", "Vale")
	if r := a.do("PATCH", base+"/incomes/"+dez.ID, map[string]any{"dateRule": offsetRule("last_business_day", 0, 0)}, c); r.Code != 200 {
		t.Fatalf("this: %d %s", r.Code, r.Body)
	}
	if got := a.incomeNamed(c, house, "2026-12-01", "Vale").ExpectedDate; got != "2026-12-31" {
		t.Errorf("dezembro só este mês: %s", got)
	}
	if got := a.incomeNamed(c, house, "2027-01-01", "Vale").ExpectedDate; got != "2026-12-31" {
		t.Errorf("janeiro não muda: %s", got)
	}
	// o molde via PATCH da fonte com applyFrom também considera o offset
	src := a.sourcesOf(c, house)[0]
	a.do("PATCH", base+"/income-sources/"+src.ID+"?applyFrom=2026-11-01", map[string]any{"dateRule": offsetRule("nth_business_day", 1, -1)}, c)
	if got := a.incomeNamed(c, house, "2026-11-01", "Vale").ExpectedDate; got != "2026-10-01" {
		t.Errorf("fonte com offset: %s", got)
	}

	// prévia: a data pode ser do mês anterior; businessDays é o da COMPETÊNCIA (out 21, nov 19, dez 22)
	var prev []struct {
		Month        string `json:"month"`
		ExpectedDate string `json:"expectedDate"`
		BusinessDays int    `json:"businessDays"`
	}
	rr := a.do("GET", base+"/income-dates?month=2026-10-01&rule=last_business_day&monthOffset=-1&count=3", nil, c)
	rr.json(&prev)
	if rr.Code != 200 || len(prev) != 3 || prev[0].ExpectedDate != "2026-09-30" || prev[1].ExpectedDate != "2026-10-30" ||
		prev[2].ExpectedDate != "2026-11-30" || prev[0].BusinessDays != 21 || prev[1].BusinessDays != 19 || prev[2].BusinessDays != 22 ||
		prev[0].Month != "2026-10-01" {
		t.Fatalf("prévia: %d %s", rr.Code, rr.Body)
	}
	if rr := a.do("GET", base+"/income-dates?month=2026-10-01&rule=last_business_day&monthOffset=1", nil, c); rr.Code != 400 {
		t.Errorf("offset inválido na prévia: %d", rr.Code)
	}
}
