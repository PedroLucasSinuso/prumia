package series

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// horizonMonths: quantos meses à frente a recorrência é materializada (a partir de hoje ou do início, o que for maior).
const horizonMonths = 12

// RecurrenceService cria, edita e mantém (estende) as contas recorrentes.
type RecurrenceService struct {
	db    *gorm.DB
	inv   *invoice.Service
	today func() caldate.Date
}

func NewRecurrenceService(db *gorm.DB, inv *invoice.Service, today func() caldate.Date) *RecurrenceService {
	return &RecurrenceService{db: db, inv: inv, today: today}
}

// defaultThrough é o último mês que a recorrência deve ter materializado "por padrão":
// 12 meses depois do maior entre o mês de hoje e o mês inicial, limitado pelo fim (se houver).
func defaultThrough(r Recurrence, today caldate.Date) caldate.Date {
	base := today.StartOfMonth()
	if r.StartMonth.After(base) {
		base = r.StartMonth
	}
	through := base.AddMonths(horizonMonths)
	if !r.EndMonth.IsZero() && r.EndMonth.Before(through) {
		through = r.EndMonth
	}
	return through
}

// insertOccurrences grava as ocorrências de from..through. ON CONFLICT DO NOTHING é o que impede de ressuscitar:
// o índice único (recurrence_id, occurrence_month) INCLUI linhas excluídas, então uma ocorrência que o usuário apagou
// continua "ocupando" o mês e o insert a ignora em silêncio.
func insertOccurrences(tx *gorm.DB, r Recurrence, from, through caldate.Date) error {
	occ := GenerateOccurrences(from, through, r.DayOfMonth)
	if len(occ) == 0 {
		return nil
	}
	rows := make([]invoice.Invoice, len(occ))
	for i, o := range occ {
		rid := r.ID
		rows[i] = invoice.Invoice{
			HouseholdID: r.HouseholdID, CategoryID: r.CategoryID, ResponsibleUserID: r.ResponsibleUserID,
			Description: r.Description, AmountCents: r.AmountCents, DueDate: o.DueDate, CompetenceMonth: o.Month,
			RecurrenceID: &rid, OccurrenceMonth: o.Month, Notes: r.Notes, CreatedBy: r.CreatedBy,
		}
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(&rows, 100).Error
}

type RecurrenceInput struct {
	CategoryID        uuid.UUID
	ResponsibleUserID *uuid.UUID
	Description       string
	AmountCents       money.Cents
	DayOfMonth        int
	StartMonth        caldate.Date
	EndMonth          *caldate.Date
	Notes             *string
}

// Create grava a recorrência e gera uma invoice por mês do início até o horizonte, numa transação.
func (s *RecurrenceService) Create(ctx context.Context, householdID, userID uuid.UUID, in RecurrenceInput) (Recurrence, error) {
	var v validation.Collector
	in.Description = invoice.CheckDescription(in.Description, &v)
	invoice.CheckAmount(in.AmountCents, "amountCents", &v)
	if in.DayOfMonth < 1 || in.DayOfMonth > 31 {
		v.Add("dayOfMonth", "informe um dia de 1 a 31")
	}
	thisMonth := s.today().StartOfMonth()
	switch {
	case in.StartMonth.IsZero() || !in.StartMonth.IsStartOfMonth():
		v.Add("startMonth", "informe o primeiro dia do mês (AAAA-MM-01)")
	case in.StartMonth.Before(thisMonth.AddMonths(-maxMonthsAway)) || in.StartMonth.After(thisMonth.AddMonths(maxMonthsAway)):
		v.Add("startMonth", fmt.Sprintf("o início deve estar a até %d meses de hoje", maxMonthsAway))
	}
	var end caldate.Date
	if in.EndMonth != nil {
		end = *in.EndMonth
		if !end.IsStartOfMonth() {
			v.Add("endMonth", "informe o primeiro dia do mês (AAAA-MM-01)")
		} else if end.Before(in.StartMonth) {
			v.Add("endMonth", "o fim não pode ser anterior ao início")
		}
	}
	in.Notes = invoice.CheckNotes(in.Notes, &v)
	if err := s.inv.CheckRefs(ctx, householdID, &in.CategoryID, in.ResponsibleUserID, &v); err != nil {
		return Recurrence{}, err
	}
	if err := v.Err(); err != nil {
		return Recurrence{}, err
	}

	r := Recurrence{
		HouseholdID: householdID, CategoryID: in.CategoryID, ResponsibleUserID: in.ResponsibleUserID,
		Description: in.Description, AmountCents: in.AmountCents, DayOfMonth: in.DayOfMonth,
		StartMonth: in.StartMonth, EndMonth: end, Notes: in.Notes, CreatedBy: userID,
	}
	r.GeneratedThrough = defaultThrough(r, s.today())
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&r).Error; err != nil {
			return fmt.Errorf("criando recorrência: %w", err)
		}
		return insertOccurrences(tx, r, r.StartMonth, r.GeneratedThrough)
	})
	return r, err
}

