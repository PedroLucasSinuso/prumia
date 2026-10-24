package boleto

import (
	"bytes"
	"context"
	"errors"
	"image"
	"regexp"
	"strings"
	"time"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/cnpj"
)

// Method diz como o boleto foi lido (é mostrado ao usuário: OCR merece mais atenção na revisão).
type Method string

const (
	MethodPDFText      Method = "pdf_text"
	MethodBarcodeImage Method = "barcode_image"
	MethodOCR          Method = "ocr"
	MethodText         Method = "text" // texto escrito ou colado (sem arquivo, sem OCR)
)

var (
	ErrPasswordRequired = errors.New("o PDF exige senha")
	ErrWrongPassword    = errors.New("senha do PDF incorreta")
	ErrUnsupported      = errors.New("formato de arquivo não suportado")
	ErrNotFound         = errors.New("não foi possível ler um boleto válido no arquivo")
)

// Result é o boleto lido e o caminho que o encontrou.
type Result struct {
	Boleto
	Method Method
}

// Extractor roda a cascata de leitura. Cada etapa é uma função para que os testes troquem as ferramentas
// externas (pdftotext, ghostscript, tesseract) por dublês; nil = etapa indisponível e é pulada.
// Em Go, uma struct de funções faz o papel de uma interface pequena que o PHP resolveria com injeção de dependência.
type Extractor struct {
	// PDFText devolve o texto do PDF. Deve devolver ErrPasswordRequired / ErrWrongPassword quando for o caso.
	PDFText func(ctx context.Context, pdf []byte, password string) (string, error)
	// Rasterize devolve a página (1, 2…) do PDF como PNG.
	Rasterize func(ctx context.Context, pdf []byte, password string, page int) ([]byte, error)
	// Barcode devolve os dígitos do código de barras (ITF) encontrado na imagem.
	Barcode func(img []byte) (string, error)
	// OCR devolve o texto reconhecido na imagem.
	OCR func(ctx context.Context, img []byte) (string, error)
	// Now define o "hoje" usado para resolver o fator de vencimento.
	Now func() time.Time
}

const maxPDFPages = 2 // boleto quase sempre está na 1ª página; limitar mantém o custo previsível

type fileKind int

const (
	kindUnknown fileKind = iota
	kindPDF
	kindImage
)

func sniff(b []byte) fileKind {
	switch {
	case bytes.HasPrefix(b, []byte("%PDF-")):
		return kindPDF
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")), bytes.HasPrefix(b, []byte("\xff\xd8\xff")):
		return kindImage
	}
	return kindUnknown
}

// Extract lê o boleto de um arquivo (PDF, PNG ou JPEG) que está só em memória.
func (e *Extractor) Extract(ctx context.Context, data []byte, password string) (Result, error) {
	now := time.Now
	if e.Now != nil {
		now = e.Now
	}
	ref := now()

	switch sniff(data) {
	case kindPDF:
		return e.fromPDF(ctx, data, password, ref)
	case kindImage:
		return e.fromImage(ctx, data, ref)
	}
	return Result{}, ErrUnsupported
}

func (e *Extractor) fromPDF(ctx context.Context, pdf []byte, password string, ref time.Time) (Result, error) {
	if e.PDFText != nil {
		text, err := e.PDFText(ctx, pdf, password)
		switch {
		case errors.Is(err, ErrPasswordRequired), errors.Is(err, ErrWrongPassword):
			return Result{}, err
		case err == nil:
			if b, ok := FindInText(text, ref); ok {
				return Result{Boleto: b, Method: MethodPDFText}, nil
			}
		}
		// Qualquer outro erro (ferramenta ausente, PDF só de imagem) cai para as próximas etapas.
	}
	if e.Rasterize == nil {
		return Result{}, ErrNotFound
	}
	for page := 1; page <= maxPDFPages; page++ {
		img, err := e.Rasterize(ctx, pdf, password, page)
		if err != nil {
			if errors.Is(err, ErrPasswordRequired) || errors.Is(err, ErrWrongPassword) {
				return Result{}, err
			}
			break // sem mais páginas ou ferramenta indisponível
		}
		if r, err := e.fromImage(ctx, img, ref); err == nil {
			return r, nil
		}
	}
	return Result{}, ErrNotFound
}

// maxImagePixels limita o tamanho da imagem ANTES de decodificar: o cabeçalho de um PNG/JPEG de poucos KB pode
// declarar 60000x60000 pixels, e decodificar isso pede GBs de memória (derruba a API para todos). 40 MP cobre foto
// de celular (12 a 48 MP) e a página de PDF a 200 dpi (~4 MP).
const maxImagePixels = 40_000_000

var errImageTooLarge = errors.New("imagem grande demais")

// checkImageSize lê só o cabeçalho. Se nem o cabeçalho for legível, deixa seguir: a decodificação vai falhar sozinha.
func checkImageSize(img []byte) error {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(img))
	if err == nil && int64(cfg.Width)*int64(cfg.Height) > maxImagePixels {
		return errImageTooLarge
	}
	return nil
}

