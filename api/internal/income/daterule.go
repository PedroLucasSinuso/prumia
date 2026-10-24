package income

import (
	"fmt"

	"github.com/PedroLucasSinuso/prumia/api/internal/calendar"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// Regras de data: QUANDO a receita cai em cada mês. Nada aqui é específico de uma pessoa ou empresa: o salário no 2º dia
// útil, o VR no dia 28 e o aluguel no último dia útil são só configurações diferentes das mesmas três regras.
const (
	RuleDayOfMonth     = "day_of_month"      // dia N do mês (travado no último dia do mês curto)
	RuleNthBusinessDay = "nth_business_day"  // N-ésimo dia útil do mês
	RuleLastBusiness   = "last_business_day" // último dia útil do mês

	maxNthBusinessDay = 23 // nenhum mês tem mais que 23 dias úteis
)

// DateRule é a regra de data completa. N não se aplica ao último dia útil (fica 0).
type DateRule struct {
	Rule   string
	N      int
	Adjust calendar.Adjust
}

// DefaultAdjust é o ajuste de uma regra nova: o dinheiro não cai em fim de semana nem feriado, então vai para a frente.
const DefaultAdjust = calendar.Forward

// Check valida a regra e normaliza (ajuste vazio = padrão; N ignorado no último dia útil). Erros saem no campo `field`.
func (r DateRule) Check(field string, v *validation.Collector) DateRule {
	if r.Adjust == "" {
		r.Adjust = DefaultAdjust
	}
	if !calendar.ValidAdjust(r.Adjust) {
		v.Add(field+".weekendAdjust", "use forward, backward ou none")
	}
	switch r.Rule {
	case RuleDayOfMonth:
		if r.N < 1 || r.N > 31 {
			v.Add(field+".n", "informe um dia de 1 a 31")
		}
	case RuleNthBusinessDay:
		if r.N < 1 || r.N > maxNthBusinessDay {
			v.Add(field+".n", fmt.Sprintf("informe de 1 a %d", maxNthBusinessDay))
		}
	case RuleLastBusiness:
		r.N = 0
	default:
		v.Add(field+".rule", "use day_of_month, nth_business_day ou last_business_day")
	}
	return r
}

// ExpectedDate calcula a data de recebimento no mês de `month` (qualquer dia do mês; usa o dia 1).
// Só o "dia N do mês" precisa de ajuste: os dias úteis já caem em dia útil.
func (r DateRule) ExpectedDate(month caldate.Date, h calendar.HolidayFunc) caldate.Date {
	month = month.StartOfMonth()
	switch r.Rule {
	case RuleNthBusinessDay:
		return calendar.NthBusinessDay(month, r.N, h)
	case RuleLastBusiness:
		return calendar.LastBusinessDay(month, h)
	default:
		return calendar.Roll(month.WithDayClamped(r.N), r.Adjust, h)
	}
}

// ruleCols converte para as colunas do banco (N nulo no último dia útil).
func (r DateRule) nPtr() *int {
	if r.Rule == RuleLastBusiness {
		return nil
	}
	n := r.N
	return &n
}

func ruleFromCols(rule string, n *int, adjust string) DateRule {
	r := DateRule{Rule: rule, Adjust: calendar.Adjust(adjust)}
	if n != nil {
		r.N = *n
	}
	return r
}

// Occurrence é um lançamento mensal previsto, já calculado (ainda não gravado).
type Occurrence struct {
	Month        caldate.Date // competência (dia 1)
	ExpectedDate caldate.Date
}

// GenerateOccurrences devolve um lançamento por mês de from até through (ambos dia 1, inclusive), com a data de cada mês
// calculada pela regra.
func GenerateOccurrences(from, through caldate.Date, rule DateRule, h calendar.HolidayFunc) []Occurrence {
	var out []Occurrence
	for m := from; !m.After(through); m = m.AddMonths(1) {
		out = append(out, Occurrence{Month: m, ExpectedDate: rule.ExpectedDate(m, h)})
	}
	return out
}
