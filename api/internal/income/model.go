// Package income cuida das receitas: fontes recorrentes (salário, VR), lançamentos mensais com descontos itemizados
// e a previsão (lançamentos PREVISTOS gerados até um horizonte). Regras completas em
// docs/developer-guide/incomes-and-wallets.md.
package income

import (
	"time"

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
	// Valor: fixo, ou por unidade (preço x quantidade; a quantidade padrão de cada mês = dias úteis).
	AmountMode     string
	UnitLabel      *string
	UnitPriceCents *money.Cents
	// Regra de data (ver rules.go): dia N, N-ésimo dia útil ou último dia útil, com o ajuste de fim de semana/feriado.
	DateRule      string
	DateRuleN     *int // nil só em last_business_day
	WeekendAdjust string
	Notes         *string
	CreatedBy     uuid.UUID `gorm:"type:uuid"`
	DeletedAt     gorm.DeletedAt
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
	// ReceivedAt (zero = NULL) é um recebimento marcado de propósito (ex.: antes da data esperada).
	ReceivedAt caldate.Date
	// HeldAt é a exceção "não caiu": o dinheiro previsto ainda não entrou. Anula o recebimento automático.
	HeldAt *time.Time
	// Por unidade: Quantity e UnitPriceCents são preenchidos juntos (nil = valor fixo). O bruto = preço x quantidade.
	Quantity       *int
	UnitPriceCents *money.Cents
	UnitLabel      *string
	// Regra de data usada para calcular ExpectedDate (nil = data digitada, receita avulsa sem regra).
	DateRule      *string
	DateRuleN     *int
	WeekendAdjust *string
	Notes         *string
	CreatedBy     uuid.UUID `gorm:"type:uuid"`
	DeletedAt     gorm.DeletedAt
}

func (Income) TableName() string { return "incomes" }

// IsReceived é o estado DERIVADO "recebida" (não existe coluna de status): a menos que a pessoa tenha dito "não caiu",
// a receita conta como recebida quando a data esperada chega (ou antes, se foi marcada de propósito).
func (i Income) IsReceived(today caldate.Date) bool {
	return i.HeldAt == nil && (!i.ReceivedAt.IsZero() || !i.ExpectedDate.After(today))
}

// ReceivedOn é o dia em que o dinheiro entrou: a marcação de propósito ou, no recebimento automático, a data esperada.
func (i Income) ReceivedOn() caldate.Date {
	if !i.ReceivedAt.IsZero() {
		return i.ReceivedAt
	}
	return i.ExpectedDate
}

// ReceivedSQL é o mesmo estado derivado em SQL (usa um parâmetro: o "hoje"). Fica ao lado de IsReceived para as duas
// definições não se separarem. `alias` é o apelido da tabela na consulta ("" = sem apelido).
func ReceivedSQL(alias string) string {
	if alias != "" {
		alias += "."
	}
	return "(" + alias + "held_at IS NULL AND (" + alias + "received_at IS NOT NULL OR " + alias + "expected_date <= ?))"
}

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
	Received   bool         // derivado (ver IsReceived), relativo ao "hoje" do serviço
	Repeats    bool         // a repetição (fonte) continua depois deste mês
	Until      caldate.Date // último mês da repetição (zero = sem fim)
}

// Mode devolve fixed ou per_unit.
func (i Income) Mode() string {
	if i.Quantity != nil {
		return AmountPerUnit
	}
	return AmountFixed
}

// SourceView é a fonte com os descontos do template.
type SourceView struct {
	Source
	Deductions []Deduction
}
