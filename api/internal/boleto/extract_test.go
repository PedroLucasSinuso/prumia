package boleto

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/makiuchi-d/gozxing"
	"github.com/makiuchi-d/gozxing/oned"
)

const (
	exampleLine    = "00190.50095 40144.816069 06809.350314 3 37370000000100"
	exampleBarcode = "00193373700000001000500940144816060680935031"
)

var (
	pdfBytes = []byte("%PDF-1.4 falso")
	pngBytes = append([]byte("\x89PNG\r\n\x1a\n"), 0, 0, 0)
	ref2007  = time.Date(2007, 12, 1, 0, 0, 0, 0, time.UTC)
)

func extractor() *Extractor { return &Extractor{Now: func() time.Time { return ref2007 }} }

func TestFindInText(t *testing.T) {
	cases := map[string]string{
		"linha com pontos":  "Pagador: Maria\nBeneficiário: LOJA EXEMPLO LTDA\n" + exampleLine + "\nValor 1,00",
		"colada em outros":  "Nosso número 123456789 " + strings.ReplaceAll(exampleLine, " ", "") + " fim",
		"quebrada em linha": "00190.50095 40144.816069\n06809.350314 3 37370000000100",
		"só o código":       "Código: " + exampleBarcode,
	}
	for name, text := range cases {
		t.Run(name, func(t *testing.T) {
			b, ok := FindInText(text, ref2007)
			if !ok {
				t.Fatal("não achou")
			}
			if b.Barcode != exampleBarcode || b.AmountCents != 100 {
				t.Errorf("leu %+v", b)
			}
		})
	}
	if b, _ := FindInText("Beneficiário: LOJA EXEMPLO LTDA\n"+exampleLine, ref2007); b.Beneficiary != "LOJA EXEMPLO LTDA" {
		t.Errorf("beneficiário = %q", b.Beneficiary)
	}
	if b, _ := FindInText("Beneficiário\nPADARIA DO ZÉ\n"+exampleLine, ref2007); b.Beneficiary != "PADARIA DO ZÉ" {
		t.Errorf("beneficiário na linha de baixo = %q", b.Beneficiary)
	}
}

func TestFindInTextIgnoresInvalidNumbers(t *testing.T) {
	// mesma linha com um dígito trocado: não pode ser aceita
	text := "00190.50095 40144.816069 06809.350314 3 37370000000101"
	if _, ok := FindInText(text, ref2007); ok {
		t.Error("aceitou linha com dígito errado")
	}
	if _, ok := FindInText("CPF 123.456.789-09 protocolo 2026102000000000001", ref2007); ok {
		t.Error("achou boleto em texto sem boleto")
	}
}

func TestExtractCascade(t *testing.T) {
	ctx := context.Background()
	t.Run("texto do PDF", func(t *testing.T) {
		e := extractor()
		e.PDFText = func(context.Context, []byte, string) (string, error) { return exampleLine, nil }
		r, err := e.Extract(ctx, pdfBytes, "")
		if err != nil || r.Method != MethodPDFText {
			t.Fatalf("%v %v", r.Method, err)
		}
	})
	t.Run("PDF sem texto cai para o código de barras", func(t *testing.T) {
		e := extractor()
		e.PDFText = func(context.Context, []byte, string) (string, error) { return "", nil }
		e.Rasterize = func(context.Context, []byte, string, int) ([]byte, error) { return pngBytes, nil }
		e.Barcode = func([]byte) (string, error) { return exampleBarcode, nil }
		r, err := e.Extract(ctx, pdfBytes, "")
		if err != nil || r.Method != MethodBarcodeImage || r.DigitableLine != digits(exampleLine) {
			t.Fatalf("%+v %v", r, err)
		}
	})
	t.Run("sem código de barras cai para o OCR", func(t *testing.T) {
		e := extractor()
		e.Barcode = func([]byte) (string, error) { return "", errors.New("nada") }
		e.OCR = func(context.Context, []byte) (string, error) { return "texto " + exampleLine, nil }
		r, err := e.Extract(ctx, pngBytes, "")
		if err != nil || r.Method != MethodOCR {
			t.Fatalf("%v %v", r.Method, err)
		}
	})
	t.Run("código de barras inválido não é aceito", func(t *testing.T) {
		e := extractor()
		e.Barcode = func([]byte) (string, error) { return strings.Repeat("1", 44), nil }
		if _, err := e.Extract(ctx, pngBytes, ""); !errors.Is(err, ErrNotFound) {
			t.Fatalf("erro = %v", err)
		}
	})
	t.Run("OCR com números errados é recusado", func(t *testing.T) {
		e := extractor()
		e.OCR = func(context.Context, []byte) (string, error) {
			return strings.Replace(exampleLine, "816069", "816060", 1), nil
		}
		if _, err := e.Extract(ctx, pngBytes, ""); !errors.Is(err, ErrNotFound) {
			t.Fatalf("erro = %v", err)
		}
	})
	t.Run("senha", func(t *testing.T) {
		e := extractor()
		e.PDFText = func(_ context.Context, _ []byte, pw string) (string, error) {
			switch pw {
			case "":
				return "", ErrPasswordRequired
			case "certa":
				return exampleLine, nil
			}
			return "", ErrWrongPassword
		}
		if _, err := e.Extract(ctx, pdfBytes, ""); !errors.Is(err, ErrPasswordRequired) {
			t.Errorf("sem senha: %v", err)
		}
		if _, err := e.Extract(ctx, pdfBytes, "errada"); !errors.Is(err, ErrWrongPassword) {
			t.Errorf("senha errada: %v", err)
		}
		if _, err := e.Extract(ctx, pdfBytes, "certa"); err != nil {
			t.Errorf("senha certa: %v", err)
		}
	})
	t.Run("formato desconhecido", func(t *testing.T) {
		if _, err := extractor().Extract(ctx, []byte("MZ executável"), ""); !errors.Is(err, ErrUnsupported) {
			t.Fatalf("erro = %v", err)
		}
	})
}

