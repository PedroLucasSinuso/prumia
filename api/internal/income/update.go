package income

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/PedroLucasSinuso/prumia/api/internal/calendar"
	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// Patch: nil = não mexer. DeductionsSet/NotesSet distinguem "não enviado" de "lista vazia"/"null".
type Patch struct {
	UserID      *uuid.UUID
	Kind        *string
	Description *string
	// Só valem com scope=this (cada mês tem o seu):
	CompetenceMonth *caldate.Date
	ExpectedDate    *caldate.Date
	Quantity        *int

	AmountMode       *string
	GrossAmountCents *money.Cents
	UnitPriceCents   *money.Cents
	UnitLabel        *string
	Rule             *DateRule
	DeductionsSet    bool
	Deductions       []Deduction
	NotesSet         bool
	Notes            *string
}

// Update edita a receita.
//
//   - scope=this (padrão): só este lançamento; o molde da repetição não muda. Descontos enviados SUBSTITUEM a lista.
//   - scope=following: o molde muda e este lançamento e os seguintes que ainda NÃO contam como recebidos recebem os campos
//     enviados. Recebidos nunca mudam em lote (inclusive este, se já estiver recebido). Sem repetição, equivale a this.
//     Competência, data digitada e quantidade são de cada mês: não valem em lote (400).
//
// O bruto por unidade é sempre recalculado (preço x quantidade). Tudo numa transação, com a linha travada.
func (s *Service) Update(ctx context.Context, householdID, id uuid.UUID, p Patch, scope Scope) (View, error) {
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		cur, err := lockFind(tx, householdID, id)
		if err != nil {
			return err
		}
		if scope == ScopeFollowing && cur.SourceID != nil {
			return s.updateFollowing(ctx, tx, cur, p)
		}
		return s.updateThis(ctx, tx, cur, p)
	})
	if err != nil {
		return View{}, err
	}
	return s.Get(ctx, householdID, id)
}

func (s *Service) updateFollowing(ctx context.Context, tx *gorm.DB, cur Income, p Patch) error {
	var v validation.Collector
	if p.CompetenceMonth != nil {
		v.Add("competenceMonth", "o mês só pode mudar em um lançamento por vez (escopo this)")
	}
	if p.ExpectedDate != nil {
		v.Add("expectedDate", "a data digitada só pode mudar em um lançamento por vez (escopo this); use a regra de data")
	}
	if p.Quantity != nil {
		v.Add("quantity", "a quantidade é de cada mês (escopo this)")
	}
	var src Source
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("household_id = ? AND id = ?", cur.HouseholdID, *cur.SourceID).First(&src).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s.updateThis(ctx, tx, cur, p) // fonte excluída: nada a propagar
	}
	if err != nil {
		return err
	}
	upd, err := s.patchMold(ctx, tx, &src, SourcePatch{
		UserID: p.UserID, Kind: p.Kind, Name: p.Description, AmountMode: p.AmountMode, GrossAmountCents: p.GrossAmountCents,
		UnitPriceCents: p.UnitPriceCents, UnitLabel: p.UnitLabel, Rule: p.Rule, NotesSet: p.NotesSet, Notes: p.Notes,
		DeductionsSet: p.DeductionsSet, Deductions: p.Deductions,
	}, &v)
	if err != nil {
		return err
	}
	if err := v.Err(); err != nil {
		return err
	}
	if err := upd.write(tx, src); err != nil {
		return err
	}
	var rows []Income
	if err := s.predicted(tx, src).Where("competence_month >= ?", cur.CompetenceMonth).Find(&rows).Error; err != nil {
		return err
	}
	return s.applyMoldRows(ctx, tx, src, upd.tmpl, rows, upd.touch)
}