func (e *Extractor) fromImage(ctx context.Context, img []byte, ref time.Time) (Result, error) {
	if checkImageSize(img) != nil {
		return Result{}, ErrNotFound
	}
	if e.Barcode != nil {
		if code, err := e.Barcode(img); err == nil {
			if b, err := ParseBarcode(code, ref); err == nil {
				return Result{Boleto: b, Method: MethodBarcodeImage}, nil
			}
		}
	}
	if e.OCR != nil {
		if text, err := e.OCR(ctx, img); err == nil {
			if b, ok := FindInText(text, ref); ok {
				return Result{Boleto: b, Method: MethodOCR}, nil
			}
		}
	}
	return Result{}, ErrNotFound
}

// Sequências que podem ser uma linha digitável: dígitos separados por ponto, espaço ou hífen.
var candidate = regexp.MustCompile(`[0-9][0-9. \-]{40,80}[0-9]`)

var beneficiaryRe = regexp.MustCompile(`(?im)^\s*(?:benefici[aá]rio|cedente|ben[eé]ficiaire)\s*[:\-]?\s*(.*)$`)

// FindInText procura no texto a primeira linha digitável (47/48 dígitos) ou código de barras (44) que passe nos dígitos verificadores.
// O texto de PDF e de OCR traz muito ruído, mas a validação dos dígitos torna falso positivo praticamente impossível.
func FindInText(text string, ref time.Time) (Boleto, bool) {
	for _, src := range []string{text, strings.ReplaceAll(text, "\n", " ")} {
		for _, m := range candidate.FindAllString(src, -1) {
			d := digits(m)
			// Janela deslizante: o trecho pode vir colado a outros números (ex.: nosso número antes da linha).
			for _, size := range []int{47, 48, 44} {
				for i := 0; i+size <= len(d); i++ {
					w := d[i : i+size]
					var b Boleto
					var err error
					if size == 44 {
						b, err = ParseBarcode(w, ref)
					} else {
						b, err = Parse(w, ref)
					}
					if err == nil {
						enrich(&b, text, ref)
						return b, true
					}
				}
			}
		}
	}
	return Boleto{}, false
}

// enrich completa o boleto com o que só o texto do documento diz: beneficiário, vencimento (conta de consumo não
// o traz no código de barras) e competência. O vencimento do código de barras, quando existe, sempre prevalece.
func enrich(b *Boleto, text string, ref time.Time) {
	b.Beneficiary = findBeneficiary(text)
	if b.DueDate.IsZero() {
		b.DueDate = findDueDate(text)
	}
	b.Competence = findCompetence(text)
	b.BeneficiaryCNPJ = findCNPJ(text)
}

var (
	dueDateRe = regexp.MustCompile(`(?i)vencimento\s*:?\s*(\d{2})/(\d{2})/(\d{4})`)
	// "Referência: 10/2026", "Mês: OUT/2026", "Competência 10/2026", "Mês de referência: outubro/2026", "REF: JUN/2026".
	competenceRe = regexp.MustCompile(`(?i)(?:compet[eê]ncia|refer[eê]ncia|\bref\b\.?|m[eê]s(?: de refer[eê]ncia)?)\s*:?\s*(\d{1,2}|[a-zç]{3,9})\s*/\s*(\d{4})`)
	// Razão social: palavras com inicial maiúscula (ou tudo maiúsculo) terminadas em tipo societário, na mesma linha:
	// "GASCO DISTRIBUIDORA S/A", "Gasco Distribuidora SA", "Netlink Provedor Ltda". "SA"/"ME" só em maiúsculas
	// (em minúsculas são palavras comuns); "Ltda"/"Eireli"/"S.A." em qualquer caixa. Conectivos (de, da, do, e) são aceitos.
	companyRe = regexp.MustCompile(`((?:[A-ZÀ-Ú][\p{L}0-9&.'-]*[ \t]+(?:(?:de|da|do|dos|das|e)[ \t]+)?){1,8}?)(S/A|(?i:s\.a\.?)|SA|(?i:ltda)\.?|(?i:eireli)|S/S|EPP|ME)(?:\s|$|[-−–,.])`)
	// "Razão social: X" e "Nome / Razão Social: X" (o valor pode vir na linha de baixo).
	razaoRe = regexp.MustCompile(`(?im)^[ \t]*(?:nome[ \t]*/[ \t]*)?raz[aã]o[ \t]+social[ \t]*:?[ \t]*(.*)$`)
)

var months = map[string]time.Month{
	"jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6,
	"jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12,
}

// findDueDate lê "Vencimento: dd/mm/aaaa" (o valor pode vir na linha de baixo) ou, se não houver, a coluna
// "Vencimento" de uma tabela (rótulos numa linha, valores na seguinte; ver table.go).
func findDueDate(text string) time.Time {
	if m := dueDateRe.FindStringSubmatch(text); m != nil {
		if d := validDate(m[3], m[2], m[1]); !d.IsZero() {
			return d
		}
	}
	return readTable(text).due
}

func validDate(y, mo, d string) time.Time {
	year, month, day := toInt(y), toInt(mo), toInt(d)
	t := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	// time.Date "normaliza" 31/02 para março: comparar de volta rejeita datas impossíveis.
	if year < 2000 || t.Day() != day || int(t.Month()) != month {
		return time.Time{}
	}
	return t
}

