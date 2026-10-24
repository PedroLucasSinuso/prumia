package boleto

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"
)

// Kind diz o que o arquivo trazia.
type Kind string

const (
	KindBoleto Kind = "boleto" // linha digitável válida
	KindBill   Kind = "bill"   // conta sem linha digitável: só valor (e, se der, vencimento)
	KindList   Kind = "list"   // várias contas, uma por linha ("Gás R$ 157,82"), ex.: print de conversa
)

// Item é uma conta encontrada no arquivo. Tudo é sugestão: a pessoa revisa antes de salvar.
type Item struct {
	Description     string
	AmountCents     int64     // 0 = não lido
	DueDate         time.Time // zero = não lido
	Competence      time.Time // dia 1; zero = não lido
	Beneficiary     string
	BeneficiaryCNPJ string
	Boleto          *Boleto // só em KindBoleto
}

// Document é o resultado da leitura: o tipo, como foi lido e as contas (1 em boleto/bill, 2+ em list).
type Document struct {
	Kind   Kind
	Method Method
	Items  []Item
}

// text é um texto lido do arquivo e o caminho que o produziu (texto do PDF ou OCR).
type text struct {
	body   string
	method Method
}

// ExtractDocument lê um arquivo (PDF, PNG ou JPEG) que está só em memória e diz o que ele traz.
//
// Ordem (testada em document_test.go): primeiro tudo o que pode achar um BOLETO, do mais barato e exato ao mais caro
// (texto do PDF, código de barras das páginas, OCR); só se nenhum caminho achar linha digitável válida o texto é lido
// como conta sem boleto ou lista (analyze). O texto do PDF é analisado antes de rodar o OCR, que é a etapa mais cara.
func (e *Extractor) ExtractDocument(ctx context.Context, data []byte, password string) (Document, error) {
	ref := time.Now()
	if e.Now != nil {
		ref = e.Now()
	}
	switch sniff(data) {
	case kindPDF:
		return e.documentFromPDF(ctx, data, password, ref)
	case kindImage:
		return e.documentFromImages(ctx, [][]byte{data}, nil, ref)
	}
	return Document{}, ErrUnsupported
}

func (e *Extractor) documentFromPDF(ctx context.Context, pdf []byte, password string, ref time.Time) (Document, error) {
	var pdfText string
	if e.PDFText != nil {
		t, err := e.PDFText(ctx, pdf, password)
		switch {
		case errors.Is(err, ErrPasswordRequired), errors.Is(err, ErrWrongPassword):
			return Document{}, err
		case err == nil:
			if b, ok := FindInText(t, ref); ok {
				return boletoDocument(b, t, MethodPDFText), nil
			}
			pdfText = t
		}
		// Qualquer outro erro (ferramenta ausente, PDF só de imagem) cai para as próximas etapas.
	}
	var pages [][]byte
	if e.Rasterize != nil {
		for page := 1; page <= maxPDFPages; page++ {
			img, err := e.Rasterize(ctx, pdf, password, page)
			if err != nil {
				if errors.Is(err, ErrPasswordRequired) || errors.Is(err, ErrWrongPassword) {
					return Document{}, err
				}
				break // sem mais páginas ou ferramenta indisponível
			}
			pages = append(pages, img)
		}
	}
	var texts []text
	if strings.TrimSpace(pdfText) != "" {
		texts = append(texts, text{pdfText, MethodPDFText})
	}
	return e.documentFromImages(ctx, pages, texts, ref)
}

// documentFromImages tenta o código de barras em todas as imagens; depois analisa os textos já lidos (do PDF) e só
// então roda o OCR, imagem a imagem (boleto no texto do OCR, senão conta/lista).
func (e *Extractor) documentFromImages(ctx context.Context, imgs [][]byte, texts []text, ref time.Time) (Document, error) {
	var ok [][]byte
	for _, img := range imgs {
		if checkImageSize(img) != nil {
			continue // imagem gigante: nem decodifica (ver checkImageSize)
		}
		ok = append(ok, img)
		if e.Barcode == nil {
			continue
		}
		if code, err := e.Barcode(img); err == nil {
			if b, err := ParseBarcode(code, ref); err == nil {
				// O código de barras não traz o texto; se o PDF tiver texto, ele completa beneficiário e vencimento.
				var body string
				if len(texts) > 0 {
					body = texts[0].body
					enrich(&b, body, ref)
				}
				return boletoDocument(b, body, MethodBarcodeImage), nil
			}
		}
	}
	for _, t := range texts {
		if d, found := analyze(t.body); found {
			d.Method = t.method
			return d, nil
		}
	}
	if e.OCR == nil {
		return Document{}, ErrNotFound
	}
	// Boleto em qualquer página vence a conta/lista lida de outra página (a 2ª página pode ser o boleto da fatura).
	var fallback *Document
	for _, img := range ok {
		body, err := e.OCR(ctx, img)
		if err != nil {
			continue
		}
		if b, found := FindInText(body, ref); found {
			return boletoDocument(b, body, MethodOCR), nil
		}
		if d, found := analyze(body); found && fallback == nil {
			d.Method = MethodOCR
			fallback = &d
		}
	}
	if fallback != nil {
		return *fallback, nil
	}
	return Document{}, ErrNotFound
}

