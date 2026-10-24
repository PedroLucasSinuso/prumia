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
		WalletId: w.WalletID, Name: w.Name, OwnerUserId: w.OwnerUserID, IsDefault: w.IsDefault, Archived: w.Archived,
		OpeningBalanceCents: w.Opening, OpeningBalanceMonth: w.OpeningMonth, CarryOverCents: w.CarryOver,
		ExpectedIncomeCents: w.Expected, ReceivedIncomeCents: w.Received, PaidCents: w.Paid, TransfersInCents: w.TransfersIn, TransfersOutCents: w.TransfersOut, BalanceCents: w.Balance(),
		MonthBalanceCents: w.MonthBalance(), PendingCents: w.Pending, ProjectedCents: w.Projected(),
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
	out := gen.MonthlySummary{
		Month: s.Month, TotalPaidCents: s.TotalPaid, TotalPendingCents: s.TotalPending,
		OverdueCents: s.Overdue, OverdueCount: s.OverdueCount,
	}
	out.Wallets = make([]gen.WalletBalance, len(s.Wallets))
	for i, w := range s.Wallets {
		out.Wallets[i] = toGenWallet(w)
	}
	out.ByCategory = make([]gen.CategoryTotal, len(s.ByCategory))
	for i, cat := range s.ByCategory {
		out.ByCategory[i] = gen.CategoryTotal{CategoryId: cat.CategoryID, TotalCents: cat.Total, PaidCents: cat.Paid}
	}
	c.JSON(http.StatusOK, out)
}

// GetCategoryHistory: GET /households/{householdId}/summary/categories?from=&to=
// Valida o intervalo ANTES de estender o horizonte (um pedido inválido não grava nada) e estende até `to`, para que um
// intervalo com meses futuros já mostre as contas fixas daqueles meses.
func (h *Summaries) GetCategoryHistory(c *gin.Context, householdId gen.HouseholdId, params gen.GetCategoryHistoryParams) {
	ctx := c.Request.Context()
	from, to, err := h.Svc.HistoryRange(params.From, params.To)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	for _, e := range h.Horizons {
		if err := e.EnsureHorizon(ctx, householdId, to); err != nil {
			h.Log.Warn("não foi possível estender o horizonte para o histórico", "erro", err)
		}
	}
	hist, err := h.Svc.CategoryHistory(ctx, householdId, &from, &to)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out := gen.CategoryHistory{Months: hist.Months, Series: make([]gen.CategorySeries, len(hist.Series))}
	for i, cs := range hist.Series {
		pts := make([]gen.CategoryPoint, len(cs.Points))
		for j, p := range cs.Points {
			pts[j] = gen.CategoryPoint{Month: p.Month, TotalCents: p.Total, PaidCents: p.Paid, SeriesCents: p.Series}
		}
		out.Series[i] = gen.CategorySeries{CategoryId: cs.CategoryID, Points: pts}
	}
	c.JSON(http.StatusOK, out)
}
