package income

import (
	"context"
	"testing"
	"time"

	"github.com/PedroLucasSinuso/prumia/api/internal/calendar"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

func d(y int, m time.Month, day int) caldate.Date { return caldate.New(y, m, day) }

func TestNetEhCalculadoDoBrutoMenosDescontos(t *testing.T) {
	cases := []struct {
		name  string
		gross int64
		ds    []Deduction
		want  int64
	}{
		{"sem descontos", 500000, nil, 500000},
		{"salário com INSS, IRRF, plano e coparticipação", 800000, []Deduction{
			{Kind: "inss", AmountCents: 90800}, {Kind: "irrf", AmountCents: 61200},
			{Kind: "health_plan", AmountCents: 35000}, {Kind: "health_copay", AmountCents: 4590},
		}, 608410},
		{"descontos que consomem tudo", 10000, []Deduction{{Kind: "other", AmountCents: 10000}}, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Net(money.Cents(c.gross), c.ds); int64(got) != c.want {
				t.Errorf("líquido %d, quer %d", got, c.want)
			}
		})
	}
}

func TestCheckDeductions(t *testing.T) {
	ok := Deduction{Kind: "inss", Name: " INSS ", AmountCents: 100}
	cases := []struct {
		name   string
		gross  int64
		ds     []Deduction
		fields []string // campos com erro esperados
	}{
		{"válido", 1000, []Deduction{ok}, nil},
		{"soma igual ao bruto é aceita", 100, []Deduction{ok}, nil},
		{"soma acima do bruto", 150, []Deduction{ok, ok}, []string{"deductions"}},
		{"tipo inválido", 1000, []Deduction{{Kind: "iptu", Name: "x", AmountCents: 1}}, []string{"deductions[0].kind"}},
		{"nome vazio", 1000, []Deduction{{Kind: "other", Name: "  ", AmountCents: 1}}, []string{"deductions[0].name"}},
		{"valor zero", 1000, []Deduction{{Kind: "other", Name: "x", AmountCents: 0}}, []string{"deductions[0].amountCents"}},
		{"valor negativo", 1000, []Deduction{{Kind: "other", Name: "x", AmountCents: -5}}, []string{"deductions[0].amountCents"}},
		{"valor absurdo não estoura a soma", 1000, []Deduction{{Kind: "other", Name: "x", AmountCents: 1 << 62}}, []string{"deductions[0].amountCents"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var v validation.Collector
			out := CheckDeductions(money.Cents(c.gross), c.ds, &v)
			err := v.Err()
			if len(c.fields) == 0 {
				if err != nil {
					t.Fatalf("erro inesperado: %v", err)
				}
				if out[0].Name != "INSS" && c.name == "válido" {
					t.Errorf("nome deveria ser aparado: %q", out[0].Name)
				}
				return
			}
			ve, _ := err.(*validation.Error)
			if ve == nil {
				t.Fatal("esperava erro de validação")
			}
			for _, f := range c.fields {
				if _, has := ve.Fields[f]; !has {
					t.Errorf("faltou erro no campo %s: %v", f, ve.Fields)
				}
			}
		})
	}
}

func TestMuitosDescontosRecusados(t *testing.T) {
	var v validation.Collector
	CheckDeductions(1_000_000, make([]Deduction, maxDeductions+1), &v)
	if v.Err() == nil {
		t.Error("deveria recusar descontos demais")
	}
}

