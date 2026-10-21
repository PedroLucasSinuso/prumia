package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/PedroLucasSinuso/prumia/api/internal/category"
	"github.com/PedroLucasSinuso/prumia/api/internal/household"
	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
	"github.com/PedroLucasSinuso/prumia/api/internal/series"
)

// writeDomainError converte os erros dos serviços de domínio em respostas HTTP.
// É o lugar único desse mapeamento para categorias e invoices: erro novo de negócio = uma linha aqui.
func writeDomainError(c *gin.Context, log *slog.Logger, err error) {
	problem := func(status int, code string) {
		httpx.WriteProblem(c, httpx.Problem{Status: status, Code: code, Detail: err.Error()})
	}
	var ve *validation.Error
	switch {
	case errors.As(err, &ve):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "validation_error", Fields: ve.Fields})
	case errors.Is(err, category.ErrNotFound), errors.Is(err, invoice.ErrNotFound), errors.Is(err, household.ErrNotFound), errors.Is(err, series.ErrNotFound):
		httpx.NotFound(c)
	case errors.Is(err, category.ErrNameTaken):
		problem(http.StatusConflict, "category_exists")
	case errors.Is(err, category.ErrInUse):
		problem(http.StatusConflict, "category_in_use")
	case errors.Is(err, invoice.ErrAlreadyPaid):
		problem(http.StatusConflict, "already_paid")
	case errors.Is(err, invoice.ErrNotPaid):
		problem(http.StatusConflict, "not_paid")
	case errors.Is(err, invoice.ErrNotDeleted):
		problem(http.StatusConflict, "not_deleted")
	case errors.Is(err, invoice.ErrCategoryGone):
		problem(http.StatusConflict, "category_deleted")
	default:
		log.Error("erro inesperado", "erro", err, "rota", c.FullPath())
		httpx.Internal(c)
	}
}

func badJSON(c *gin.Context) {
	httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "bad_request", Detail: "corpo JSON inválido"})
}

// readPatch lê o corpo uma vez e devolve (a) o JSON decodificado no tipo `dst` e (b) o conjunto de chaves presentes.
// Precisamos de (b) porque, num PATCH, "campo ausente" (não mexer) e "campo null" (limpar) são coisas diferentes,
// e o tipo gerado (ponteiro) não consegue distingui-las.
func readPatch(c *gin.Context, dst any) (present map[string]bool, ok bool) {
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10))
	if err != nil {
		badJSON(c)
		return nil, false
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		badJSON(c)
		return nil, false
	}
	if err := json.Unmarshal(body, dst); err != nil {
		badJSON(c)
		return nil, false
	}
	present = make(map[string]bool, len(raw))
	for k := range raw {
		present[k] = true
	}
	return present, true
}
