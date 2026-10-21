package income

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

// maxStartAwayMonths limita quão longe (passado ou futuro) uma fonte pode começar (não gerar milhares de linhas por requisição).
const maxStartAwayMonths = 120

// sourceDeductions carrega o template de várias fontes de uma vez (uma consulta, sem N+1).
func sourceDeductions(tx *gorm.DB, householdID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID][]Deduction, error) {
	out := map[uuid.UUID][]Deduction{}
	if len(ids) == 0 {
		return out, nil
	}
	var rows []sourceDeductionRow
	err := tx.Where("household_id = ? AND source_id IN ?", householdID, ids).Order("position, id").Find(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("lendo descontos do template: %w", err)
	}
	for _, r := range rows {
		out[r.SourceID] = append(out[r.SourceID], Deduction{Kind: r.Kind, Name: r.Name, AmountCents: r.AmountCents})
	}
	return out, nil
}

func replaceSourceDeductions(tx *gorm.DB, householdID, sourceID uuid.UUID, ds []Deduction) error {
	if err := tx.Where("household_id = ? AND source_id = ?", householdID, sourceID).Delete(&sourceDeductionRow{}).Error; err != nil {
		return err
	}
	if len(ds) == 0 {
		return nil
	}
	rows := make([]sourceDeductionRow, len(ds))
	for i, d := range ds {
		rows[i] = sourceDeductionRow{HouseholdID: householdID, SourceID: sourceID, Kind: d.Kind, Name: d.Name, AmountCents: d.AmountCents, Position: i}
	}
	return tx.Create(&rows).Error
}

// insertOccurrences grava os lançamentos PREVISTOS de from..through, já com bruto e descontos do template.
//
// ON CONFLICT DO NOTHING é o que impede de ressuscitar: o índice único (source_id, competence_month) INCLUI linhas
// excluídas, então um mês que o usuário apagou continua "ocupado" e o insert o ignora em silêncio. Como o insert pode
// pular linhas, os descontos só são gravados para os lançamentos que de fato existem depois dele.
func insertOccurrences(tx *gorm.DB, src Source, tmpl []Deduction, from, through caldate.Date) error {
	occ := GenerateOccurrences(from, through, src.DayOfMonth)
	if len(occ) == 0 {
		return nil
	}
	rows := make([]Income, len(occ))
	ids := make([]uuid.UUID, len(occ))
	for i, o := range occ {
		sid := src.ID
		rows[i] = Income{
			HouseholdID: src.HouseholdID, SourceID: &sid, UserID: src.UserID, Kind: src.Kind, Description: src.Name,
			Wallet: src.Wallet, CompetenceMonth: o.Month, ExpectedDate: o.ExpectedDate,
			GrossAmountCents: src.GrossAmountCents, Notes: src.Notes, CreatedBy: src.CreatedBy,
		}
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(&rows, 100).Error; err != nil {
		return err
	}
	for i := range rows {
		ids[i] = rows[i].ID // o hook BeforeCreate já definiu os ids na aplicação
	}
	var created []uuid.UUID
	if err := tx.Model(&Income{}).Where("household_id = ? AND id IN ?", src.HouseholdID, ids).Pluck("id", &created).Error; err != nil {
		return err
	}
	return insertDeductions(tx, src.HouseholdID, created, tmpl)
}

type SourceInput struct {
	UserID           uuid.UUID
	Kind             string
	Wallet           *string
	Name             string
	GrossAmountCents money.Cents
	DayOfMonth       int
	StartMonth       caldate.Date
	EndMonth         *caldate.Date
	Notes            *string
	Deductions       []Deduction
}

// CreateSource grava a fonte e gera os lançamentos previstos do início até o horizonte (12 meses), numa transação.
func (s *Service) CreateSource(ctx context.Context, householdID, createdBy uuid.UUID, in SourceInput) (SourceView, error) {
	var v validation.Collector
	in.Name = checkName("name", in.Name, 120, &v)
	wallet := ResolveWallet(in.Kind, in.Wallet, &v)
	CheckGross(in.GrossAmountCents, &v)
	ds := CheckDeductions(in.GrossAmountCents, in.Deductions, &v)
	if in.DayOfMonth < 1 || in.DayOfMonth > 31 {
		v.Add("dayOfMonth", "informe um dia de 1 a 31")
	}
	thisMonth := s.today().StartOfMonth()
	switch {
	case in.StartMonth.IsZero() || !in.StartMonth.IsStartOfMonth():
		v.Add("startMonth", "informe o primeiro dia do mês (AAAA-MM-01)")
	case in.StartMonth.Before(thisMonth.AddMonths(-maxStartAwayMonths)) || in.StartMonth.After(thisMonth.AddMonths(maxStartAwayMonths)):
		v.Add("startMonth", fmt.Sprintf("o início deve estar a até %d meses de hoje", maxStartAwayMonths))
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
	if err := s.checkMember(ctx, householdID, in.UserID, &v); err != nil {
		return SourceView{}, err
	}
	if err := v.Err(); err != nil {
		return SourceView{}, err
	}

	src := Source{
		HouseholdID: householdID, UserID: in.UserID, Kind: in.Kind, Name: in.Name, Wallet: wallet,
		GrossAmountCents: in.GrossAmountCents, DayOfMonth: in.DayOfMonth, StartMonth: in.StartMonth, EndMonth: end,
		Notes: in.Notes, CreatedBy: createdBy,
	}
	src.GeneratedThrough = DefaultThrough(src.StartMonth, src.EndMonth, s.today())
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&src).Error; err != nil {
			return fmt.Errorf("criando fonte de receita: %w", err)
		}
		if err := replaceSourceDeductions(tx, householdID, src.ID, ds); err != nil {
			return err
		}
		return insertOccurrences(tx, src, ds, src.StartMonth, src.GeneratedThrough)
	})
	if err != nil {
		return SourceView{}, err
	}
	return SourceView{Source: src, Deductions: nonNil(ds)}, nil
}

