package api

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/brasilapi"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/cnpj"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/ratelimit"
)

// CNPJLookups implementa GET /cnpj/{cnpj}: consulta a razão social na BrasilAPI (cadastro manual de favorecido).
// Não é um recurso da casa (CNPJ é dado público): exige só estar logado, e cada pessoa tem um limite de consultas.
type CNPJLookups struct {
	Company CNPJLooker
	Log     *slog.Logger
	limiter *ratelimit.Limiter
}

func NewCNPJLookups(company CNPJLooker, log *slog.Logger) *CNPJLookups {
	return &CNPJLookups{Company: company, Log: log, limiter: ratelimit.New(6*time.Second, 10)}
}

// LookupCnpj: GET /cnpj/{cnpj}
func (h *CNPJLookups) LookupCnpj(c *gin.Context, raw string) {
	if !h.limiter.Allow(auth.CurrentUser(c).ID.String()) {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusTooManyRequests, Code: "too_many_requests"})
		return
	}
	if !cnpj.Valid(raw) {
		httpx.NotFound(c) // CNPJ que nem passa nos dígitos verificadores não existe: nem consulta
		return
	}
	co, err := h.Company.Lookup(c.Request.Context(), raw)
	switch {
	case err == nil:
		out := gen.CnpjInfo{Cnpj: co.CNPJ, LegalName: co.LegalName}
		if co.TradeName != "" {
			out.TradeName = &co.TradeName
		}
		c.JSON(http.StatusOK, out)
	case errors.Is(err, brasilapi.ErrNotFound):
		httpx.NotFound(c)
	default:
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusServiceUnavailable, Code: "lookup_unavailable", Detail: "a consulta de CNPJ está indisponível agora"})
	}
}
