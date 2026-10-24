package income

import (
	"fmt"
	"strings"

	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// Este arquivo tem só as regras PURAS (sem banco), para testar em tabela.

const (
	// MaxAmount é o teto de qualquer valor (o mesmo das invoices: R$ 10 bilhões): evita estouro de int64 nas somas.
	MaxAmount = invoice.MaxAmount
	// maxDeductions limita os descontos de um lançamento (com o teto por valor, a soma nunca estoura int64).
	maxDeductions = 20
	maxNameLen    = 60
)

var deductionKinds = map[string]bool{"inss": true, "irrf": true, "health_plan": true, "health_copay": true, "other": true}

// Net é o líquido: bruto menos a soma dos descontos. É CALCULADO a cada leitura; nunca é gravado (evita divergência).
func Net(gross money.Cents, ds []Deduction) money.Cents { return gross - SumDeductions(ds) }

// SumDeductions soma os descontos. Seguro contra overflow porque cada valor <= MaxAmount e há no máx. maxDeductions.
func SumDeductions(ds []Deduction) money.Cents {
	var sum money.Cents
	for _, d := range ds {
		sum += d.AmountCents
	}
	return sum
}

// WalletFor deriva a carteira do tipo: VR (benefit) só existe na carteira de benefício, e o resto na livre.
// Espelha o CHECK ((kind='benefit') = (wallet='benefit')) do banco.
func WalletFor(kind string) string {
	if kind == KindBenefit {
		return WalletBenefit
	}
	return WalletFree
}

// ResolveWallet valida o tipo e a carteira opcionalmente informada. Informar `benefit` com tipo salário (ou `free` com VR)
// é incoerente e vira erro no campo `wallet`.
func ResolveWallet(kind string, wallet *string, v *validation.Collector) string {
	if kind != KindSalary && kind != KindBenefit && kind != KindOther {
		v.Add("kind", "use salary, benefit ou other")
		return ""
	}
	w := WalletFor(kind)
	if wallet != nil && *wallet != w {
		if kind == KindBenefit {
			v.Add("wallet", "vale-refeição/benefício só pode ficar na carteira de benefício")
		} else {
			v.Add("wallet", "só receitas do tipo benefício vão para a carteira de benefício")
		}
	}
	return w
}

// CheckDeductions normaliza (apara nomes) e valida os descontos: tipo conhecido, nome 1..60, valor > 0 e a SOMA não
// pode ultrapassar o bruto. Erros saem por campo: `deductions[2].amountCents`.
func CheckDeductions(gross money.Cents, ds []Deduction, v *validation.Collector) []Deduction {
	if len(ds) > maxDeductions {
		v.Add("deductions", fmt.Sprintf("no máximo %d descontos", maxDeductions))
		return ds
	}
	out := make([]Deduction, len(ds))
	var sum money.Cents
	for i, d := range ds {
		d.Name = strings.TrimSpace(d.Name)
		if !deductionKinds[d.Kind] {
			v.Add(fmt.Sprintf("deductions[%d].kind", i), "use inss, irrf, health_plan, health_copay ou other")
		}
		if n := len([]rune(d.Name)); n < 1 || n > maxNameLen {
			v.Add(fmt.Sprintf("deductions[%d].name", i), fmt.Sprintf("informe um nome de 1 a %d caracteres", maxNameLen))
		}
		if d.AmountCents <= 0 || d.AmountCents > MaxAmount {
			v.Add(fmt.Sprintf("deductions[%d].amountCents", i), "informe um valor maior que zero")
		} else {
			sum += d.AmountCents
		}
		out[i] = d
	}
	if gross > 0 && sum > gross {
		v.Add("deductions", "a soma dos descontos não pode ultrapassar o valor bruto")
	}
	return out
}

// CheckGross valida o valor bruto.
func CheckGross(gross money.Cents, v *validation.Collector) {
	if gross <= 0 || gross > MaxAmount {
		v.Add("grossAmountCents", "informe um valor maior que zero")
	}
}

// horizonMonths: quantos meses à frente a previsão é gerada (a partir de hoje ou do início, o que for maior).
const horizonMonths = 12

// maxAheadMonths limita o "gere até este mês" pedido ao listar um mês futuro (evita gerar décadas por uma URL).
const maxAheadMonths = 60

// DefaultThrough é o último mês que a fonte deve ter materializado por padrão: 12 meses depois do maior entre o mês de
// hoje e o mês inicial, limitado pelo fim (se houver).
func DefaultThrough(start, end, today caldate.Date) caldate.Date {
	base := today.StartOfMonth()
	if start.After(base) {
		base = start
	}
	through := base.AddMonths(horizonMonths)
	if !end.IsZero() && end.Before(through) {
		through = end
	}
	return through
}

// TargetThrough é o horizonte efetivo: o padrão, ou o mês pedido (se maior), nunca além de hoje+60 meses nem do fim.
func TargetThrough(start, end, today, requested caldate.Date) caldate.Date {
	target := DefaultThrough(start, end, today)
	if req := requested.StartOfMonth(); !requested.IsZero() && req.After(target) {
		target = req
		if limit := today.StartOfMonth().AddMonths(maxAheadMonths); target.After(limit) {
			target = limit
		}
		if !end.IsZero() && end.Before(target) {
			target = end
		}
	}
	return target
}
