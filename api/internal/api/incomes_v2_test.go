package api

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// Testes de ponta a ponta das receitas v2: regras de data (dia útil), valor por unidade, recebimento automático e
// "não caiu", excluir/restaurar/editar com escopo, prévia de datas e estimativa de impostos. "Hoje" = 18/10/2026.
// Todos os nomes e valores são inventados.

func ruleBody(rule string, n int, adjust string) map[string]any {
	r := map[string]any{"rule": rule, "weekendAdjust": adjust}
	if rule != "last_business_day" {
		r["n"] = n
	}
	return r
}

// postIncome cria uma receita que se repete (salary fixo por padrão, a partir de outubro de 2026).
func (a *app) postIncome(c *http.Cookie, house string, extra map[string]any) (incT, resp) {
	a.t.Helper()
	body := map[string]any{
		"userId": a.uid("ana@x.com"), "kind": "salary", "description": "Salário Ana", "competenceMonth": "2026-10-01",
		"grossAmountCents": 500000, "dateRule": ruleBody("nth_business_day", 2, ""), "repeats": true,
	}
	for k, v := range extra {
		body[k] = v
	}
	r := a.do("POST", "/api/households/"+house+"/incomes", body, c)
	var out incT
	if r.Code == http.StatusCreated {
		r.json(&out)
	}
	return out, r
}

func (a *app) incomeNamed(c *http.Cookie, house, month, desc string) incT {
	a.t.Helper()
	for _, i := range a.incomesOf(c, house, month) {
		if i.Description == desc {
			return i
		}
	}
	a.t.Fatalf("receita %q não encontrada em %s", desc, month)
	return incT{}
}

func TestRegrasDeDataNaCriacaoEmMesesReais(t *testing.T) {
	a, c, house, _, _ := serie(t)
	for desc, extra := range map[string]map[string]any{
		"Salário 2º útil":  {"description": "Salário 2º útil", "dateRule": ruleBody("nth_business_day", 2, "")},
		"Salário 5º útil":  {"description": "Salário 5º útil", "dateRule": ruleBody("nth_business_day", 5, "")},
		"VR dia 28":        {"description": "VR dia 28", "kind": "benefit", "dateRule": ruleBody("day_of_month", 28, "")},
		"VR dia 28 volta":  {"description": "VR dia 28 volta", "kind": "benefit", "dateRule": ruleBody("day_of_month", 28, "backward")},
		"VR dia 28 mantém": {"description": "VR dia 28 mantém", "kind": "benefit", "dateRule": ruleBody("day_of_month", 28, "none")},
		"Aluguel último":   {"description": "Aluguel último", "kind": "other", "dateRule": ruleBody("last_business_day", 0, "")},
	} {
		if _, r := a.postIncome(c, house, extra); r.Code != 201 {
			t.Fatalf("%s: %d %s", desc, r.Code, r.Body)
		}
	}
	// novembro/2026: dia 2 é feriado (Finados), dia 20 também; dia 28 é sábado
	want := map[string][3]string{ // outubro, novembro, dezembro
		"Salário 2º útil":  {"2026-10-02", "2026-11-04", "2026-12-02"},
		"Salário 5º útil":  {"2026-10-07", "2026-11-09", "2026-12-07"},
		"VR dia 28":        {"2026-10-28", "2026-11-30", "2026-12-28"}, // sábado vai para segunda (padrão forward)
		"VR dia 28 volta":  {"2026-10-28", "2026-11-27", "2026-12-28"}, // sábado volta para sexta
		"VR dia 28 mantém": {"2026-10-28", "2026-11-28", "2026-12-28"},
		"Aluguel último":   {"2026-10-30", "2026-11-30", "2026-12-31"},
	}
	for desc, dates := range want {
		for i, m := range []string{"2026-10-01", "2026-11-01", "2026-12-01"} {
			if got := a.incomeNamed(c, house, m, desc).ExpectedDate; got != dates[i] {
				t.Errorf("%s em %s: %s, quer %s", desc, m, got, dates[i])
			}
		}
	}
	vr := a.incomeNamed(c, house, "2026-11-01", "VR dia 28")
	if vr.Wallet != "benefit" || vr.DateRule == nil || vr.DateRule.Rule != "day_of_month" || vr.DateRule.WeekendAdjust != "forward" || !vr.Repeats {
		t.Errorf("VR: %+v", vr)
	}
	// regra inválida / repetição sem regra / avulsa sem data
	_, r := a.postIncome(c, house, map[string]any{"dateRule": ruleBody("nth_business_day", 24, "")})
	assertField(t, r, 400, "dateRule.n")
	_, r = a.postIncome(c, house, map[string]any{"dateRule": nil})
	assertField(t, r, 400, "dateRule")
	_, r = a.postIncome(c, house, map[string]any{"dateRule": nil, "repeats": false})
	assertField(t, r, 400, "expectedDate")
	_, r = a.postIncome(c, house, map[string]any{"dateRule": ruleBody("day_of_month", 5, "talvez")})
	assertField(t, r, 400, "dateRule.weekendAdjust")
}

