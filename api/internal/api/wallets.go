package api

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/wallet"
)

// Wallets implementa as operações de carteira do contrato. Listar é para qualquer membro; todo o resto é só do admin
// (conferido no service, que recebe quem está agindo).
type Wallets struct {
	Svc *wallet.Service
	Log *slog.Logger
}

func toGenWalletItem(w wallet.Wallet) gen.Wallet {
	return gen.Wallet{
		Id: w.ID, Name: w.Name, OwnerUserId: w.OwnerUserID, IsDefault: w.IsDefault, WarnOnOverdraft: w.WarnOnOverdraft,
		OpeningBalanceCents: w.OpeningBalanceCents, OpeningBalanceMonth: w.OpeningBalanceMonth, SortOrder: w.SortOrder, Archived: w.Archived(),
	}
}

// ListWallets: GET /households/{householdId}/wallets
func (h *Wallets) ListWallets(c *gin.Context, householdId gen.HouseholdId, params gen.ListWalletsParams) {
	include := params.IncludeArchived != nil && *params.IncludeArchived
	rows, err := h.Svc.List(c.Request.Context(), householdId, include)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	out := make([]gen.Wallet, len(rows))
	for i, w := range rows {
		out[i] = toGenWalletItem(w)
	}
	c.JSON(http.StatusOK, out)
}

// CreateWallet: POST /households/{householdId}/wallets
func (h *Wallets) CreateWallet(c *gin.Context, householdId gen.HouseholdId) {
	var body gen.WalletInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	in := wallet.CreateInput{Name: body.Name, OwnerUserID: body.OwnerUserId, WarnOnOverdraft: body.WarnOnOverdraft, SortOrder: body.SortOrder,
		OpeningBalanceMonth: body.OpeningBalanceMonth}
	if body.OpeningBalanceCents != nil {
		in.OpeningBalanceCents = *body.OpeningBalanceCents
	}
	created, err := h.Svc.Create(c.Request.Context(), householdId, auth.CurrentUser(c).ID, in)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusCreated, toGenWalletItem(created))
}

// UpdateWallet: PATCH /households/{householdId}/wallets/{walletId}
func (h *Wallets) UpdateWallet(c *gin.Context, householdId gen.HouseholdId, walletId openapi_types.UUID) {
	var body gen.WalletPatch
	present, ok := readPatch(c, &body)
	if !ok {
		return
	}
	updated, err := h.Svc.Update(c.Request.Context(), householdId, auth.CurrentUser(c).ID, walletId, wallet.Patch{
		Name: body.Name, OwnerSet: present["ownerUserId"], OwnerUserID: body.OwnerUserId,
		WarnOnOverdraft: body.WarnOnOverdraft, OpeningBalanceCents: body.OpeningBalanceCents,
		OpeningMonthSet: present["openingBalanceMonth"], OpeningBalanceMonth: body.OpeningBalanceMonth, IsDefault: body.IsDefault, SortOrder: body.SortOrder,
	})
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenWalletItem(updated))
}

// ArchiveWallet: POST /households/{householdId}/wallets/{walletId}/archive
func (h *Wallets) ArchiveWallet(c *gin.Context, householdId gen.HouseholdId, walletId openapi_types.UUID) {
	h.setArchived(c, householdId, walletId, true)
}

// RestoreWallet: POST /households/{householdId}/wallets/{walletId}/restore
func (h *Wallets) RestoreWallet(c *gin.Context, householdId gen.HouseholdId, walletId openapi_types.UUID) {
	h.setArchived(c, householdId, walletId, false)
}

func (h *Wallets) setArchived(c *gin.Context, householdId gen.HouseholdId, walletId openapi_types.UUID, archived bool) {
	w, err := h.Svc.SetArchived(c.Request.Context(), householdId, auth.CurrentUser(c).ID, walletId, archived)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, toGenWalletItem(w))
}
