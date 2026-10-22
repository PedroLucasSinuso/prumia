// Package payee cuida dos favorecidos: quem recebe o pagamento, com o nome (apelido) que a casa escolhe.
package payee

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbmodel"
)

type Payee struct {
	dbmodel.Base
	HouseholdID uuid.UUID `gorm:"type:uuid"`
	Name        string    // apelido da casa ("Gás")
	CNPJ        *string   // só dígitos, validado; opcional
	LegalName   *string   // razão social, informativa ("GASCO DISTRIBUIDORA S/A")
	// DefaultCategoryID é sugestão ao lançar conta deste favorecido; nil = sem sugestão.
	DefaultCategoryID *uuid.UUID `gorm:"type:uuid"`
	ArchivedAt        *time.Time
	DeletedAt         gorm.DeletedAt
}

func (Payee) TableName() string { return "payees" }

func (p Payee) Archived() bool { return p.ArchivedAt != nil }
