package api

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/summary"
)

// Summaries implementa GET /summary. Horizons são opcionais (nil = não estende): o resumo de um mês futuro precisa da
// previsão de receitas e das contas fixas já geradas até aquele mês.
type Summaries struct {
	Svc      *summary.Service
	Log      *slog.Logger
	Horizons []HorizonEnsurer
}

func toGenWallet(w summary.WalletBalance) gen.WalletBalance {
	return gen.WalletBalance{
		ExpectedIncomeCents: w.Expected, ReceivedIncomeCents: w.Received, PaidCents: w.Paid, BalanceCents: w.Balance(),
	}
}

// GetMonthlySummary: GET /households/{householdId}/summary?month=
func (h *Summaries) GetMonthlySummary(c *gin.Context, householdId gen.HouseholdId, params gen.GetMonthlySummaryParams) {
	ctx := c.Request.Context()
	for _, e := range h.Horizons {
		// Leitura que grava: falhar aqui não derruba o resumo, só vira aviso no log.
		if err := e.EnsureHorizon(ctx, householdId, params.Month); err != nil {
			h.Log.Warn("não foi possível estender o horizonte para o resumo", "erro", err)
		}
	}
	s, err := h.Svc.Month(ctx, householdId, params.Month)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out := gen.MonthlySummary{Month: s.Month, TotalPaidCents: s.TotalPaid, TotalPendingCents: s.TotalPending}
	out.Wallets.Free = toGenWallet(s.Free)
	out.Wallets.Benefit = toGenWallet(s.Benefit)
	out.ByCategory = make([]gen.CategoryTotal, len(s.ByCategory))
	for i, cat := range s.ByCategory {
		out.ByCategory[i] = gen.CategoryTotal{CategoryId: cat.CategoryID, TotalCents: cat.Total, PaidCents: cat.Paid}
	}
	c.JSON(http.StatusOK, out)
}
