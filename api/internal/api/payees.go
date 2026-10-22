package api

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/payee"
)

// Payees implementa as operações de favorecido do contrato.
type Payees struct {
	Svc *payee.Service
	Log *slog.Logger
}

func toGenPayee(p payee.Payee) gen.Payee {
	return gen.Payee{Id: p.ID, Name: p.Name, Cnpj: p.CNPJ, LegalName: p.LegalName, DefaultCategoryId: p.DefaultCategoryID, Archived: p.Archived()}
}

// ListPayees: GET /households/{householdId}/payees
func (h *Payees) ListPayees(c *gin.Context, householdId gen.HouseholdId, params gen.ListPayeesParams) {
	include := params.IncludeArchived != nil && *params.IncludeArchived
	rows, err := h.Svc.List(c.Request.Context(), householdId, include)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out := make([]gen.Payee, len(rows))
	for i, p := range rows {
		out[i] = toGenPayee(p)
	}
	c.JSON(http.StatusOK, out)
}

// CreatePayee: POST /households/{householdId}/payees
func (h *Payees) CreatePayee(c *gin.Context, householdId gen.HouseholdId) {
	var body gen.PayeeInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	created, err := h.Svc.Create(c.Request.Context(), householdId, payee.CreateInput{
		Name: body.Name, CNPJ: body.Cnpj, LegalName: body.LegalName, DefaultCategoryID: body.DefaultCategoryId,
	})
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusCreated, toGenPayee(created))
}

// UpdatePayee: PATCH /households/{householdId}/payees/{payeeId}
func (h *Payees) UpdatePayee(c *gin.Context, householdId gen.HouseholdId, payeeId openapi_types.UUID) {
	var body gen.PayeePatch
	present, ok := readPatch(c, &body)
	if !ok {
		return
	}
	updated, err := h.Svc.Update(c.Request.Context(), householdId, payeeId, payee.Patch{
		Name:    body.Name,
		CNPJSet: present["cnpj"], CNPJ: body.Cnpj,
		LegalNameSet: present["legalName"], LegalName: body.LegalName,
		DefaultCategorySet: present["defaultCategoryId"], DefaultCategoryID: body.DefaultCategoryId,
		Archived: body.Archived,
	})
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenPayee(updated))
}

// DeletePayee: DELETE /households/{householdId}/payees/{payeeId}
func (h *Payees) DeletePayee(c *gin.Context, householdId gen.HouseholdId, payeeId openapi_types.UUID) {
	if err := h.Svc.Delete(c.Request.Context(), householdId, payeeId); err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.Status(http.StatusNoContent)
}
