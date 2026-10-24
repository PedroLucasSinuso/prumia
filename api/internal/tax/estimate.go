package tax

import (
	"errors"
	"sort"
)

// Limites de entrada (evita estouro e números absurdos).
const (
	MaxGrossCents = 10_000_000_000 // R$ 100 milhões por mês
	MaxDependents = 20
)

var ErrInvalid = errors.New("valor ou dependentes fora do limite")

// Result é a estimativa. Sempre aproximada: ver o aviso no pacote.
type Result struct {
	INSSCents   int64
	IRRFCents   int64
	TableYear   int // ano da tabela usada (pode ser diferente do pedido: ver tableFor)
	Sources     []string
	CheckedOn   string
	Approximate bool
}

// tableFor escolhe a tabela do ano: a mais recente que não passe do ano pedido; se o ano é anterior a todas, a mais antiga.
// Ano sem tabela usa a mais recente e o chamador vê pelo TableYear que não foi a do ano pedido.
func tableFor(year int) Table {
	years := make([]int, 0, len(tables))
	for y := range tables {
		years = append(years, y)
	}
	sort.Ints(years)
	pick := years[0]
	for _, y := range years {
		if y <= year {
			pick = y
		}
	}
	return tables[pick]
}

// Estimate calcula INSS e IRRF mensais de um salário bruto (centavos) no ano de `year`, com `dependents` dependentes.
// O que NÃO considera: pensão alimentícia, previdência privada, outros rendimentos, 13º, PLR, férias, plano de saúde
// (não é dedução na fonte) e salários de vários empregos. Por isso Approximate é sempre true.
func Estimate(year int, grossCents int64, dependents int) (Result, error) {
	if grossCents <= 0 || grossCents > MaxGrossCents || dependents < 0 || dependents > MaxDependents {
		return Result{}, ErrInvalid
	}
	t := tableFor(year)
	inss := inssOf(t, grossCents)

	// Base: bruto menos a dedução mais vantajosa (INSS + dependentes, ou o desconto simplificado).
	legal := inss + int64(dependents)*t.DependentCents
	ded := legal
	if t.SimplifiedCents > ded {
		ded = t.SimplifiedCents
	}
	base := grossCents - ded
	if base < 0 {
		base = 0
	}
	irrf := progressive(t.IRRF, base)
	if r := t.Reduction; r != nil {
		irrf -= reductionOf(r, grossCents, irrf)
	}
	if irrf < 0 {
		irrf = 0
	}
	return Result{INSSCents: inss, IRRFCents: irrf, TableYear: t.Year, Sources: t.Sources, CheckedOn: t.CheckedOn, Approximate: true}, nil
}

// roundDiv divide arredondando para o mais próximo (metade para cima). Só para valores não negativos.
func roundDiv(num, den int64) int64 { return (num + den/2) / den }

// inssOf soma, faixa a faixa, a parte do salário dentro da faixa vezes a alíquota. O salário acima do teto não paga mais.
// Arredonda uma vez só, no fim (como a Previdência: teto de 2026 = R$ 988,09).
func inssOf(t Table, gross int64) int64 {
	var num int64 // centavos x pontos-base (arredondado no fim)
	var prev int64
	for _, b := range t.INSS {
		if gross <= prev {
			break
		}
		top := b.UpToCents
		if gross < top {
			top = gross
		}
		num += (top - prev) * b.RateBP
		prev = b.UpToCents
	}
	return roundDiv(num, 10000)
}

// progressive aplica a tabela progressiva com parcela a deduzir: base x alíquota - parcela (nunca negativo).
func progressive(bands []Band, base int64) int64 {
	for _, b := range bands {
		if b.UpToCents == 0 || base <= b.UpToCents {
			v := roundDiv(base*b.RateBP, 10000) - b.DeductionCents
			if v < 0 {
				return 0
			}
			return v
		}
	}
	return 0
}

// reductionOf é a redução da Lei 15.270/2025 sobre os rendimentos tributáveis (o bruto), limitada ao imposto.
func reductionOf(r *Reduction, gross, tax int64) int64 {
	var red int64
	switch {
	case gross <= r.FullUpToCents:
		red = r.CapCents
	case gross < r.ZeroFromCents:
		red = r.BaseCents - roundDiv(gross*r.FactorMicro, 1_000_000)
	}
	if red < 0 {
		red = 0
	}
	if red > tax {
		red = tax
	}
	return red
}
