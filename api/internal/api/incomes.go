package api

import (
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/income"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
)

// Incomes implementa as operações de receitas (lançamentos mensais e fontes) do contrato.
// Visibilidade: todos os membros da casa (inclusive viewer) leem as receitas de todos; a casa é a unidade de dados.
// Escrita: o middleware bloqueia viewer (403) em qualquer método que não seja leitura.
type Incomes struct {
	Svc *income.Service
	Log *slog.Logger
}

func toGenDeductions(ds []income.Deduction) []gen.Deduction {
	out := make([]gen.Deduction, len(ds))
	for i, d := range ds {
		out[i] = gen.Deduction{Kind: gen.DeductionKind(d.Kind), Name: d.Name, AmountCents: d.AmountCents}
	}
	return out
}

func fromGenDeductions(ds *[]gen.Deduction) []income.Deduction {
	if ds == nil {
		return nil
	}
	out := make([]income.Deduction, len(*ds))
	for i, d := range *ds {
		out[i] = income.Deduction{Kind: string(d.Kind), Name: d.Name, AmountCents: d.AmountCents}
	}
	return out
}

func toGenIncome(v income.View) gen.Income {
	out := gen.Income{
		Id: v.ID, SourceId: v.SourceID, UserId: v.UserID, Kind: gen.IncomeKind(v.Kind), Description: v.Description,
		Wallet: gen.Wallet(v.Wallet), CompetenceMonth: v.CompetenceMonth, ExpectedDate: v.ExpectedDate,
		GrossAmountCents: v.GrossAmountCents, Deductions: toGenDeductions(v.Deductions), NetAmountCents: v.Net,
		Received: v.Received(), Notes: v.Notes,
	}
	if v.Received() {
		r := v.ReceivedAt
		out.ReceivedAt = &r
	}
	return out
}

func toGenSource(v income.SourceView) gen.IncomeSource {
	out := gen.IncomeSource{
		Id: v.ID, UserId: v.UserID, Kind: gen.IncomeSourceKind(v.Kind), Wallet: gen.Wallet(v.Wallet), Name: v.Name,
		GrossAmountCents: v.GrossAmountCents, DayOfMonth: v.DayOfMonth, StartMonth: v.StartMonth,
		Deductions: toGenDeductions(v.Deductions), Notes: v.Notes,
	}
	if !v.EndMonth.IsZero() {
		e := v.EndMonth
		out.EndMonth = &e
	}
	g := v.GeneratedThrough
	out.GeneratedThrough = &g
	return out
}

// ListIncomes: GET /households/{householdId}/incomes?month=
func (h *Incomes) ListIncomes(c *gin.Context, householdId gen.HouseholdId, params gen.ListIncomesParams) {
	ctx := c.Request.Context()
	// Garante a previsão até o mês pedido. Leitura que grava: se falhar, só avisa no log e segue com o que existe.
	if err := h.Svc.EnsureHorizon(ctx, householdId, params.Month); err != nil {
		h.Log.Warn("não foi possível estender a previsão de receitas", "erro", err)
	}
	items, err := h.Svc.List(ctx, householdId, params.Month)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out := make([]gen.Income, len(items))
	for i, v := range items {
		out[i] = toGenIncome(v)
	}
	c.JSON(http.StatusOK, out)
}

// CreateIncome: POST /households/{householdId}/incomes (receita avulsa)
func (h *Incomes) CreateIncome(c *gin.Context, householdId gen.HouseholdId) {
	var body gen.IncomeInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	v, err := h.Svc.Create(c.Request.Context(), householdId, auth.CurrentUser(c).ID, income.CreateInput{
		UserID: body.UserId, Kind: string(body.Kind), Wallet: walletPtr(body.Wallet), Description: body.Description,
		CompetenceMonth: body.CompetenceMonth, ExpectedDate: body.ExpectedDate, GrossAmountCents: body.GrossAmountCents,
		Deductions: fromGenDeductions(body.Deductions), Notes: body.Notes,
	})
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusCreated, toGenIncome(v))
}