func TestCarteiraDerivadaDoTipo(t *testing.T) {
	free, ben := WalletFree, WalletBenefit
	cases := []struct {
		kind   string
		wallet *string
		want   string
		bad    string // campo com erro
	}{
		{KindSalary, nil, WalletFree, ""},
		{KindBenefit, nil, WalletBenefit, ""},
		{KindOther, &free, WalletFree, ""},
		{KindBenefit, &ben, WalletBenefit, ""},
		{KindBenefit, &free, WalletBenefit, "wallet"},
		{KindSalary, &ben, WalletFree, "wallet"},
		{"bolsa", nil, "", "kind"},
	}
	for _, c := range cases {
		var v validation.Collector
		got := ResolveWallet(c.kind, c.wallet, &v)
		if got != c.want {
			t.Errorf("%s: carteira %q, quer %q", c.kind, got, c.want)
		}
		ve, _ := v.Err().(*validation.Error)
		if (c.bad == "") != (ve == nil) || (ve != nil && ve.Fields[c.bad] == "") {
			t.Errorf("%s/%v: erro %v, quer campo %q", c.kind, c.wallet, v.Err(), c.bad)
		}
	}
}

func TestPrevisaoComDia31TravaEmMesCurto(t *testing.T) {
	// ajuste none: a data é exatamente o dia N (travado no último dia do mês curto), como era antes das regras de dia útil
	rule := DateRule{Rule: RuleDayOfMonth, N: 31, Adjust: calendar.None}
	got := GenerateOccurrences(d(2027, 1, 1), d(2027, 5, 1), rule, calendar.NoHolidays)
	want := []string{"2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"}
	if len(got) != len(want) {
		t.Fatalf("%d meses, quer %d", len(got), len(want))
	}
	for i, w := range want {
		if got[i].ExpectedDate.String() != w {
			t.Errorf("mês %d: %s, quer %s", i, got[i].ExpectedDate, w)
		}
		if !got[i].Month.IsStartOfMonth() {
			t.Errorf("competência deve ser dia 1: %s", got[i].Month)
		}
	}
	// ano bissexto
	leap := DateRule{Rule: RuleDayOfMonth, N: 30, Adjust: calendar.None}
	if f := GenerateOccurrences(d(2028, 2, 1), d(2028, 2, 1), leap, calendar.NoHolidays); f[0].ExpectedDate.String() != "2028-02-29" {
		t.Errorf("fevereiro bissexto: %s", f[0].ExpectedDate)
	}
	// virada de ano e intervalo vazio
	five := DateRule{Rule: RuleDayOfMonth, N: 5, Adjust: calendar.None}
	if f := GenerateOccurrences(d(2026, 11, 1), d(2027, 2, 1), five, calendar.NoHolidays); len(f) != 4 || f[2].Month.String() != "2027-01-01" {
		t.Errorf("virada de ano: %+v", f)
	}
	if f := GenerateOccurrences(d(2026, 5, 1), d(2026, 4, 1), five, calendar.NoHolidays); len(f) != 0 {
		t.Errorf("intervalo invertido deveria ser vazio: %+v", f)
	}
}

// Feriados nacionais de 2026 (lista real da BrasilAPI) para os testes das regras de data.
func holidays2026(day caldate.Date) bool {
	return calendar.New("off").Func(context.Background())(day)
}

