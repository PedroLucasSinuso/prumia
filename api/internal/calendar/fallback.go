package calendar

import (
	"time"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
)

// Easter calcula o domingo de Páscoa (algoritmo gregoriano de Meeus/Jones/Butcher). Só aritmética inteira.
func Easter(year int) caldate.Date {
	a := year % 19
	b := year / 100
	c := year % 100
	d := b / 4
	e := b % 4
	f := (b + 8) / 25
	g := (b - f + 1) / 3
	h := (19*a + b - d - g + 15) % 30
	i := c / 4
	k := c % 4
	l := (32 + 2*e + 2*i - h - k) % 7
	m := (a + 11*h + 22*l) / 451
	month := (h + l - 7*m + 114) / 31
	day := (h+l-7*m+114)%31 + 1
	return caldate.New(year, time.Month(month), day)
}

// Holiday é um feriado nacional com o nome.
type Holiday struct {
	Date caldate.Date
	Name string
}

// ComputedHolidays calcula os feriados nacionais do ano sem rede: os fixos mais a Páscoa e os móveis (Carnaval segunda e
// terça, Sexta-feira Santa, Corpus Christi). A Consciência Negra (20/11) é feriado nacional desde 2024 (Lei 14.759/2023).
// É o plano B quando a BrasilAPI cai ou está desligada (HOLIDAYS_URL=off). Não inclui feriados estaduais nem municipais.
func ComputedHolidays(year int) []Holiday {
	fixed := func(m time.Month, d int, name string) Holiday { return Holiday{caldate.New(year, m, d), name} }
	easter := Easter(year)
	out := []Holiday{
		fixed(time.January, 1, "Confraternização mundial"),
		{easter.AddDays(-48), "Carnaval"},
		{easter.AddDays(-47), "Carnaval"},
		{easter.AddDays(-2), "Sexta-feira Santa"},
		{easter, "Páscoa"},
		fixed(time.April, 21, "Tiradentes"),
		fixed(time.May, 1, "Dia do trabalho"),
		{easter.AddDays(60), "Corpus Christi"},
		fixed(time.September, 7, "Independência do Brasil"),
		fixed(time.October, 12, "Nossa Senhora Aparecida"),
		fixed(time.November, 2, "Finados"),
		fixed(time.November, 15, "Proclamação da República"),
	}
	if year >= 2024 {
		out = append(out, fixed(time.November, 20, "Dia da consciência negra"))
	}
	out = append(out, fixed(time.December, 25, "Natal"))
	return out
}
