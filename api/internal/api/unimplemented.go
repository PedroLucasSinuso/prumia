// Stubs de todas as operações do contrato, escritos uma vez a partir de gen.ServerInterface.
// Remova cada stub quando o handler real existir. Quando o contrato ganha uma operação nova, o build quebra aqui até alguém tratá-la (de propósito).

package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
)

// Unimplemented responde 501 em todas as operações. O Server a embute (em Go, "embutir" um tipo
// promove seus métodos) e sobrescreve só as operações que já existem de verdade.
type Unimplemented struct{}

func notImplemented(c *gin.Context) {
	httpx.WriteProblem(c, httpx.Problem{Status: http.StatusNotImplemented, Code: "not_implemented"})
}

func (Unimplemented) AcceptInvite(c *gin.Context) { notImplemented(c) }

func (Unimplemented) CreateCategory(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) CreateHousehold(c *gin.Context) { notImplemented(c) }

func (Unimplemented) CreateIncome(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) CreateIncomeSource(c *gin.Context, householdId gen.HouseholdId) {
	notImplemented(c)
}

func (Unimplemented) CreateInvite(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) CreateInvoice(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) CreatePasswordResetLink(c *gin.Context, householdId gen.HouseholdId, userId gen.UserId) {
	notImplemented(c)
}

func (Unimplemented) CreatePurchase(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) CreateRecurrence(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) DeleteCategory(c *gin.Context, householdId gen.HouseholdId, categoryId openapi_types.UUID) {
	notImplemented(c)
}

func (Unimplemented) DeleteHousehold(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) DeleteIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID) {
	notImplemented(c)
}

func (Unimplemented) DeleteInvoice(c *gin.Context, householdId gen.HouseholdId, invoiceId gen.InvoiceId, params gen.DeleteInvoiceParams) {
	notImplemented(c)
}

func (Unimplemented) ExtractBoleto(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) GetHousehold(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) GetInvoice(c *gin.Context, householdId gen.HouseholdId, invoiceId gen.InvoiceId) {
	notImplemented(c)
}

func (Unimplemented) GetMe(c *gin.Context) { notImplemented(c) }

func (Unimplemented) GetMonthlySummary(c *gin.Context, householdId gen.HouseholdId, params gen.GetMonthlySummaryParams) {
	notImplemented(c)
}

func (Unimplemented) GetPurchase(c *gin.Context, householdId gen.HouseholdId, purchaseId openapi_types.UUID) {
	notImplemented(c)
}

func (Unimplemented) ListCategories(c *gin.Context, householdId gen.HouseholdId, params gen.ListCategoriesParams) {
	notImplemented(c)
}

func (Unimplemented) ListIncomeSources(c *gin.Context, householdId gen.HouseholdId) {
	notImplemented(c)
}

func (Unimplemented) ListIncomes(c *gin.Context, householdId gen.HouseholdId, params gen.ListIncomesParams) {
	notImplemented(c)
}

func (Unimplemented) ListInvoices(c *gin.Context, householdId gen.HouseholdId, params gen.ListInvoicesParams) {
	notImplemented(c)
}

func (Unimplemented) ListMembers(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) ListPurchases(c *gin.Context, householdId gen.HouseholdId, params gen.ListPurchasesParams) {
	notImplemented(c)
}

func (Unimplemented) ListRecurrences(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) Login(c *gin.Context) { notImplemented(c) }

func (Unimplemented) Logout(c *gin.Context) { notImplemented(c) }

func (Unimplemented) PayInvoice(c *gin.Context, householdId gen.HouseholdId, invoiceId gen.InvoiceId) {
	notImplemented(c)
}

func (Unimplemented) ReceiveIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID) {
	notImplemented(c)
}

func (Unimplemented) Register(c *gin.Context) { notImplemented(c) }

func (Unimplemented) RemoveMember(c *gin.Context, householdId gen.HouseholdId, userId gen.UserId) {
	notImplemented(c)
}

func (Unimplemented) ResetPassword(c *gin.Context) { notImplemented(c) }

func (Unimplemented) RestoreInvoice(c *gin.Context, householdId gen.HouseholdId, invoiceId gen.InvoiceId) {
	notImplemented(c)
}

func (Unimplemented) RevokeInvite(c *gin.Context, householdId gen.HouseholdId, inviteId openapi_types.UUID) {
	notImplemented(c)
}

func (Unimplemented) UnpayInvoice(c *gin.Context, householdId gen.HouseholdId, invoiceId gen.InvoiceId) {
	notImplemented(c)
}

func (Unimplemented) UpdateCategory(c *gin.Context, householdId gen.HouseholdId, categoryId openapi_types.UUID) {
	notImplemented(c)
}

func (Unimplemented) UpdateHousehold(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) UpdateIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID) {
	notImplemented(c)
}

func (Unimplemented) UpdateIncomeSource(c *gin.Context, householdId gen.HouseholdId, sourceId openapi_types.UUID, params gen.UpdateIncomeSourceParams) {
	notImplemented(c)
}

func (Unimplemented) UpdateInvoice(c *gin.Context, householdId gen.HouseholdId, invoiceId gen.InvoiceId, params gen.UpdateInvoiceParams) {
	notImplemented(c)
}

func (Unimplemented) UpdateMemberRole(c *gin.Context, householdId gen.HouseholdId, userId gen.UserId) {
	notImplemented(c)
}

func (Unimplemented) UpdateRecurrence(c *gin.Context, householdId gen.HouseholdId, recurrenceId openapi_types.UUID) {
	notImplemented(c)
}
