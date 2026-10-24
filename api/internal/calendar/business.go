// Package calendar responde "este dia é útil?" para o Brasil: sábado, domingo e feriados nacionais NÃO são úteis.
// É a fonte única de verdade para datas de recebimento (receitas) e para sugerir quantidades ("dias úteis do mês").
//
// As funções deste arquivo são PURAS: recebem o conjunto de feriados como função e não fazem rede. A rede (BrasilAPI) e o
// cálculo offline ficam em holidays.go e fallback.go.
package calendar

import (
	"time"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
)

// HolidayFunc diz se a data é feriado nacional. Em Go funções são valores comuns: passar uma função no lugar de uma
// interface evita criar um tipo só para os testes (em PHP seria um callable).
type HolidayFunc func(caldate.Date) bool

// NoHolidays é o conjunto vazio (só fim de semana vale como não útil).
func NoHolidays(caldate.Date) bool { return false }

// Adjust diz o que fazer quando uma data cai em dia não útil.
type Adjust string

const (
	Forward  Adjust = "forward"  // vai para o próximo dia útil (padrão: o dinheiro nunca cai em fim de semana ou feriado)
	Backward Adjust = "backward" // volta para o dia útil anterior
	None     Adjust = "none"     // mantém a data como está
)

// ValidAdjust confere o valor vindo de fora (API ou banco).
func ValidAdjust(a Adjust) bool { return a == Forward || a == Backward || a == None }

// IsBusinessDay: segunda a sexta que não seja feriado nacional.
func IsBusinessDay(d caldate.Date, h HolidayFunc) bool {
	wd := d.Time().Weekday()
	if wd == time.Saturday || wd == time.Sunday {
		return false
	}
	return h == nil || !h(d)
}

// Roll leva a data ao dia útil conforme o ajuste. Se já é útil (ou o ajuste é None), devolve a mesma data.
// Com Forward pode atravessar a virada do mês (o dia 31 que cai no sábado vira segunda, dia 2 do mês seguinte).
func Roll(d caldate.Date, adj Adjust, h HolidayFunc) caldate.Date {
	step := 0
	switch adj {
	case Forward:
		step = 1
	case Backward:
		step = -1
	default:
		return d
	}
	// Sempre há um dia útil a poucos dias de qualquer data; o limite do laço é só um cinto de segurança.
	for i := 0; i < 366 && !IsBusinessDay(d, h); i++ {
		d = d.AddDays(step)
	}
	return d
}

// NthBusinessDay devolve o n-ésimo dia útil do mês de `month` (n >= 1). Se o mês tem menos de n dias úteis, devolve o
// último dia útil do mês (um "23º dia útil" nunca foge do mês).
func NthBusinessDay(month caldate.Date, n int, h HolidayFunc) caldate.Date {
	month = month.StartOfMonth()
	count := 0
	var last caldate.Date
	for d := month; d.Month() == month.Month(); d = d.AddDays(1) {
		if !IsBusinessDay(d, h) {
			continue
		}
		count++
		last = d
		if count == n {
			return d
		}
	}
	return last
}

// LastBusinessDay é o último dia útil do mês.
func LastBusinessDay(month caldate.Date, h HolidayFunc) caldate.Date {
	month = month.StartOfMonth()
	for d := month.AddMonths(1).AddDays(-1); !d.Before(month); d = d.AddDays(-1) {
		if IsBusinessDay(d, h) {
			return d
		}
	}
	return month // inalcançável na prática (todo mês tem dia útil)
}

// BusinessDaysInMonth conta os dias úteis do mês.
func BusinessDaysInMonth(month caldate.Date, h HolidayFunc) int {
	month = month.StartOfMonth()
	n := 0
	for d := month; d.Month() == month.Month(); d = d.AddDays(1) {
		if IsBusinessDay(d, h) {
			n++
		}
	}
	return n
}