func TestAvulsaComRegraEComDataDigitada(t *testing.T) {
	a, c, house, _, _ := serie(t)
	// avulsa só com data digitada (sem regra)
	i, r := a.postIncome(c, house, map[string]any{"repeats": false, "dateRule": nil, "expectedDate": "2026-10-20", "description": "Freela"})
	if r.Code != 201 || i.ExpectedDate != "2026-10-20" || i.DateRule != nil || i.Repeats || i.SourceID != nil {
		t.Fatalf("avulsa com data: %d %s", r.Code, r.Body)
	}
	// avulsa com regra (não repete): a regra calcula a data do mês
	i, r = a.postIncome(c, house, map[string]any{"repeats": false, "description": "Bônus", "dateRule": ruleBody("last_business_day", 0, "")})
	if r.Code != 201 || i.ExpectedDate != "2026-10-30" || i.Repeats {
		t.Fatalf("avulsa com regra: %d %s", r.Code, r.Body)
	}
	// repetição com data digitada no primeiro mês: só o primeiro mês usa a data digitada
	i, r = a.postIncome(c, house, map[string]any{"description": "Comissão", "expectedDate": "2026-10-23"})
	if r.Code != 201 || i.ExpectedDate != "2026-10-23" || !i.Repeats {
		t.Fatalf("repete com data no 1º mês: %d %s", r.Code, r.Body)
	}
	if nov := a.incomeNamed(c, house, "2026-11-01", "Comissão"); nov.ExpectedDate != "2026-11-04" {
		t.Errorf("novembro segue a regra: %+v", nov)
	}
	// "repete até": o último mês gerado é o informado
	i, r = a.postIncome(c, house, map[string]any{"description": "Temporário", "repeatsUntil": "2026-12-01"})
	if r.Code != 201 || i.RepeatsUntilOrEmpty() != "2026-12-01" || !i.Repeats {
		t.Fatalf("repete até dezembro: %d %s", r.Code, r.Body)
	}
	if dez := a.incomeNamed(c, house, "2026-12-01", "Temporário"); dez.Repeats {
		t.Errorf("dezembro é o último mês: não repete mais: %+v", dez)
	}
	for _, x := range a.incomesOf(c, house, "2027-01-01") {
		if x.Description == "Temporário" {
			t.Errorf("Temporário não deveria existir em janeiro")
		}
	}
}