func nonNil(ds []Deduction) []Deduction {
	if ds == nil {
		return []Deduction{}
	}
	return ds
}

// EnsureHorizon estende a previsão de todas as fontes ativas da casa até o horizonte padrão (12 meses à frente) ou até
// `requested` (um mês futuro que alguém está olhando), o que for maior, respeitando o fim de cada fonte e o teto de
// 60 meses. Idempotente e seguro com chamadas simultâneas (trava da linha + ON CONFLICT DO NOTHING).
// requested zero = só o horizonte padrão.
func (s *Service) EnsureHorizon(ctx context.Context, householdID uuid.UUID, requested caldate.Date) error {
	return s.ensure(ctx, s.db.WithContext(ctx).Where("household_id = ?", householdID), requested)
}

// EnsureHorizonAll faz o mesmo para TODAS as casas: é o job diário (`api horizon`), o único lugar sem filtro de casa,
// de propósito (roda como sistema, não em nome de um usuário).
func (s *Service) EnsureHorizonAll(ctx context.Context) error {
	return s.ensure(ctx, s.db.WithContext(ctx), caldate.Date{})
}

func (s *Service) ensure(ctx context.Context, scope *gorm.DB, requested caldate.Date) error {
	today := s.today()
	maxThrough := today.StartOfMonth().AddMonths(maxAheadMonths)
	var srcs []Source
	if err := scope.Where("generated_through < ?", maxThrough).Find(&srcs).Error; err != nil {
		return err
	}
	for _, c := range srcs {
		if !c.GeneratedThrough.Before(TargetThrough(c.StartMonth, c.EndMonth, today, requested)) {
			continue // já em dia (checagem barata, sem transação)
		}
		err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			// Relê a fonte TRAVADA: outra chamada pode ter gerado enquanto esperávamos.
			var cur Source
			err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("household_id = ? AND id = ?", c.HouseholdID, c.ID).First(&cur).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			if err != nil {
				return err
			}
			target := TargetThrough(cur.StartMonth, cur.EndMonth, today, requested)
			if !cur.GeneratedThrough.Before(target) {
				return nil
			}
			tmpl, err := sourceDeductions(tx, cur.HouseholdID, []uuid.UUID{cur.ID})
			if err != nil {
				return err
			}
			if err := insertOccurrences(tx, cur, tmpl[cur.ID], cur.GeneratedThrough.AddMonths(1), target); err != nil {
				return err
			}
			return tx.Model(&Source{}).Where("id = ? AND household_id = ?", cur.ID, cur.HouseholdID).
				Update("generated_through", gorm.Expr("GREATEST(generated_through, ?::date)", target)).Error
		})
		if err != nil {
			return fmt.Errorf("estendendo fonte de receita %s: %w", c.ID, err)
		}
	}
	return nil
}

