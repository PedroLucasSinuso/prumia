package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/rates"
)

// Rates implementa GET /rates: as taxas de referência (CDI, Selic, IPCA). Não é recurso da casa (são dados públicos):
// exige só estar logado. Nunca falha por causa da BrasilAPI: sem ela, available=false (com a última leitura boa, se houver).
type Rates struct {
	Client *rates.Client
}

// GetReferenceRates: GET /rates
func (h *Rates) GetReferenceRates(c *gin.Context) {
	s := h.Client.Current(c.Request.Context())
	out := gen.ReferenceRates{Available: s.Available, FetchedAt: s.FetchedAt, Rates: make([]gen.ReferenceRate, len(s.Rates))}
	for i, r := range s.Rates {
		out.Rates[i] = gen.ReferenceRate{Code: gen.ReferenceRateCode(r.Code), Name: r.Name, BasisPoints: int(r.BasisPoints)}
	}
	c.JSON(http.StatusOK, out)
}