// As três regras e os três ajustes, em meses reais de 2026 (nov/2026: dia 2 é feriado e dia 28 é sábado).
func TestRegrasDeData2026(t *testing.T) {
	h := holidays2026
	cases := []struct {
		name  string
		rule  DateRule
		month caldate.Date
		want  string
	}{
		{"2º dia útil de outubro", DateRule{Rule: RuleNthBusinessDay, N: 2}, d(2026, 10, 1), "2026-10-02"},
		{"5º dia útil de outubro (12/10 é feriado, mas vem depois)", DateRule{Rule: RuleNthBusinessDay, N: 5}, d(2026, 10, 1), "2026-10-07"},
		{"2º dia útil de novembro (feriado em 2/11)", DateRule{Rule: RuleNthBusinessDay, N: 2}, d(2026, 11, 1), "2026-11-04"},
		{"5º dia útil de novembro", DateRule{Rule: RuleNthBusinessDay, N: 5}, d(2026, 11, 1), "2026-11-09"},
		{"último dia útil de outubro", DateRule{Rule: RuleLastBusiness}, d(2026, 10, 1), "2026-10-30"},
		{"último dia útil de fevereiro (Carnaval não atrapalha)", DateRule{Rule: RuleLastBusiness}, d(2026, 2, 1), "2026-02-27"},
		{"dia 28 em outubro (quarta)", DateRule{Rule: RuleDayOfMonth, N: 28, Adjust: calendar.Forward}, d(2026, 10, 1), "2026-10-28"},
		{"dia 28 em novembro (sábado) para a frente", DateRule{Rule: RuleDayOfMonth, N: 28, Adjust: calendar.Forward}, d(2026, 11, 1), "2026-11-30"},
		{"dia 28 em novembro (sábado) para trás", DateRule{Rule: RuleDayOfMonth, N: 28, Adjust: calendar.Backward}, d(2026, 11, 1), "2026-11-27"},
		{"dia 28 em novembro (sábado) mantido", DateRule{Rule: RuleDayOfMonth, N: 28, Adjust: calendar.None}, d(2026, 11, 1), "2026-11-28"},
		{"dia 15 de fevereiro: domingo + Carnaval", DateRule{Rule: RuleDayOfMonth, N: 15, Adjust: calendar.Forward}, d(2026, 2, 1), "2026-02-18"},
		{"dia 31 em fevereiro trava no 28 (sábado) e vai para segunda", DateRule{Rule: RuleDayOfMonth, N: 31, Adjust: calendar.Forward}, d(2026, 2, 1), "2026-03-02"},
		// Datas usadas pelos testes da prévia "Próximas datas" no front (web/src/lib/incomeDates.test.ts): se mudarem aqui, mude lá.
		{"5º dia útil de dezembro", DateRule{Rule: RuleNthBusinessDay, N: 5}, d(2026, 12, 1), "2026-12-07"},
		{"5º dia útil de janeiro (1º é feriado)", DateRule{Rule: RuleNthBusinessDay, N: 5}, d(2027, 1, 1), "2027-01-08"},
		{"último dia útil de dezembro", DateRule{Rule: RuleLastBusiness}, d(2026, 12, 1), "2026-12-31"},
		{"último dia útil de janeiro", DateRule{Rule: RuleLastBusiness}, d(2027, 1, 1), "2027-01-29"},
		{"2º dia útil de dezembro", DateRule{Rule: RuleNthBusinessDay, N: 2}, d(2026, 12, 1), "2026-12-02"},
		{"2º dia útil de janeiro (1º é feriado)", DateRule{Rule: RuleNthBusinessDay, N: 2}, d(2027, 1, 1), "2027-01-05"},
		{"dia 31 em maio (domingo) para a frente", DateRule{Rule: RuleDayOfMonth, N: 31, Adjust: calendar.Forward}, d(2026, 5, 1), "2026-06-01"},
		{"dia 31 em fevereiro de 2027 (domingo) mantido", DateRule{Rule: RuleDayOfMonth, N: 31, Adjust: calendar.None}, d(2027, 2, 1), "2027-02-28"},
	}
	for _, c := range cases {
		if got := c.rule.ExpectedDate(c.month, h); got.String() != c.want {
			t.Errorf("%s: %s, quer %s", c.name, got, c.want)
		}
	}
}

