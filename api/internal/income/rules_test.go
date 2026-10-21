package income

import (
	"testing"
	"time"

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
	got := GenerateOccurrences(d(2027, 1, 1), d(2027, 5, 1), 31)
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
	if f := GenerateOccurrences(d(2028, 2, 1), d(2028, 2, 1), 30); f[0].ExpectedDate.String() != "2028-02-29" {
		t.Errorf("fevereiro bissexto: %s", f[0].ExpectedDate)
	}
	// virada de ano e intervalo vazio
	if f := GenerateOccurrences(d(2026, 11, 1), d(2027, 2, 1), 5); len(f) != 4 || f[2].Month.String() != "2027-01-01" {
		t.Errorf("virada de ano: %+v", f)
	}
	if f := GenerateOccurrences(d(2026, 5, 1), d(2026, 4, 1), 5); len(f) != 0 {
		t.Errorf("intervalo invertido deveria ser vazio: %+v", f)
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
