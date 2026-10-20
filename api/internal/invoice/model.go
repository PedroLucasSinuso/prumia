// Package invoice cuida das despesas ("invoices"): cadastro, listagem do mês, pagamento.
package invoice

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbmodel"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
)

// Invoice espelha a tabela `invoices` (ver docs/developer-guide/schema.md).
// Datas opcionais usam caldate.Date com valor zero = NULL; ponteiros só onde o tipo base não é nulável.
type Invoice struct {
	dbmodel.Base
	HouseholdID       uuid.UUID  `gorm:"type:uuid"`
	CategoryID        uuid.UUID  `gorm:"type:uuid"`
	ResponsibleUserID *uuid.UUID `gorm:"type:uuid"`
	Description       string
	AmountCents       money.Cents
	DueDate           caldate.Date
	// CompetenceMonth: mês a que o gasto se refere (dia 1). O resumo mensal usa este campo.
	CompetenceMonth caldate.Date

	// Série (no máximo uma): parcela de compra OU ocorrência de recorrência (Fase 1c).
	PurchaseID        *uuid.UUID `gorm:"type:uuid"`
	InstallmentNumber *int
	RecurrenceID      *uuid.UUID `gorm:"type:uuid"`
	OccurrenceMonth   caldate.Date

	// Pagamento: os quatro campos andam juntos (CHECK no banco). PaidAt zero = pendente.
	PaidAt          caldate.Date
	PaidWallet      *string
	PaidAmountCents *money.Cents
	PaidByUserID    *uuid.UUID `gorm:"type:uuid"`

	Notes     *string
	CreatedBy uuid.UUID `gorm:"type:uuid"`
	DeletedAt gorm.DeletedAt
}

func (Invoice) TableName() string { return "invoices" }

func (i Invoice) Paid() bool     { return !i.PaidAt.IsZero() }
func (i Invoice) InSeries() bool { return i.PurchaseID != nil || i.RecurrenceID != nil }

// Status é derivado, não é coluna: pago = tem paid_at; atrasada = pendente com vencimento passado.
type Status string

const (
	StatusPending Status = "pending"
	StatusOverdue Status = "overdue"
	StatusPaid    Status = "paid"
)

// View é a invoice com o status já calculado para o dia de hoje.
type View struct {
	Invoice
	Status Status
}

func statusOf(i Invoice, today caldate.Date) Status {
	switch {
	case i.Paid():
		return StatusPaid
	case i.DueDate.Before(today):
		return StatusOverdue
	default:
		return StatusPending
	}
}