func TestValorPorUnidadeDiasUteis(t *testing.T) {
	a, c, house, _, _ := serie(t)
	base := "/api/households/" + house
	vr, r := a.postIncome(c, house, map[string]any{
		"description": "VR por dia", "kind": "benefit", "grossAmountCents": nil, "amountMode": "per_unit", "unitPriceCents": 6500,
		"unitLabel": "dia trabalhado", "dateRule": ruleBody("day_of_month", 28, ""),
	})
	if r.Code != 201 || vr.AmountMode != "per_unit" || vr.UnitLabel == nil || *vr.UnitLabel != "dia trabalhado" {
		t.Fatalf("criar por unidade: %d %s", r.Code, r.Body)
	}
	// quantidade sugerida = dias úteis do mês (out/2026: 21; nov: 19; dez: 22), bruto = preço x quantidade
	for m, want := range map[string][2]int64{"2026-10-01": {21, 136500}, "2026-11-01": {19, 123500}, "2026-12-01": {22, 143000}} {
		x := a.incomeNamed(c, house, m, "VR por dia")
		if x.Quantity == nil || int64(*x.Quantity) != want[0] || x.GrossAmountCents != want[1] || x.NetAmountCents != want[1] || *x.UnitPriceCents != 6500 {
			t.Errorf("%s: %+v", m, x)
		}
	}
	src := a.sourcesOf(c, house)[0]
	if src.AmountMode != "per_unit" || src.GrossAmountCents != 6500 {
		t.Errorf("fonte por unidade (o bruto espelha o preço): %+v", src)
	}

	// a pessoa ajusta a quantidade do mês (faltou em dois dias): o bruto é recalculado
	nov := a.incomeNamed(c, house, "2026-11-01", "VR por dia")
	r = a.do("PATCH", base+"/incomes/"+nov.ID, map[string]any{"quantity": 17}, c)
	var upd incT
	r.json(&upd)
	if r.Code != 200 || *upd.Quantity != 17 || upd.GrossAmountCents != 110500 {
		t.Fatalf("ajustar quantidade: %d %s", r.Code, r.Body)
	}
	// só o preço (este mês): mantém a quantidade ajustada
	r = a.do("PATCH", base+"/incomes/"+nov.ID, map[string]any{"unitPriceCents": 7000}, c)
	upd = incT{}
	r.json(&upd)
	if *upd.Quantity != 17 || upd.GrossAmountCents != 119000 {
		t.Errorf("só o preço: %+v", upd)
	}
	// em lote: não se aceita quantidade; informar o total em receita por unidade também é erro
	assertField(t, a.do("PATCH", base+"/incomes/"+nov.ID+"?scope=following", map[string]any{"quantity": 10}, c), 400, "quantity")
	assertField(t, a.do("PATCH", base+"/incomes/"+nov.ID, map[string]any{"grossAmountCents": 1000}, c), 400, "grossAmountCents")
	assertField(t, a.do("PATCH", base+"/incomes/"+nov.ID, map[string]any{"quantity": 0}, c), 400, "quantity")

	// preço novo para este e os seguintes: novembro (17 dias ajustados) mantém a quantidade; dezembro usa os dias úteis
	r = a.do("PATCH", base+"/incomes/"+nov.ID+"?scope=following", map[string]any{"unitPriceCents": 7200}, c)
	if r.Code != 200 {
		t.Fatalf("preço em lote: %d %s", r.Code, r.Body)
	}
	nov = a.incomeNamed(c, house, "2026-11-01", "VR por dia")
	dez := a.incomeNamed(c, house, "2026-12-01", "VR por dia")
	if nov.GrossAmountCents != 17*7200 || *dez.Quantity != 22 || dez.GrossAmountCents != 22*7200 {
		t.Errorf("em lote: nov %+v, dez %+v", nov, dez)
	}
	if out := a.incomeNamed(c, house, "2026-10-01", "VR por dia"); out.GrossAmountCents != 136500 {
		t.Errorf("outubro (antes do corte) mudou: %+v", out)
	}
	// o molde mudou: um mês gerado depois já nasce com o preço novo
	jan := a.incomeNamed(c, house, "2028-01-01", "VR por dia")
	if *jan.UnitPriceCents != 7200 || *jan.Quantity != 21 {
		t.Errorf("molde: %+v", jan)
	}

	// valor fixo para por unidade e de volta, só neste mês
	r = a.do("PATCH", base+"/incomes/"+dez.ID, map[string]any{"amountMode": "fixed", "grossAmountCents": 150000}, c)
	upd = incT{}
	r.json(&upd)
	if r.Code != 200 || upd.AmountMode != "fixed" || upd.Quantity != nil || upd.UnitPriceCents != nil || upd.GrossAmountCents != 150000 {
		t.Errorf("para fixo: %d %s", r.Code, r.Body)
	}
	// quantidade informada na criação vale para o primeiro mês
	x, r := a.postIncome(c, house, map[string]any{
		"description": "Plantão", "kind": "other", "grossAmountCents": nil, "amountMode": "per_unit", "unitPriceCents": 30000,
		"unitLabel": "plantão", "quantity": 4, "dateRule": ruleBody("last_business_day", 0, ""),
	})
	if r.Code != 201 || *x.Quantity != 4 || x.GrossAmountCents != 120000 {
		t.Fatalf("quantidade no 1º mês: %d %s", r.Code, r.Body)
	}
	if n := a.incomeNamed(c, house, "2026-11-01", "Plantão"); *n.Quantity != 19 {
		t.Errorf("meses seguintes usam os dias úteis: %+v", n)
	}
	// validações
	_, r = a.postIncome(c, house, map[string]any{"amountMode": "per_unit", "grossAmountCents": nil})
	assertField(t, r, 400, "unitPriceCents")
	_, r = a.postIncome(c, house, map[string]any{"amountMode": "por_hora"})
	assertField(t, r, 400, "amountMode")
}