// maxAheadMonths limita o pedido "gere até este mês" feito ao listar um mês futuro (evita gerar décadas por uma URL).
const maxAheadMonths = 60

// EnsureHorizon estende, para todas as recorrências ativas da casa, as ocorrências até o horizonte padrão (12 meses à
// frente) ou até `requested` (um mês futuro que alguém está olhando), o que for maior, respeitando o fim de cada uma
// e o teto de maxAheadMonths. Idempotente e seguro com chamadas simultâneas (ON CONFLICT DO NOTHING).
// requested zero = só o horizonte padrão.
func (s *RecurrenceService) EnsureHorizon(ctx context.Context, householdID uuid.UUID, requested caldate.Date) error {
	return s.ensure(ctx, s.db.WithContext(ctx).Where("household_id = ?", householdID), requested)
}

// EnsureHorizonAll faz o mesmo para TODAS as casas. É o job diário (`api horizon`); o único lugar sem filtro de casa,
// de propósito: roda como sistema, não em nome de um usuário.
func (s *RecurrenceService) EnsureHorizonAll(ctx context.Context) error {
	return s.ensure(ctx, s.db.WithContext(ctx), caldate.Date{})
}

func (s *RecurrenceService) ensure(ctx context.Context, scope *gorm.DB, requested caldate.Date) error {
	today := s.today()
	var recs []Recurrence
	// gorm.DeletedAt já exclui as recorrências apagadas. O filtro generated_through < teto evita ler as já em dia.
	maxThrough := today.StartOfMonth().AddMonths(maxAheadMonths)
	if err := scope.Where("generated_through < ?", maxThrough).Find(&recs).Error; err != nil {
		return err
	}
	for _, r := range recs {
		target := defaultThrough(r, today)
		if req := requested.StartOfMonth(); !requested.IsZero() && req.After(target) {
			target = req
			if target.After(maxThrough) {
				target = maxThrough
			}
			if !r.EndMonth.IsZero() && r.EndMonth.Before(target) {
				target = r.EndMonth
			}
		}
		if !r.GeneratedThrough.Before(target) {
			continue
		}
		err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := insertOccurrences(tx, r, r.GeneratedThrough.AddMonths(1), target); err != nil {
				return err
			}
			// GREATEST: se duas chamadas simultâneas gerarem, a de horizonte menor não recua o marcador.
			return tx.Model(&Recurrence{}).Where("id = ? AND household_id = ?", r.ID, r.HouseholdID).
				Update("generated_through", gorm.Expr("GREATEST(generated_through, ?::date)", target)).Error
		})
		if err != nil {
			return fmt.Errorf("estendendo recorrência %s: %w", r.ID, err)
		}
	}
	return nil
}

// List devolve as recorrências da casa (ativas e encerradas), após garantir o horizonte.
func (s *RecurrenceService) List(ctx context.Context, householdID uuid.UUID) ([]Recurrence, error) {
	if err := s.EnsureHorizon(ctx, householdID, caldate.Date{}); err != nil {
		return nil, err
	}
	var recs []Recurrence
	err := s.db.WithContext(ctx).Where("household_id = ?", householdID).Order("created_at, id").Find(&recs).Error
	return recs, err
}

// RecurrencePatch: nil = não mexer; os campos que aceitam "limpar" têm flag Set.
type RecurrencePatch struct {
	CategoryID        *uuid.UUID
	ResponsibleSet    bool
	ResponsibleUserID *uuid.UUID
	Description       *string
	AmountCents       *money.Cents
	DayOfMonth        *int
	EndMonthSet       bool
	EndMonth          *caldate.Date
	NotesSet          bool
	Notes             *string
}