// findCompetence devolve o dia 1 do mês de referência, ou zero. Aceita mês numérico ou abreviado/extenso em português.
func findCompetence(text string) time.Time {
	for _, m := range competenceRe.FindAllStringSubmatch(text, -1) {
		if month := monthOf(m[1]); month != 0 {
			if y := toInt(m[2]); y >= 2000 && y <= 2100 {
				return time.Date(y, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
			}
		}
	}
	return readTable(text).competence
}

// monthOf converte "06", "6", "jun" ou "junho" no número do mês (0 = inválido).
func monthOf(s string) int {
	if s == "" {
		return 0
	}
	if s[0] >= '0' && s[0] <= '9' {
		if m := toInt(s); m >= 1 && m <= 12 {
			return m
		}
		return 0
	}
	r := []rune(strings.ToLower(s))
	if len(r) < 3 {
		return 0
	}
	return int(months[string(r[:3])])
}

func findBeneficiary(text string) string {
	if name := findRazao(text); name != "" {
		return name
	}
	if name := findLabeledBeneficiary(text); name != "" {
		return name
	}
	// Sem rótulo: a primeira razão social do documento costuma ser a de quem emitiu (conta de consumo).
	if m := companyRe.FindStringSubmatch(text); m != nil {
		return cleanName(m[1] + " " + m[2])
	}
	return ""
}

// findRazao lê o valor do rótulo "Razão social" / "Nome / Razão Social", na mesma linha ou na de baixo. Numa tabela
// ("Nome / Razão Social   CNPJ" e os valores embaixo) o que vem depois do nome (outra coluna, o CNPJ) é cortado.
func findRazao(text string) string {
	loc := razaoRe.FindStringSubmatchIndex(text)
	if loc == nil {
		return ""
	}
	name := cutColumn(text[loc[2]:loc[3]])
	if name == "" || otherLabelRe.MatchString(name) {
		rest := strings.SplitN(text[loc[1]:], "\n", 3)
		if len(rest) < 2 {
			return ""
		}
		name = cutColumn(rest[1])
	}
	if len(digits(name)) > len(name)/2 {
		return ""
	}
	return cleanName(name)
}

var (
	// O que termina a coluna do nome: "|", tabulação ou 2+ espaços (pdftotext -layout/OCR), o rótulo CNPJ/CPF ou um número longo.
	columnEndRe  = regexp.MustCompile(`(?i)\||\t|\s{2,}|\bcnpj\b|\bcpf\b|\d{2}[. ]?\d{3}[. ]?\d{3}`)
	otherLabelRe = regexp.MustCompile(`(?i)^(?:cnpj|cpf|endere[cç]o|inscri[cç][aã]o)`)
)

func cutColumn(s string) string {
	s = strings.TrimLeft(s, " \t:|-")
	if loc := columnEndRe.FindStringIndex(s); loc != nil {
		s = s[:loc[0]]
	}
	return strings.TrimRight(strings.TrimSpace(s), ":-,")
}

func cleanName(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}

func findLabeledBeneficiary(text string) string {
	lines := strings.Split(text, "\n")
	for i, l := range lines {
		m := beneficiaryRe.FindStringSubmatch(l)
		if m == nil {
			continue
		}
		name := strings.TrimSpace(m[1])
		if name == "" && i+1 < len(lines) { // o nome costuma vir na linha de baixo do rótulo
			name = strings.TrimSpace(lines[i+1])
		}
		if len(name) > 120 {
			name = name[:120]
		}
		if name != "" && len(digits(name)) < len(name)/2 { // descarta "nome" que é só número
			return name
		}
	}
	return ""
}

func toInt(s string) int {
	n := 0
	for _, r := range s {
		n = n*10 + int(r-'0')
	}
	return n
}

// cnpjRe aceita as máscaras que aparecem em PDF e OCR, inclusive fora do padrão ("11.222-333/0001-81"). Exige a barra: sem ela,
// um CPF (11 dígitos) ou qualquer número longo não vira candidato.
var cnpjRe = regexp.MustCompile(`\d{2}[. ]?\d{3}[.\- ]?\d{3}\s?/\s?\d{4}\s?-?\s?\d{2}`)

// findCNPJ devolve o CNPJ (só dígitos) de quem recebe. Só vale o que passa nos dígitos verificadores. Com rótulo
// ("Razão social", "Beneficiário", "Cedente"), prefere o primeiro CNPJ a partir dele, porque o documento também pode
// trazer o CNPJ do pagador; sem rótulo, o primeiro válido.
func findCNPJ(text string) string {
	start := 0
	if loc := labelRe.FindStringIndex(text); loc != nil {
		start = loc[0]
	}
	for _, from := range []int{start, 0} {
		for _, m := range cnpjRe.FindAllString(text[from:], -1) {
			if cnpj.Valid(m) {
				return cnpj.Digits(m)
			}
		}
	}
	return ""
}

var labelRe = regexp.MustCompile(`(?i)raz[aã]o social|benefici[aá]rio|cedente`)