// Barcode lê um ITF de verdade: desenhamos o código com o codificador da própria biblioteca e relemos.
func TestBarcodeRoundTrip(t *testing.T) {
	matrix, err := oned.NewITFWriter().Encode(exampleBarcode, gozxing.BarcodeFormat_ITF, 900, 120, nil)
	if err != nil {
		t.Fatal(err)
	}
	img := image.NewGray(image.Rect(0, 0, matrix.GetWidth(), matrix.GetHeight()))
	for y := 0; y < matrix.GetHeight(); y++ {
		for x := 0; x < matrix.GetWidth(); x++ {
			c := color.Gray{Y: 255}
			if matrix.Get(x, y) {
				c = color.Gray{Y: 0}
			}
			img.SetGray(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	got, err := Barcode(buf.Bytes())
	if err != nil || got != exampleBarcode {
		t.Fatalf("leu %q: %v", got, err)
	}
	e := &Extractor{Barcode: Barcode, Now: func() time.Time { return ref2007 }}
	r, err := e.Extract(context.Background(), buf.Bytes(), "")
	if err != nil || r.Method != MethodBarcodeImage || r.AmountCents != 100 {
		t.Fatalf("%+v %v", r, err)
	}
}

// Com as ferramentas reais instaladas (pdftotext e Ghostscript), um PDF de verdade, com e sem senha.
func TestRealPDFTools(t *testing.T) {
	for _, tool := range []string{"pdftotext", "gs"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s não instalado", tool)
		}
	}
	ps := "%!PS\n/Courier findfont 12 scalefont setfont\n72 700 moveto (Beneficiario: LOJA EXEMPLO LTDA) show\n72 680 moveto (" + exampleLine + ") show\nshowpage\n"
	plain := gsPDF(t, ps, nil)
	locked := gsPDF(t, ps, []string{"-sOwnerPassword=dono", "-sUserPassword=segredo"})

	e := extractor()
	e.PDFText, e.Rasterize = PDFText, Rasterize

	r, err := e.Extract(context.Background(), plain, "")
	if err != nil || r.Method != MethodPDFText || r.Barcode != exampleBarcode || r.Beneficiary != "LOJA EXEMPLO LTDA" {
		t.Fatalf("PDF simples: %+v %v", r, err)
	}
	if _, err := e.Extract(context.Background(), locked, ""); !errors.Is(err, ErrPasswordRequired) {
		t.Errorf("sem senha: %v", err)
	}
	if _, err := e.Extract(context.Background(), locked, "errada"); !errors.Is(err, ErrWrongPassword) {
		t.Errorf("senha errada: %v", err)
	}
	if r, err := e.Extract(context.Background(), locked, "segredo"); err != nil || r.Barcode != exampleBarcode {
		t.Errorf("senha certa: %+v %v", r, err)
	}
	// rasterização funciona (usada quando o PDF não tem camada de texto)
	if img, err := Rasterize(context.Background(), plain, "", 1); err != nil || !bytes.HasPrefix(img, []byte("\x89PNG")) {
		t.Errorf("rasterizar: %v", err)
	}
}

// pngComDimensoes devolve um PNG válido (1x1) com o cabeçalho reescrito para dizer w x h: poucos bytes que, ao
// decodificar, pediriam w*h*4 bytes de memória ("bomba de descompressão").
func pngComDimensoes(t *testing.T, w, h uint32) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewGray(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	// assinatura (8) + tamanho (4) + "IHDR" (4): largura no byte 16, altura no 20, CRC do bloco no 29
	binary.BigEndian.PutUint32(b[16:], w)
	binary.BigEndian.PutUint32(b[20:], h)
	binary.BigEndian.PutUint32(b[29:], crc32.ChecksumIEEE(b[12:29]))
	return b
}

// Imagem com dimensões absurdas não chega ao decodificador nem ao Tesseract: um PNG de poucos bytes declarando
// 60000x60000 pedia ~14 GB de memória no image.Decode e derrubava a API para todo mundo.
func TestImagemGiganteEhRecusadaSemDecodificar(t *testing.T) {
	bomb := pngComDimensoes(t, 60000, 60000)
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(bomb)); err != nil || cfg.Width != 60000 {
		t.Fatalf("PNG de teste malformado: %+v %v", cfg, err)
	}
	e := extractor()
	e.Barcode = func([]byte) (string, error) {
		t.Error("Barcode chamado com imagem gigante")
		return "", errors.New("x")
	}
	e.OCR = func(context.Context, []byte) (string, error) {
		t.Error("OCR chamado com imagem gigante")
		return "", errors.New("x")
	}
	if _, err := e.Extract(context.Background(), bomb, ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("erro = %v", err)
	}
	// a página que o Ghostscript desenha passa pela mesma checagem
	e.Rasterize = func(context.Context, []byte, string, int) ([]byte, error) { return bomb, nil }
	if _, err := e.Extract(context.Background(), pdfBytes, ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("erro (PDF) = %v", err)
	}
	// o leitor real de código de barras também se recusa
	if _, err := Barcode(bomb); err == nil {
		t.Error("Barcode aceitou imagem gigante")
	}
	// imagem de tamanho normal (foto de 12 MP) segue a cascata
	called := false
	e = extractor()
	e.Barcode = func([]byte) (string, error) { called = true; return exampleBarcode, nil }
	if _, err := e.Extract(context.Background(), pngComDimensoes(t, 4000, 3000), ""); err != nil || !called {
		t.Errorf("imagem normal: chamado=%v erro=%v", called, err)
	}
}

func gsPDF(t *testing.T, ps string, extra []string) []byte {
	t.Helper()
	args := append([]string{"-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite"}, extra...)
	args = append(args, "-sOutputFile=-", "-")
	cmd := exec.Command("gs", args...)
	cmd.Stdin = strings.NewReader(ps)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("gs: %v", err)
	}
	return out
}

