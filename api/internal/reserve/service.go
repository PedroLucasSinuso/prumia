// Package reserve calcula a meta da reserva de emergência da casa (PT-5a): quantos MESES de gasto essencial a casa quer
// guardados, quais carteiras contam como reserva e o progresso (saldo dessas carteiras ÷ gasto essencial médio). Nada é
// gravado além da configuração (households.reserve_target_months e wallets.counts_as_reserve). Regras em
// docs/developer-guide/incomes-and-wallets.md, seção "Reserva de emergência".
package reserve

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
	"github.com/PedroLucasSinuso/prumia/api/internal/summary"
)

var ErrForbidden = errors.New("apenas administradores da casa")

const (
	MinTargetMonths = 1
	MaxTargetMonths = 36
	// BasisMonths: a média do gasto essencial olha os 6 meses ANTES do mês consultado (só os que tiveram alguma conta).
	BasisMonths = 6
)

// Service: o saldo das carteiras vem do summary.Service (a mesma conta do resumo, uma só implementação).
type Service struct {
	db       *gorm.DB
	balances *summary.Service
}

func NewService(db *gorm.DB, balances *summary.Service) *Service {
	return &Service{db: db, balances: balances}
}

// Status é a reserva da casa num mês. TargetMonths nil = a casa não configurou meta (a tela não mostra nada).
type Status struct {
	TargetMonths *int
	WalletIDs    []uuid.UUID
	// EssentialMonthly: gasto essencial médio por mês (contas de categorias essenciais: valor pago, ou o da conta se pendente).
	EssentialMonthly money.Cents
	// Basis: quantos meses entraram na média (0 = ainda não há gasto essencial para calcular).
	Basis int
	// Saved: soma do saldo REALIZADO (o mesmo do resumo) das carteiras de reserva no mês.
	Saved money.Cents
}

// Target é o valor da meta (meses × gasto essencial médio); 0 sem meta ou sem gasto.
func (s Status) Target() money.Cents {
	if s.TargetMonths == nil {
		return 0
	}
	return money.Cents(*s.TargetMonths) * s.EssentialMonthly
}

// Get calcula o status da reserva no mês `month` (dia 1).
func (s *Service) Get(ctx context.Context, householdID uuid.UUID, month caldate.Date) (Status, error) {
	if month.IsZero() || !month.IsStartOfMonth() {
		return Status{}, validation.New("month", "informe o primeiro dia do mês (AAAA-MM-01)")
	}
	db := s.db.WithContext(ctx)
	var out Status
	var target sql.NullInt32
	if err := db.Raw(`SELECT reserve_target_months FROM households WHERE id = ? AND deleted_at IS NULL`, householdID).Scan(&target).Error; err != nil {
		return Status{}, err
	}
	if target.Valid {
		t := int(target.Int32)
		out.TargetMonths = &t
	}
	if err := db.Raw(`SELECT id FROM wallets WHERE household_id = ? AND counts_as_reserve ORDER BY is_default DESC, sort_order, lower(name), id`, householdID).
		Scan(&out.WalletIDs).Error; err != nil {
		return Status{}, err
	}
	if out.WalletIDs == nil {
		out.WalletIDs = []uuid.UUID{}
	}
	if err := s.essential(db, householdID, month, &out); err != nil {
		return Status{}, err
	}
	if len(out.WalletIDs) > 0 {
		sum, err := s.balances.Month(ctx, householdID, month)
		if err != nil {
			return Status{}, fmt.Errorf("saldo das carteiras de reserva: %w", err)
		}
		reserve := map[uuid.UUID]bool{}
		for _, id := range out.WalletIDs {
			reserve[id] = true
		}
		for _, w := range sum.Wallets {
			if reserve[w.WalletID] {
				out.Saved += w.Balance()
			}
		}
	}
	return out, nil
}

