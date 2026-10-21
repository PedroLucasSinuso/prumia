// Package boleto lê boletos: valida a linha digitável pelos dígitos verificadores e extrai os dados
// de um arquivo (texto do PDF, código de barras ou OCR). Nada é gravado em disco nem logado.
package boleto

import (
	"errors"
	"strings"
	"time"
)

// Boleto são os dados que o app guarda (nunca o arquivo).
type Boleto struct {
	DigitableLine string // 47 (cobrança bancária) ou 48 dígitos (arrecadação/convênio)
	Barcode       string // 44 dígitos
	// AmountCents e DueDate são zero quando o boleto não informa (valor aberto / sem vencimento).
	AmountCents int64
	DueDate     time.Time // dia de calendário em UTC; zero = desconhecido
	// Beneficiary só vem quando o texto do documento permite achá-lo.
	Beneficiary string
}

var (
	ErrInvalidLine = errors.New("linha digitável inválida")
)

// digits devolve só os dígitos de s.
func digits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// mod10 calcula o dígito verificador módulo 10: pesos 2,1,2,1… da direita para a esquerda; produtos de dois dígitos somam seus dígitos.
func mod10(s string) int {
	sum, weight := 0, 2
	for i := len(s) - 1; i >= 0; i-- {
		p := int(s[i]-'0') * weight
		if p > 9 {
			p = p/10 + p%10
		}
		sum += p
		weight = 3 - weight // alterna 2 e 1
	}
	return (10 - sum%10) % 10
}

// mod11 calcula o módulo 11 com pesos 2..9 da direita para a esquerda. `bank` escolhe a regra do dígito geral do
// código de barras bancário (0, 10 e 11 viram 1); fora dele, a regra dos blocos de arrecadação (0 e 1 viram 0, 10 vira 1).
func mod11(s string, bank bool) int {
	sum, weight := 0, 2
	for i := len(s) - 1; i >= 0; i-- {
		sum += int(s[i]-'0') * weight
		weight++
		if weight > 9 {
			weight = 2
		}
	}
	rest := sum % 11
	if bank {
		dv := 11 - rest
		if dv == 0 || dv == 10 || dv == 11 {
			return 1
		}
		return dv
	}
	switch rest {
	case 0, 1:
		return 0
	case 10:
		return 1
	}
	return 11 - rest
}

// Parse valida uma linha digitável (com ou sem pontos e espaços) e devolve o boleto com código de barras, valor e vencimento.
// `ref` é "hoje": o fator de vencimento do boleto bancário tem só 4 dígitos e repete a cada ~25 anos, então escolhemos a data mais próxima dele.
func Parse(line string, ref time.Time) (Boleto, error) {
	d := digits(line)
	switch {
	case len(d) == 47:
		return parseBank(d, ref)
	case len(d) == 48 && d[0] == '8':
		return parseCollection(d)
	}
	return Boleto{}, ErrInvalidLine
}

// ParseBarcode valida um código de barras de 44 dígitos e devolve o boleto com a linha digitável correspondente.
func ParseBarcode(code string, ref time.Time) (Boleto, error) {
	d := digits(code)
	if len(d) != 44 {
		return Boleto{}, ErrInvalidLine
	}
	if d[0] == '8' {
		line := collectionLine(d)
		return parseCollection(line)
	}
	return parseBank(bankLine(d), ref)
}

// bankLine monta a linha digitável (47) a partir do código de barras bancário (44), calculando os 3 dígitos de campo.
func bankLine(bc string) string {
	f1 := bc[0:4] + bc[19:24]
	f2 := bc[24:34]
	f3 := bc[34:44]
	return f1 + itoa(mod10(f1)) + f2 + itoa(mod10(f2)) + f3 + itoa(mod10(f3)) + bc[4:5] + bc[5:19]
}

func itoa(n int) string { return string(rune('0' + n)) }

func parseBank(d string, ref time.Time) (Boleto, error) {
	f1, f2, f3 := d[0:9], d[10:20], d[21:31]
	if itoa(mod10(f1)) != d[9:10] || itoa(mod10(f2)) != d[20:21] || itoa(mod10(f3)) != d[31:32] {
		return Boleto{}, ErrInvalidLine
	}
	bc := d[0:4] + d[32:33] + d[33:47] + d[4:9] + d[10:20] + d[21:31]
	if itoa(mod11(bc[0:4]+bc[5:], true)) != bc[4:5] {
		return Boleto{}, ErrInvalidLine
	}
	b := Boleto{DigitableLine: d, Barcode: bc}
	if v := atoi(bc[9:19]); v > 0 {
		b.AmountCents = v
	}
	b.DueDate = dueFromFactor(int(atoi(bc[5:9])), ref)
	return b, nil
}

// collectionLine monta a linha digitável (48) de um código de barras de arrecadação (44): 4 blocos de 11 + dígito.
func collectionLine(bc string) string {
	useMod10 := bc[2] == '6' || bc[2] == '7'
	var out string
	for i := 0; i < 4; i++ {
		blk := bc[i*11 : (i+1)*11]
		if useMod10 {
			out += blk + itoa(mod10(blk))
		} else {
			out += blk + itoa(mod11(blk, false))
		}
	}
	return out
}

func parseCollection(d string) (Boleto, error) {
	ident := d[2]
	if ident != '6' && ident != '7' && ident != '8' && ident != '9' {
		return Boleto{}, ErrInvalidLine
	}
	useMod10 := ident == '6' || ident == '7'
	var bc string
	for i := 0; i < 4; i++ {
		blk, dv := d[i*12:i*12+11], d[i*12+11:i*12+12]
		var want int
		if useMod10 {
			want = mod10(blk)
		} else {
			want = mod11(blk, false)
		}
		if itoa(want) != dv {
			return Boleto{}, ErrInvalidLine
		}
		bc += blk
	}
	// Dígito geral (4º dígito do código de barras) sobre os outros 43.
	rest := bc[0:3] + bc[4:]
	var general int
	if useMod10 {
		general = mod10(rest)
	} else {
		general = mod11(rest, false)
	}
	if itoa(general) != bc[3:4] {
		return Boleto{}, ErrInvalidLine
	}
	b := Boleto{DigitableLine: d, Barcode: bc}
	// 6 e 8 trazem o valor efetivo (centavos); 7 e 9 trazem referência/quantidade, sem valor em reais.
	if ident == '6' || ident == '8' {
		if v := atoi(bc[4:15]); v > 0 {
			b.AmountCents = v
		}
	}
	return b, nil
}

func atoi(s string) int64 {
	var n int64
	for _, r := range s {
		n = n*10 + int64(r-'0')
	}
	return n
}

// dueFromFactor converte o fator de vencimento em data. Base 07/10/1997; em 22/02/2025 o fator voltou a 1000.
// Fator 0000 = sem vencimento. Como o fator se repete, vale a data mais próxima de `ref`.
func dueFromFactor(factor int, ref time.Time) time.Time {
	if factor == 0 {
		return time.Time{}
	}
	oldBase := time.Date(1997, 10, 7, 0, 0, 0, 0, time.UTC)
	newBase := time.Date(2025, 2, 22, 0, 0, 0, 0, time.UTC)
	old := oldBase.AddDate(0, 0, factor)
	if factor < 1000 {
		return old
	}
	recent := newBase.AddDate(0, 0, factor-1000)
	if absDays(ref.Sub(recent)) < absDays(ref.Sub(old)) {
		return recent
	}
	return old
}

func absDays(d time.Duration) float64 {
	if d < 0 {
		d = -d
	}
	return d.Hours() / 24
}