// Trechos reais de contas de consumo (dados pessoais removidos): o rótulo e o valor podem vir em linhas separadas.
func TestFindInTextMetadados(t *testing.T) {
	ref := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	gas := "GASCO DISTRIBUIDORA S/A − Rua Exemplo, 100 CNPJ: 11.222-333/0001-81.\nMês:\nVencimento:\nOUT/2026\n10/11/2026\n" +
		"Mês: OUT/2026\nVencimento: 10/11/2026\n83630000001-2 23451112223-1 33444555666-8 77788899900-3"
	b, ok := FindInText(gas, ref)
	if !ok {
		t.Fatal("linha de 48 dígitos não encontrada")
	}
	if b.Beneficiary != "GASCO DISTRIBUIDORA S/A" {
		t.Errorf("beneficiário = %q", b.Beneficiary)
	}
	if got := b.DueDate.Format("2006-01-02"); got != "2026-11-10" {
		t.Errorf("vencimento = %s", got)
	}
	if got := b.Competence.Format("2006-01-02"); got != "2026-10-01" {
		t.Errorf("competência = %s", got)
	}

	net := "RAZÃO SOCIAL: NETLINK PROVEDOR LTDA\nReferência: 10/2026\nVencimento: 10/10/2026\n" +
		"00190.05008 94014.481603 60680.935032 8 15950000005000"
	b, ok = FindInText(net, ref)
	if !ok {
		t.Fatal("linha de 47 dígitos não encontrada")
	}
	if b.Beneficiary != "NETLINK PROVEDOR LTDA" || b.Competence.Format("2006-01") != "2026-10" {
		t.Errorf("netlink: %q %v", b.Beneficiary, b.Competence)
	}
	// O vencimento do código de barras prevalece sobre o texto.
	if got := b.DueDate.Format("2006-01-02"); got != "2026-10-10" {
		t.Errorf("vencimento = %s", got)
	}
}

func TestDatasImpossiveisSaoIgnoradas(t *testing.T) {
	if d := findDueDate("Vencimento: 31/02/2026"); !d.IsZero() {
		t.Errorf("31/02 aceito: %v", d)
	}
	if d := findCompetence("Mês: XYZ/2026 Referência: 13/2026"); !d.IsZero() {
		t.Errorf("mês inválido aceito: %v", d)
	}
}
