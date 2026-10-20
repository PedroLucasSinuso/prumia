package api

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
)

// Invoices implementa as operações de invoice do contrato (sem parcelas/recorrências, que vêm na Fase 1c).
type Invoices struct {
	Svc *invoice.Service
	Log *slog.Logger
}

func toGenInvoice(v invoice.View) gen.Invoice {
	out := gen.Invoice{
		Id: v.ID, CategoryId: v.CategoryID, ResponsibleUserId: v.ResponsibleUserID,
		Description: v.Description, AmountCents: v.AmountCents,
		DueDate: v.DueDate, CompetenceMonth: v.CompetenceMonth,
		Status: gen.InvoiceStatus(v.Status), Notes: v.Notes,
	}
	if v.Paid() && v.PaidWallet != nil && v.PaidAmountCents != nil {
		out.Paid = &gen.Payment{
			PaidAt: v.PaidAt, Wallet: gen.Wallet(*v.PaidWallet), AmountCents: *v.PaidAmountCents, PaidByUserId: v.PaidByUserID,
		}
	}
	switch {
	case v.PurchaseID != nil:
		out.Series = &gen.SeriesRef{Kind: gen.SeriesRefKindInstallment, PurchaseId: v.PurchaseID, InstallmentNumber: v.InstallmentNumber}
	case v.RecurrenceID != nil:
		out.Series = &gen.SeriesRef{Kind: gen.SeriesRefKindRecurrence, RecurrenceId: v.RecurrenceID}
	}
	return out
}

func scopeOf(s *string) invoice.Scope {
	if s != nil && *s == string(gen.SeriesScopeFollowing) {
		return invoice.ScopeFollowing
	}
	return invoice.ScopeThis
}

// ListInvoices: GET /households/{householdId}/invoices
func (h *Invoices) ListInvoices(c *gin.Context, householdId gen.HouseholdId, params gen.ListInvoicesParams) {
	f := invoice.ListFilter{
		Month: params.Month, CategoryID: params.CategoryId, ResponsibleUserID: params.ResponsibleUserId, PurchaseID: params.PurchaseId,
	}
	if params.Status != nil {
		f.Status = invoice.Status(*params.Status)
	}
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
	out := gen.InvoicePage{Items: make([]gen.Invoice, len(page.Items))}
	for i, v := range page.Items {
		out.Items[i] = toGenInvoice(v)
	}
	if page.NextCursor != "" {
		out.NextCursor = &page.NextCursor
	}
	c.JSON(http.StatusOK, out)
}

// CreateInvoice: POST /households/{householdId}/invoices
func (h *Invoices) CreateInvoice(c *gin.Context, householdId gen.HouseholdId) {
	var body gen.InvoiceInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	v, err := h.Svc.Create(c.Request.Context(), householdId, auth.CurrentUser(c).ID, invoice.CreateInput{
		CategoryID: body.CategoryId, ResponsibleUserID: body.ResponsibleUserId, Description: body.Description,
		AmountCents: body.AmountCents, DueDate: body.DueDate, CompetenceMonth: body.CompetenceMonth, Notes: body.Notes,
	})
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusCreated, toGenInvoice(v))
}

// GetInvoice: GET /households/{householdId}/invoices/{invoiceId}
func (h *Invoices) GetInvoice(c *gin.Context, householdId gen.HouseholdId, invoiceId gen.InvoiceId) {
	v, err := h.Svc.Get(c.Request.Context(), householdId, invoiceId)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenInvoice(v))
}

// UpdateInvoice: PATCH /households/{householdId}/invoices/{invoiceId}
func (h *Invoices) UpdateInvoice(c *gin.Context, householdId gen.HouseholdId, invoiceId gen.InvoiceId, params gen.UpdateInvoiceParams) {
	var body gen.InvoicePatch
	present, ok := readPatch(c, &body)
	if !ok {
		return
	}
	var scope *string
	if params.Scope != nil {
		s := string(*params.Scope)
		scope = &s
	}
	v, err := h.Svc.Update(c.Request.Context(), householdId, invoiceId, invoice.Patch{
		CategoryID: body.CategoryId, ResponsibleSet: present["responsibleUserId"], ResponsibleUserID: body.ResponsibleUserId,
		Description: body.Description, AmountCents: body.AmountCents, DueDate: body.DueDate, CompetenceMonth: body.CompetenceMonth,
		NotesSet: present["notes"], Notes: body.Notes,
	}, scopeOf(scope))
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenInvoice(v))
}

// DeleteInvoice: DELETE /households/{householdId}/invoices/{invoiceId}
func (h *Invoices) DeleteInvoice(c *gin.Context, householdId gen.HouseholdId, invoiceId gen.InvoiceId, params gen.DeleteInvoiceParams) {
	var scope *string
	if params.Scope != nil {
		s := string(*params.Scope)
		scope = &s
	}
	if err := h.Svc.Delete(c.Request.Context(), householdId, invoiceId, scopeOf(scope)); err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// RestoreInvoice: POST /households/{householdId}/invoices/{invoiceId}/restore
func (h *Invoices) RestoreInvoice(c *gin.Context, householdId gen.HouseholdId, invoiceId gen.InvoiceId) {
	v, err := h.Svc.Restore(c.Request.Context(), householdId, invoiceId)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenInvoice(v))
}

// PayInvoice: POST /households/{householdId}/invoices/{invoiceId}/pay
func (h *Invoices) PayInvoice(c *gin.Context, householdId gen.HouseholdId, invoiceId gen.InvoiceId) {
	var body gen.PayRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	v, err := h.Svc.Pay(c.Request.Context(), householdId, invoiceId, auth.CurrentUser(c).ID, invoice.PayInput{
		Wallet: string(body.Wallet), PaidAt: body.PaidAt, AmountCents: body.AmountCents,
	})
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	// warnings (ex.: saldo de benefício insuficiente) entram na Fase 2, junto com as receitas.
	c.JSON(http.StatusOK, gen.PayResult{Invoice: toGenInvoice(v), Warnings: &[]string{}})
}

// UnpayInvoice: DELETE /households/{householdId}/invoices/{invoiceId}/pay
func (h *Invoices) UnpayInvoice(c *gin.Context, householdId gen.HouseholdId, invoiceId gen.InvoiceId) {
	v, err := h.Svc.Unpay(c.Request.Context(), householdId, invoiceId)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenInvoice(v))
}
