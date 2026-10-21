// Package invoice cuida das despesas ("invoices"): cadastro, listagem do mês, pagamento.
package invoice

import (
	"time"

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
	// InstallmentsCount: total de parcelas da compra (só para parcelas); alimenta "3 de 6" na resposta.
	InstallmentsCount *int
	// Boleto: dados do boleto associado (nunca o arquivo), se houver.
	Boleto *Boleto
}

// Boleto espelha `invoice_boletos` (1:1 com a invoice). A linha digitável é única por casa só no serviço (invoices excluídas não contam).
type Boleto struct {
	InvoiceID           uuid.UUID `gorm:"type:uuid;primaryKey"`
	HouseholdID         uuid.UUID `gorm:"type:uuid"`
	DigitableLine       string
	Barcode             *string
	BeneficiaryName     *string
	DocumentAmountCents *money.Cents
	DocumentDueDate     caldate.Date
	CreatedAt           time.Time `gorm:"autoCreateTime"`
	UpdatedAt           time.Time `gorm:"autoUpdateTime"`
}

func (Boleto) TableName() string { return "invoice_boletos" }

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
