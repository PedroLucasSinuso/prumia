package boleto

import (
	"regexp"
	"strings"
	"time"
)

// Contas de consumo costumam trazer os dados como TABELA: uma linha (ou algumas, no texto do pdftotext) só com
// rótulos e a linha seguinte com os valores, na mesma ordem:
//
//	REF: MÊS / ANO | VENCIMENTO | TOTAL A PAGAR
//	JUN/2026       | 17/07/2026 | R$ 130,43
//
// A coluna não dá para casar pela posição (OCR e pdftotext não preservam espaços), então casamos pelo TIPO do valor
// e pela ordem: o 1º rótulo de vencimento fica com a 1ª data, o 1º de valor com o 1º "R$", o de mês com o 1º "JUN/2026".

type labelKind int

const (
	labelCompetence labelKind = iota + 1
	labelDue
	labelAmountStrong // "total a pagar", "valor a pagar", "valor do documento", "valor cobrado"
	labelAmountWeak   // só "total" (pode ser um subtotal)
)

// tableLabelRe acha os rótulos conhecidos. A ordem das alternativas importa: Go devolve a primeira que casa na
// posição mais à esquerda, então os rótulos longos vêm antes dos curtos ("total a pagar" antes de "total").
var tableLabelRe = regexp.MustCompile(`(?i)(total[ \t]+a[ \t]+pagar|valor[ \t]+a[ \t]+pagar|valor[ \t]+do[ \t]+documento|valor[ \t]+cobrado|valor[ \t]+total|` +
	`(?:data[ \t]+de[ \t]+)?vencimento|compet[eê]ncia|m[eê]s[ \t]*/[ \t]*ano|m[eê]s[ \t]+de[ \t]+refer[eê]ncia|refer[eê]ncia|\bref\b|\bm[eê]s\b|\btotal\b)`)

// Palavras que podem sobrar numa linha de rótulos sem fazê-la deixar de ser só rótulos.
var labelFillerRe = regexp.MustCompile(`(?i)\b(?:ano|data|de|do|da|r\$|em|reais)\b|[^\p{L}]`)

func kindOfLabel(l string) labelKind {
	l = strings.ToLower(strings.Join(strings.Fields(l), " "))
	switch {
	case strings.Contains(l, "vencimento"):
		return labelDue
	case l == "total":
		return labelAmountWeak
	case strings.HasPrefix(l, "total") || strings.HasPrefix(l, "valor"):
		return labelAmountStrong
	}
	return labelCompetence
}

// labelsOf devolve os rótulos da linha, se ela for SÓ rótulos (o que sobra são separadores e palavras de ligação).
// Rótulos iguais em sequência contam uma vez ("REF: MÊS / ANO" é um rótulo de competência, não dois).
func labelsOf(line string) []labelKind {
	locs := tableLabelRe.FindAllStringIndex(line, -1)
	if locs == nil {
		return nil
	}
	rest := tableLabelRe.ReplaceAllString(line, " ")
	// "Vencimento: 10/11/2026" não é linha de rótulos: o valor já está nela (e o rótulo em linha é lido em outro lugar).
	if tableValueRe.MatchString(rest) || len([]rune(labelFillerRe.ReplaceAllString(rest, ""))) > 3 {
		return nil
	}
	var out []labelKind
	for _, loc := range locs {
		k := kindOfLabel(line[loc[0]:loc[1]])
		if len(out) > 0 && out[len(out)-1] == k {
			continue
		}
		out = append(out, k)
	}
	return out
}

// Valores de uma linha da tabela, na ordem em que aparecem. A data vem antes do mês na alternância para "17/07/2026"
// não ser lido como mês "07/2026".
var tableValueRe = regexp.MustCompile(`(?i)\b(\d{2})/(\d{2})/(\d{4})\b|\b(\d{1,2}|[a-zç]{3,9})[ \t]*/[ \t]*(\d{4})\b|` + moneyPattern)

// moneyPattern: "R$ 1.234,56", "R$1.234,56", "1.234,56", "130,43" e o "RS 130,43" que o OCR costuma devolver.
// Grupos: inteiro (com pontos de milhar) e centavos. Aceita ponto como decimal ("130.43", erro comum de OCR).
const moneyPattern = `(?:R[ \t]?[$S][ \t]*)?\b(\d{1,3}(?:\.\d{3})+|\d+)[,.](\d{2})\b`

type tableFields struct {
	due, competence time.Time
	amount          int64
	strong          bool // o valor veio de um rótulo forte ("total a pagar"), não de um "total" solto
}

// readTable procura blocos "linhas de rótulos" + "linhas de valores" e devolve o primeiro valor de cada tipo.
func readTable(text string) tableFields {
	var f tableFields
	lines := strings.Split(text, "\n")
	for i := 0; i < len(lines); i++ {
		labels := labelsOf(lines[i])
		if labels == nil {
			continue
		}
		// pdftotext sem -layout põe cada célula numa linha: junta até 4 linhas seguidas só de rótulos.
		j := i + 1
		for ; j < len(lines) && j < i+4; j++ {
			more := labelsOf(lines[j])
			if more == nil {
				break
			}
			labels = append(labels, more...)
		}
		var values [][]string
		for k := j; k < len(lines) && k < j+4 && len(values) < len(labels); k++ {
			if labelsOf(lines[k]) != nil {
				break
			}
			values = append(values, tableValueRe.FindAllStringSubmatch(lines[k], -1)...)
		}
		f.fill(labels, values)
		i = j - 1
	}
	return f
}

// fill casa rótulos e valores por tipo e ordem e guarda o primeiro de cada (não sobrescreve o que já achou).
func (f *tableFields) fill(labels []labelKind, values [][]string) {
	var dates, monthsFound []time.Time
	var amounts []int64
	for _, v := range values {
		switch {
		case v[1] != "":
			if d := validDate(v[3], v[2], v[1]); !d.IsZero() {
				dates = append(dates, d)
			}
		case v[4] != "":
			if m, y := monthOf(v[4]), toInt(v[5]); m != 0 && y >= 2000 && y <= 2100 {
				monthsFound = append(monthsFound, time.Date(y, time.Month(m), 1, 0, 0, 0, 0, time.UTC))
			}
		case v[6] != "":
			amounts = append(amounts, moneyCents(v[6], v[7]))
		}
	}
	var nd, nm, na int
	for _, l := range labels {
		switch l {
		case labelDue:
			if nd < len(dates) && f.due.IsZero() {
				f.due = dates[nd]
			}
			nd++
		case labelCompetence:
			if nm < len(monthsFound) && f.competence.IsZero() {
				f.competence = monthsFound[nm]
			}
			nm++
		case labelAmountStrong, labelAmountWeak:
			if na < len(amounts) && amounts[na] > 0 && (f.amount == 0 || (!f.strong && l == labelAmountStrong)) {
				f.amount, f.strong = amounts[na], l == labelAmountStrong
			}
			na++
		}
	}
}

// moneyCents converte as partes de "1.234,56" em centavos.
func moneyCents(intPart, cents string) int64 {
	d := digits(intPart)
	if len(d) > 12 { // mais que R$ 999 bilhões: não é valor de conta
		return 0
	}
	return atoi(d)*100 + atoi(cents)
}
