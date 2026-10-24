package api

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/transfer"
)

// Transfers implementa as operações de transferência entre carteiras do contrato.
type Transfers struct {
	Svc     *transfer.Service
	Log     *slog.Logger
	Balance OverdraftChecker // aviso de saldo da carteira de origem; nil = sem aviso
}

func toGenTransfer(t transfer.Transfer) gen.Transfer {
	return gen.Transfer{
		Id: t.ID, FromWalletId: t.FromWalletID, ToWalletId: t.ToWalletID, AmountCents: t.AmountCents,
		TransferDate: t.TransferDate, CompetenceMonth: t.CompetenceMonth, Notes: t.Notes,
	}
}

// ListTransfers: GET /households/{householdId}/transfers?month=
func (h *Transfers) ListTransfers(c *gin.Context, householdId gen.HouseholdId, params gen.ListTransfersParams) {
	rows, err := h.Svc.List(c.Request.Context(), householdId, params.Month)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out := make([]gen.Transfer, len(rows))
	for i, t := range rows {
		out[i] = toGenTransfer(t)
	}
	c.JSON(http.StatusOK, out)
}

// CreateTransfer: POST /households/{householdId}/transfers
func (h *Transfers) CreateTransfer(c *gin.Context, householdId gen.HouseholdId) {
	var body gen.TransferInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	in := transfer.CreateInput{FromWalletID: body.FromWalletId, ToWalletID: body.ToWalletId, AmountCents: body.AmountCents, Notes: body.Notes}
	if body.TransferDate != nil {
		in.TransferDate = *body.TransferDate
	}
	if body.CompetenceMonth != nil {
		in.CompetenceMonth = *body.CompetenceMonth
	}
	ctx := c.Request.Context()
	t, err := h.Svc.Create(ctx, householdId, auth.CurrentUser(c).ID, in)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	// Aviso (nunca bloqueia): o saldo da origem já inclui esta transferência. Falha no cálculo só vai para o log.
	warnings, details := []string{}, []gen.PayWarning{}
	if h.Balance != nil {
		low, err := h.Balance.OverdraftWarning(ctx, householdId, t.FromWalletID, t.CompetenceMonth)
		if err != nil {
			h.Log.Warn("não foi possível calcular o saldo da carteira", "erro", err)
		} else if low {
			warnings = append(warnings, WarnWalletBalanceInsufficient)
			details = append(details, gen.PayWarning{Code: WarnWalletBalanceInsufficient, WalletId: t.FromWalletID})
		}
	}
	c.JSON(http.StatusCreated, gen.TransferResult{Transfer: toGenTransfer(t), Warnings: &warnings, WarningDetails: &details})
}

// DeleteTransfer: DELETE /households/{householdId}/transfers/{transferId}
func (h *Transfers) DeleteTransfer(c *gin.Context, householdId gen.HouseholdId, transferId openapi_types.UUID) {
	if err := h.Svc.Delete(c.Request.Context(), householdId, transferId); err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// RestoreTransfer: POST /households/{householdId}/transfers/{transferId}/restore
func (h *Transfers) RestoreTransfer(c *gin.Context, householdId gen.HouseholdId, transferId openapi_types.UUID) {
	t, err := h.Svc.Restore(c.Request.Context(), householdId, transferId)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenTransfer(t))
}
