// Package money guarda dinheiro como inteiro em centavos (BRL). Nunca use float para dinheiro:
// 0.1 + 0.2 != 0.3 em ponto flutuante, e erro de centavo em contas é inaceitável.
package money

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Cents é um valor em centavos. R$ 660,00 = Cents(66000). Pode ser negativo (ex.: saldo).
type Cents int64

// String formata no padrão brasileiro: "R$ 1.234,56" (e "-R$ 10,00" para negativos).
func (c Cents) String() string {
	neg := c < 0
	if neg {
		c = -c
	}
	reais := strconv.FormatInt(int64(c)/100, 10)
	// insere o separador de milhar da direita para a esquerda
	var b strings.Builder
	for i, r := range reais {
		if i > 0 && (len(reais)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	out := fmt.Sprintf("R$ %s,%02d", b.String(), int64(c)%100)
	if neg {
		return "-" + out
	}
	return out
}

// Split divide o total em n parcelas. As n-1 primeiras têm o mesmo valor (arredondado para baixo)
// e a **última leva o resto de centavos**, então a soma é sempre exatamente o total.
// Ex.: R$ 100,00 em 3x => 33,33 + 33,33 + 33,34.
func Split(total Cents, n int) ([]Cents, error) {
	if n < 1 {
		return nil, errors.New("money: número de parcelas deve ser >= 1")
	}
	if total <= 0 {
		return nil, errors.New("money: total deve ser positivo")
	}
	base := total / Cents(n)
	parts := make([]Cents, n) // make cria um slice com n posições zeradas
	var sum Cents
	for i := 0; i < n-1; i++ {
		parts[i] = base
		sum += base
	}
	parts[n-1] = total - sum
	return parts, nil
}
