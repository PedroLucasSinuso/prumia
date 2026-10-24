package income

import (
	"fmt"
	"strings"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// Modos de valor. `fixed` é o "valor cheio" de sempre. `per_unit` é preço x quantidade, com o rótulo da unidade livre
// ("dia trabalhado", "hora", "plantão"): vale para qualquer renda que varia por quantidade, não só para um benefício.
const (
	AmountFixed   = "fixed"
	AmountPerUnit = "per_unit"

	maxQuantity      = 999
	maxUnitLabel     = 30
	DefaultUnitLabel = "unidade"
)

// Amount é o valor já resolvido e validado de um lançamento.
type Amount struct {
	Mode           string
	GrossCents     money.Cents  // fixo: o informado; por unidade: preço x quantidade
	UnitPriceCents *money.Cents // só por unidade
	Quantity       *int         // só por unidade
	UnitLabel      *string      // só por unidade
}

// AmountInput é o que chega de fora. Ponteiro nil = campo ausente.
type AmountInput struct {
	Mode           string // "" = fixed
	GrossCents     *money.Cents
	UnitPriceCents *money.Cents
	Quantity       *int
	UnitLabel      *string
}

// Resolve valida e calcula o valor. `defaultQuantity` é a quantidade sugerida do mês (dias úteis) quando o modo é por
// unidade e a pessoa não informou. O bruto por unidade é SEMPRE recalculado aqui (preço x quantidade), nunca digitado.
func (in AmountInput) Resolve(defaultQuantity int, v *validation.Collector) Amount {
	switch in.Mode {
	case "", AmountFixed:
		var g money.Cents
		if in.GrossCents == nil {
			v.Add("grossAmountCents", "informe o valor")
		} else {
			g = *in.GrossCents
			CheckGross(g, v)
		}
		return Amount{Mode: AmountFixed, GrossCents: g}
	case AmountPerUnit:
		return resolvePerUnit(in, defaultQuantity, v)
	}
	v.Add("amountMode", "use fixed ou per_unit")
	return Amount{Mode: AmountFixed}
}

func resolvePerUnit(in AmountInput, defaultQuantity int, v *validation.Collector) Amount {
	var price money.Cents
	if in.UnitPriceCents == nil || *in.UnitPriceCents <= 0 || *in.UnitPriceCents > MaxAmount {
		v.Add("unitPriceCents", "informe o preço por unidade")
	} else {
		price = *in.UnitPriceCents
	}
	qty := defaultQuantity
	if in.Quantity != nil {
		qty = *in.Quantity
	}
	if qty < 1 || qty > maxQuantity {
		v.Add("quantity", fmt.Sprintf("informe uma quantidade de 1 a %d", maxQuantity))
		qty = 1
	}
	label := DefaultUnitLabel
	if in.UnitLabel != nil {
		label = strings.TrimSpace(*in.UnitLabel)
	}
	if n := len([]rune(label)); n < 1 || n > maxUnitLabel {
		v.Add("unitLabel", fmt.Sprintf("informe um nome de 1 a %d caracteres", maxUnitLabel))
	}
	gross := money.Cents(int64(price) * int64(qty)) // price <= 10^12 e qty <= 999: cabe em int64 com folga
	if gross > MaxAmount {
		v.Add("grossAmountCents", "o total ultrapassa o limite")
	}
	return Amount{Mode: AmountPerUnit, GrossCents: gross, UnitPriceCents: &price, Quantity: &qty, UnitLabel: &label}
}

// cols devolve as colunas do lançamento para este valor (nil onde não se aplica), prontas para um Updates(map).
func (a Amount) cols() map[string]any {
	return map[string]any{
		"gross_amount_cents": a.GrossCents, "unit_price_cents": a.UnitPriceCents, "quantity": a.Quantity, "unit_label": a.UnitLabel,
	}
}
