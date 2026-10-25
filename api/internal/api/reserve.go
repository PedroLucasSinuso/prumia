package api

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
	"github.com/PedroLucasSinuso/prumia/api/internal/reserve"
)

// Reserves implementa a meta da reserva de emergência do contrato. Today dá o mês atual da resposta do PUT.
type Reserves struct {
	Svc   *reserve.Service
	Log   *slog.Logger
	Today func() caldate.Date
}

func toGenReserve(s reserve.Status) gen.ReserveStatus {
	return gen.ReserveStatus{
		TargetMonths: s.TargetMonths, WalletIds: s.WalletIDs, EssentialMonthlyCents: s.EssentialMonthly, BasisMonths: s.Basis,
		SavedCents: s.Saved, TargetCents: s.Target(),
	}
}

// GetReserve: GET /households/{householdId}/reserve?month=
func (h *Reserves) GetReserve(c *gin.Context, householdId gen.HouseholdId, params gen.GetReserveParams) {
	s, err := h.Svc.Get(c.Request.Context(), householdId, params.Month)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenReserve(s))
}

// SetReserve: PUT /households/{householdId}/reserve
func (h *Reserves) SetReserve(c *gin.Context, householdId gen.HouseholdId) {
	var body gen.ReserveInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	ctx := c.Request.Context()
	err := h.Svc.Set(ctx, householdId, auth.CurrentUser(c).ID, reserve.SetInput{TargetMonths: body.TargetMonths, WalletIDs: body.WalletIds})
	if errors.Is(err, reserve.ErrForbidden) {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusForbidden, Code: "forbidden", Detail: err.Error()})
		return
	}
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	s, err := h.Svc.Get(ctx, householdId, h.Today().StartOfMonth())
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenReserve(s))
}
