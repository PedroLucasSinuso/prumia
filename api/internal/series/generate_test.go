package series

import (
	"testing"
	"time"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
)

func d(y int, m time.Month, day int) caldate.Date { return caldate.New(y, m, day) }

func TestGenerateInstallmentsDatas(t *testing.T) {
	cases := []struct {
		name  string
		first caldate.Date
		count int
		want  []string // vencimentos esperados (prefixo conferido)
	}{
		{"dia 31 de janeiro trava em fevereiro e volta ao 31", d(2026, 1, 31), 4, []string{"2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"}},
		{"ano bissexto: 31/jan vira 29/fev", d(2028, 1, 31), 3, []string{"2028-01-31", "2028-02-29", "2028-03-31"}},
		{"dia 30 de janeiro em ano comum", d(2026, 1, 30), 3, []string{"2026-01-30", "2026-02-28", "2026-03-30"}},
		{"virada de ano", d(2026, 11, 15), 4, []string{"2026-11-15", "2026-12-15", "2027-01-15", "2027-02-15"}},
		{"29 de fevereiro bissexto segue para 28 no ano comum", d(2028, 2, 29), 13, nil},
		{"agosto do notebook", d(2026, 8, 5), 6, []string{"2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05", "2026-12-05", "2027-01-05"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := GenerateInstallments(100000, c.count, 0, c.first)
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != c.count {
				t.Fatalf("%d parcelas, quer %d", len(got), c.count)
			}
			for i, w := range c.want {
				if got[i].DueDate.String() != w {
					t.Errorf("parcela %d vence %s, quer %s", i+1, got[i].DueDate, w)
				}
			}
			for i, p := range got {
				if p.Number != i+1 {
					t.Errorf("numeração: %d na posição %d", p.Number, i)
				}
				// competência = mês do vencimento, sempre dia 1
				if !p.Competence.IsStartOfMonth() || p.Competence.Month() != p.DueDate.Month() || p.Competence.Year() != p.DueDate.Year() {
					t.Errorf("competência %s não é o mês de %s", p.Competence, p.DueDate)
				}
			}
		})
	}
	// 29/fev/2028 + 12 meses = 28/fev/2029 (trava), e a parcela 13 não "deriva" para o dia 28 das seguintes
	got, _ := GenerateInstallments(100000, 14, 0, d(2028, 2, 29))
	if got[12].DueDate.String() != "2029-02-28" || got[11].DueDate.String() != "2029-01-29" {
		t.Errorf("29/fev: %s e %s", got[11].DueDate, got[12].DueDate)
	}
}

func TestGenerateInstallmentsValores(t *testing.T) {
	cases := []struct {
		name  string
		total money.Cents
		count int
		per   money.Cents
		want  []money.Cents // parcelas conferidas do início; a soma é conferida sempre
		sum   money.Cents
	}{
		{"divide exato: notebook 6x R$ 660", 396000, 6, 0, []money.Cents{66000, 66000, 66000, 66000, 66000, 66000}, 396000},
		{"resto na última: R$ 100 em 3x", 10000, 3, 0, []money.Cents{3333, 3333, 3334}, 10000},
		{"resto grande na última: 10 centavos em 3x", 10, 3, 0, []money.Cents{3, 3, 4}, 10},
		{"valor da parcela informado vale para todas, sem resto", 10000, 3, 3500, []money.Cents{3500, 3500, 3500}, 10500},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := GenerateInstallments(c.total, c.count, c.per, d(2026, 8, 5))
			if err != nil {
				t.Fatal(err)
			}
			var sum money.Cents
			for i, p := range got {
				sum += p.Amount
				if i < len(c.want) && p.Amount != c.want[i] {
					t.Errorf("parcela %d = %d, quer %d", i+1, p.Amount, c.want[i])
				}
			}
			if sum != c.sum {
				t.Errorf("soma = %d, quer %d", sum, c.sum)
			}
		})
	}
}

func TestGenerateInstallments120Parcelas(t *testing.T) {
	got, err := GenerateInstallments(1_234_567, 120, 0, d(2026, 1, 31))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 120 {
		t.Fatalf("%d parcelas", len(got))
	}
	var sum money.Cents
	for _, p := range got {
		sum += p.Amount
	}
	if sum != 1_234_567 {
		t.Errorf("soma = %d", sum)
	}
	// 120 meses depois de 31/jan/2026 é 31/jan/2036 (a parcela 120 é a de índice 119 => dez/2035)
	if last := got[119].DueDate.String(); last != "2035-12-31" {
		t.Errorf("última parcela vence %s", last)
	}
	// nenhum vencimento repetido nem fora de ordem
	for i := 1; i < len(got); i++ {
		if !got[i].DueDate.After(got[i-1].DueDate) {
			t.Fatalf("vencimentos fora de ordem na parcela %d", i+1)
		}
	}
}

func TestGenerateInstallmentsErros(t *testing.T) {
	if _, err := GenerateInstallments(100, 0, 0, d(2026, 1, 1)); err == nil {
		t.Error("0 parcelas deveria falhar")
	}
	if _, err := GenerateInstallments(100, 2, 0, caldate.Date{}); err == nil {
		t.Error("sem data deveria falhar")
	}
	if _, err := GenerateInstallments(0, 2, 0, d(2026, 1, 1)); err == nil {
		t.Error("total zero sem valor de parcela deveria falhar")
	}
}

func TestGenerateOccurrences(t *testing.T) {
	// dia 31 trava nos meses curtos; competência = mês; inclui as duas pontas
	got := GenerateOccurrences(d(2026, 1, 1), d(2026, 5, 1), 31)
	want := []string{"2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"}
	if len(got) != len(want) {
		t.Fatalf("%d ocorrências", len(got))
	}
	for i, w := range want {
		if got[i].DueDate.String() != w || got[i].Month.String() != got[i].DueDate.StartOfMonth().String() {
			t.Errorf("ocorrência %d: %+v, quer vencimento %s", i, got[i], w)
		}
	}
	// bissexto e virada de ano
	got = GenerateOccurrences(d(2027, 12, 1), d(2028, 2, 1), 30)
	if got[0].DueDate.String() != "2027-12-30" || got[1].DueDate.String() != "2028-01-30" || got[2].DueDate.String() != "2028-02-29" {
		t.Errorf("virada/bissexto: %+v", got)
	}
	// intervalo invertido = vazio
	if got := GenerateOccurrences(d(2026, 5, 1), d(2026, 1, 1), 5); len(got) != 0 {
		t.Errorf("invertido: %+v", got)
	}
}

func TestDefaultThrough(t *testing.T) {
	hoje := d(2026, 10, 18)
	cases := []struct {
		name string
		r    Recurrence
		want string
	}{
		{"início no passado: 12 meses a partir de hoje", Recurrence{StartMonth: d(2026, 1, 1)}, "2027-10-01"},
		{"início no futuro: 12 meses a partir do início", Recurrence{StartMonth: d(2027, 3, 1)}, "2028-03-01"},
		{"fim antes do horizonte limita", Recurrence{StartMonth: d(2026, 1, 1), EndMonth: d(2027, 2, 1)}, "2027-02-01"},
		{"fim depois do horizonte não estende", Recurrence{StartMonth: d(2026, 1, 1), EndMonth: d(2030, 1, 1)}, "2027-10-01"},
	}
	for _, c := range cases {
		if got := defaultThrough(c.r, hoje).String(); got != c.want {
			t.Errorf("%s: %s, quer %s", c.name, got, c.want)
		}
	}
}
