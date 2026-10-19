package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/household"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
)

// Households implementa as operações de casa do contrato. Fica no pacote api (e não em household)
// porque precisa do auth (usuário atual) e o auth já importa household: o inverso seria um ciclo de imports.
type Households struct {
	Svc *household.Service
	Log interface{ Error(msg string, args ...any) }
}

func (h *Households) writeError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, household.ErrInvalidName):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "validation_error",
			Fields: map[string]string{"name": err.Error()}})
	case errors.Is(err, household.ErrNotFound):
		httpx.NotFound(c)
	default:
		h.Log.Error("erro inesperado", "erro", err, "rota", c.FullPath())
		httpx.Internal(c)
	}
}

func toHousehold(h household.Household) gen.Household {
	return gen.Household{Id: h.ID, Name: h.Name, CreatedAt: h.CreatedAt}
}

// CreateHousehold: POST /households. O criador vira admin; as categorias padrão são criadas junto.
func (h *Households) CreateHousehold(c *gin.Context) {
	var body gen.CreateHouseholdJSONRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "bad_request", Detail: "corpo JSON inválido"})
		return
	}
	created, err := h.Svc.Create(c.Request.Context(), body.Name, auth.CurrentUser(c).ID)
	if err != nil {
		h.writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, toHousehold(created))
}

// GetHousehold: GET /households/{householdId}. O middleware já garantiu que o usuário é membro.
func (h *Households) GetHousehold(c *gin.Context, householdId gen.HouseholdId) {
	got, err := h.Svc.Get(c.Request.Context(), householdId, auth.CurrentUser(c).ID)
	if err != nil {
		h.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, toHousehold(got))
}

// ListMembers: GET /households/{householdId}/members.
func (h *Households) ListMembers(c *gin.Context, householdId gen.HouseholdId) {
	members, err := h.Svc.ListMembers(c.Request.Context(), householdId)
	if err != nil {
		h.writeError(c, err)
		return
	}
	out := make([]gen.Member, len(members))
	for i, m := range members {
		joined, _ := time.Parse(time.RFC3339, m.JoinedAt)
		out[i] = gen.Member{UserId: m.UserID, Name: m.Name, Email: m.Email, Role: gen.Role(m.Role), JoinedAt: joined}
	}
	c.JSON(http.StatusOK, out)
}
