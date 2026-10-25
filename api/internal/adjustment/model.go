// Package adjustment cuida dos ajustes de saldo ("Conferir saldo"): a pessoa informa quanto dinheiro há de verdade numa
// carteira e a diferença para o saldo calculado vira um ajuste naquele mês. Não é receita nem despesa: só corrige o
// saldo da carteira (o cálculo está em internal/summary). Não há edição: para corrigir, exclui e confere de novo.
// Regras em docs/developer-guide/incomes-and-wallets.md.
package adjustment

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/id"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
)

// Adjustment espelha a tabela `wallet_adjustments`. Não usa dbmodel.Base porque a tabela não tem updated_at.
// AmountCents tem sinal: positivo = havia mais dinheiro do que o calculado; negativo = menos.
type Adjustment struct {
	ID              uuid.UUID `gorm:"type:uuid;primaryKey"`
	HouseholdID     uuid.UUID `gorm:"type:uuid"`
	WalletID        uuid.UUID `gorm:"type:uuid"`
	CompetenceMonth caldate.Date
	AmountCents     money.Cents
	Notes           *string
	CreatedBy       uuid.UUID `gorm:"type:uuid"`
	CreatedAt       time.Time
	DeletedAt       gorm.DeletedAt
}

func (Adjustment) TableName() string { return "wallet_adjustments" }

// BeforeCreate gera o UUIDv7 na aplicação (mesmo papel do hook de dbmodel.Base).
func (a *Adjustment) BeforeCreate(*gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = id.New()
	}
	return nil
}