// UpdateIncome: PATCH /households/{householdId}/incomes/{incomeId}
func (h *Incomes) UpdateIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID) {
	var body gen.IncomePatch
	present, ok := readPatch(c, &body)
	if !ok {
		return
	}
	v, err := h.Svc.Update(c.Request.Context(), householdId, incomeId, income.Patch{
		Description: body.Description, ExpectedDate: body.ExpectedDate, GrossAmountCents: body.GrossAmountCents,
		DeductionsSet: present["deductions"] && body.Deductions != nil, Deductions: fromGenDeductions(body.Deductions),
		NotesSet: present["notes"], Notes: body.Notes,
	})
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenIncome(v))
}

// DeleteIncome: DELETE /households/{householdId}/incomes/{incomeId}
func (h *Incomes) DeleteIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID) {
	if err := h.Svc.Delete(c.Request.Context(), householdId, incomeId); err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ReceiveIncome: POST /households/{householdId}/incomes/{incomeId}/receive (corpo opcional)
func (h *Incomes) ReceiveIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID) {
	var body gen.ReceiveIncomeJSONBody
	if err := c.ShouldBindJSON(&body); err != nil && !errors.Is(err, io.EOF) { // EOF = sem corpo = receber hoje
		badJSON(c)
		return
	}
	v, err := h.Svc.Receive(c.Request.Context(), householdId, incomeId, body.ReceivedAt)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenIncome(v))
}

// UnreceiveIncome: DELETE /households/{householdId}/incomes/{incomeId}/receive
func (h *Incomes) UnreceiveIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID) {
	v, err := h.Svc.Unreceive(c.Request.Context(), householdId, incomeId)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenIncome(v))
}

// ListIncomeSources: GET /households/{householdId}/income-sources
func (h *Incomes) ListIncomeSources(c *gin.Context, householdId gen.HouseholdId) {
	items, err := h.Svc.ListSources(c.Request.Context(), householdId)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out := make([]gen.IncomeSource, len(items))
	for i, v := range items {
		out[i] = toGenSource(v)
	}
	c.JSON(http.StatusOK, out)
}

// CreateIncomeSource: POST /households/{householdId}/income-sources
func (h *Incomes) CreateIncomeSource(c *gin.Context, householdId gen.HouseholdId) {
	var body gen.IncomeSourceInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	v, err := h.Svc.CreateSource(c.Request.Context(), householdId, auth.CurrentUser(c).ID, income.SourceInput{
		UserID: body.UserId, Kind: string(body.Kind), Wallet: walletPtr(body.Wallet), Name: body.Name,
		GrossAmountCents: body.GrossAmountCents, DayOfMonth: body.DayOfMonth, StartMonth: body.StartMonth,
		EndMonth: body.EndMonth, Notes: body.Notes, Deductions: fromGenDeductions(body.Deductions),
	})
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusCreated, toGenSource(v))
}

// UpdateIncomeSource: PATCH /households/{householdId}/income-sources/{sourceId}?applyFrom=
func (h *Incomes) UpdateIncomeSource(c *gin.Context, householdId gen.HouseholdId, sourceId openapi_types.UUID, params gen.UpdateIncomeSourceParams) {
	var body gen.IncomeSourcePatch
	present, ok := readPatch(c, &body)
	if !ok {
		return
	}
	var applyFrom *caldate.Date
	if params.ApplyFrom != nil {
		applyFrom = params.ApplyFrom
	}
	v, err := h.Svc.UpdateSource(c.Request.Context(), householdId, sourceId, income.SourcePatch{
		Name: body.Name, GrossAmountCents: body.GrossAmountCents, DayOfMonth: body.DayOfMonth,
		EndMonthSet: present["endMonth"], EndMonth: body.EndMonth, NotesSet: present["notes"], Notes: body.Notes,
		DeductionsSet: present["deductions"] && body.Deductions != nil, Deductions: fromGenDeductions(body.Deductions),
	}, applyFrom)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenSource(v))
}