// ListSources devolve as fontes da casa (ativas e encerradas) com os descontos do template, após garantir o horizonte.
func (s *Service) ListSources(ctx context.Context, householdID uuid.UUID) ([]SourceView, error) {
	if err := s.EnsureHorizon(ctx, householdID, caldate.Date{}); err != nil {
		return nil, err
	}
	var srcs []Source
	if err := s.db.WithContext(ctx).Where("household_id = ?", householdID).Order("created_at, id").Find(&srcs).Error; err != nil {
		return nil, err
	}
	return s.sourceViews(ctx, householdID, srcs)
}

func (s *Service) sourceViews(ctx context.Context, householdID uuid.UUID, srcs []Source) ([]SourceView, error) {
	ids := make([]uuid.UUID, len(srcs))
	for i, c := range srcs {
		ids[i] = c.ID
	}
	tmpl, err := sourceDeductions(s.db.WithContext(ctx), householdID, ids)
	if err != nil {
		return nil, err
	}
	out := make([]SourceView, len(srcs))
	for i, c := range srcs {
		out[i] = SourceView{Source: c, Deductions: nonNil(tmpl[c.ID])}
	}
	return out, nil
}

// SourcePatch: nil = não mexer. EndMonthSet/NotesSet/DeductionsSet distinguem "ausente" de "null"/"lista vazia".
type SourcePatch struct {
	Name             *string
	GrossAmountCents *money.Cents
	DayOfMonth       *int
	EndMonthSet      bool
	EndMonth         *caldate.Date
	NotesSet         bool
	Notes            *string
	DeductionsSet    bool
	Deductions       []Deduction
}