func TestCheckDeRegraDeData(t *testing.T) {
	cases := []struct {
		name string
		rule DateRule
		bad  string // campo com erro ("" = válida)
	}{
		{"dia 28", DateRule{Rule: RuleDayOfMonth, N: 28}, ""},
		{"dia 0", DateRule{Rule: RuleDayOfMonth, N: 0}, "r.n"},
		{"dia 32", DateRule{Rule: RuleDayOfMonth, N: 32}, "r.n"},
		{"23º dia útil", DateRule{Rule: RuleNthBusinessDay, N: 23}, ""},
		{"24º dia útil", DateRule{Rule: RuleNthBusinessDay, N: 24}, "r.n"},
		{"último dia útil ignora o N", DateRule{Rule: RuleLastBusiness, N: 99}, ""},
		{"regra desconhecida", DateRule{Rule: "semanal", N: 1}, "r.rule"},
		{"ajuste desconhecido", DateRule{Rule: RuleDayOfMonth, N: 1, Adjust: "sempre"}, "r.weekendAdjust"},
	}
	for _, c := range cases {
		var v validation.Collector
		got := c.rule.Check("r", &v)
		ve, _ := v.Err().(*validation.Error)
		if (c.bad == "") != (ve == nil) || (ve != nil && ve.Fields[c.bad] == "") {
			t.Errorf("%s: erro %v, quer campo %q", c.name, v.Err(), c.bad)
		}
		if c.bad == "" && got.Adjust != calendar.Forward && c.rule.Adjust == "" {
			t.Errorf("%s: ajuste vazio deveria virar forward, veio %q", c.name, got.Adjust)
		}
	}
	var v validation.Collector
	if r := (DateRule{Rule: RuleLastBusiness, N: 99}).Check("r", &v); r.N != 0 || r.nPtr() != nil {
		t.Errorf("último dia útil não tem N: %+v", r)
	}
}

func TestValorPorUnidade(t *testing.T) {
	cents := func(c int64) *money.Cents { v := money.Cents(c); return &v }
	i := func(n int) *int { return &n }
	s := func(x string) *string { return &x }
	// R$ 65,00 por dia trabalhado x 21 dias úteis
	var v validation.Collector
	a := AmountInput{Mode: AmountPerUnit, UnitPriceCents: cents(6500), UnitLabel: s(" dia trabalhado ")}.Resolve(21, &v)
	if v.Err() != nil || a.GrossCents != 136500 || *a.Quantity != 21 || *a.UnitLabel != "dia trabalhado" || a.Mode != AmountPerUnit {
		t.Errorf("padrão (dias úteis): %+v %v", a, v.Err())
	}
	// quantidade ajustada pela pessoa
	v = validation.Collector{}
	a = AmountInput{Mode: AmountPerUnit, UnitPriceCents: cents(6500), Quantity: i(19)}.Resolve(21, &v)
	if v.Err() != nil || a.GrossCents != 123500 || *a.UnitLabel != DefaultUnitLabel {
		t.Errorf("quantidade 19: %+v %v", a, v.Err())
	}
	// valor fixo
	v = validation.Collector{}
	a = AmountInput{GrossCents: cents(800000)}.Resolve(21, &v)
	if v.Err() != nil || a.Mode != AmountFixed || a.GrossCents != 800000 || a.Quantity != nil || a.UnitPriceCents != nil {
		t.Errorf("fixo: %+v %v", a, v.Err())
	}
	// erros por campo
	for name, c := range map[string]struct {
		in  AmountInput
		bad string
	}{
		"fixo sem valor":      {AmountInput{}, "grossAmountCents"},
		"fixo zero":           {AmountInput{GrossCents: cents(0)}, "grossAmountCents"},
		"unidade sem preço":   {AmountInput{Mode: AmountPerUnit}, "unitPriceCents"},
		"quantidade zero":     {AmountInput{Mode: AmountPerUnit, UnitPriceCents: cents(100), Quantity: i(0)}, "quantity"},
		"quantidade enorme":   {AmountInput{Mode: AmountPerUnit, UnitPriceCents: cents(100), Quantity: i(1000)}, "quantity"},
		"rótulo vazio":        {AmountInput{Mode: AmountPerUnit, UnitPriceCents: cents(100), UnitLabel: s("  ")}, "unitLabel"},
		"total acima do teto": {AmountInput{Mode: AmountPerUnit, UnitPriceCents: cents(int64(MaxAmount)), Quantity: i(2)}, "grossAmountCents"},
		"modo desconhecido":   {AmountInput{Mode: "hora"}, "amountMode"},
	} {
		var v validation.Collector
		c.in.Resolve(21, &v)
		ve, _ := v.Err().(*validation.Error)
		if ve == nil || ve.Fields[c.bad] == "" {
			t.Errorf("%s: erro %v, quer campo %q", name, v.Err(), c.bad)
		}
	}
}