// Update edita a recorrência e propaga às ocorrências FUTURAS e PENDENTES (não pagas, vencimento de hoje em diante).
// Pagas e passadas nunca mudam. Encerrar (endMonth) exclui as ocorrências pendentes futuras posteriores ao fim.
func (s *RecurrenceService) Update(ctx context.Context, householdID, id uuid.UUID, p RecurrencePatch) (Recurrence, error) {
	var cur Recurrence
	err := s.db.WithContext(ctx).Where("household_id = ? AND id = ?", householdID, id).First(&cur).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Recurrence{}, ErrNotFound
	}
	if err != nil {
		return Recurrence{}, err
	}

	var v validation.Collector
	recUpd := map[string]any{} // colunas da recorrência
	invUpd := map[string]any{} // colunas copiadas para as ocorrências futuras pendentes
	if p.Description != nil {
		d := invoice.CheckDescription(*p.Description, &v)
		recUpd["description"], invUpd["description"] = d, d
	}
	if p.AmountCents != nil {
		invoice.CheckAmount(*p.AmountCents, "amountCents", &v)
		recUpd["amount_cents"], invUpd["amount_cents"] = *p.AmountCents, *p.AmountCents
	}
	if p.CategoryID != nil {
		recUpd["category_id"], invUpd["category_id"] = *p.CategoryID, *p.CategoryID
	}
	var newResp *uuid.UUID
	if p.ResponsibleSet {
		newResp = p.ResponsibleUserID
		recUpd["responsible_user_id"], invUpd["responsible_user_id"] = p.ResponsibleUserID, p.ResponsibleUserID
	}
	if p.NotesSet {
		n := invoice.CheckNotes(p.Notes, &v)
		recUpd["notes"], invUpd["notes"] = n, n
	}
	if p.DayOfMonth != nil {
		if *p.DayOfMonth < 1 || *p.DayOfMonth > 31 {
			v.Add("dayOfMonth", "informe um dia de 1 a 31")
		}
		recUpd["day_of_month"] = *p.DayOfMonth
	}
	var newEnd caldate.Date
	if p.EndMonthSet {
		switch {
		case p.EndMonth == nil && !cur.EndMonth.IsZero():
			v.Add("endMonth", "não é possível reabrir uma recorrência encerrada; crie uma nova")
		case p.EndMonth != nil:
			newEnd = *p.EndMonth
			switch {
			case !newEnd.IsStartOfMonth():
				v.Add("endMonth", "informe o primeiro dia do mês (AAAA-MM-01)")
			case newEnd.Before(cur.StartMonth):
				v.Add("endMonth", "o fim não pode ser anterior ao início")
			case !cur.EndMonth.IsZero() && newEnd.After(cur.EndMonth):
				v.Add("endMonth", "só é possível antecipar o encerramento, não adiá-lo")
			default:
				recUpd["end_month"] = newEnd
			}
		}
	}
	if err := s.inv.CheckRefs(ctx, householdID, p.CategoryID, newResp, &v); err != nil {
		return Recurrence{}, err
	}
	if err := v.Err(); err != nil {
		return Recurrence{}, err
	}

	today := s.today()
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Trava a linha: edição e extensão de horizonte da mesma recorrência não se atropelam.
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("household_id = ? AND id = ?", householdID, id).First(&Recurrence{}).Error; err != nil {
			return err
		}
		if len(recUpd) > 0 {
			if err := tx.Model(&Recurrence{}).Where("household_id = ? AND id = ?", householdID, id).Updates(recUpd).Error; err != nil {
				return err
			}
		}
		// Alvo: pendentes, com vencimento de hoje em diante, desta recorrência (e só desta casa).
		future := func() *gorm.DB {
			return tx.Model(&invoice.Invoice{}).Where(
				"household_id = ? AND recurrence_id = ? AND paid_at IS NULL AND due_date >= ?", householdID, id, today)
		}
		if !newEnd.IsZero() {
			if err := future().Where("occurrence_month > ?", newEnd).Delete(&invoice.Invoice{}).Error; err != nil {
				return err
			}
		}
		if len(invUpd) > 0 {
			if err := future().Updates(invUpd).Error; err != nil {
				return err
			}
		}
		// Depois da cópia dos campos (que filtra por due_date >= hoje), muda o dia de cada ocorrência.
		if p.DayOfMonth != nil {
			var targets []invoice.Invoice
			if err := future().Find(&targets).Error; err != nil {
				return err
			}
			for _, t := range targets {
				due := t.OccurrenceMonth.WithDayClamped(*p.DayOfMonth)
				err := tx.Model(&invoice.Invoice{}).Where("household_id = ? AND id = ?", householdID, t.ID).Update("due_date", due).Error
				if err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return Recurrence{}, err
	}
	var out Recurrence
	err = s.db.WithContext(ctx).Where("household_id = ? AND id = ?", householdID, id).First(&out).Error
	return out, err
}
