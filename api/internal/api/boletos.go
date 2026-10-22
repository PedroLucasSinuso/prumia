package api

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/boleto"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/ratelimit"
)

const (
	maxBoletoFile = 5 << 20 // 5 MB, como no contrato
	maxPassword   = 256
	// Folga para os cabeçalhos do multipart; o limite real do arquivo é conferido ao ler a parte.
	maxBoletoBody  = maxBoletoFile + 64<<10
	extractTimeout = 60 * time.Second
)

// DuplicateFinder diz se já existe invoice com a linha digitável (interface mínima, definida onde é usada).
type DuplicateFinder interface {
	FindDuplicate(ctx context.Context, householdID uuid.UUID, line string) (*uuid.UUID, error)
}

// Boletos implementa POST /households/{id}/boletos/extract. O arquivo vive só na memória desta requisição.
type Boletos struct {
	Extractor *boleto.Extractor
	Dup       DuplicateFinder
	Log       *slog.Logger
	// Limite por usuário: a leitura (PDF/OCR) é a operação mais cara do servidor.
	limiter *ratelimit.Limiter
	// slots limita quantas leituras rodam AO MESMO TEMPO no servidor inteiro (cada uma pode subir Ghostscript e
	// Tesseract, que comem CPU e memória). Canal com buffer = semáforo: ocupar um lugar é enviar, liberar é receber.
	slots chan struct{}
}

// maxConcurrentExtractions: leituras simultâneas. As demais esperam a vez (até o tempo da requisição acabar).
const maxConcurrentExtractions = 2

func NewBoletos(ex *boleto.Extractor, dup DuplicateFinder, log *slog.Logger) *Boletos {
	return &Boletos{Extractor: ex, Dup: dup, Log: log, limiter: ratelimit.New(6*time.Second, 10),
		slots: make(chan struct{}, maxConcurrentExtractions)}
}

// acquire espera um lugar livre; false se o contexto acabar antes. Quem recebe true deve chamar release (com defer).
func (h *Boletos) acquire(ctx context.Context) bool {
	select {
	case h.slots <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}

func (h *Boletos) release() { <-h.slots }

// readUpload lê o multipart parte a parte, direto para a memória. (ParseMultipartForm gravaria o excedente em arquivo
// temporário no disco, o que o desenho do boleto proíbe.) Devolve o arquivo e a senha opcional.
func readUpload(c *gin.Context) (file []byte, password string, err error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBoletoBody)
	mr, err := c.Request.MultipartReader()
	if err != nil {
		return nil, "", err
	}
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, "", err
		}
		switch part.FormName() {
		case "file":
			file, err = readLimited(part, maxBoletoFile)
		case "password":
			var b []byte
			b, err = readLimited(part, maxPassword)
			password = string(b)
		}
		if err != nil {
			return nil, "", err
		}
	}
	return file, password, nil
}

var errTooLarge = errors.New("arquivo grande demais")

func readLimited(r io.Reader, limit int) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(r, int64(limit)+1))
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return nil, errTooLarge
		}
		return nil, err
	}
	if len(b) > limit {
		return nil, errTooLarge
	}
	return b, nil
}

// ExtractBoleto: POST /households/{householdId}/boletos/extract
func (h *Boletos) ExtractBoleto(c *gin.Context, householdId gen.HouseholdId) {
	if !h.limiter.Allow(auth.CurrentUser(c).ID.String()) {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusTooManyRequests, Code: "too_many_requests"})
		return
	}
	file, password, err := readUpload(c)
	switch {
	case errors.Is(err, errTooLarge):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusRequestEntityTooLarge, Code: "file_too_large", Detail: "o arquivo passa de 5 MB"})
		return
	case err != nil:
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			httpx.WriteProblem(c, httpx.Problem{Status: http.StatusRequestEntityTooLarge, Code: "file_too_large", Detail: "o arquivo passa de 5 MB"})
			return
		}
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "bad_request", Detail: "envie o arquivo no campo \"file\" (multipart)"})
		return
	case len(file) == 0:
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "bad_request", Detail: "envie o arquivo no campo \"file\""})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), extractTimeout)
	defer cancel()
	if !h.acquire(ctx) {
		c.Header("Retry-After", "30")
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusServiceUnavailable, Code: "busy", Detail: "muitas leituras de boleto agora; tente de novo"})
		return
	}
	defer h.release()
	res, err := h.Extractor.Extract(ctx, file, password)
	if err != nil {
		h.writeError(c, err)
		return
	}
	// Nenhum log leva o arquivo, a senha ou os números lidos: só o método e o resultado.
	h.Log.Info("boleto lido", "metodo", string(res.Method))

	dup, err := h.Dup.FindDuplicate(ctx, householdId, res.DigitableLine)
	if err != nil {
		h.Log.Error("erro ao checar duplicidade de boleto", "erro", err)
		httpx.Internal(c)
		return
	}
	out := gen.BoletoExtraction{Boleto: gen.Boleto{DigitableLine: res.DigitableLine, Barcode: &res.Barcode}, Method: gen.BoletoExtractionMethod(res.Method), DuplicateOfInvoiceId: dup}
	if res.AmountCents > 0 {
		amount := gen.Cents(res.AmountCents)
		out.Boleto.DocumentAmountCents = &amount
	}
	if !res.DueDate.IsZero() {
		d := caldate.FromTime(res.DueDate)
		out.Boleto.DocumentDueDate = &d
	}
	if !res.Competence.IsZero() {
		m := caldate.FromTime(res.Competence)
		out.Boleto.DocumentCompetenceMonth = &m
	}
	if res.Beneficiary != "" {
		out.Boleto.BeneficiaryName = &res.Beneficiary
	}
	c.JSON(http.StatusOK, out)
}

func (h *Boletos) writeError(c *gin.Context, err error) {
	problem := func(code, detail string) {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusUnprocessableEntity, Code: code, Detail: detail})
	}
	switch {
	case errors.Is(err, boleto.ErrPasswordRequired):
		problem("password_required", "o PDF tem senha")
	case errors.Is(err, boleto.ErrWrongPassword):
		problem("wrong_password", "senha do PDF incorreta")
	case errors.Is(err, boleto.ErrUnsupported):
		problem("unsupported_file", "envie um PDF, PNG ou JPG")
	case errors.Is(err, boleto.ErrNotFound):
		problem("boleto_not_found", "não foi possível ler um boleto válido neste arquivo")
	default:
		h.Log.Error("falha ao ler boleto", "erro", err)
		httpx.Internal(c)
	}
}