// UpdateSource edita o template da fonte.
//
//   - Sem applyFrom: só o template muda. Os lançamentos já gerados ficam como estão; valem os novos valores para os meses
//     que ainda vão ser gerados.
//   - Com applyFrom (dia 1): os lançamentos PREVISTOS (não recebidos, não excluídos) desse mês em diante recebem o
//     template inteiro (nome, bruto, dia, observação e descontos), sobrescrevendo ajustes mês a mês. Os RECEBIDOS nunca mudam.
//   - endMonth só pode ANTECIPAR o fim; os previstos depois dele são excluídos (logicamente). Recebidos ficam.
func (s *Service) UpdateSource(ctx context.Context, householdID, id uuid.UUID, p SourcePatch, applyFrom *caldate.Date) (SourceView, error) {
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var cur Source
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("household_id = ? AND id = ?", householdID, id).First(&cur).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		tmplMap, err := sourceDeductions(tx, householdID, []uuid.UUID{id})
		if err != nil {
			return err
		}
		tmpl := tmplMap[id]

		var v validation.Collector
		upd := map[string]any{}
		if applyFrom != nil && (applyFrom.IsZero() || !applyFrom.IsStartOfMonth()) {
			v.Add("applyFrom", "informe o primeiro dia do mês (AAAA-MM-01)")
		}
		if p.Name != nil {
			cur.Name = checkName("name", *p.Name, 120, &v)
			upd["name"] = cur.Name
		}
		if p.GrossAmountCents != nil {
			cur.GrossAmountCents = *p.GrossAmountCents
			CheckGross(cur.GrossAmountCents, &v)
			upd["gross_amount_cents"] = cur.GrossAmountCents
		}
		if p.DayOfMonth != nil {
			cur.DayOfMonth = *p.DayOfMonth
			if cur.DayOfMonth < 1 || cur.DayOfMonth > 31 {
				v.Add("dayOfMonth", "informe um dia de 1 a 31")
			}
			upd["day_of_month"] = cur.DayOfMonth
		}
		if p.NotesSet {
			cur.Notes = invoice.CheckNotes(p.Notes, &v)
			upd["notes"] = cur.Notes
		}
		if p.DeductionsSet {
			tmpl = CheckDeductions(cur.GrossAmountCents, p.Deductions, &v)
		} else if p.GrossAmountCents != nil && SumDeductions(tmpl) > cur.GrossAmountCents {
			v.Add("grossAmountCents", "o bruto não pode ficar menor que a soma dos descontos")
		}
		var newEnd caldate.Date
		if p.EndMonthSet {
			switch {
			case p.EndMonth == nil && !cur.EndMonth.IsZero():
				v.Add("endMonth", "não é possível reabrir uma fonte encerrada; crie uma nova")
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
					upd["end_month"] = newEnd
				}
			}
		}
		if err := v.Err(); err != nil {
			return err
		}

		if len(upd) > 0 {
			if err := tx.Model(&Source{}).Where("household_id = ? AND id = ?", householdID, id).Updates(upd).Error; err != nil {
				return err
			}
		}
		if p.DeductionsSet {
			if err := replaceSourceDeductions(tx, householdID, id, tmpl); err != nil {
				return err
			}
		}
		// Previstos desta fonte (e só desta casa): não recebidos e não excluídos (o escopo do GORM filtra deleted_at).
		predicted := func() *gorm.DB {
			return tx.Model(&Income{}).Where("household_id = ? AND source_id = ? AND received_at IS NULL", householdID, id)
		}
		if !newEnd.IsZero() {
			if err := predicted().Where("competence_month > ?", newEnd).Delete(&Income{}).Error; err != nil {
				return err
			}
		}
		if applyFrom != nil {
			return s.reapplyTemplate(tx, predicted().Where("competence_month >= ?", *applyFrom), cur, tmpl)
		}
		return nil
	})
	if err != nil {
		return SourceView{}, err
	}
	var out Source
	if err := s.db.WithContext(ctx).Where("household_id = ? AND id = ?", householdID, id).First(&out).Error; err != nil {
		return SourceView{}, err
	}
	vs, err := s.sourceViews(ctx, householdID, []Source{out})
	if err != nil {
		return SourceView{}, err
	}
	return vs[0], nil
}

// reapplyTemplate copia o template da fonte para os lançamentos de `targets` e troca os descontos deles.
func (s *Service) reapplyTemplate(tx *gorm.DB, targets *gorm.DB, src Source, tmpl []Deduction) error {
	var ids []uuid.UUID
	if err := targets.Session(&gorm.Session{}).Pluck("id", &ids).Error; err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	// Dia do mês travado no último dia do mês curto, calculado no banco: dia 31 em fevereiro vira 28/29.
	expected := gorm.Expr("LEAST(competence_month + (?::int - 1), (competence_month + interval '1 month - 1 day')::date)", src.DayOfMonth)
	err := tx.Model(&Income{}).Where("household_id = ? AND id IN ?", src.HouseholdID, ids).Updates(map[string]any{
		"description": src.Name, "gross_amount_cents": src.GrossAmountCents, "notes": src.Notes, "expected_date": expected,
	}).Error
	if err != nil {
		return err
	}
	if err := tx.Where("household_id = ? AND income_id IN ?", src.HouseholdID, ids).Delete(&incomeDeductionRow{}).Error; err != nil {
		return err
	}
	return insertDeductions(tx, src.HouseholdID, ids, tmpl)
}
