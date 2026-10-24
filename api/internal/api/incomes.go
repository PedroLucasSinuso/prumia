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
	"github.com/PedroLucasSinuso/prumia/api/internal/calendar"
	"github.com/PedroLucasSinuso/prumia/api/internal/income"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
	"github.com/PedroLucasSinuso/prumia/api/internal/tax"
)

// Incomes implementa as operações de receitas (lançamentos mensais, repetições, prévia de datas e estimativa de
// impostos) do contrato. Visibilidade: todos os membros da casa (inclusive viewer) leem as receitas de todos; a casa é
// a unidade de dados. Escrita: o middleware bloqueia viewer (403) em qualquer método que não seja leitura.
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

// ruleToGen / ruleFromGen convertem a regra de data entre o contrato e o domínio.
func ruleToGen(r income.DateRule) gen.DateRule {
	adj := gen.WeekendAdjust(r.Adjust)
	out := gen.DateRule{Rule: gen.DateRuleKind(r.Rule), WeekendAdjust: &adj}
	if r.Rule != income.RuleLastBusiness {
		n := r.N
		out.N = &n
	}
	return out
}

func ruleFromGen(r *gen.DateRule) *income.DateRule {
	if r == nil {
		return nil
	}
	out := income.DateRule{Rule: string(r.Rule)}
	if r.N != nil {
		out.N = *r.N
	}
	if r.WeekendAdjust != nil {
		out.Adjust = calendar.Adjust(*r.WeekendAdjust)
	}
	return &out
}

func amountModePtr(m *gen.AmountMode) string {
	if m == nil {
		return ""
	}
	return string(*m)
}

func toGenIncome(v income.View) gen.Income {
	out := gen.Income{
		Id: v.ID, SourceId: v.SourceID, UserId: v.UserID, Kind: gen.IncomeKind(v.Kind), Description: v.Description,
		Wallet: gen.Wallet(v.Wallet), CompetenceMonth: v.CompetenceMonth, ExpectedDate: v.ExpectedDate,
		AmountMode: gen.AmountMode(v.Mode()), GrossAmountCents: v.GrossAmountCents, Deductions: toGenDeductions(v.Deductions),
		NetAmountCents: v.Net, Received: v.Received, Held: v.HeldAt != nil, Repeats: v.Repeats, Notes: v.Notes,
		UnitPriceCents: v.UnitPriceCents, Quantity: v.Quantity, UnitLabel: v.UnitLabel,
	}
	if v.Received {
		r := v.ReceivedOn()
		out.ReceivedAt = &r
	}
	if !v.Until.IsZero() {
		u := v.Until
		out.RepeatsUntil = &u
	}
	if v.DateRule != nil {
		adj := ""
		if v.WeekendAdjust != nil {
			adj = *v.WeekendAdjust
		}
		r := ruleToGen(income.DateRule{Rule: *v.DateRule, Adjust: calendar.Adjust(adj)})
		if v.DateRuleN != nil {
			n := *v.DateRuleN
			r.N = &n
		}
		out.DateRule = &r
	}
	return out
}

func toGenSource(v income.SourceView) gen.IncomeSource {
	out := gen.IncomeSource{
		Id: v.ID, UserId: v.UserID, Kind: gen.IncomeSourceKind(v.Kind), Wallet: gen.Wallet(v.Wallet), Name: v.Name,
		AmountMode: gen.AmountMode(v.AmountMode), GrossAmountCents: v.GrossAmountCents, UnitPriceCents: v.UnitPriceCents,
		UnitLabel: v.UnitLabel, DayOfMonth: v.DayOfMonth, StartMonth: v.StartMonth,
		DateRule:   ruleToGen(income.DateRule{Rule: v.DateRule, Adjust: calendar.Adjust(v.WeekendAdjust)}),
		Deductions: toGenDeductions(v.Deductions), Notes: v.Notes,
	}
	if v.DateRuleN != nil {
		n := *v.DateRuleN
		out.DateRule.N = &n
	}
	if !v.EndMonth.IsZero() {
		e := v.EndMonth
		out.EndMonth = &e
	}
	g := v.GeneratedThrough
	out.GeneratedThrough = &g
	return out
}