// essential: média do gasto essencial nos BasisMonths meses anteriores a `month` que tiveram alguma conta na casa (meses
// sem nenhuma conta, como os de antes de começar a usar o app, não puxam a média para baixo). Sem histórico, usa o
// próprio mês. "Essencial" = a categoria, ou a categoria principal dela, marcada como essencial. Uma consulta agregada.
func (s *Service) essential(db *gorm.DB, householdID uuid.UUID, month caldate.Date, out *Status) error {
	type row struct {
		Months int
		Total  money.Cents
	}
	query := `
		SELECT COUNT(*)::int AS months, COALESCE(SUM(m.essential), 0)::bigint AS total
		FROM (
			SELECT i.competence_month,
			       SUM(CASE WHEN c.is_essential OR COALESCE(p.is_essential, false)
			                THEN CASE WHEN i.paid_at IS NOT NULL THEN i.paid_amount_cents ELSE i.amount_cents END ELSE 0 END) AS essential
			FROM invoices i
			LEFT JOIN categories c ON c.household_id = i.household_id AND c.id = i.category_id
			LEFT JOIN categories p ON p.household_id = c.household_id AND p.id = c.parent_id
			WHERE i.household_id = @hh AND i.deleted_at IS NULL AND i.competence_month >= @from AND i.competence_month < @to
			GROUP BY i.competence_month
		) m`
	var r row
	from, to := month.AddMonths(-BasisMonths), month
	if err := db.Raw(query, sql.Named("hh", householdID), sql.Named("from", from), sql.Named("to", to)).Scan(&r).Error; err != nil {
		return err
	}
	if r.Months == 0 { // sem histórico: o mês consultado
		if err := db.Raw(query, sql.Named("hh", householdID), sql.Named("from", month), sql.Named("to", month.AddMonths(1))).Scan(&r).Error; err != nil {
			return err
		}
	}
	out.Basis = r.Months
	if r.Months > 0 {
		out.EssentialMonthly = r.Total / money.Cents(r.Months)
	}
	if out.EssentialMonthly == 0 {
		out.Basis = 0
	}
	return nil
}

type SetInput struct {
	// TargetMonths nil desliga a meta (a tela some); 1 a 36 liga.
	TargetMonths *int
	// WalletIDs: as carteiras que contam como reserva (as demais deixam de contar). Ativas ou arquivadas da casa.
	WalletIDs []uuid.UUID
}

// Set grava a configuração (somente admin, como as carteiras). Carteira que não é da casa = 400 em walletIds.
func (s *Service) Set(ctx context.Context, householdID, actor uuid.UUID, in SetInput) error {
	db := s.db.WithContext(ctx)
	var admins int64
	if err := db.Raw(`SELECT count(*) FROM household_members WHERE household_id = ? AND user_id = ? AND role = 'admin' AND left_at IS NULL`,
		householdID, actor).Scan(&admins).Error; err != nil {
		return err
	}
	if admins == 0 {
		return ErrForbidden
	}
	if in.TargetMonths != nil && (*in.TargetMonths < MinTargetMonths || *in.TargetMonths > MaxTargetMonths) {
		return validation.New("targetMonths", fmt.Sprintf("use de %d a %d meses", MinTargetMonths, MaxTargetMonths))
	}
	ids := map[uuid.UUID]bool{}
	for _, id := range in.WalletIDs {
		ids[id] = true
	}
	unique := make([]uuid.UUID, 0, len(ids))
	for id := range ids {
		unique = append(unique, id)
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if len(unique) > 0 {
			var found int64
			if err := tx.Raw(`SELECT count(*) FROM wallets WHERE household_id = ? AND id IN ?`, householdID, unique).Scan(&found).Error; err != nil {
				return err
			}
			if found != int64(len(unique)) {
				return validation.New("walletIds", "carteira inválida")
			}
		}
		if err := tx.Exec(`UPDATE households SET reserve_target_months = ? WHERE id = ?`, in.TargetMonths, householdID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE wallets SET counts_as_reserve = false WHERE household_id = ? AND counts_as_reserve`, householdID).Error; err != nil {
			return err
		}
		if len(unique) > 0 {
			if err := tx.Exec(`UPDATE wallets SET counts_as_reserve = true WHERE household_id = ? AND id IN ?`, householdID, unique).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
