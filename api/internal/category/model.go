// Package category cuida das categorias de despesa de cada casa.
package category

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbmodel"
)

// Wallets válidas (iguais ao CHECK do banco): "free" (livre) e "benefit" (VR).
const (
	WalletFree    = "free"
	WalletBenefit = "benefit"
)

func ValidWallet(w string) bool { return w == WalletFree || w == WalletBenefit }

type Category struct {
	dbmodel.Base
	HouseholdID uuid.UUID `gorm:"type:uuid"`
	Name        string
	// DefaultWallet é só sugestão ao pagar (ex.: Mercado -> benefit); nil = sem sugestão.
	DefaultWallet *string
	// IsEssential marca gasto essencial: base da meta da reserva de emergência (pós-MVP).
	IsEssential bool
	SortOrder   int
	ArchivedAt  *time.Time
	DeletedAt   gorm.DeletedAt
}

func (Category) TableName() string { return "categories" }

func (c Category) Archived() bool { return c.ArchivedAt != nil }
