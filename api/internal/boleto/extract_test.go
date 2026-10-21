package boleto

import (
	"bytes"
	"context"
	"errors"
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
