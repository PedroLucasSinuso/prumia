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
	"github.com/PedroLucasSinuso/prumia/api/internal/brasilapi"
	"github.com/PedroLucasSinuso/prumia/api/internal/payee"
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

// PayeeFinder acha o favorecido da casa pelo CNPJ lido do boleto (interface mínima, definida onde é usada).
type PayeeFinder interface {
	FindByCNPJ(ctx context.Context, householdID uuid.UUID, cnpj string) (payee.Payee, error)
}

// CNPJLooker consulta a empresa de um CNPJ (interface mínima; a implementação real é o cliente da BrasilAPI).
type CNPJLooker interface {
	Lookup(ctx context.Context, cnpj string) (brasilapi.Company, error)
}

// Boletos implementa POST /households/{id}/boletos/extract. O arquivo vive só na memória desta requisição.
type Boletos struct {
	Extractor *boleto.Extractor
	Dup       DuplicateFinder
	Payees    PayeeFinder
	Company   CNPJLooker // opcional (nil = não confere o nome pelo CNPJ)
	Log       *slog.Logger
	// Limite por usuário: a leitura (PDF/OCR) é a operação mais cara do servidor.
	limiter *ratelimit.Limiter
	// slots limita quantas leituras rodam AO MESMO TEMPO no servidor inteiro (cada uma pode subir Ghostscript e
	// Tesseract, que comem CPU e memória). Canal com buffer = semáforo: ocupar um lugar é enviar, liberar é receber.
	slots chan struct{}
}

// maxConcurrentExtractions: leituras simultâneas. As demais esperam a vez (até o tempo da requisição acabar).
const maxConcurrentExtractions = 2

func NewBoletos(ex *boleto.Extractor, dup DuplicateFinder, payees PayeeFinder, company CNPJLooker, log *slog.Logger) *Boletos {
	return &Boletos{Extractor: ex, Dup: dup, Payees: payees, Company: company, Log: log, limiter: ratelimit.New(6*time.Second, 10),
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

// upload aplica o limite por usuário e lê o arquivo (e a senha) da requisição. false = a resposta de erro já foi escrita.
func (h *Boletos) upload(c *gin.Context) (file []byte, password string, ok bool) {
	if !h.limiter.Allow(auth.CurrentUser(c).ID.String()) {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusTooManyRequests, Code: "too_many_requests"})
		return nil, "", false
	}
	file, password, err := readUpload(c)
	switch {
	case errors.Is(err, errTooLarge):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusRequestEntityTooLarge, Code: "file_too_large", Detail: "o arquivo passa de 5 MB"})
		return nil, "", false
	case err != nil:
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			httpx.WriteProblem(c, httpx.Problem{Status: http.StatusRequestEntityTooLarge, Code: "file_too_large", Detail: "o arquivo passa de 5 MB"})
			return nil, "", false
		}
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "bad_request", Detail: "envie o arquivo no campo \"file\" (multipart)"})
		return nil, "", false
	case len(file) == 0:
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "bad_request", Detail: "envie o arquivo no campo \"file\""})
		return nil, "", false
	}
	return file, password, true
}

// busy responde 503 quando a vez de ler não chegou a tempo (ver acquire).
func busy(c *gin.Context) {
	c.Header("Retry-After", "30")
	httpx.WriteProblem(c, httpx.Problem{Status: http.StatusServiceUnavailable, Code: "busy", Detail: "muitas leituras de boleto agora; tente de novo"})
}

// ExtractBoleto: POST /households/{householdId}/boletos/extract
func (h *Boletos) ExtractBoleto(c *gin.Context, householdId gen.HouseholdId) {
	file, password, ok := h.upload(c)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), extractTimeout)
	defer cancel()
	if !h.acquire(ctx) {
		busy(c)
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
	out := gen.BoletoExtraction{Boleto: genBoleto(res.Boleto), Method: gen.BoletoExtractionMethod(res.Method), DuplicateOfInvoiceId: dup}
	who, err := h.whoReceives(ctx, householdId, res.Beneficiary, res.BeneficiaryCNPJ, res.Method)
	if err != nil {
		httpx.Internal(c)
		return
	}
	who.applyTo(&out.Boleto)
	out.Payee = who.payee
	c.JSON(http.StatusOK, out)
}

// genBoleto converte o boleto lido no tipo do contrato (sem o beneficiário, que passa por whoReceives).
func genBoleto(b boleto.Boleto) gen.Boleto {
	out := gen.Boleto{DigitableLine: b.DigitableLine, Barcode: &b.Barcode}
	if b.AmountCents > 0 {
		amount := gen.Cents(b.AmountCents)
		out.DocumentAmountCents = &amount
	}
	if !b.DueDate.IsZero() {
		d := caldate.FromTime(b.DueDate)
		out.DocumentDueDate = &d
	}
	if !b.Competence.IsZero() {
		m := caldate.FromTime(b.Competence)
		out.DocumentCompetenceMonth = &m
	}
	return out
}

// receiver é quem recebe, já conferido: nome (o do cadastro do CNPJ, se a BrasilAPI respondeu), CNPJ (vazio se
// descartado) e o favorecido da casa com esse CNPJ.
type receiver struct {
	name, cnpj string
	verified   bool
	payee      *gen.Payee
}

func (r receiver) applyTo(b *gen.Boleto) {
	if r.cnpj != "" {
		cnpj := r.cnpj
		b.BeneficiaryCnpj = &cnpj
	}
	if r.verified {
		v := true
		b.BeneficiaryVerified = &v
	}
	if r.name != "" {
		name := r.name
		b.BeneficiaryName = &name
	}
}

// whoReceives confere o CNPJ lido na BrasilAPI e procura o favorecido da casa. Erro só quando o banco falha (já logado).
func (h *Boletos) whoReceives(ctx context.Context, householdID uuid.UUID, name, cnpjDigits string, method boleto.Method) (receiver, error) {
	r := receiver{name: name, cnpj: cnpjDigits}
	if r.cnpj != "" && h.Company != nil {
		// O nome lido (principalmente por OCR) pode estar errado; o cadastro do CNPJ é a fonte confiável.
		switch co, err := h.Company.Lookup(ctx, r.cnpj); {
		case err == nil:
			r.name, r.verified = co.LegalName, true
		case errors.Is(err, brasilapi.ErrNotFound) && method == boleto.MethodOCR:
			// CNPJ com dígitos válidos mas inexistente, vindo de OCR: quase certamente número lido errado. Não oferece cadastrar.
			r.cnpj = ""
		}
		// qualquer outra falha (API fora do ar, prazo): segue com o que o documento trouxe
	}
	if r.cnpj != "" && h.Payees != nil {
		// Favorecido já conhecido da casa (arquivado não conta: a pessoa o tirou de uso). Sem achar, a tela oferece cadastrar.
		switch p, err := h.Payees.FindByCNPJ(ctx, householdID, r.cnpj); {
		case err == nil && !p.Archived():
			gp := toGenPayee(p)
			r.payee = &gp
		case err != nil && !errors.Is(err, payee.ErrNotFound):
			h.Log.Error("erro ao buscar favorecido pelo CNPJ do boleto", "erro", err)
			return receiver{}, err
		}
	}
	return r, nil
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
