package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/household"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// Households implementa as operações de casa do contrato. Fica no pacote api (e não em household)
// porque precisa do auth (usuário atual) e o auth já importa household: o inverso seria um ciclo de imports.
type Households struct {
	Svc *household.Service
	Log interface{ Error(msg string, args ...any) }
}

func (h *Households) writeError(c *gin.Context, err error) {
	var ve *validation.Error
	switch {
	case errors.Is(err, household.ErrInvalidName):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "validation_error",
			Fields: map[string]string{"name": err.Error()}})
	case errors.Is(err, household.ErrNotFound), errors.Is(err, household.ErrInviteNotFound):
		httpx.NotFound(c)
	case errors.Is(err, household.ErrForbidden):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusForbidden, Code: "forbidden", Detail: err.Error()})
	case errors.Is(err, household.ErrLastAdmin):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusConflict, Code: "last_admin", Detail: err.Error()})
	case errors.Is(err, household.ErrAlreadyMember):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusConflict, Code: "already_member", Detail: err.Error()})
	case errors.Is(err, household.ErrInviteUsed):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusConflict, Code: "invite_used", Detail: err.Error()})
	case errors.Is(err, household.ErrInviteInvalid):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "invalid_invite", Detail: err.Error()})
	case errors.As(err, &ve):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "validation_error", Fields: ve.Fields})
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

// UpdateHousehold: PATCH /households/{householdId} (admin). Renomeia a casa.
func (h *Households) UpdateHousehold(c *gin.Context, householdId gen.HouseholdId) {
	if !auth.RequireAdmin(c) {
		return
	}
	var body gen.UpdateHouseholdJSONRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	if body.Name == nil { // PATCH sem campo nenhum: nada a mudar, devolve a casa como está
		h.GetHousehold(c, householdId)
		return
	}
	updated, err := h.Svc.Rename(c.Request.Context(), householdId, auth.CurrentUser(c).ID, *body.Name)
	if err != nil {
		h.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, toHousehold(updated))
}

// DeleteHousehold: DELETE /households/{householdId} (admin). Exclusão lógica.
func (h *Households) DeleteHousehold(c *gin.Context, householdId gen.HouseholdId) {
	if !auth.RequireAdmin(c) {
		return
	}
	if err := h.Svc.Delete(c.Request.Context(), householdId, auth.CurrentUser(c).ID); err != nil {
		h.writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// UpdateMemberRole: PATCH /households/{householdId}/members/{userId} (admin).
func (h *Households) UpdateMemberRole(c *gin.Context, householdId gen.HouseholdId, userId gen.UserId) {
	if !auth.RequireAdmin(c) {
		return
	}
	var body gen.UpdateMemberRoleJSONRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	m, err := h.Svc.UpdateMemberRole(c.Request.Context(), householdId, auth.CurrentUser(c).ID, userId, household.Role(body.Role))
	if err != nil {
		h.writeError(c, err)
		return
	}
	joined, _ := time.Parse(time.RFC3339, m.JoinedAt)
	c.JSON(http.StatusOK, gen.Member{UserId: m.UserID, Name: m.Name, Email: m.Email, Role: gen.Role(m.Role), JoinedAt: joined})
}

// RemoveMember: DELETE /households/{householdId}/members/{userId}. Admin remove qualquer um; qualquer membro
// (inclusive viewer) pode remover a SI MESMO (sair). Remover outra pessoa exige admin.
func (h *Households) RemoveMember(c *gin.Context, householdId gen.HouseholdId, userId gen.UserId) {
	me := auth.CurrentUser(c).ID
	if userId != me && !auth.RequireAdmin(c) {
		return
	}
	if err := h.Svc.RemoveMember(c.Request.Context(), householdId, me, userId); err != nil {
		h.writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// CreateInvite: POST /households/{householdId}/invites (admin). O token em claro só aparece nesta resposta.
func (h *Households) CreateInvite(c *gin.Context, householdId gen.HouseholdId) {
	if !auth.RequireAdmin(c) {
		return
	}
	var body gen.CreateInviteJSONRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	hours := 0 // 0 = padrão (campo ausente)
	if body.ExpiresInHours != nil {
		hours = *body.ExpiresInHours
		if hours == 0 { // 0 explícito é inválido
			hours = -1
		}
	}
	inv, tok, err := h.Svc.CreateInvite(c.Request.Context(), householdId, auth.CurrentUser(c).ID, household.Role(body.Role), hours)
	if err != nil {
		h.writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gen.InviteCreated{Id: inv.ID, Token: tok, Role: gen.Role(inv.Role), ExpiresAt: inv.ExpiresAt})
}

// RevokeInvite: DELETE /households/{householdId}/invites/{inviteId} (admin).
func (h *Households) RevokeInvite(c *gin.Context, householdId gen.HouseholdId, inviteId openapi_types.UUID) {
	if !auth.RequireAdmin(c) {
		return
	}
	if err := h.Svc.RevokeInvite(c.Request.Context(), householdId, auth.CurrentUser(c).ID, inviteId); err != nil {
		h.writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// AcceptInvite: POST /invites/accept. O usuário logado entra na casa do convite. A casa vem do convite
// (guardado no banco), nunca do corpo da requisição.
func (h *Households) AcceptInvite(c *gin.Context) {
	var body gen.AcceptInviteJSONRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	joined, err := h.Svc.Accept(c.Request.Context(), body.Token, auth.CurrentUser(c).ID)
	if err != nil {
		h.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, toHousehold(joined))
}