// boletoDocument monta o item do boleto. Sem valor na linha (boleto de valor aberto), usa o valor do texto, se houver.
func boletoDocument(b Boleto, body string, m Method) Document {
	it := Item{
		Description: b.Beneficiary, AmountCents: b.AmountCents, DueDate: b.DueDate, Competence: b.Competence,
		Beneficiary: b.Beneficiary, BeneficiaryCNPJ: b.BeneficiaryCNPJ, Boleto: &b,
	}
	if it.AmountCents == 0 && body != "" {
		it.AmountCents, _ = findAmount(body)
	}
	return Document{Kind: KindBoleto, Method: m, Items: []Item{it}}
}

// analyze lê um texto SEM linha digitável válida. Ordem de decisão:
//  1. valor com rótulo forte ("total a pagar"…) ou valor com vencimento => conta (bill);
//  2. duas ou mais linhas "descrição R$ valor" => lista;
//  3. uma linha "descrição R$ valor" => conta com essa descrição;
//  4. valor com rótulo fraco ("total") ou, sem rótulo, o maior "R$ x" do texto => conta.
//
// Conta com itens detalhados (consumo, bandeira, total) cai em 1 antes de virar lista, porque traz "total a pagar".
func analyze(body string) (Document, bool) {
	amount, strong := findAmount(body)
	due := findDueDate(body)
	bill := func(desc string, cents int64) (Document, bool) {
		name := findBeneficiary(body)
		if desc == "" {
			desc = name
		}
		if desc == "" {
			desc = serviceName(body) // foto sem nome legível (cabeçalho colorido): o tipo de serviço ainda aparece no texto
		}
		return Document{Kind: KindBill, Items: []Item{{
			Description: desc, AmountCents: cents, DueDate: due, Competence: findCompetence(body),
			Beneficiary: name, BeneficiaryCNPJ: findCNPJ(body),
		}}}, true
	}
	if amount > 0 && (strong || !due.IsZero()) {
		return bill("", amount)
	}
	items := findListItems(body)
	switch {
	case len(items) >= 2:
		return Document{Kind: KindList, Items: items}, true
	case len(items) == 1:
		return bill(items[0].Description, items[0].AmountCents)
	case amount > 0:
		return bill("", amount)
	}
	if largest := largestMoney(body); largest > 0 {
		return bill("", largest)
	}
	return Document{}, false
}

// Rótulo de valor seguido do valor (na mesma linha ou na de baixo). Rótulos fortes antes do "total" solto.
var amountLabelRe = regexp.MustCompile(`(?i)(total[ \t]+a[ \t]+pagar|valor[ \t]+a[ \t]+pagar|valor[ \t]+do[ \t]+documento|valor[ \t]+cobrado|valor[ \t]+total|\btotal\b)[ \t]*(?:\(R\$\))?[ \t]*[:\-]?\s*` + moneyPattern)

// findAmount devolve o valor da conta e se veio de um rótulo forte. Rótulo na mesma linha/linha de baixo primeiro;
// depois a tabela (rótulos numa linha, valores na seguinte).
func findAmount(body string) (int64, bool) {
	var weak int64
	for _, m := range amountLabelRe.FindAllStringSubmatch(body, -1) {
		cents := moneyCents(m[2], m[3])
		if cents <= 0 {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(m[1]), "total") {
			return cents, true
		}
		if weak == 0 {
			weak = cents
		}
	}
	if t := readTable(body); t.amount > 0 && (t.strong || weak == 0) {
		return t.amount, t.strong
	}
	return weak, false
}

