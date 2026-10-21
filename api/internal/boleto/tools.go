package boleto

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // registra o decodificador de JPEG em image.Decode
	_ "image/png"  // idem para PNG
	"io"
	"os/exec"
	"strings"
	"time"

	"github.com/makiuchi-d/gozxing"
	"github.com/makiuchi-d/gozxing/oned"
)

// maxToolOutput limita o que lemos de uma ferramenta externa (uma página de PDF a 200 dpi tem poucos MB).
const maxToolOutput = 32 << 20

const toolTimeout = 25 * time.Second

// run executa uma ferramenta SEM shell (argumentos fixos, nada vindo do usuário vira comando), alimentando o arquivo
// pela entrada padrão e lendo a saída padrão: o boleto nunca vira arquivo nosso.
// A saída de erro volta só para classificar o motivo e NUNCA é registrada ou devolvida (pode conter trechos do documento).
func run(ctx context.Context, stdin []byte, name string, args ...string) (stdout, stderr []byte, err error) {
	ctx, cancel := context.WithTimeout(ctx, toolTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdin = bytes.NewReader(stdin)
	var out, errb bytes.Buffer
	cmd.Stdout = &limitedWriter{w: &out, left: maxToolOutput}
	cmd.Stderr = &limitedWriter{w: &errb, left: 64 << 10}
	err = cmd.Run()
	return out.Bytes(), errb.Bytes(), err
}

type limitedWriter struct {
	w    io.Writer
	left int
}

func (l *limitedWriter) Write(p []byte) (int, error) {
	if len(p) > l.left {
		p = p[:l.left]
	}
	l.left -= len(p)
	if len(p) == 0 {
		return 0, io.ErrShortWrite
	}
	return l.w.Write(p)
}

func passwordError(stderr []byte, password string) error {
	s := strings.ToLower(string(stderr))
	if strings.Contains(s, "password") {
		if password == "" {
			return ErrPasswordRequired
		}
		return ErrWrongPassword
	}
	return nil
}

// PDFText usa o pdftotext (poppler). A senha vai como argumento do processo filho, visível só dentro do container.
func PDFText(ctx context.Context, pdf []byte, password string) (string, error) {
	args := []string{"-enc", "UTF-8", "-nopgbrk"}
	if password != "" {
		args = append(args, "-upw", password)
	}
	args = append(args, "-", "-")
	out, errOut, err := run(ctx, pdf, "pdftotext", args...)
	if err != nil {
		if perr := passwordError(errOut, password); perr != nil {
			return "", perr
		}
		return "", fmt.Errorf("pdftotext: %w", sanitize(err))
	}
	return string(out), nil
}

// Rasterize usa o Ghostscript (-dSAFER) para desenhar uma página do PDF em PNG a 200 dpi.
func Rasterize(ctx context.Context, pdf []byte, password string, page int) ([]byte, error) {
	args := []string{"-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=png16m", "-r200",
		fmt.Sprintf("-dFirstPage=%d", page), fmt.Sprintf("-dLastPage=%d", page), "-sOutputFile=-"}
	if password != "" {
		args = append(args, "-sPDFPassword="+password)
	}
	args = append(args, "-")
	out, errOut, err := run(ctx, pdf, "gs", args...)
	if err != nil {
		if perr := passwordError(errOut, password); perr != nil {
			return nil, perr
		}
		return nil, fmt.Errorf("gs: %w", sanitize(err))
	}
	if len(out) == 0 {
		return nil, errors.New("página inexistente")
	}
	return out, nil
}

// OCR usa o Tesseract em português. Os dígitos do boleto saem bem; os números lidos ainda passam pela validação.
func OCR(ctx context.Context, img []byte) (string, error) {
	out, _, err := run(ctx, img, "tesseract", "stdin", "stdout", "-l", "por", "--psm", "6")
	if err != nil {
		return "", fmt.Errorf("tesseract: %w", sanitize(err))
	}
	return string(out), nil
}

// sanitize descarta detalhes do erro do processo (podem trazer a linha de comando, e com ela a senha do PDF).
func sanitize(err error) error {
	var ee *exec.ExitError
	switch {
	case errors.Is(err, exec.ErrNotFound):
		return errors.New("ferramenta não instalada")
	case errors.As(err, &ee):
		return fmt.Errorf("saída %d", ee.ExitCode())
	case errors.Is(err, context.DeadlineExceeded):
		return errors.New("tempo esgotado")
	}
	return errors.New("falha ao executar")
}

// Barcode procura um código de barras do tipo ITF (o dos boletos) na imagem e devolve seus dígitos.
func Barcode(img []byte) (string, error) {
	im, _, err := image.Decode(bytes.NewReader(img))
	if err != nil {
		return "", err
	}
	bmp, err := gozxing.NewBinaryBitmapFromImage(im)
	if err != nil {
		return "", err
	}
	hints := map[gozxing.DecodeHintType]interface{}{
		gozxing.DecodeHintType_TRY_HARDER:       true,
		gozxing.DecodeHintType_POSSIBLE_FORMATS: []gozxing.BarcodeFormat{gozxing.BarcodeFormat_ITF},
	}
	res, err := oned.NewITFReader().Decode(bmp, hints)
	if err != nil {
		return "", err
	}
	return res.GetText(), nil
}

// NewExtractor devolve o extrator com as ferramentas reais. Ferramentas ausentes simplesmente pulam sua etapa.
func NewExtractor() *Extractor {
	return &Extractor{PDFText: PDFText, Rasterize: Rasterize, Barcode: Barcode, OCR: OCR}
}
