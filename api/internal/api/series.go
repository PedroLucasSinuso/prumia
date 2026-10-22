package api

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/series"
)

// Purchases implementa as operações de compra parcelada do contrato.
type Purchases struct {
	Svc      *series.PurchaseService
	Invoices *invoice.Service // para montar as parcelas com status e "n de N"
	Log      *slog.Logger
}

func toGenPurchase(p series.Purchase) gen.Purchase {
	return gen.Purchase{
		Id: p.ID, CategoryId: p.CategoryID, ResponsibleUserId: p.ResponsibleUserID, Description: p.Description,
		PurchaseDate: p.PurchaseDate, TotalAmountCents: p.TotalAmountCents, InstallmentsCount: p.InstallmentsCount, Notes: p.Notes,
	}
}

func (h *Purchases) toGenDetail(c *gin.Context, householdID openapi_types.UUID, d series.Detail) (gen.Purchase, error) {
	out, err := h.toGenDetails(c, householdID, []series.Detail{d})
	if err != nil {
		return gen.Purchase{}, err
	}
	return out[0], nil
}

// toGenDetails monta várias compras com as parcelas calculando os status de TODAS as parcelas numa chamada só
// (Views faz consultas por lista, não por item): a listagem continua sem N+1.
func (h *Purchases) toGenDetails(c *gin.Context, householdID openapi_types.UUID, ds []series.Detail) ([]gen.Purchase, error) {
	var all []invoice.Invoice
	for _, d := range ds {
		all = append(all, d.Installments...)
	}
	views, err := h.Invoices.Views(c.Request.Context(), householdID, all)
	if err != nil {
		return nil, err
	}
	out := make([]gen.Purchase, len(ds))
	k := 0
	for i, d := range ds {
		out[i] = toGenPurchase(d.Purchase)
		items := make([]gen.Invoice, len(d.Installments))
		for j := range d.Installments {
			items[j] = toGenInvoice(views[k])
			k++
		}
		out[i].Installments = items
	}
	return out, nil
}

// ListPurchases: GET /households/{householdId}/purchases
func (h *Purchases) ListPurchases(c *gin.Context, householdId gen.HouseholdId, params gen.ListPurchasesParams) {
	f := series.PurchaseFilter{}
	if params.Q != nil {
		f.Q = *params.Q
	}
	if params.Limit != nil {
		f.Limit = int(*params.Limit)
	}
	if params.Cursor != nil {
		f.Cursor = *params.Cursor
	}
	page, err := h.Svc.List(c.Request.Context(), householdId, f)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	items, err := h.toGenDetails(c, householdId, page.Items)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out := gen.PurchasePage{Items: items}
	if page.NextCursor != "" {
		out.NextCursor = &page.NextCursor
	}
	c.JSON(http.StatusOK, out)
}

// CreatePurchase: POST /households/{householdId}/purchases
func (h *Purchases) CreatePurchase(c *gin.Context, householdId gen.HouseholdId) {
	var body gen.PurchaseInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	d, err := h.Svc.Create(c.Request.Context(), householdId, auth.CurrentUser(c).ID, series.PurchaseInput{
		CategoryID: body.CategoryId, ResponsibleUserID: body.ResponsibleUserId, Description: body.Description,
		PurchaseDate: body.PurchaseDate, TotalAmountCents: body.TotalAmountCents, InstallmentsCount: body.InstallmentsCount,
		FirstDueDate: body.FirstDueDate, InstallmentAmountCents: body.InstallmentAmountCents, Notes: body.Notes,
	})
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out, err := h.toGenDetail(c, householdId, d)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

// GetPurchase: GET /households/{householdId}/purchases/{purchaseId}
func (h *Purchases) GetPurchase(c *gin.Context, householdId gen.HouseholdId, purchaseId openapi_types.UUID) {
	d, err := h.Svc.Get(c.Request.Context(), householdId, purchaseId)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out, err := h.toGenDetail(c, householdId, d)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// Recurrences implementa as operações de conta recorrente do contrato.
type Recurrences struct {
	Svc *series.RecurrenceService
	Log *slog.Logger
}

func toGenRecurrence(r series.Recurrence) gen.Recurrence {
	out := gen.Recurrence{
		Id: r.ID, CategoryId: r.CategoryID, ResponsibleUserId: r.ResponsibleUserID, Description: r.Description,
		AmountCents: r.AmountCents, DayOfMonth: r.DayOfMonth, StartMonth: r.StartMonth, Notes: r.Notes,
	}
	if !r.EndMonth.IsZero() {
		e := r.EndMonth
		out.EndMonth = &e
	}
	g := r.GeneratedThrough
	out.GeneratedThrough = &g
	return out
}

// ListRecurrences: GET /households/{householdId}/recurrences
func (h *Recurrences) ListRecurrences(c *gin.Context, householdId gen.HouseholdId) {
	recs, err := h.Svc.List(c.Request.Context(), householdId)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out := make([]gen.Recurrence, len(recs))
	for i, r := range recs {
		out[i] = toGenRecurrence(r)
	}
	c.JSON(http.StatusOK, out)
}

// CreateRecurrence: POST /households/{householdId}/recurrences
func (h *Recurrences) CreateRecurrence(c *gin.Context, householdId gen.HouseholdId) {
	var body gen.RecurrenceInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	r, err := h.Svc.Create(c.Request.Context(), householdId, auth.CurrentUser(c).ID, series.RecurrenceInput{
		CategoryID: body.CategoryId, ResponsibleUserID: body.ResponsibleUserId, Description: body.Description,
		AmountCents: body.AmountCents, DayOfMonth: body.DayOfMonth, StartMonth: body.StartMonth, EndMonth: body.EndMonth, Notes: body.Notes,
	})
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusCreated, toGenRecurrence(r))
}

// UpdateRecurrence: PATCH /households/{householdId}/recurrences/{recurrenceId}
func (h *Recurrences) UpdateRecurrence(c *gin.Context, householdId gen.HouseholdId, recurrenceId openapi_types.UUID) {
	var body gen.RecurrencePatch
	present, ok := readPatch(c, &body)
	if !ok {
		return
	}
	r, err := h.Svc.Update(c.Request.Context(), householdId, recurrenceId, series.RecurrencePatch{
		CategoryID: body.CategoryId, ResponsibleSet: present["responsibleUserId"], ResponsibleUserID: body.ResponsibleUserId,
		Description: body.Description, AmountCents: body.AmountCents, DayOfMonth: body.DayOfMonth,
		EndMonthSet: present["endMonth"], EndMonth: body.EndMonth, NotesSet: present["notes"], Notes: body.Notes,
	})
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenRecurrence(r))
}
