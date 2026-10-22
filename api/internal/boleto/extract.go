package boleto

import (
	"bytes"
	"context"
	"errors"
	"image"
	"regexp"
	"strings"
	"time"
)

// Method diz como o boleto foi lido (é mostrado ao usuário: OCR merece mais atenção na revisão).
type Method string

const (
	MethodPDFText      Method = "pdf_text"
	MethodBarcodeImage Method = "barcode_image"
	MethodOCR          Method = "ocr"
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
						b.Beneficiary = findBeneficiary(text)
						return b, true
					}
				}
			}
		}
	}
	return Boleto{}, false
}

func findBeneficiary(text string) string {
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