func TestRecebimentoAutomaticoENaoCaiu(t *testing.T) {
	a, c, house, _, clock := serie(t)
	base := "/api/households/" + house
	// salário no 2º dia útil (já passou em out/2026: recebido sozinho) e VR no dia 28 (ainda vai cair)
	sal, _ := a.postIncome(c, house, map[string]any{"description": "Salário", "deductions": []dedT{{"inss", "INSS", 50000}}})
	vr, _ := a.postIncome(c, house, map[string]any{"description": "VR", "kind": "benefit", "grossAmountCents": 60000, "dateRule": ruleBody("day_of_month", 28, "")})
	if !sal.Received || sal.ReceivedAt == nil || *sal.ReceivedAt != "2026-10-02" || sal.Held {
		t.Fatalf("salário deveria contar como recebido sozinho: %+v", sal)
	}
	if vr.Received || vr.ReceivedAt != nil || vr.Held {
		t.Fatalf("VR ainda não caiu: %+v", vr)
	}
	s := a.summaryOf(c, house, "2026-10-01")
	if f := s.Wallets.Free; f.ReceivedIncomeCents != 450000 || f.ExpectedIncomeCents != 450000 || f.BalanceCents != 450000 {
		t.Errorf("livre com recebimento automático: %+v", f)
	}
	if b := s.Wallets.Benefit; b.ReceivedIncomeCents != 0 || b.ExpectedIncomeCents != 60000 {
		t.Errorf("benefício ainda a receber: %+v", b)
	}

	// "não caiu": sai do recebido e do saldo, mas continua previsto
	r := a.do("DELETE", base+"/incomes/"+sal.ID+"/receive", nil, c)
	var got incT
	r.json(&got)
	if r.Code != 200 || got.Received || !got.Held || got.ReceivedAt != nil {
		t.Fatalf("não caiu: %d %s", r.Code, r.Body)
	}
	if f := a.summaryOf(c, house, "2026-10-01").Wallets.Free; f.ReceivedIncomeCents != 0 || f.ExpectedIncomeCents != 450000 || f.BalanceCents != 0 {
		t.Errorf("livre com o salário retido: %+v", f)
	}
	if r := a.do("DELETE", base+"/incomes/"+sal.ID+"/receive", nil, c); r.Code != 409 || !strings.Contains(r.Body.String(), "not_received") {
		t.Errorf("não caiu de novo: %d %s", r.Code, r.Body)
	}
	// ficar retido não muda com o tempo: continua "não caiu" semanas depois
	a.travel(clock, time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC))
	if x := a.incomeNamed(c, house, "2026-10-01", "Salário"); x.Received || !x.Held {
		t.Errorf("retido deve continuar retido: %+v", x)
	}
	// "caiu": volta ao recebimento automático (a data já passou)
	r = a.receive(c, house, sal.ID, nil)
	got = incT{}
	r.json(&got)
	if r.Code != 200 || !got.Received || got.Held || *got.ReceivedAt != "2026-10-02" {
		t.Fatalf("caiu: %d %s", r.Code, r.Body)
	}
	if r := a.receive(c, house, sal.ID, nil); r.Code != 409 || !strings.Contains(r.Body.String(), "already_received") {
		t.Errorf("caiu de novo: %d %s", r.Code, r.Body)
	}
	// o VR (28/10) já passou na viagem para 20/11: recebido sozinho; o de novembro (30/11) ainda não
	if x := a.incomeNamed(c, house, "2026-10-01", "VR"); !x.Received {
		t.Errorf("VR de outubro deveria ter caído sozinho: %+v", x)
	}
	if x := a.incomeNamed(c, house, "2026-11-01", "VR"); x.Received {
		t.Errorf("VR de novembro ainda não caiu: %+v", x)
	}
	// recebido ANTES da data: "caiu" marca hoje (ou a data informada); depois "não caiu" desfaz
	nov := a.incomeNamed(c, house, "2026-11-01", "VR")
	r = a.receive(c, house, nov.ID, map[string]any{"receivedAt": "2026-11-19"})
	got = incT{}
	r.json(&got)
	if r.Code != 200 || !got.Received || *got.ReceivedAt != "2026-11-19" {
		t.Fatalf("receber antes da data: %d %s", r.Code, r.Body)
	}
	if b := a.summaryOf(c, house, "2026-11-01").Wallets.Benefit; b.ReceivedIncomeCents != 60000 {
		t.Errorf("benefício recebido antes da data: %+v", b)
	}
	a.do("DELETE", base+"/incomes/"+nov.ID+"/receive", nil, c)
	if b := a.summaryOf(c, house, "2026-11-01").Wallets.Benefit; b.ReceivedIncomeCents != 0 || b.ExpectedIncomeCents != 60000 {
		t.Errorf("benefício depois do não caiu: %+v", b)
	}
}

