// Package series cuida das séries de despesas: compras parceladas (N parcelas fixas) e contas recorrentes
// (uma ocorrência por mês, estendida sob demanda). Cada parcela/ocorrência é uma linha comum de `invoices`.
//
// Este arquivo tem só as funções PURAS de geração (sem banco), para serem testadas em tabela.
// Regras completas: docs/developer-guide/series-generation.md.
package series

import (
	"errors"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
)

// Installment é uma parcela já calculada (ainda não gravada).
type Installment struct {
	Number     int // 1..N
	Amount     money.Cents
	DueDate    caldate.Date
	Competence caldate.Date // mês do vencimento
}

// GenerateInstallments calcula as N parcelas de uma compra.
//
//   - Valor: se perInstallment == 0, divide o total com money.Split (as N-1 primeiras iguais, a última leva o resto de
//     centavos). Se perInstallment > 0, TODAS as parcelas valem exatamente isso e o total não é redistribuído
//     (útil para parcelado com juros: a soma das parcelas pode diferir do total informado).
//   - Vencimento: mensal a partir de first. Cada data é calculada a partir da PRIMEIRA (first.AddMonths(i)), e não da
//     anterior, para a trava de fim de mês não se acumular: 31/jan -> 28/fev -> 31/mar (e não 28/mar).
//   - Competência: o mês do vencimento de cada parcela.
func GenerateInstallments(total money.Cents, count int, perInstallment money.Cents, first caldate.Date) ([]Installment, error) {
	if count < 1 {
		return nil, errors.New("series: número de parcelas deve ser >= 1")
	}
	if first.IsZero() {
		return nil, errors.New("series: informe o vencimento da 1ª parcela")
	}
	var amounts []money.Cents
	if perInstallment > 0 {
		amounts = make([]money.Cents, count)
		for i := range amounts {
			amounts[i] = perInstallment
		}
	} else {
		var err error
		if amounts, err = money.Split(total, count); err != nil {
			return nil, err
		}
	}
	out := make([]Installment, count)
	for i := range out {
		due := first.AddMonths(i)
		out[i] = Installment{Number: i + 1, Amount: amounts[i], DueDate: due, Competence: due.StartOfMonth()}
	}
	return out, nil
}

// Occurrence é uma ocorrência mensal de uma recorrência (ainda não gravada).
type Occurrence struct {
	Month   caldate.Date // competência e occurrence_month (dia 1)
	DueDate caldate.Date
}

// GenerateOccurrences devolve uma ocorrência por mês de from até through (ambos dia 1, inclusive).
// O vencimento é o dia `day` do mês, travado no último dia em mês curto (dia 31 em abril vira 30).
func GenerateOccurrences(from, through caldate.Date, day int) []Occurrence {
	var out []Occurrence
	for m := from; !m.After(through); m = m.AddMonths(1) {
		out = append(out, Occurrence{Month: m, DueDate: m.WithDayClamped(day)})
	}
	return out
}
