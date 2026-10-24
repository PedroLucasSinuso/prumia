package invoice

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// ExportRow é uma linha da exportação (Ajustes > Dados): a conta com os NOMES já resolvidos (categoria com a mãe,
// favorecido). A formatação para planilha (vírgula decimal, dd/mm/aaaa) é da borda HTTP, não daqui.
type ExportRow struct {
	DueDate         caldate.Date
	CompetenceMonth caldate.Date
	Description     string
	Category        string  // "Moradia" ou "Moradia › Gás"
	Payee           *string // nil = sem favorecido
	AmountCents     money.Cents
	Status          Status
	PaidAt          caldate.Date // zero = não paga
	PaidWallet      *string      // NOME da carteira de pagamento
	PaidAmountCents *money.Cents
}

// exportRow é o formato cru da consulta (nomes das colunas do SELECT).
type exportRow struct {
	DueDate         caldate.Date
	CompetenceMonth caldate.Date
	Description     string
	CategoryName    string
	ParentName      *string
	PayeeName       *string
	AmountCents     money.Cents
	PaidAt          caldate.Date
	PaidWallet      *string
	PaidAmountCents *money.Cents
}

// Export lista as contas NÃO excluídas da casa com vencimento entre from e to (inclusivos; nil = sem limite),
// em ordem de vencimento. Uma consulta só (JOIN), sem N+1. Todos os JOINs repetem o household_id: mesmo com as FKs
// compostas do schema, o isolamento por casa não depende só delas.
func (s *Service) Export(ctx context.Context, householdID uuid.UUID, from, to *caldate.Date) ([]ExportRow, error) {
	if from != nil && to != nil && to.Before(*from) {
		return nil, validation.New("to", "a data final é anterior à inicial")
	}
	q := s.db.WithContext(ctx).Table("invoices i").
		Select(`i.due_date, i.competence_month, i.description, c.name AS category_name, p.name AS parent_name,
			pe.name AS payee_name, i.amount_cents, i.paid_at, w.name AS paid_wallet, i.paid_amount_cents`).
		Joins("JOIN categories c ON c.household_id = i.household_id AND c.id = i.category_id").
		Joins("LEFT JOIN categories p ON p.household_id = c.household_id AND p.id = c.parent_id").
		Joins("LEFT JOIN wallets w ON w.household_id = i.household_id AND w.id = i.paid_wallet_id").
		Joins("LEFT JOIN payees pe ON pe.household_id = i.household_id AND pe.id = i.payee_id").
		Where("i.household_id = ? AND i.deleted_at IS NULL", householdID)
	if from != nil {
		q = q.Where("i.due_date >= ?", *from)
	}
	if to != nil {
		q = q.Where("i.due_date <= ?", *to)
	}
	var raw []exportRow
	if err := q.Order("i.due_date, i.description, i.id").Scan(&raw).Error; err != nil {
		return nil, fmt.Errorf("exportando contas: %w", err)
	}
	today := s.today()
	out := make([]ExportRow, len(raw))
	for i, r := range raw {
		category := r.CategoryName
		if r.ParentName != nil {
			category = *r.ParentName + " › " + r.CategoryName
		}
		// o status é derivado (regra 6 do CLAUDE.md): monta uma Invoice só com o que statusOf precisa
		st := statusOf(Invoice{PaidAt: r.PaidAt, DueDate: r.DueDate}, today)
		out[i] = ExportRow{
			DueDate: r.DueDate, CompetenceMonth: r.CompetenceMonth, Description: r.Description, Category: category,
			Payee: r.PayeeName, AmountCents: r.AmountCents, Status: st, PaidAt: r.PaidAt, PaidWallet: r.PaidWallet,
			PaidAmountCents: r.PaidAmountCents,
		}
	}
	return out, nil
}
