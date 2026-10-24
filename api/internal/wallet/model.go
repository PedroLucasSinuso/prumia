// Package wallet cuida das carteiras de cada casa (Geral, Benefício, a da Ana...). Uma carteira é só um rótulo com um
// saldo inicial: o saldo vem das receitas recebidas e das despesas pagas (ver internal/summary). Nunca é apagada: com
// uso, é arquivada. Regras em docs/developer-guide/incomes-and-wallets.md.
package wallet

import (
	"time"

	"github.com/google/uuid"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbmodel"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
)

// Nomes das duas carteiras criadas junto com toda casa nova (e pelo backfill da migration 00008).
const (
	DefaultName = "Geral"
	BenefitName = "Benefício"
)

// Wallet espelha a tabela `wallets`.
type Wallet struct {
	dbmodel.Base
	HouseholdID uuid.UUID `gorm:"type:uuid"`
	Name        string
	// OwnerUserID é só uma etiqueta ("carteira da Ana"): não restringe quem pode usar a carteira.
	OwnerUserID *uuid.UUID `gorm:"type:uuid"`
	// IsDefault: exatamente uma por casa (índice único parcial no banco). A padrão não pode ser arquivada.
	IsDefault bool
	// WarnOnOverdraft liga o aviso "saldo insuficiente" ao pagar com esta carteira.
	WarnOnOverdraft bool
	// OpeningBalanceCents: saldo inicial (pode ser negativo). Entra no saldo anterior de todos os meses.
	OpeningBalanceCents money.Cents
	SortOrder           int
	ArchivedAt          *time.Time
}

func (Wallet) TableName() string { return "wallets" }

func (w Wallet) Archived() bool { return w.ArchivedAt != nil }