// Valor com "R$" explícito (no texto solto, sem rótulo, exigimos o símbolo para não pegar qualquer número).
var currencyRe = regexp.MustCompile(`R[ \t]?[$S][ \t]*(\d{1,3}(?:\.\d{3})+|\d+)[,.](\d{2})\b`)

func largestMoney(body string) int64 {
	var best int64
	for _, m := range currencyRe.FindAllStringSubmatch(body, -1) {
		if c := moneyCents(m[1], m[2]); c > best {
			best = c
		}
	}
	return best
}

// listLineRe: "Gás R$157,82", "- Mercado: R$ 568,99", "Ração gatos: R$199,99", com hora de mensagem opcional no fim
// ("14:32") e os vistos do aplicativo de conversa.
var listLineRe = regexp.MustCompile(`^[ \t]*(?:[-•*·–][ \t]*)?(.*?)[ \t]*[:=\-–]?[ \t]*R[ \t]?[$S][ \t]*(\d{1,3}(?:\.\d{3})+|\d+)[,.](\d{2})\b[ \t]*(?:\d{1,2}:\d{2})?[ \t]*[✓✔]*(?:[ \t]+\S{1,8}){0,3}[ \t]*$`)

// Um algarismo (ou dois) sozinho antes de uma palavra, no começo da descrição, é ruído de OCR, não parte do nome.
// (RE2, o regex do Go, não tem lookahead: por isso o resto da descrição vai num grupo.)
var leadingNoiseRe = regexp.MustCompile(`^\p{P}*\d{1,2}\s+(\p{L}{2}.*)$`)

// Separa itens na mesma linha ("Gás R$157,82 / Mercado R$568,99"): só quando a linha tem mais de um valor.
var itemSeparatorRe = regexp.MustCompile(`[ \t]+[/;|][ \t]+`)

// Descrições que são rótulo de soma, não conta.
var notItemRe = regexp.MustCompile(`(?i)^(?:sub)?total(?:\s+(?:a\s+pagar|geral))?$|^valor(?:\s+total)?$|^saldo$`)

func findListItems(body string) []Item {
	var out []Item
	for _, line := range strings.Split(body, "\n") {
		parts := []string{line}
		if len(currencyRe.FindAllStringIndex(line, -1)) > 1 {
			parts = itemSeparatorRe.Split(line, -1)
		}
		for _, p := range parts {
			m := listLineRe.FindStringSubmatch(p)
			if m == nil {
				continue
			}
			desc := cleanDescription(m[1])
			cents := moneyCents(m[2], m[3])
			if desc == "" || cents <= 0 || notItemRe.MatchString(desc) {
				continue
			}
			out = append(out, Item{Description: desc, AmountCents: cents})
		}
	}
	return out
}

// cleanDescription tira pontuação das pontas e espaços repetidos; exige ao menos uma letra e corta em 120 caracteres
// (o limite da descrição da conta).
func cleanDescription(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	// OCR de print de conversa lê o marcador da linha como um algarismo solto ("1 Ração gatos"): descarta.
	s = leadingNoiseRe.ReplaceAllString(s, "$1")
	s = strings.TrimFunc(s, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != ')' })
	if !strings.ContainsFunc(s, unicode.IsLetter) {
		return ""
	}
	if r := []rune(s); len(r) > 120 {
		s = string(r[:120])
	}
	return s
}

// serviceNames: palavras do documento que dizem o tipo da conta, na ordem de prioridade, e o nome curto sugerido.
// Só usado quando nenhum nome de empresa foi lido; a pessoa sempre pode trocar a descrição ao revisar.
var serviceNames = []struct{ keyword, name string }{
	{"energia elétrica", "Luz"}, {"energia eletrica", "Luz"}, {"energia elet", "Luz"},
	{"gás natural", "Gás"}, {"gas natural", "Gás"},
	{"saneamento", "Água"}, {"abastecimento de água", "Água"}, {"abastecimento de agua", "Água"},
	{"comunicação eletrônica", "Internet"}, {"comunicacao eletronica", "Internet"}, {"banda larga", "Internet"},
	{"telefonia", "Telefone"},
}

func serviceName(body string) string {
	low := strings.ToLower(body)
	for _, s := range serviceNames {
		if strings.Contains(low, s.keyword) {
			return s.name
		}
	}
	return ""
}