func TestExcluirComEscopoEDesfazer(t *testing.T) {
	a, c, house, _, _ := serie(t)
	base := "/api/households/" + house
	// salário no dia 28 (a receber em out/2026), outubro/2026 a outubro/2027
	first, _ := a.postIncome(c, house, map[string]any{"dateRule": ruleBody("day_of_month", 28, "")})
	month := func(m string) incT { return a.incomeNamed(c, house, m, "Salário Ana") }
	has := func(m string) bool {
		for _, i := range a.incomesOf(c, house, m) {
			if i.Description == "Salário Ana" {
				return true
			}
		}
		return false
	}

	// só este mês: some, não ressuscita ao estender o horizonte, e dá para desfazer
	dec := month("2026-12-01")
	if r := a.do("DELETE", base+"/incomes/"+dec.ID, nil, c); r.Code != 204 {
		t.Fatalf("excluir este mês: %d", r.Code)
	}
	a.incomesOf(c, house, "2028-06-01") // estende o horizonte
	if has("2026-12-01") {
		t.Fatal("dezembro excluído ressuscitou")
	}

	// este e os seguintes (a partir de fevereiro/2027): encerra a repetição
	feb := month("2027-02-01")
	if r := a.do("DELETE", base+"/incomes/"+feb.ID+"?scope=following", nil, c); r.Code != 204 {
		t.Fatalf("excluir seguintes: %d", r.Code)
	}
	for _, m := range []string{"2027-02-01", "2027-03-01", "2027-10-01", "2028-06-01"} {
		if has(m) {
			t.Errorf("%s deveria ter sumido", m)
		}
	}
	if !has("2027-01-01") || !has("2026-11-01") {
		t.Error("meses anteriores devem continuar")
	}
	src := a.sourcesOf(c, house)[0]
	if src.EndMonth == nil || *src.EndMonth != "2027-01-01" {
		t.Errorf("a repetição deveria terminar em janeiro: %+v", src)
	}
	if got := month("2027-01-01"); got.Repeats || got.RepeatsUntilOrEmpty() != "2027-01-01" {
		t.Errorf("janeiro é o último mês: %+v", got)
	}

	// Desfazer o lote: volta fevereiro em diante e o fim; dezembro (excluído antes, outro instante) continua excluído
	if r := a.do("POST", base+"/incomes/"+feb.ID+"/restore?scope=following", nil, c); r.Code != 200 {
		t.Fatalf("desfazer lote: %d %s", r.Code, r.Body)
	}
	if !has("2027-02-01") || !has("2027-10-01") || has("2026-12-01") {
		t.Errorf("depois do desfazer: fev=%v out/27=%v dez=%v", has("2027-02-01"), has("2027-10-01"), has("2026-12-01"))
	}
	if src := a.sourcesOf(c, house)[0]; src.EndMonth != nil {
		t.Errorf("o fim deveria ter voltado a ser aberto: %+v", src)
	}
	if r := a.do("POST", base+"/incomes/"+feb.ID+"/restore", nil, c); r.Code != 409 || !strings.Contains(r.Body.String(), "not_deleted") {
		t.Errorf("restaurar o que não está excluído: %d %s", r.Code, r.Body)
	}
	// desfazer só dezembro
	if r := a.do("POST", base+"/incomes/"+dec.ID+"/restore", nil, c); r.Code != 200 || !has("2026-12-01") {
		t.Errorf("restaurar dezembro: %d %s", r.Code, r.Body)
	}

	// lotes empilhados: cortar de maio/2027 e depois de março/2027; desfazer o de maio primeiro dá 409
	may := month("2027-05-01")
	mar := month("2027-03-01")
	a.do("DELETE", base+"/incomes/"+may.ID+"?scope=following", nil, c)
	a.do("DELETE", base+"/incomes/"+mar.ID+"?scope=following", nil, c)
	if r := a.do("POST", base+"/incomes/"+may.ID+"/restore?scope=following", nil, c); r.Code != 409 || !strings.Contains(r.Body.String(), "series_changed") {
		t.Fatalf("lote empilhado fora de ordem: %d %s", r.Code, r.Body)
	}
	if has("2027-05-01") {
		t.Error("o 409 não pode restaurar nada")
	}
	if r := a.do("POST", base+"/incomes/"+mar.ID+"/restore?scope=following", nil, c); r.Code != 200 {
		t.Fatalf("desfazer março: %d %s", r.Code, r.Body)
	}
	// março voltou, mas maio em diante estava no lote de maio (mesmo deleted_at diferente): continua excluído
	if !has("2027-03-01") || has("2027-05-01") {
		t.Errorf("março=%v maio=%v", has("2027-03-01"), has("2027-05-01"))
	}
	if r := a.do("POST", base+"/incomes/"+may.ID+"/restore?scope=following", nil, c); r.Code != 200 || !has("2027-10-01") {
		t.Fatalf("desfazer maio: %d %s", r.Code, r.Body)
	}
	_ = first
	// escopo inválido
	if r := a.do("DELETE", base+"/incomes/"+may.ID+"?scope=tudo", nil, c); r.Code != 400 {
		t.Errorf("escopo inválido: %d", r.Code)
	}
}

func TestExcluirEmLoteNuncaApagaRecebidas(t *testing.T) {
	a, c, house, _, _ := serie(t)
	base := "/api/households/" + house
	// 2º dia útil: outubro (2/10) já foi recebido sozinho; novembro em diante a receber
	a.postIncome(c, house, nil)
	oct := a.incomeNamed(c, house, "2026-10-01", "Salário Ana")
	if !oct.Received {
		t.Fatalf("pré-condição: outubro recebido: %+v", oct)
	}
	// "este e os seguintes" a partir do recebido: ele fica; os seguintes saem; a repetição termina em outubro
	if r := a.do("DELETE", base+"/incomes/"+oct.ID+"?scope=following", nil, c); r.Code != 204 {
		t.Fatalf("%d", r.Code)
	}
	if got := a.incomesOf(c, house, "2026-10-01"); len(got) != 1 {
		t.Errorf("o recebido não pode sumir em lote: %+v", got)
	}
	if got := a.incomesOf(c, house, "2026-11-01"); len(got) != 0 {
		t.Errorf("novembro deveria ter sumido: %+v", got)
	}
	if src := a.sourcesOf(c, house)[0]; src.EndMonth == nil || *src.EndMonth != "2026-10-01" {
		t.Errorf("a repetição termina em outubro: %+v", src)
	}
	// repetição inteira (a partir do primeiro mês, a receber): a fonte é excluída; o desfazer a reativa
	nova, _ := a.postIncome(c, house, map[string]any{"description": "Nova", "competenceMonth": "2026-11-01"})
	if r := a.do("DELETE", base+"/incomes/"+nova.ID+"?scope=following", nil, c); r.Code != 204 {
		t.Fatal(r.Code)
	}
	for _, s := range a.sourcesOf(c, house) {
		if s.Name == "Nova" {
			t.Errorf("a repetição excluída não deveria aparecer na lista: %+v", s)
		}
	}
	if r := a.do("POST", base+"/incomes/"+nova.ID+"/restore?scope=following", nil, c); r.Code != 200 {
		t.Fatalf("restaurar repetição inteira: %d %s", r.Code, r.Body)
	}
	found := false
	for _, s := range a.sourcesOf(c, house) {
		found = found || s.Name == "Nova"
	}
	if !found || len(a.incomesOf(c, house, "2027-03-01")) != 1 {
		t.Errorf("a repetição deveria ter voltado inteira")
	}
	// avulsa: following equivale a this
	av, _ := a.postIncome(c, house, map[string]any{"repeats": false, "dateRule": nil, "expectedDate": "2026-10-25", "description": "Avulsa"})
	if r := a.do("DELETE", base+"/incomes/"+av.ID+"?scope=following", nil, c); r.Code != 204 {
		t.Errorf("avulsa: %d", r.Code)
	}
	if r := a.do("POST", base+"/incomes/"+av.ID+"/restore?scope=following", nil, c); r.Code != 200 {
		t.Errorf("restaurar avulsa: %d %s", r.Code, r.Body)
	}
}

