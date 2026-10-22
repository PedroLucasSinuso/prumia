// Package cnpj valida e formata CNPJ (14 dígitos, dois dígitos verificadores).
package cnpj

import "strings"

// Digits devolve só os dígitos de s (aceita qualquer máscara, até a torta "11.222-333/0001-81").
func Digits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Valid confere tamanho, dígitos verificadores e recusa sequências repetidas (00000000000000 passa na conta, mas não existe).
func Valid(s string) bool {
	d := Digits(s)
	if len(d) != 14 || d == strings.Repeat(string(d[0]), 14) {
		return false
	}
	return check(d[:12]) == int(d[12]-'0') && check(d[:13]) == int(d[13]-'0')
}

// check calcula um dígito: pesos 2..9 da direita para a esquerda, módulo 11 (resto < 2 vira 0).
func check(s string) int {
	sum, w := 0, 2
	for i := len(s) - 1; i >= 0; i-- {
		sum += int(s[i]-'0') * w
		if w++; w > 9 {
			w = 2
		}
	}
	if r := sum % 11; r >= 2 {
		return 11 - r
	}
	return 0
}

// Format devolve 00.000.000/0000-00; se não tiver 14 dígitos, devolve s como veio.
func Format(s string) string {
	d := Digits(s)
	if len(d) != 14 {
		return s
	}
	return d[:2] + "." + d[2:5] + "." + d[5:8] + "/" + d[8:12] + "-" + d[12:]
}