// scopeParam converte o `scope` da query. Valor desconhecido é erro (400), não "this" em silêncio: em exclusão, errar o
// alcance para o lado maior seria pior.
func scopeParam(c *gin.Context, s *string) (income.Scope, bool) {
	switch {
	case s == nil || *s == "" || *s == string(gen.IncomeScopeThis):
		return income.ScopeThis, true
	case *s == string(gen.IncomeScopeFollowing):
		return income.ScopeFollowing, true
	}
	writeDomainError(c, nil, validation.New("scope", "use this ou following"))
	return "", false
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

// CreateIncome: POST /households/{householdId}/incomes (avulsa, ou com repeats=true cria a repetição)
func (h *Incomes) CreateIncome(c *gin.Context, householdId gen.HouseholdId) {
	var body gen.IncomeInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	in := income.CreateInput{
		UserID: body.UserId, Kind: string(body.Kind), Wallet: walletPtr(body.Wallet), Description: body.Description,
		CompetenceMonth: body.CompetenceMonth, ExpectedDate: body.ExpectedDate, Rule: ruleFromGen(body.DateRule),
		Amount: income.AmountInput{
			Mode: amountModePtr(body.AmountMode), GrossCents: body.GrossAmountCents, UnitPriceCents: body.UnitPriceCents,
			Quantity: body.Quantity, UnitLabel: body.UnitLabel,
		},
		RepeatUntil: body.RepeatsUntil, Deductions: fromGenDeductions(body.Deductions), Notes: body.Notes,
	}
	in.Repeats = body.Repeats != nil && *body.Repeats
	v, err := h.Svc.Create(c.Request.Context(), householdId, auth.CurrentUser(c).ID, in)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusCreated, toGenIncome(v))
}

// UpdateIncome: PATCH /households/{householdId}/incomes/{incomeId}?scope=
func (h *Incomes) UpdateIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID, params gen.UpdateIncomeParams) {
	var body gen.IncomePatch
	present, ok := readPatch(c, &body)
	if !ok {
		return
	}
	var sp *string
	if params.Scope != nil {
		s := string(*params.Scope)
		sp = &s
	}
	scope, ok := scopeParam(c, sp)
	if !ok {
		return
	}
	p := income.Patch{
		UserID: body.UserId, Description: body.Description, CompetenceMonth: body.CompetenceMonth, ExpectedDate: body.ExpectedDate,
		Quantity: body.Quantity, GrossAmountCents: body.GrossAmountCents, UnitPriceCents: body.UnitPriceCents, UnitLabel: body.UnitLabel,
		Rule: ruleFromGen(body.DateRule), DeductionsSet: present["deductions"] && body.Deductions != nil,
		Deductions: fromGenDeductions(body.Deductions), NotesSet: present["notes"], Notes: body.Notes,
	}
	if body.Kind != nil {
		k := string(*body.Kind)
		p.Kind = &k
	}
	if body.AmountMode != nil {
		m := string(*body.AmountMode)
		p.AmountMode = &m
	}
	v, err := h.Svc.Update(c.Request.Context(), householdId, incomeId, p, scope)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenIncome(v))
}

// DeleteIncome: DELETE /households/{householdId}/incomes/{incomeId}?scope=
func (h *Incomes) DeleteIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID, params gen.DeleteIncomeParams) {
	var sp *string
	if params.Scope != nil {
		s := string(*params.Scope)
		sp = &s
	}
	scope, ok := scopeParam(c, sp)
	if !ok {
		return
	}
	if err := h.Svc.Delete(c.Request.Context(), householdId, incomeId, scope); err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// RestoreIncome: POST /households/{householdId}/incomes/{incomeId}/restore?scope=
func (h *Incomes) RestoreIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID, params gen.RestoreIncomeParams) {
	var sp *string
	if params.Scope != nil {
		s := string(*params.Scope)
		sp = &s
	}
	scope, ok := scopeParam(c, sp)
	if !ok {
		return
	}
	v, err := h.Svc.Restore(c.Request.Context(), householdId, incomeId, scope)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenIncome(v))
}

// ReceiveIncome: POST /households/{householdId}/incomes/{incomeId}/receive ("caiu"; corpo opcional)
func (h *Incomes) ReceiveIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID) {
	var body gen.ReceiveIncomeJSONBody
	if err := c.ShouldBindJSON(&body); err != nil && !errors.Is(err, io.EOF) { // EOF = sem corpo = hoje
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

// UnreceiveIncome: DELETE /households/{householdId}/incomes/{incomeId}/receive ("não caiu")
func (h *Incomes) UnreceiveIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID) {
	v, err := h.Svc.Unreceive(c.Request.Context(), householdId, incomeId)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenIncome(v))
}

