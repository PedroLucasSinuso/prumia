package api

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/category"
)

// Categories implementa as operações de categoria do contrato.
type Categories struct {
	Svc *category.Service
	Log *slog.Logger
}

func toGenCategory(c category.Category) gen.Category {
	out := gen.Category{Id: c.ID, Name: c.Name, IsEssential: c.IsEssential, SortOrder: c.SortOrder, Archived: c.Archived(), ParentId: c.ParentID}
	if c.DefaultWallet != nil {
		w := gen.Wallet(*c.DefaultWallet)
		out.DefaultWallet = &w
	}
	return out
}

func walletPtr(w *gen.Wallet) *string {
	if w == nil {
		return nil
	}
	s := string(*w)
	return &s
}

// ListCategories: GET /households/{householdId}/categories
func (h *Categories) ListCategories(c *gin.Context, householdId gen.HouseholdId, params gen.ListCategoriesParams) {
	include := params.IncludeArchived != nil && *params.IncludeArchived
	cats, err := h.Svc.List(c.Request.Context(), householdId, include)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out := make([]gen.Category, len(cats))
	for i, cat := range cats {
		out[i] = toGenCategory(cat)
	}
	c.JSON(http.StatusOK, out)
}

// CreateCategory: POST /households/{householdId}/categories
func (h *Categories) CreateCategory(c *gin.Context, householdId gen.HouseholdId) {
	var body gen.CategoryInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	in := category.CreateInput{Name: body.Name, DefaultWallet: walletPtr(body.DefaultWallet), ParentID: body.ParentId}
	if body.IsEssential != nil {
		in.IsEssential = *body.IsEssential
	}
	created, err := h.Svc.Create(c.Request.Context(), householdId, in)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusCreated, toGenCategory(created))
}

// UpdateCategory: PATCH /households/{householdId}/categories/{categoryId}
func (h *Categories) UpdateCategory(c *gin.Context, householdId gen.HouseholdId, categoryId openapi_types.UUID) {
	var body gen.CategoryPatch
	present, ok := readPatch(c, &body)
	if !ok {
		return
	}
	p := category.Patch{
		Name: body.Name, IsEssential: body.IsEssential, SortOrder: body.SortOrder, Archived: body.Archived,
		DefaultWalletSet: present["defaultWallet"], DefaultWallet: walletPtr(body.DefaultWallet),
		ParentSet: present["parentId"], ParentID: body.ParentId,
	}
	updated, err := h.Svc.Update(c.Request.Context(), householdId, categoryId, p)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenCategory(updated))
}

// DeleteCategory: DELETE /households/{householdId}/categories/{categoryId}
func (h *Categories) DeleteCategory(c *gin.Context, householdId gen.HouseholdId, categoryId openapi_types.UUID) {
	if err := h.Svc.Delete(c.Request.Context(), householdId, categoryId); err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.Status(http.StatusNoContent)
}
