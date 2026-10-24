package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/boleto"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
)

// ExtractDocument: POST /households/{householdId}/documents/extract
//
// Mesmo upload, limite por usuário, semáforo e regras de memória do ExtractBoleto (o handler é o mesmo tipo, então
// compartilha limiter e slots: ler documento e ler boleto disputam a mesma cota). A diferença é o que volta: um
// boleto, uma conta sem boleto ("bill") ou uma lista de contas.
func (h *Boletos) ExtractDocument(c *gin.Context, householdId gen.HouseholdId) {
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
	doc, err := h.Extractor.ExtractDocument(ctx, file, password)
	if errors.Is(err, boleto.ErrNotFound) {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusUnprocessableEntity, Code: "boleto_not_found", Detail: "não encontrei boleto nem valor de conta neste arquivo"})
		return
	}
	if err != nil {
		h.writeError(c, err)
		return
	}
	h.writeDocument(c, ctx, householdId, doc)
}

// maxParseText: tamanho máximo do texto colado, em caracteres (não em bytes: "ç" são 2 bytes e conta como 1).
const maxParseText = 20000

// ParseDocumentText: POST /households/{householdId}/documents/parse-text
//
// Texto escrito ou colado no lugar de arquivo: mesma saída do ExtractDocument (boleto, bill ou list), sem OCR e sem
// disco. Divide o limite por usuário com a leitura de arquivos, mas não usa o semáforo (não sobe Ghostscript nem
// Tesseract: é só texto e regex).
func (h *Boletos) ParseDocumentText(c *gin.Context, householdId gen.HouseholdId) {
	if !h.limiter.Allow(auth.CurrentUser(c).ID.String()) {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusTooManyRequests, Code: "too_many_requests"})
		return
	}
	var body struct {
		Text string `json:"text"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		var mbe *http.MaxBytesError // errors.As: "este erro é (ou embrulha) um *MaxBytesError?"
		if errors.As(err, &mbe) {
			textTooLarge(c)
			return
		}
		badJSON(c)
		return
	}
	if utf8.RuneCountInString(body.Text) > maxParseText {
		textTooLarge(c)
		return
	}
	if strings.TrimSpace(body.Text) == "" {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "bad_request", Detail: "envie o texto no campo \"text\""})
		return
	}
	doc, err := h.Extractor.ExtractText(body.Text)
	if errors.Is(err, boleto.ErrNotFound) {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusUnprocessableEntity, Code: "boleto_not_found", Detail: "não encontrei boleto nem valor de conta neste texto"})
		return
	}
	if err != nil {
		h.writeError(c, err)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), extractTimeout)
	defer cancel()
	h.writeDocument(c, ctx, householdId, doc)
}

func textTooLarge(c *gin.Context) {
	httpx.WriteProblem(c, httpx.Problem{Status: http.StatusRequestEntityTooLarge, Code: "text_too_large", Detail: "o texto passa de 20.000 caracteres"})
}

// writeDocument responde 200 com o documento lido (arquivo ou texto), resolvendo favorecido e duplicidade de cada item.
func (h *Boletos) writeDocument(c *gin.Context, ctx context.Context, householdId gen.HouseholdId, doc boleto.Document) {
	// Só o tipo, o método e quantos itens: nunca os valores, nomes ou números lidos.
	h.Log.Info("documento lido", "tipo", string(doc.Kind), "metodo", string(doc.Method), "itens", len(doc.Items))

	out := gen.DocumentExtraction{
		Kind: gen.DocumentExtractionKind(doc.Kind), Method: gen.DocumentExtractionMethod(doc.Method),
		Items: make([]gen.DocumentItem, 0, len(doc.Items)),
	}
	for _, it := range doc.Items {
		item, err := h.documentItem(ctx, householdId, it, doc.Method)
		if err != nil {
			httpx.Internal(c)
			return
		}
		out.Items = append(out.Items, item)
	}
	c.JSON(http.StatusOK, out)
}

// documentItem converte um item lido no tipo do contrato, conferindo quem recebe e a duplicidade do boleto.
func (h *Boletos) documentItem(ctx context.Context, householdID gen.HouseholdId, it boleto.Item, method boleto.Method) (gen.DocumentItem, error) {
	var out gen.DocumentItem
	if it.AmountCents > 0 {
		a := gen.Cents(it.AmountCents)
		out.AmountCents = &a
	}
	if !it.DueDate.IsZero() {
		d := caldate.FromTime(it.DueDate)
		out.DueDate = &d
	}
	if !it.Competence.IsZero() {
		m := caldate.FromTime(it.Competence)
		out.CompetenceMonth = &m
	}
	who, err := h.whoReceives(ctx, householdID, it.Beneficiary, it.BeneficiaryCNPJ, method)
	if err != nil {
		return out, err
	}
	out.Payee = who.payee
	if who.name != "" {
		out.BeneficiaryName = &who.name
	}
	if who.cnpj != "" {
		out.BeneficiaryCnpj = &who.cnpj
	}
	if who.verified {
		out.BeneficiaryVerified = &who.verified
	}
	desc := it.Description
	if desc == "" || (who.verified && desc == it.Beneficiary) {
		desc = who.name // o nome do cadastro do CNPJ é mais confiável que o lido
	}
	if desc != "" {
		out.Description = &desc
	}
	if it.Boleto != nil {
		b := genBoleto(*it.Boleto)
		who.applyTo(&b)
		out.Boleto = &b
		dup, err := h.Dup.FindDuplicate(ctx, householdID, it.Boleto.DigitableLine)
		if err != nil {
			h.Log.Error("erro ao checar duplicidade de boleto", "erro", err)
			return out, err
		}
		out.DuplicateOfInvoiceId = dup
	}
	return out, nil
}