// PreviewIncomeDates: GET /households/{householdId}/income-dates (nada é gravado)
func (h *Incomes) PreviewIncomeDates(c *gin.Context, householdId gen.HouseholdId, params gen.PreviewIncomeDatesParams) {
	rule := income.DateRule{Rule: string(params.Rule)}
	if params.N != nil {
		rule.N = *params.N
	}
	if params.WeekendAdjust != nil {
		rule.Adjust = calendar.Adjust(*params.WeekendAdjust)
	}
	count := 3
	if params.Count != nil {
		count = *params.Count
	}
	items, err := h.Svc.Preview(c.Request.Context(), rule, params.Month, count)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out := make([]gen.IncomeDatePreview, len(items))
	for i, it := range items {
		out[i] = gen.IncomeDatePreview{Month: it.Month, ExpectedDate: it.ExpectedDate, BusinessDays: it.BusinessDays}
	}
	c.JSON(http.StatusOK, out)
}

// EstimateTax: GET /households/{householdId}/tax/estimate (sugestão; nada é gravado)
func (h *Incomes) EstimateTax(c *gin.Context, householdId gen.HouseholdId, params gen.EstimateTaxParams) {
	dependents := 0
	if params.Dependents != nil {
		dependents = *params.Dependents
	}
	var v validation.Collector
	if params.Month.IsZero() {
		v.Add("month", "informe um mês")
	}
	if params.GrossCents <= 0 || int64(params.GrossCents) > tax.MaxGrossCents {
		v.Add("grossCents", "informe o salário bruto")
	}
	if dependents < 0 || dependents > tax.MaxDependents {
		v.Add("dependents", "informe de 0 a 20 dependentes")
	}
	if err := v.Err(); err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	r, err := tax.Estimate(params.Month.Year(), int64(params.GrossCents), dependents)
	if err != nil { // já validado acima; defesa em profundidade
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "validation_error", Detail: err.Error()})
		return
	}
	checked, _ := caldate.ParseISO(r.CheckedOn)
	c.JSON(http.StatusOK, gen.TaxEstimate{
		InssCents: money.Cents(r.INSSCents), IrrfCents: money.Cents(r.IRRFCents), TableYear: r.TableYear,
		Sources: r.Sources, CheckedOn: checked, Approximate: r.Approximate,
	})
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
	in := income.SourceInput{
		UserID: body.UserId, Kind: string(body.Kind), Wallet: walletPtr(body.Wallet), Name: body.Name,
		Amount: income.AmountInput{
			Mode: amountModePtr(body.AmountMode), GrossCents: body.GrossAmountCents, UnitPriceCents: body.UnitPriceCents,
			Quantity: body.Quantity, UnitLabel: body.UnitLabel,
		},
		DayOfMonth: body.DayOfMonth, StartMonth: body.StartMonth, EndMonth: body.EndMonth, Notes: body.Notes,
		Deductions: fromGenDeductions(body.Deductions),
	}
	if rule := ruleFromGen(body.DateRule); rule != nil {
		in.Rule = *rule
	} // sem regra e sem dayOfMonth: a regra vazia falha na validação ("dateRule.rule")
	v, err := h.Svc.CreateSource(c.Request.Context(), householdId, auth.CurrentUser(c).ID, in)
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
	p := income.SourcePatch{
		UserID: body.UserId, Name: body.Name, GrossAmountCents: body.GrossAmountCents, UnitPriceCents: body.UnitPriceCents,
		UnitLabel: body.UnitLabel, Rule: ruleFromGen(body.DateRule), DayOfMonth: body.DayOfMonth,
		EndMonthSet: present["endMonth"], EndMonth: body.EndMonth, NotesSet: present["notes"], Notes: body.Notes,
		DeductionsSet: present["deductions"] && body.Deductions != nil, Deductions: fromGenDeductions(body.Deductions),
	}
	if body.Kind != nil {
		k := string(*body.Kind)
		p.Kind = &k
	}
	if body.AmountMode != nil {
		m := string(*body.AmountMode)
		p.AmountMode = &m
	}
	v, err := h.Svc.UpdateSource(c.Request.Context(), householdId, sourceId, p, params.ApplyFrom)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenSource(v))
}
