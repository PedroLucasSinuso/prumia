package api

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/PedroLucasSinuso/prumia/api/internal/adjustment"
	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
)

// Adjustments implementa as operações de ajuste de saldo ("Conferir saldo") do contrato.
type Adjustments struct {
	Svc *adjustment.Service
	Log *slog.Logger
}

func toGenAdjustment(a adjustment.Adjustment) gen.WalletAdjustment {
	return gen.WalletAdjustment{
		Id: a.ID, WalletId: a.WalletID, CompetenceMonth: a.CompetenceMonth, AmountCents: a.AmountCents, Notes: a.Notes,
		CreatedAt: a.CreatedAt,
	}
}

// ListWalletAdjustments: GET /households/{householdId}/wallet-adjustments?month=
func (h *Adjustments) ListWalletAdjustments(c *gin.Context, householdId gen.HouseholdId, params gen.ListWalletAdjustmentsParams) {
	rows, err := h.Svc.List(c.Request.Context(), householdId, params.Month)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out := make([]gen.WalletAdjustment, len(rows))
	for i, a := range rows {
		out[i] = toGenAdjustment(a)
	}
	c.JSON(http.StatusOK, out)
}

// CreateWalletAdjustment: POST /households/{householdId}/wallet-adjustments
func (h *Adjustments) CreateWalletAdjustment(c *gin.Context, householdId gen.HouseholdId) {
	var body gen.WalletAdjustmentInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	in := adjustment.CreateInput{WalletID: body.WalletId, ActualBalance: body.ActualBalanceCents, Notes: body.Notes}
	if body.CompetenceMonth != nil {
		in.CompetenceMonth = *body.CompetenceMonth
	}
	a, err := h.Svc.Create(c.Request.Context(), householdId, auth.CurrentUser(c).ID, in)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusCreated, toGenAdjustment(a))
}

// DeleteWalletAdjustment: DELETE /households/{householdId}/wallet-adjustments/{adjustmentId}
func (h *Adjustments) DeleteWalletAdjustment(c *gin.Context, householdId gen.HouseholdId, adjustmentId openapi_types.UUID) {
	if err := h.Svc.Delete(c.Request.Context(), householdId, adjustmentId); err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// RestoreWalletAdjustment: POST /households/{householdId}/wallet-adjustments/{adjustmentId}/restore
func (h *Adjustments) RestoreWalletAdjustment(c *gin.Context, householdId gen.HouseholdId, adjustmentId openapi_types.UUID) {
	a, err := h.Svc.Restore(c.Request.Context(), householdId, adjustmentId)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenAdjustment(a))
}
