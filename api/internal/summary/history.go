package summary

import (
	"context"
	"sort"

	"github.com/google/uuid"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// Histórico por categoria (gráficos do resumo). Por competência, por categoria FOLHA: a soma da categoria principal é feita
// no cliente, igual ao resumo do mês.

const (
	DefaultHistoryMonths = 6
	MaxHistoryMonths     = 24
)

// Point é uma categoria num mês. Total segue a regra do resumo: pago (valor efetivo) + pendente (valor da invoice).
type Point struct {
	Month  caldate.Date
	Total  money.Cents
	Paid   money.Cents
	Series money.Cents // parte do total que é parcela ou conta fixa (compromissos)
}

type CategorySeries struct {
	CategoryID uuid.UUID
	Points     []Point // um por mês do intervalo, na ordem de History.Months
}

type History struct {
	Months []caldate.Date
	Series []CategorySeries
}

type historyRow struct {
	CategoryID uuid.UUID
	Month      caldate.Date
	Total      money.Cents
	Paid       money.Cents
	Series     money.Cents
}

// HistoryRange resolve o intervalo pedido: nil = padrão (os 6 meses até o mês atual; com só `to`, os 6 até ele; com só
// `from`, 6 a partir dele). Recusa dia ≠ 1, from > to e mais de 24 meses. Exportada porque o handler precisa do `to` para
// estender o horizonte das contas fixas antes da consulta.
//
// Em Go, ponteiro (*caldate.Date) é o jeito idiomático de dizer "opcional": nil = não veio (como null no PHP).
func (s *Service) HistoryRange(from, to *caldate.Date) (caldate.Date, caldate.Date, error) {
	var f, t caldate.Date
	switch {
	case from == nil && to == nil:
		t = s.today().StartOfMonth()
		f = t.AddMonths(-(DefaultHistoryMonths - 1))
	case from == nil:
		t = *to
		f = t.AddMonths(-(DefaultHistoryMonths - 1))
	case to == nil:
		f = *from
		t = f.AddMonths(DefaultHistoryMonths - 1)
	default:
		f, t = *from, *to
	}
	v := validation.Collector{}
	if f.IsZero() || !f.IsStartOfMonth() {
		v.Add("from", "informe o primeiro dia do mês (AAAA-MM-01)")
	}
	if t.IsZero() || !t.IsStartOfMonth() {
		v.Add("to", "informe o primeiro dia do mês (AAAA-MM-01)")
	}
	if err := v.Err(); err != nil {
		return f, t, err
	}
	if t.Before(f) {
		return f, t, validation.New("to", "o último mês não pode ser antes do primeiro")
	}
	if monthsBetween(f, t) > MaxHistoryMonths {
		return f, t, validation.New("from", "no máximo 24 meses por consulta")
	}
	return f, t, nil
}

// monthsBetween conta os meses de f a t, inclusive (out a out = 1).
func monthsBetween(f, t caldate.Date) int {
	return (t.Year()-f.Year())*12 + int(t.Month()-f.Month()) + 1
}

// CategoryHistory devolve uma série por categoria com um ponto por mês (zeros incluídos). Uma consulta agregada por
// (categoria, mês), coberta pelo índice invoices_competence_idx (household_id, competence_month).
func (s *Service) CategoryHistory(ctx context.Context, householdID uuid.UUID, from, to *caldate.Date) (History, error) {
	f, t, err := s.HistoryRange(from, to)
	if err != nil {
		return History{}, err
	}
	var rows []historyRow
	err = s.db.WithContext(ctx).Raw(`
		SELECT category_id AS category_id, competence_month AS month,
		       COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN paid_amount_cents ELSE amount_cents END), 0)::bigint AS total,
		       COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN paid_amount_cents ELSE 0 END), 0)::bigint AS paid,
		       COALESCE(SUM(CASE WHEN purchase_id IS NULL AND recurrence_id IS NULL THEN 0
		                         WHEN paid_at IS NOT NULL THEN paid_amount_cents ELSE amount_cents END), 0)::bigint AS series
		FROM invoices
		WHERE household_id = ? AND competence_month BETWEEN ? AND ? AND deleted_at IS NULL
		GROUP BY category_id, competence_month`, householdID, f, t).Scan(&rows).Error
	if err != nil {
		return History{}, err
	}
	return assembleHistory(f, t, rows), nil
}

// assembleHistory é PURA: preenche os meses vazios com zero e ordena as séries pela soma do período (maior primeiro).
func assembleHistory(f, t caldate.Date, rows []historyRow) History {
	n := monthsBetween(f, t)
	out := History{Months: make([]caldate.Date, n), Series: []CategorySeries{}}
	// Chave pelo texto "AAAA-MM-DD": comparar time.Time com == também compara o fuso (*Location), e a data que vem do banco
	// pode ter outro; o texto não tem essa armadilha.
	index := make(map[string]int, n)
	for i := range n {
		m := f.AddMonths(i)
		out.Months[i] = m
		index[m.String()] = i
	}
	byCat := map[uuid.UUID]*CategorySeries{}
	sums := map[uuid.UUID]money.Cents{}
	for _, r := range rows {
		i, ok := index[r.Month.String()]
		if !ok {
			continue // defensivo: a consulta já filtra pelo intervalo
		}
		cs := byCat[r.CategoryID]
		if cs == nil {
			cs = &CategorySeries{CategoryID: r.CategoryID, Points: make([]Point, n)}
			for j := range n {
				cs.Points[j].Month = out.Months[j]
			}
			byCat[r.CategoryID] = cs
		}
		cs.Points[i].Total += r.Total
		cs.Points[i].Paid += r.Paid
		cs.Points[i].Series += r.Series
		sums[r.CategoryID] += r.Total
	}
	for _, cs := range byCat {
		out.Series = append(out.Series, *cs)
	}
	sort.Slice(out.Series, func(i, j int) bool {
		a, b := out.Series[i].CategoryID, out.Series[j].CategoryID
		if sums[a] != sums[b] {
			return sums[a] > sums[b]
		}
		return a.String() < b.String()
	})
	return out
}
