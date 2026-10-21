// Package income cuida das receitas: fontes recorrentes (salário, VR), lançamentos mensais com descontos itemizados
// e a previsão (lançamentos PREVISTOS gerados até um horizonte). Regras completas em
// docs/developer-guide/incomes-and-wallets.md.
package income

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbmodel"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/id"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
)

// Tipos de receita e carteiras (valores iguais aos CHECKs do banco).
const (
	KindSalary  = "salary"
	KindBenefit = "benefit"
	KindOther   = "other"

	WalletFree    = "free"
	WalletBenefit = "benefit"
)

// Source espelha `income_sources`: o molde de uma receita mensal de uma pessoa.
type Source struct {
	dbmodel.Base
	HouseholdID      uuid.UUID `gorm:"type:uuid"`
	UserID           uuid.UUID `gorm:"type:uuid"`
	Kind             string
	Name             string
	Wallet           string
	GrossAmountCents money.Cents
	DayOfMonth       int
	StartMonth       caldate.Date
	EndMonth         caldate.Date // zero = sem fim (NULL)
	GeneratedThrough caldate.Date // último mês materializado em incomes
	Notes            *string
	CreatedBy        uuid.UUID `gorm:"type:uuid"`
	DeletedAt        gorm.DeletedAt
}

func (Source) TableName() string { return "income_sources" }

// Income espelha `incomes`: o lançamento de um mês. ReceivedAt zero = previsto.
type Income struct {
	dbmodel.Base
	HouseholdID      uuid.UUID  `gorm:"type:uuid"`
	SourceID         *uuid.UUID `gorm:"type:uuid"`
	UserID           uuid.UUID  `gorm:"type:uuid"`
	Kind             string
	Description      string
	Wallet           string
	CompetenceMonth  caldate.Date
	ExpectedDate     caldate.Date
	GrossAmountCents money.Cents
	ReceivedAt       caldate.Date
	Notes            *string
	CreatedBy        uuid.UUID `gorm:"type:uuid"`
	DeletedAt        gorm.DeletedAt
}

func (Income) TableName() string { return "incomes" }

func (i Income) Received() bool { return !i.ReceivedAt.IsZero() }

// Deduction é um desconto itemizado (INSS, IRRF, plano...). É o mesmo valor para o template da fonte e para o lançamento.
type Deduction struct {
	Kind        string
	Name        string
	AmountCents money.Cents
}

// As duas structs abaixo espelham as tabelas de descontos. Não usam dbmodel.Base porque essas tabelas não têm
// created_at/updated_at; o id (UUIDv7) é gerado no hook BeforeCreate, como nos demais modelos.
type sourceDeductionRow struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	HouseholdID uuid.UUID `gorm:"type:uuid"`
	SourceID    uuid.UUID `gorm:"type:uuid"`
	Kind        string
	Name        string
	AmountCents money.Cents
	Position    int
}

func (sourceDeductionRow) TableName() string { return "income_source_deductions" }
func (r *sourceDeductionRow) BeforeCreate(*gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = id.New()
	}
	return nil
}

type incomeDeductionRow struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	HouseholdID uuid.UUID `gorm:"type:uuid"`
	IncomeID    uuid.UUID `gorm:"type:uuid"`
	Kind        string
	Name        string
	AmountCents money.Cents
	Position    int
}

func (incomeDeductionRow) TableName() string { return "income_deductions" }
func (r *incomeDeductionRow) BeforeCreate(*gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = id.New()
	}
	return nil
}

// View é o lançamento com os descontos carregados e o líquido já calculado (nunca gravado).
type View struct {
	Income
	Deductions []Deduction
	Net        money.Cents
}

// SourceView é a fonte com os descontos do template.
type SourceView struct {
	Source
	Deductions []Deduction
}