func (s *Service) updateThis(ctx context.Context, tx *gorm.DB, cur Income, p Patch) error {
	var v validation.Collector
	h := s.holidays(ctx)
	cols := map[string]any{}

	if p.UserID != nil {
		if err := s.checkMember(ctx, cur.HouseholdID, *p.UserID, &v); err != nil {
			return err
		}
		cols["user_id"] = *p.UserID
	}
	if p.Kind != nil {
		cols["kind"], cols["wallet"] = *p.Kind, ResolveWallet(*p.Kind, nil, &v)
	}
	if p.Description != nil {
		cols["description"] = checkName("description", *p.Description, 120, &v)
	}
	if p.NotesSet {
		cols["notes"] = invoice.CheckNotes(p.Notes, &v)
	}

	// Competência: só muda em "este mês"; numa repetição, não pode colidir com outro mês da mesma repetição
	// (o índice único inclui as excluídas, então um mês apagado também está ocupado).
	competence := cur.CompetenceMonth
	if p.CompetenceMonth != nil {
		checkMonth("competenceMonth", *p.CompetenceMonth, &v)
		if !p.CompetenceMonth.IsZero() && p.CompetenceMonth.IsStartOfMonth() && !p.CompetenceMonth.Equal(competence) {
			competence = *p.CompetenceMonth
			cols["competence_month"] = competence
			if cur.SourceID != nil {
				var n int64
				err := tx.Unscoped().Model(&Income{}).
					Where("household_id = ? AND source_id = ? AND competence_month = ? AND id <> ?", cur.HouseholdID, *cur.SourceID, competence, cur.ID).
					Count(&n).Error
				if err != nil {
					return err
				}
				if n > 0 {
					v.Add("competenceMonth", "esta repetição já tem uma receita nesse mês")
				}
			}
		}
	}

	// Valor.
	gross := cur.GrossAmountCents
	amountTouched := p.AmountMode != nil || p.GrossAmountCents != nil || p.UnitPriceCents != nil || p.Quantity != nil || p.UnitLabel != nil
	if amountTouched {
		in := AmountInput{Mode: cur.Mode(), UnitPriceCents: p.UnitPriceCents, Quantity: p.Quantity, UnitLabel: p.UnitLabel}
		if p.AmountMode != nil {
			in.Mode = *p.AmountMode
		}
		switch in.Mode {
		case AmountPerUnit:
			if p.GrossAmountCents != nil {
				v.Add("grossAmountCents", "em receita por unidade o total é preço x quantidade; informe o preço e a quantidade")
			}
			if in.UnitPriceCents == nil {
				in.UnitPriceCents = cur.UnitPriceCents
			}
			if in.Quantity == nil {
				in.Quantity = cur.Quantity
			}
			if in.UnitLabel == nil {
				in.UnitLabel = cur.UnitLabel
			}
		default:
			in.GrossCents = p.GrossAmountCents
			if in.GrossCents == nil {
				g := cur.GrossAmountCents // trocar de "por unidade" para fixo sem informar o valor mantém o total atual
				in.GrossCents = &g
			}
		}
		a := in.Resolve(calendar.BusinessDaysInMonth(competence, h), &v)
		for k, val := range a.cols() {
			cols[k] = val
		}
		gross = a.GrossCents
	}

	// Regra e data esperada. Uma data digitada vence; senão, mudar a regra ou o mês recalcula pela regra.
	var rule *DateRule
	if p.Rule != nil {
		r := p.Rule.Check("dateRule", &v)
		rule = &r
		cols["date_rule"], cols["date_rule_n"], cols["weekend_adjust"] = r.Rule, r.nPtr(), string(r.Adjust)
	} else if cur.DateRule != nil {
		adj := ""
		if cur.WeekendAdjust != nil {
			adj = *cur.WeekendAdjust
		}
		r := ruleFromCols(*cur.DateRule, cur.DateRuleN, adj)
		rule = &r
	}
	switch {
	case p.ExpectedDate != nil:
		if p.ExpectedDate.IsZero() {
			v.Add("expectedDate", "informe a data esperada")
		}
		cols["expected_date"] = *p.ExpectedDate
	case rule != nil && (p.Rule != nil || !competence.Equal(cur.CompetenceMonth)):
		cols["expected_date"] = rule.ExpectedDate(competence, h)
	case !competence.Equal(cur.CompetenceMonth):
		cols["expected_date"] = competence.WithDayClamped(cur.ExpectedDate.Day())
	}

	// Descontos efetivos depois do patch: os enviados, ou os atuais (quando só o valor muda).
	var ds []Deduction
	switch {
	case p.DeductionsSet:
		ds = CheckDeductions(gross, p.Deductions, &v)
	case amountTouched:
		cd, err := s.deductionsOf(tx, cur.HouseholdID, cur.ID)
		if err != nil {
			return err
		}
		if SumDeductions(cd) > gross {
			v.Add("grossAmountCents", "o valor não pode ficar menor que a soma dos descontos")
		}
	}
	if err := v.Err(); err != nil {
		return err
	}
	if len(cols) > 0 {
		if err := tx.Model(&Income{}).Where("household_id = ? AND id = ?", cur.HouseholdID, cur.ID).Updates(cols).Error; err != nil {
			return err
		}
	}
	if p.DeductionsSet {
		return replaceDeductions(tx, cur.HouseholdID, cur.ID, ds)
	}
	return nil
}
