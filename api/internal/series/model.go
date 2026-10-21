package series

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbmodel"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
)

// Purchase espelha a tabela `purchases`: o cabeçalho da compra parcelada.
// As parcelas são linhas de `invoices` (purchase_id + installment_number).
type Purchase struct {
	dbmodel.Base
	HouseholdID       uuid.UUID  `gorm:"type:uuid"`
	CategoryID        uuid.UUID  `gorm:"type:uuid"`
	ResponsibleUserID *uuid.UUID `gorm:"type:uuid"`
	Description       string
	PurchaseDate      caldate.Date
	// TotalAmountCents é o total informado pelo usuário (informativo); a soma real são as parcelas.
	TotalAmountCents  money.Cents
	InstallmentsCount int
	Notes             *string
	CreatedBy         uuid.UUID `gorm:"type:uuid"`
	DeletedAt         gorm.DeletedAt
}

func (Purchase) TableName() string { return "purchases" }

// Recurrence espelha a tabela `recurrences`: o molde de uma conta fixa mensal.
type Recurrence struct {
	dbmodel.Base
	HouseholdID       uuid.UUID  `gorm:"type:uuid"`
	CategoryID        uuid.UUID  `gorm:"type:uuid"`
	ResponsibleUserID *uuid.UUID `gorm:"type:uuid"`
	Description       string
	AmountCents       money.Cents
	DayOfMonth        int
	StartMonth        caldate.Date
	EndMonth          caldate.Date // zero = sem fim (NULL)
	GeneratedThrough  caldate.Date // último mês materializado em invoices
	Notes             *string
	CreatedBy         uuid.UUID `gorm:"type:uuid"`
	DeletedAt         gorm.DeletedAt
}

func (Recurrence) TableName() string { return "recurrences" }