func TestEditarReceitaComEscopo(t *testing.T) {
	a, c, house, _, _ := serie(t)
	base := "/api/households/" + house
	// segundo membro (Davi) para trocar a pessoa
	a.register("Davi", "davi@x.com", "Casa D")
	davi := a.uid("davi@x.com")
	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')", house, davi)

	a.postIncome(c, house, map[string]any{"dateRule": ruleBody("day_of_month", 28, ""), "deductions": []dedT{{"inss", "INSS", 40000}}})
	nov := a.incomeNamed(c, house, "2026-11-01", "Salário Ana")

	// só este mês: pessoa, tipo (muda a carteira), observação; o molde e os outros meses não mudam
	r := a.do("PATCH", base+"/incomes/"+nov.ID, map[string]any{"userId": davi, "kind": "benefit", "notes": "mudou"}, c)
	var upd incT
	r.json(&upd)
	if r.Code != 200 || upd.UserID != davi || upd.Kind != "benefit" || upd.Wallet != "benefit" {
		t.Fatalf("pessoa e tipo: %d %s", r.Code, r.Body)
	}
	if dez := a.incomeNamed(c, house, "2026-12-01", "Salário Ana"); dez.UserID == davi || dez.Kind != "salary" {
		t.Errorf("dezembro mudou junto: %+v", dez)
	}
	if s := a.sourcesOf(c, house)[0]; s.Kind != "salary" {
		t.Errorf("o molde mudou: %+v", s)
	}
	if b := a.summaryOf(c, house, "2026-11-01").Wallets.Benefit; b.ExpectedIncomeCents != 460000 {
		t.Errorf("a carteira de benefício deveria ter o valor: %+v", b)
	}
	assertField(t, a.do("PATCH", base+"/incomes/"+nov.ID, map[string]any{"userId": "018f0000-0000-7000-8000-000000000000"}, c), 400, "userId")
	assertField(t, a.do("PATCH", base+"/incomes/"+nov.ID, map[string]any{"kind": "bolsa"}, c), 400, "kind")

	// mês de competência: colide com outro mês da mesma repetição
	assertField(t, a.do("PATCH", base+"/incomes/"+nov.ID, map[string]any{"competenceMonth": "2026-12-01"}, c), 400, "competenceMonth")
	assertField(t, a.do("PATCH", base+"/incomes/"+nov.ID, map[string]any{"competenceMonth": "2026-12-15"}, c), 400, "competenceMonth")
	// avulsa muda de mês: a data acompanha
	av, _ := a.postIncome(c, house, map[string]any{"repeats": false, "dateRule": nil, "expectedDate": "2026-10-20", "description": "Freela"})
	r = a.do("PATCH", base+"/incomes/"+av.ID, map[string]any{"competenceMonth": "2026-11-01"}, c)
	upd = incT{}
	r.json(&upd)
	if r.Code != 200 || upd.CompetenceMonth != "2026-11-01" || upd.ExpectedDate != "2026-11-20" {
		t.Errorf("mover avulsa de mês: %d %s", r.Code, r.Body)
	}
	// em lote não se muda mês nem data digitada
	assertField(t, a.do("PATCH", base+"/incomes/"+nov.ID+"?scope=following", map[string]any{"competenceMonth": "2027-05-01"}, c), 400, "competenceMonth")
	assertField(t, a.do("PATCH", base+"/incomes/"+nov.ID+"?scope=following", map[string]any{"expectedDate": "2026-11-10"}, c), 400, "expectedDate")
	if r := a.do("PATCH", base+"/incomes/"+nov.ID+"?scope=todos", map[string]any{"notes": "x"}, c); r.Code != 400 {
		t.Errorf("escopo inválido: %d", r.Code)
	}

	// este e os seguintes a partir de dezembro: descrição, regra (2º dia útil), valor e descontos
	dez := a.incomeNamed(c, house, "2026-12-01", "Salário Ana")
	r = a.do("PATCH", base+"/incomes/"+dez.ID+"?scope=following", map[string]any{
		"description": "Salário novo", "dateRule": ruleBody("nth_business_day", 2, ""), "grossAmountCents": 600000,
		"deductions": []dedT{{"inss", "INSS", 55000}, {"irrf", "IRRF", 5000}},
	}, c)
	if r.Code != 200 {
		t.Fatalf("em lote: %d %s", r.Code, r.Body)
	}
	for m, date := range map[string]string{"2026-12-01": "2026-12-02", "2027-01-01": "2027-01-05", "2027-02-01": "2027-02-02"} {
		x := a.incomeNamed(c, house, m, "Salário novo")
		if x.ExpectedDate != date || x.GrossAmountCents != 600000 || x.NetAmountCents != 540000 || len(x.Deductions) != 2 || x.DateRule.Rule != "nth_business_day" {
			t.Errorf("%s: %+v", m, x)
		}
	}
	// novembro (antes do corte) fica como estava; o molde mudou; meses gerados depois já nascem novos
	if x := a.incomeNamed(c, house, "2026-11-01", "Salário Ana"); x.GrossAmountCents != 500000 || x.ExpectedDate != "2026-11-30" {
		t.Errorf("novembro mudou: %+v", x)
	}
	s := a.sourcesOf(c, house)[0]
	if s.Name != "Salário novo" || s.GrossAmountCents != 600000 || s.DateRule.Rule != "nth_business_day" || len(s.Deductions) != 2 {
		t.Errorf("molde: %+v", s)
	}
	if x := a.incomeNamed(c, house, "2028-03-01", "Salário novo"); x.GrossAmountCents != 600000 || x.ExpectedDate != "2028-03-02" {
		t.Errorf("mês gerado depois: %+v", x)
	}
	// descontos acima do novo bruto: 400 e nada muda
	assertField(t, a.do("PATCH", base+"/incomes/"+dez.ID+"?scope=following", map[string]any{"grossAmountCents": 50000}, c), 400, "grossAmountCents")
	if x := a.incomeNamed(c, house, "2027-01-01", "Salário novo"); x.GrossAmountCents != 600000 {
		t.Errorf("edição inválida alterou dados: %+v", x)
	}
}

