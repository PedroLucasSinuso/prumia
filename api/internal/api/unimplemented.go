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

func (Unimplemented) CreateIncome(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) CreateIncomeSource(c *gin.Context, householdId gen.HouseholdId) {
	notImplemented(c)
}

func (Unimplemented) DeleteIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID) {
	notImplemented(c)
}

func (Unimplemented) ExtractBoleto(c *gin.Context, householdId gen.HouseholdId) { notImplemented(c) }

func (Unimplemented) GetMonthlySummary(c *gin.Context, householdId gen.HouseholdId, params gen.GetMonthlySummaryParams) {
	notImplemented(c)
}

func (Unimplemented) ListIncomeSources(c *gin.Context, householdId gen.HouseholdId) {
	notImplemented(c)
}

func (Unimplemented) ListIncomes(c *gin.Context, householdId gen.HouseholdId, params gen.ListIncomesParams) {
	notImplemented(c)
}

func (Unimplemented) ReceiveIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID) {
	notImplemented(c)
}

func (Unimplemented) UpdateIncome(c *gin.Context, householdId gen.HouseholdId, incomeId openapi_types.UUID) {
	notImplemented(c)
}

func (Unimplemented) UpdateIncomeSource(c *gin.Context, householdId gen.HouseholdId, sourceId openapi_types.UUID, params gen.UpdateIncomeSourceParams) {
	notImplemented(c)
}
