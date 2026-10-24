package boleto

import (
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Padrão de lista (documentado em docs/developer-guide/boleto-extraction.md): UMA conta por linha, "descrição: valor".
//
//	Gás: R$ 150,00      <- forte (tem R$)
//	Mercado: 310,25     <- forte (vírgula com 2 casas e separador)
//	Teste: 567          <- fraco (inteiro puro): só vale se o texto já tem 2 itens fortes
//
// Itens fracos existem porque quem digita "Gás: 150" não pensa em centavos; mas "Medidor: 3789363" ou "Cliente: 46198"
// de uma fatura têm a mesma cara, então sozinhos (ou com 1 item forte) eles são ignorados.

// maxWeakReais: teto de sanidade para o valor inteiro fraco (R$ 100.000).
const maxWeakReais = 100000

// maxPlainDescription: descrição de item sem "R$" tem no máximo ~40 caracteres (frase de conversa não é conta).
const maxPlainDescription = 40

// listLineRe separa uma linha em: descrição (preguiçosa), separador, "R$", número e lixo curto no fim (OCR: "M", "2519 ,").
// RE2, o regex do Go, não tem lookahead/lookbehind: por isso tudo vai em grupos e a decisão fica no código (parseListLine).
var listLineRe = regexp.MustCompile(`^[ \t]*(?:[-•*·–][ \t]*)?(.*?)[ \t]*([:=\-–])?[ \t]*(R[ \t]?[$S][ \t]*)?(\d[\d.,]*)[ \t]*[✓✔]*(?:[ \t]+\S{1,8}){0,3}[ \t]*$`)

// Hora da mensagem no fim da linha ("14:32 ✓✓"): é tirada antes de ler; hora no meio da linha descarta a linha.
var (
	trailingTimeRe = regexp.MustCompile(`[ \t]+\d{1,2}:\d{2}[ \t✓✔]*$`)
	timeRe         = regexp.MustCompile(`\d{1,2}:\d{2}`)
	dateRe         = regexp.MustCompile(`\d{1,2}/\d{1,2}/\d{2,4}`)
	// CPF (000.000.000-00) e CNPJ (00.000.000/0000-00): o "-00" final não é um valor.
	documentRe = regexp.MustCompile(`\d{3}\.\d{3}\.\d{3}|\d{2}\.\d{3}\.\d{3}/|\d{4}-\d{2}\b`)
	// Número solto na descrição ("westgroup 727"): em item sem R$ ele pode ser o valor de outra coisa.
	looseNumberRe = regexp.MustCompile(`(?:^|\s)[\d.,/\-]*\d[\d.,/\-]*(?:\s|$)`)
	wholeDigitsRe = regexp.MustCompile(`^\d{1,3}(?:\.\d{3})+$|^\d+$`)
)

// Um algarismo (ou dois) sozinho antes de uma palavra, no começo da descrição, é ruído de OCR, não parte do nome.
var leadingNoiseRe = regexp.MustCompile(`^\p{P}*\d{1,2}\s+(\p{L}{2}.*)$`)

// Separa itens na mesma linha ("Gás: 98,40 / Mercado: 310,25").
var itemSeparatorRe = regexp.MustCompile(`[ \t]+[/|][ \t]+|[ \t]*;[ \t]*`)

// Descrições que são rótulo de soma, não conta.
var notItemRe = regexp.MustCompile(`(?i)^(?:sub)?total(?:\s+(?:a\s+pagar|geral))?$|^valor(?:\s+total)?$|^saldo$`)

// listItem é um item lido de uma linha, ainda sem a decisão forte/fraco aplicada ao texto todo.
type listItem struct {
	Item
	weak bool
}

// ignoredLine: linhas que nunca são conta (link, e-mail, token, hora, data, CPF/CNPJ).
func ignoredLine(line string) bool {
	low := strings.ToLower(line)
	for _, s := range []string{"://", "www.", "@", "token="} {
		if strings.Contains(low, s) {
			return true
		}
	}
	return timeRe.MatchString(line) || dateRe.MatchString(line) || documentRe.MatchString(line)
}

// parseMoney lê o número de uma linha de lista: "150" -> 15000, "150,5" -> 15050, "1.234,56", "R$150".
// twoDecimals diz se veio com vírgula e 2 casas ("154,72"). Ponto decimal ("130.43", erro comum de OCR) só com "R$".
// Idioma de Go: devolve (valor, flag, ok) em vez de lançar exceção; quem chama confere o ok.
func parseMoney(tok string, hasRS bool) (cents int64, twoDecimals, ok bool) {
	tok = strings.TrimRight(tok, ".,")
	intPart, frac := tok, ""
	if i := strings.LastIndexAny(tok, ",."); i >= 0 {
		f := tok[i+1:]
		if len(f) >= 1 && len(f) <= 2 && (tok[i] == ',' || (len(f) == 2 && hasRS)) {
			intPart, frac = tok[:i], f
			twoDecimals = len(f) == 2 && tok[i] == ','
		}
		// Com 3 casas ("1.234") o ponto é separador de milhar e fica em intPart.
	}
	if !wholeDigitsRe.MatchString(intPart) {
		return 0, false, false
	}
	if len(frac) == 1 {
		frac += "0" // "150,5" são 50 centavos
	}
	if frac == "" {
		frac = "00"
	}
	cents = moneyCents(intPart, frac)
	return cents, twoDecimals, cents > 0
}

// parseListLine lê UMA conta de um trecho de linha. ok=false: não é item (ou é ruído).
func parseListLine(line string) (listItem, bool) {
	line = trailingTimeRe.ReplaceAllString(line, "")
	if ignoredLine(line) {
		return listItem{}, false
	}
	m := listLineRe.FindStringSubmatch(line)
	if m == nil {
		return listItem{}, false
	}
	desc, sep, hasRS := cleanDescription(m[1]), m[2], m[3] != ""
	if desc == "" || notItemRe.MatchString(desc) {
		return listItem{}, false
	}
	cents, twoDecimals, ok := parseMoney(m[4], hasRS)
	if !ok {
		return listItem{}, false
	}
	if !hasRS {
		// Sem "R$" o separador é obrigatório ("Gás: 98,40"), a descrição é curta e sem número solto, e o número não pode
		// estar grudado em outro ("0001-90" de CNPJ, "10/11").
		last, _ := utf8.DecodeLastRuneInString(desc)
		if sep == "" || utf8.RuneCountInString(desc) > maxPlainDescription || looseNumberRe.MatchString(desc) ||
			strings.ContainsRune("0123456789/.", last) {
			return listItem{}, false
		}
	}
	weak := !hasRS && !twoDecimals
	if weak && cents > maxWeakReais*100 {
		return listItem{}, false
	}
	return listItem{Item: Item{Description: desc, AmountCents: cents}, weak: weak}, true
}

// findListItems devolve as contas do texto, na ordem. Itens fracos só entram se houver 2+ itens fortes.
func findListItems(body string) []Item {
	var all []listItem
	strong := 0
	for _, line := range strings.Split(body, "\n") {
		line = trailingTimeRe.ReplaceAllString(line, "")
		var found []listItem
		// Vários itens na mesma linha: só vale a divisão se ao menos 2 partes forem itens.
		if parts := itemSeparatorRe.Split(line, -1); len(parts) > 1 {
			for _, p := range parts {
				if it, ok := parseListLine(p); ok {
					found = append(found, it)
				}
			}
		}
		if len(found) < 2 {
			found = nil
			if it, ok := parseListLine(line); ok {
				found = append(found, it)
			}
		}
		for _, it := range found {
			if !it.weak {
				strong++
			}
		}
		all = append(all, found...)
	}
	var out []Item
	for _, it := range all {
		if it.weak && strong < 2 {
			continue
		}
		out = append(out, it.Item)
	}
	return out
}

// ExtractText lê um texto escrito ou colado (sem arquivo, sem OCR): linha digitável no texto = boleto; senão analyze.
func (e *Extractor) ExtractText(body string) (Document, error) {
	ref := time.Now()
	if e.Now != nil {
		ref = e.Now()
	}
	if b, ok := FindInText(body, ref); ok {
		return boletoDocument(b, body, MethodText), nil
	}
	if d, ok := analyze(body); ok {
		d.Method = MethodText
		return d, nil
	}
	return Document{}, ErrNotFound
}