// O estado "recebida" é derivado: a data chegou e ninguém disse "não caiu" (ou foi marcada antes da data).
func TestEstadoRecebidaDerivado(t *testing.T) {
	today := d(2026, 10, 18)
	held := time.Now()
	cases := []struct {
		name string
		in   Income
		want bool
	}{
		{"data futura", Income{ExpectedDate: d(2026, 10, 28)}, false},
		{"data de hoje", Income{ExpectedDate: today}, true},
		{"data passada", Income{ExpectedDate: d(2026, 10, 5)}, true},
		{"data passada mas não caiu", Income{ExpectedDate: d(2026, 10, 5), HeldAt: &held}, false},
		{"futura marcada como recebida", Income{ExpectedDate: d(2026, 10, 28), ReceivedAt: d(2026, 10, 17)}, true},
		{"marcada recebida mas depois não caiu", Income{ExpectedDate: d(2026, 10, 28), ReceivedAt: d(2026, 10, 17), HeldAt: &held}, false},
	}
	for _, c := range cases {
		if got := c.in.IsReceived(today); got != c.want {
			t.Errorf("%s: recebida = %v", c.name, got)
		}
	}
	// no recebimento automático, o dia que entrou é a data esperada; na marcação antecipada, o dia marcado
	if got := (Income{ExpectedDate: d(2026, 10, 5)}).ReceivedOn(); got.String() != "2026-10-05" {
		t.Errorf("recebimento automático: %s", got)
	}
	if got := (Income{ExpectedDate: d(2026, 10, 28), ReceivedAt: d(2026, 10, 17)}).ReceivedOn(); got.String() != "2026-10-17" {
		t.Errorf("recebimento antecipado: %s", got)
	}
}

func TestHorizonte(t *testing.T) {
	today := d(2026, 10, 18)
	cases := []struct {
		name       string
		start, end caldate.Date
		requested  caldate.Date
		want       string
	}{
		{"padrão: 12 meses a partir de hoje", d(2026, 1, 1), caldate.Date{}, caldate.Date{}, "2027-10-01"},
		{"início no futuro conta a partir do início", d(2027, 3, 1), caldate.Date{}, caldate.Date{}, "2028-03-01"},
		{"fim antes do horizonte limita", d(2026, 1, 1), d(2027, 2, 1), caldate.Date{}, "2027-02-01"},
		{"mês pedido além do padrão estende", d(2026, 1, 1), caldate.Date{}, d(2029, 5, 1), "2029-05-01"},
		{"mês pedido respeita o fim", d(2026, 1, 1), d(2028, 1, 1), d(2030, 5, 1), "2028-01-01"},
		{"mês pedido tem teto de 60 meses", d(2026, 1, 1), caldate.Date{}, d(2060, 1, 1), "2031-10-01"},
		{"mês pedido menor que o padrão não encolhe", d(2026, 1, 1), caldate.Date{}, d(2026, 12, 1), "2027-10-01"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := TargetThrough(c.start, c.end, today, c.requested); got.String() != c.want {
				t.Errorf("horizonte %s, quer %s", got, c.want)
			}
		})
	}
}

func TestCheckSalaryTaxes(t *testing.T) {
	ds := []Deduction{{Kind: "health_plan", Name: "Plano", AmountCents: 100}, {Kind: "inss", Name: "INSS", AmountCents: 100}}
	var v validation.Collector
	CheckSalaryTaxes(KindSalary, ds, &v)
	if v.Err() != nil {
		t.Fatalf("salário aceita INSS: %v", v)
	}
	for _, k := range []string{KindBenefit, KindOther} {
		var v validation.Collector
		CheckSalaryTaxes(k, ds, &v)
		if v.Err() == nil {
			t.Fatalf("%s não pode ter INSS", k)
		}
	}
}
