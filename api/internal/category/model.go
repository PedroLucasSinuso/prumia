// Package category cuida das categorias de despesa de cada casa.
package category

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbmodel"
)

type Category struct {
	dbmodel.Base
	HouseholdID uuid.UUID `gorm:"type:uuid"`
	Name        string
	// DefaultWalletID é só sugestão ao pagar (ex.: Mercado -> carteira Benefício); nil = sem sugestão.
	DefaultWalletID *uuid.UUID `gorm:"type:uuid"`
	// IsEssential marca gasto essencial: base da meta da reserva de emergência (pós-MVP).
	IsEssential bool
	SortOrder   int
	// ParentID: categoria-mãe (nil = de topo). Só dois níveis: a mãe é sempre de topo.
	ParentID   *uuid.UUID `gorm:"type:uuid"`
	ArchivedAt *time.Time
	DeletedAt  gorm.DeletedAt
}

func (Category) TableName() string { return "categories" }

func (c Category) Archived() bool { return c.ArchivedAt != nil }
