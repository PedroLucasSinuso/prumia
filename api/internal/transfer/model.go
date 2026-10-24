// Package transfer cuida das transferências entre carteiras da casa (guardar dinheiro na Reserva, tirar de lá). Não é
// receita nem despesa: só move saldo de uma carteira para outra (o cálculo está em internal/summary). Não há edição:
// para corrigir, exclui e cria outra. Regras em docs/developer-guide/incomes-and-wallets.md.
package transfer

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/id"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
)

// Transfer espelha a tabela `wallet_transfers`. Não usa dbmodel.Base porque a tabela não tem updated_at.
type Transfer struct {
	ID              uuid.UUID `gorm:"type:uuid;primaryKey"`
	HouseholdID     uuid.UUID `gorm:"type:uuid"`
	FromWalletID    uuid.UUID `gorm:"type:uuid"`
	ToWalletID      uuid.UUID `gorm:"type:uuid"`
	AmountCents     money.Cents
	TransferDate    caldate.Date
	CompetenceMonth caldate.Date
	Notes           *string
	CreatedBy       uuid.UUID `gorm:"type:uuid"`
	CreatedAt       time.Time
	DeletedAt       gorm.DeletedAt
}

func (Transfer) TableName() string { return "wallet_transfers" }

// BeforeCreate gera o UUIDv7 na aplicação (mesmo papel do hook de dbmodel.Base).
func (t *Transfer) BeforeCreate(*gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = id.New()
	}
	return nil
}