func TestEditarEmLoteNaoMudaRecebidos(t *testing.T) {
	a, c, house, _, _ := serie(t)
	base := "/api/households/" + house
	a.postIncome(c, house, nil) // 2º dia útil: outubro recebido, novembro em diante a receber
	oct := a.incomeNamed(c, house, "2026-10-01", "Salário Ana")
	r := a.do("PATCH", base+"/incomes/"+oct.ID+"?scope=following", map[string]any{"grossAmountCents": 700000, "description": "Reajuste"}, c)
	if r.Code != 200 {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	if x := a.incomeNamed(c, house, "2026-10-01", "Salário Ana"); x.GrossAmountCents != 500000 {
		t.Errorf("recebido não muda em lote: %+v", x)
	}
	if x := a.incomeNamed(c, house, "2026-11-01", "Reajuste"); x.GrossAmountCents != 700000 {
		t.Errorf("novembro deveria mudar: %+v", x)
	}
	// "só este mês" num recebido continua permitido (corrigir um valor errado)
	if r := a.do("PATCH", base+"/incomes/"+oct.ID, map[string]any{"grossAmountCents": 510000}, c); r.Code != 200 {
		t.Errorf("corrigir o recebido: %d %s", r.Code, r.Body)
	}
	// reaplicar o molde (PATCH da fonte com applyFrom) também respeita os recebidos
	src := a.sourcesOf(c, house)[0]
	a.do("PATCH", base+"/income-sources/"+src.ID+"?applyFrom=2026-10-01", map[string]any{"grossAmountCents": 800000}, c)
	if x := a.incomeNamed(c, house, "2026-10-01", "Salário Ana"); x.GrossAmountCents != 510000 {
		t.Errorf("reaplicação mexeu no recebido: %+v", x)
	}
	if x := a.incomeNamed(c, house, "2026-11-01", "Reajuste"); x.GrossAmountCents != 800000 {
		t.Errorf("reaplicação deveria mudar novembro: %+v", x)
	}
}

func TestPreviaDeDatasEEstimativaDeImpostos(t *testing.T) {
	a, c, house, _, _ := serie(t)
	base := "/api/households/" + house
	var prev []struct {
		Month        string `json:"month"`
		ExpectedDate string `json:"expectedDate"`
		BusinessDays int    `json:"businessDays"`
	}
	r := a.do("GET", base+"/income-dates?month=2026-10-01&rule=nth_business_day&n=2&count=3", nil, c)
	r.json(&prev)
	if r.Code != 200 || len(prev) != 3 || prev[0].ExpectedDate != "2026-10-02" || prev[1].ExpectedDate != "2026-11-04" ||
		prev[2].ExpectedDate != "2026-12-02" || prev[0].BusinessDays != 21 || prev[1].BusinessDays != 19 || prev[2].BusinessDays != 22 {
		t.Fatalf("prévia: %d %s", r.Code, r.Body)
	}
	prev = nil
	a.do("GET", base+"/income-dates?month=2026-11-15&rule=day_of_month&n=28&weekendAdjust=backward", nil, c).json(&prev)
	if len(prev) != 3 || prev[0].Month != "2026-11-01" || prev[0].ExpectedDate != "2026-11-27" {
		t.Errorf("prévia com ajuste: %+v", prev)
	}
	assertField(t, a.do("GET", base+"/income-dates?month=2026-10-01&rule=nth_business_day&n=40", nil, c), 400, "dateRule.n")
	assertField(t, a.do("GET", base+"/income-dates?month=2026-10-01&rule=nth_business_day&n=2&count=99", nil, c), 400, "count")
	if r := a.do("GET", base+"/income-dates?month=2026-10-01&rule=semanal&n=2", nil, c); r.Code != 400 {
		t.Errorf("regra inválida: %d", r.Code)
	}

	var est struct {
		InssCents   int64    `json:"inssCents"`
		IrrfCents   int64    `json:"irrfCents"`
		TableYear   int      `json:"tableYear"`
		Sources     []string `json:"sources"`
		CheckedOn   string   `json:"checkedOn"`
		Approximate bool     `json:"approximate"`
	}
	r = a.do("GET", base+"/tax/estimate?month=2026-10-01&grossCents=600000", nil, c)
	r.json(&est)
	if r.Code != 200 || est.InssCents != 64151 || est.IrrfCents != 38510 || est.TableYear != 2026 || !est.Approximate || len(est.Sources) < 3 || est.CheckedOn == "" {
		t.Fatalf("estimativa: %d %s", r.Code, r.Body)
	}
	r = a.do("GET", base+"/tax/estimate?month=2031-03-01&grossCents=600000&dependents=2", nil, c)
	est.TableYear = 0
	r.json(&est)
	if r.Code != 200 || est.TableYear != 2026 || est.IrrfCents != 28083 {
		t.Errorf("ano sem tabela usa a mais recente: %d %s", r.Code, r.Body)
	}
	assertField(t, a.do("GET", base+"/tax/estimate?month=2026-10-01&grossCents=0", nil, c), 400, "grossCents")
	assertField(t, a.do("GET", base+"/tax/estimate?month=2026-10-01&grossCents=1000&dependents=99", nil, c), 400, "dependents")
}

func TestReceitasV2IsolamentoEPapeis(t *testing.T) {
	a, cA, houseA, _, _ := serie(t)
	baseA := "/api/households/" + houseA
	inc, _ := a.postIncome(cA, houseA, map[string]any{"dateRule": ruleBody("day_of_month", 28, "")})
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")
	baseB := "/api/households/" + houseB
	// Beto, com ids da casa A na URL da casa B, não lê nem altera nada (404)
	for name, r := range map[string]resp{
		"editar":    a.do("PATCH", baseB+"/incomes/"+inc.ID+"?scope=following", map[string]any{"grossAmountCents": 1}, cB),
		"excluir":   a.do("DELETE", baseB+"/incomes/"+inc.ID+"?scope=following", nil, cB),
		"restaurar": a.do("POST", baseB+"/incomes/"+inc.ID+"/restore?scope=following", nil, cB),
		"não caiu":  a.do("DELETE", baseB+"/incomes/"+inc.ID+"/receive", nil, cB),
		"caiu":      a.do("POST", baseB+"/incomes/"+inc.ID+"/receive", nil, cB),
	} {
		if r.Code != http.StatusNotFound {
			t.Errorf("%s: %d (quer 404)", name, r.Code)
		}
	}
	// a casa B não enxerga as receitas da A e a prévia/impostos funcionam na própria casa
	if got := a.incomesOf(cB, houseB, "2026-10-01"); len(got) != 0 {
		t.Errorf("casa B viu receitas da A: %+v", got)
	}
	if got := a.incomeNamed(cA, houseA, "2026-10-01", "Salário Ana"); got.Held || got.GrossAmountCents != 500000 {
		t.Errorf("a receita da casa A mudou: %+v", got)
	}
	// viewer lê a prévia e a estimativa, mas não escreve nada
	cC, _ := a.register("Carla", "carla@x.com", "Casa C")
	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'viewer')", houseA, a.uid("carla@x.com"))
	if r := a.do("GET", baseA+"/income-dates?month=2026-10-01&rule=last_business_day", nil, cC); r.Code != 200 {
		t.Errorf("viewer lendo a prévia: %d", r.Code)
	}
	if r := a.do("GET", baseA+"/tax/estimate?month=2026-10-01&grossCents=300000", nil, cC); r.Code != 200 {
		t.Errorf("viewer lendo a estimativa: %d", r.Code)
	}
	for name, r := range map[string]resp{
		"criar":     a.do("POST", baseA+"/incomes", map[string]any{"userId": a.uid("carla@x.com"), "kind": "other", "description": "x", "competenceMonth": "2026-10-01", "grossAmountCents": 100, "expectedDate": "2026-10-20"}, cC),
		"excluir":   a.do("DELETE", baseA+"/incomes/"+inc.ID+"?scope=following", nil, cC),
		"restaurar": a.do("POST", baseA+"/incomes/"+inc.ID+"/restore", nil, cC),
		"não caiu":  a.do("DELETE", baseA+"/incomes/"+inc.ID+"/receive", nil, cC),
	} {
		if r.Code != http.StatusForbidden {
			t.Errorf("viewer %s: %d (quer 403)", name, r.Code)
		}
	}
}
