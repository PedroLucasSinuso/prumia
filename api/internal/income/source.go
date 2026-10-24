package income

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/PedroLucasSinuso/prumia/api/internal/calendar"
	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// maxStartAwayMonths limita quão longe (passado ou futuro) uma fonte pode começar (não gerar milhares de linhas por requisição).
const maxStartAwayMonths = 120

// rule devolve a regra de data da fonte.
func (src Source) rule() DateRule {
	return ruleFromCols(src.DateRule, src.DateRuleN, src.WeekendAdjust)
}

// dayMirror é o valor da coluna legada day_of_month (1 a 31): o dia da regra "dia N" e 1 nas demais (ela não é usada).
func dayMirror(r DateRule) int {
	if r.Rule == RuleDayOfMonth {
		return r.N
	}
	return 1
}

// sourceDeductions carrega o molde de várias fontes de uma vez (uma consulta, sem N+1).
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

// newOccurrence monta o lançamento PREVISTO de um mês a partir do molde. firstQty (opcional) vale só para o mês `from`.
func newOccurrence(src Source, o Occurrence, h calendar.HolidayFunc, qtyOverride *int) Income {
	sid := src.ID
	rs, adj := src.DateRule, src.WeekendAdjust
	row := Income{
		HouseholdID: src.HouseholdID, SourceID: &sid, UserID: src.UserID, Kind: src.Kind, Description: src.Name,
		Wallet: src.Wallet, CompetenceMonth: o.Month, ExpectedDate: o.ExpectedDate,
		GrossAmountCents: src.GrossAmountCents, Notes: src.Notes, CreatedBy: src.CreatedBy,
		DateRule: &rs, DateRuleN: src.DateRuleN, WeekendAdjust: &adj,
	}
	if src.AmountMode == AmountPerUnit && src.UnitPriceCents != nil {
		qty := calendar.BusinessDaysInMonth(o.Month, h) // quantidade sugerida: dias úteis do mês (a pessoa ajusta depois)
		if qtyOverride != nil {
			qty = *qtyOverride
		}
		price := *src.UnitPriceCents
		row.Quantity, row.UnitPriceCents, row.UnitLabel = &qty, &price, src.UnitLabel
		row.GrossAmountCents = money.Cents(int64(price) * int64(qty))
	}
	return row
}

// insertOccurrences grava os lançamentos PREVISTOS de from..through, já com valor, regra e descontos do molde.
//
// ON CONFLICT DO NOTHING é o que impede de ressuscitar: o índice único (source_id, competence_month) INCLUI linhas
// excluídas, então um mês que o usuário apagou continua "ocupado" e o insert o ignora em silêncio. Como o insert pode
// pular linhas, os descontos só são gravados para os lançamentos que de fato existem depois dele.
func insertOccurrences(tx *gorm.DB, src Source, tmpl []Deduction, from, through caldate.Date, h calendar.HolidayFunc, firstQty *int) error {
	occ := GenerateOccurrences(from, through, src.rule(), h)
	if len(occ) == 0 {
		return nil
	}
	rows := make([]Income, len(occ))
	ids := make([]uuid.UUID, len(occ))
	for i, o := range occ {
		var q *int
		if i == 0 {
			q = firstQty
		}
		rows[i] = newOccurrence(src, o, h, q)
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

// SourceInput descreve a repetição. Amount.Quantity (por unidade) vale só para o primeiro mês.
type SourceInput struct {
	UserID     uuid.UUID
	Kind       string
	Wallet     *string
	Name       string
	Amount     AmountInput
	Rule       DateRule
	DayOfMonth *int // atalho antigo ("dia N"), usado só quando Rule vem vazia
	StartMonth caldate.Date
	EndMonth   *caldate.Date
	Notes      *string
	Deductions []Deduction
}

// CreateSource grava a fonte e gera os lançamentos do início até o horizonte (12 meses), numa transação.
func (s *Service) CreateSource(ctx context.Context, householdID, createdBy uuid.UUID, in SourceInput) (SourceView, error) {
	return s.createSource(ctx, householdID, createdBy, in)
}

func (s *Service) createSource(ctx context.Context, householdID, createdBy uuid.UUID, in SourceInput) (SourceView, error) {
	var v validation.Collector
	h := s.holidays(ctx)
	in.Name = checkName("name", in.Name, 120, &v)
	wallet := ResolveWallet(in.Kind, in.Wallet, &v)
	if in.Rule.Rule == "" && in.DayOfMonth != nil {
		if *in.DayOfMonth < 1 || *in.DayOfMonth > 31 {
			v.Add("dayOfMonth", "informe um dia de 1 a 31")
		}
		in.Rule = DateRule{Rule: RuleDayOfMonth, N: *in.DayOfMonth}
	}
	rule := in.Rule.Check("dateRule", &v)
	startOK := !in.StartMonth.IsZero() && in.StartMonth.IsStartOfMonth()
	defQty := 1
	if startOK {
		defQty = calendar.BusinessDaysInMonth(in.StartMonth, h)
	}
	amount := in.Amount.Resolve(defQty, &v)
	if amount.Mode == AmountPerUnit && amount.UnitPriceCents != nil && int64(*amount.UnitPriceCents)*maxNthBusinessDay > int64(MaxAmount) {
		v.Add("unitPriceCents", "o preço por unidade é alto demais")
	}
	ds := CheckDeductions(amount.GrossCents, in.Deductions, &v)
	CheckSalaryTaxes(in.Kind, ds, &v)
	thisMonth := s.today().StartOfMonth()
	switch {
	case !startOK:
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

	// No molde por unidade, o bruto guarda o PREÇO (a coluna exige > 0); o bruto de cada mês é preço x quantidade.
	moldGross := amount.GrossCents
	if amount.Mode == AmountPerUnit {
		moldGross = *amount.UnitPriceCents
	}
	src := Source{
		HouseholdID: householdID, UserID: in.UserID, Kind: in.Kind, Name: in.Name, Wallet: wallet,
		GrossAmountCents: moldGross, AmountMode: amount.Mode, UnitLabel: amount.UnitLabel, UnitPriceCents: amount.UnitPriceCents,
		DateRule: rule.Rule, DateRuleN: rule.nPtr(), WeekendAdjust: string(rule.Adjust), DayOfMonth: dayMirror(rule),
		StartMonth: in.StartMonth, EndMonth: end, Notes: in.Notes, CreatedBy: createdBy,
	}
	src.GeneratedThrough = DefaultThrough(src.StartMonth, src.EndMonth, s.today())
	var firstQty *int
	if amount.Mode == AmountPerUnit {
		firstQty = amount.Quantity
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&src).Error; err != nil {
			return fmt.Errorf("criando fonte de receita: %w", err)
		}
		if err := replaceSourceDeductions(tx, householdID, src.ID, ds); err != nil {
			return err
		}
		return insertOccurrences(tx, src, ds, src.StartMonth, src.GeneratedThrough, h, firstQty)
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
			if err := insertOccurrences(tx, cur, tmpl[cur.ID], cur.GeneratedThrough.AddMonths(1), target, s.holidays(ctx), nil); err != nil {
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
	UserID *uuid.UUID
	Kind   *string
	Name   *string
	// Valor: qualquer um dos campos abaixo reavalia o valor do molde.
	AmountMode       *string
	GrossAmountCents *money.Cents
	UnitPriceCents   *money.Cents
	UnitLabel        *string
	// Regra de data: Rule inteira, ou só DayOfMonth (atalho antigo: mantém o ajuste e troca para "dia N").
	Rule          *DateRule
	DayOfMonth    *int
	EndMonthSet   bool
	EndMonth      *caldate.Date
	NotesSet      bool
	Notes         *string
	DeductionsSet bool
	Deductions    []Deduction
}

// moldTouch diz quais grupos de campos do molde mudaram (e devem ser copiados para os lançamentos afetados).
type moldTouch struct {
	Identity, Name, Notes, Amount, Rule, Deductions bool
}

func allTouched() moldTouch { return moldTouch{true, true, true, true, true, true} }

// UpdateSource edita o molde da repetição.
//
//   - Sem applyFrom: só o molde muda. Os lançamentos já gerados ficam como estão; valem os novos valores para os meses
//     que ainda vão ser gerados.
//   - Com applyFrom (dia 1): os lançamentos A RECEBER (não recebidos, não excluídos) desse mês em diante recebem o
//     molde inteiro, sobrescrevendo ajustes mês a mês. Os RECEBIDOS nunca mudam.
//   - endMonth só pode ANTECIPAR o fim; os lançamentos a receber depois dele são excluídos (logicamente). Recebidos ficam.
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
		var v validation.Collector
		if applyFrom != nil && (applyFrom.IsZero() || !applyFrom.IsStartOfMonth()) {
			v.Add("applyFrom", "informe o primeiro dia do mês (AAAA-MM-01)")
		}
		upd, err := s.patchMold(ctx, tx, &cur, p, &v)
		if err != nil {
			return err
		}
		if err := v.Err(); err != nil {
			return err
		}
		if err := upd.write(tx, cur); err != nil {
			return err
		}
		if !upd.newEnd.IsZero() {
			if err := s.predicted(tx, cur).Where("competence_month > ?", upd.newEnd).Delete(&Income{}).Error; err != nil {
				return err
			}
		}
		if applyFrom != nil {
			var rows []Income
			if err := s.predicted(tx, cur).Where("competence_month >= ?", *applyFrom).Find(&rows).Error; err != nil {
				return err
			}
			return s.applyMoldRows(ctx, tx, cur, upd.tmpl, rows, allTouched())
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

// predicted: lançamentos da fonte que ainda NÃO contam como recebidos (e não excluídos: o escopo do GORM já filtra).
// Recebidos (inclusive o recebimento automático de datas passadas) nunca são alterados em lote.
func (s *Service) predicted(tx *gorm.DB, src Source) *gorm.DB {
	return tx.Model(&Income{}).Where("household_id = ? AND source_id = ?", src.HouseholdID, src.ID).
		Where("NOT "+ReceivedSQL(""), s.today())
}

// moldUpdate é o resultado de validar um SourcePatch: o que gravar e o que mudou.
type moldUpdate struct {
	cols    map[string]any
	tmpl    []Deduction
	tmplSet bool
	newEnd  caldate.Date
	touch   moldTouch
}

func (m moldUpdate) write(tx *gorm.DB, cur Source) error {
	if len(m.cols) > 0 {
		if err := tx.Model(&Source{}).Where("household_id = ? AND id = ?", cur.HouseholdID, cur.ID).Updates(m.cols).Error; err != nil {
			return err
		}
	}
	if m.tmplSet {
		return replaceSourceDeductions(tx, cur.HouseholdID, cur.ID, m.tmpl)
	}
	return nil
}

// patchMold valida o patch e ATUALIZA `cur` em memória com os valores novos (o chamador grava com moldUpdate.write).
// Erros de validação vão para v.
func (s *Service) patchMold(ctx context.Context, tx *gorm.DB, cur *Source, p SourcePatch, v *validation.Collector) (moldUpdate, error) {
	out := moldUpdate{cols: map[string]any{}}
	tmplMap, err := sourceDeductions(tx, cur.HouseholdID, []uuid.UUID{cur.ID})
	if err != nil {
		return out, err
	}
	out.tmpl = tmplMap[cur.ID]
	if p.UserID != nil {
		if err := s.checkMember(ctx, cur.HouseholdID, *p.UserID, v); err != nil {
			return out, err
		}
		cur.UserID = *p.UserID
		out.cols["user_id"] = cur.UserID
		out.touch.Identity = true
	}
	if p.Kind != nil {
		cur.Kind = *p.Kind
		cur.Wallet = ResolveWallet(cur.Kind, nil, v)
		out.cols["kind"], out.cols["wallet"] = cur.Kind, cur.Wallet
		out.touch.Identity = true
	}
	if p.Name != nil {
		cur.Name = checkName("name", *p.Name, 120, v)
		out.cols["name"] = cur.Name
		out.touch.Name = true
	}
	if p.NotesSet {
		cur.Notes = invoice.CheckNotes(p.Notes, v)
		out.cols["notes"] = cur.Notes
		out.touch.Notes = true
	}
	if p.AmountMode != nil || p.GrossAmountCents != nil || p.UnitPriceCents != nil || p.UnitLabel != nil {
		in := AmountInput{Mode: cur.AmountMode, GrossCents: p.GrossAmountCents, UnitPriceCents: p.UnitPriceCents, UnitLabel: p.UnitLabel}
		if p.AmountMode != nil {
			in.Mode = *p.AmountMode
		}
		// O que não veio é herdado do molde atual (mudar só o preço mantém o rótulo, por exemplo).
		if in.Mode == AmountFixed && in.GrossCents == nil {
			g := cur.GrossAmountCents
			in.GrossCents = &g
		}
		if in.Mode == AmountPerUnit {
			if in.UnitPriceCents == nil {
				in.UnitPriceCents = cur.UnitPriceCents
			}
			if in.UnitLabel == nil {
				in.UnitLabel = cur.UnitLabel
			}
		}
		a := in.Resolve(1, v) // o molde guarda só o preço; a quantidade é de cada mês
		if a.Mode == AmountPerUnit && a.UnitPriceCents != nil && int64(*a.UnitPriceCents)*maxNthBusinessDay > int64(MaxAmount) {
			v.Add("unitPriceCents", "o preço por unidade é alto demais")
		}
		cur.AmountMode, cur.GrossAmountCents, cur.UnitPriceCents, cur.UnitLabel = a.Mode, a.GrossCents, a.UnitPriceCents, a.UnitLabel
		out.cols["amount_mode"], out.cols["gross_amount_cents"] = cur.AmountMode, cur.GrossAmountCents
		out.cols["unit_price_cents"], out.cols["unit_label"] = cur.UnitPriceCents, cur.UnitLabel
		out.touch.Amount = true
	}
	var newRule *DateRule
	switch {
	case p.Rule != nil:
		r := p.Rule.Check("dateRule", v)
		newRule = &r
	case p.DayOfMonth != nil:
		if *p.DayOfMonth < 1 || *p.DayOfMonth > 31 {
			v.Add("dayOfMonth", "informe um dia de 1 a 31")
		} else {
			r := DateRule{Rule: RuleDayOfMonth, N: *p.DayOfMonth, Adjust: calendar.Adjust(cur.WeekendAdjust)}
			newRule = &r
		}
	}
	if newRule != nil {
		cur.DateRule, cur.DateRuleN, cur.WeekendAdjust, cur.DayOfMonth = newRule.Rule, newRule.nPtr(), string(newRule.Adjust), dayMirror(*newRule)
		out.cols["date_rule"], out.cols["date_rule_n"], out.cols["weekend_adjust"], out.cols["day_of_month"] =
			cur.DateRule, cur.DateRuleN, cur.WeekendAdjust, cur.DayOfMonth
		out.touch.Rule = true
	}
	// Soma dos descontos contra o bruto do molde (por unidade: preço x dias úteis do mês corrente, a quantidade típica).
	moldGross := cur.GrossAmountCents
	if cur.AmountMode == AmountPerUnit && cur.UnitPriceCents != nil {
		moldGross = money.Cents(int64(*cur.UnitPriceCents) * int64(calendar.BusinessDaysInMonth(s.today(), s.holidays(ctx))))
	}
	if p.DeductionsSet {
		out.tmpl = CheckDeductions(moldGross, p.Deductions, v)
		CheckSalaryTaxes(cur.Kind, out.tmpl, v)
		out.tmplSet, out.touch.Deductions = true, true
	} else if out.touch.Amount && SumDeductions(out.tmpl) > moldGross {
		v.Add("grossAmountCents", "o valor não pode ficar menor que a soma dos descontos")
	}
	if p.EndMonthSet {
		switch {
		case p.EndMonth == nil && !cur.EndMonth.IsZero():
			v.Add("endMonth", "não é possível reabrir uma fonte encerrada; crie uma nova")
		case p.EndMonth != nil:
			end := *p.EndMonth
			switch {
			case !end.IsStartOfMonth():
				v.Add("endMonth", "informe o primeiro dia do mês (AAAA-MM-01)")
			case end.Before(cur.StartMonth):
				v.Add("endMonth", "o fim não pode ser anterior ao início")
			case !cur.EndMonth.IsZero() && end.After(cur.EndMonth):
				v.Add("endMonth", "só é possível antecipar o encerramento, não adiá-lo")
			default:
				out.newEnd = end
				out.cols["end_month"] = end
			}
		}
	}
	return out, nil
}

// applyMoldRows copia os grupos de campos alterados (touch) do molde para os lançamentos de `rows`, um a um, e troca os
// descontos se for o caso. São no máximo ~60 linhas (o horizonte), então um UPDATE por linha é simples e suficiente.
func (s *Service) applyMoldRows(ctx context.Context, tx *gorm.DB, src Source, tmpl []Deduction, rows []Income, touch moldTouch) error {
	if len(rows) == 0 {
		return nil
	}
	h := s.holidays(ctx)
	rule := src.rule()
	ids := make([]uuid.UUID, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
		upd := map[string]any{}
		if touch.Identity {
			upd["user_id"], upd["kind"], upd["wallet"] = src.UserID, src.Kind, src.Wallet
		}
		if touch.Name {
			upd["description"] = src.Name
		}
		if touch.Notes {
			upd["notes"] = src.Notes
		}
		if touch.Amount {
			a := Amount{Mode: AmountFixed, GrossCents: src.GrossAmountCents}
			if src.AmountMode == AmountPerUnit && src.UnitPriceCents != nil {
				// A quantidade é do mês: mantém a que o lançamento já tinha (ajustada pela pessoa) ou sugere os dias úteis.
				qty := calendar.BusinessDaysInMonth(r.CompetenceMonth, h)
				if r.Quantity != nil {
					qty = *r.Quantity
				}
				price := *src.UnitPriceCents
				a = Amount{Mode: AmountPerUnit, GrossCents: money.Cents(int64(price) * int64(qty)), UnitPriceCents: &price, Quantity: &qty, UnitLabel: src.UnitLabel}
			}
			for k, val := range a.cols() {
				upd[k] = val
			}
		}
		if touch.Rule {
			rs, adj := rule.Rule, string(rule.Adjust)
			upd["date_rule"], upd["date_rule_n"], upd["weekend_adjust"] = rs, rule.nPtr(), adj
			upd["expected_date"] = rule.ExpectedDate(r.CompetenceMonth, h)
		}
		if len(upd) == 0 {
			continue
		}
		if err := tx.Model(&Income{}).Where("household_id = ? AND id = ?", src.HouseholdID, r.ID).Updates(upd).Error; err != nil {
			return err
		}
	}
	if touch.Deductions {
		if err := tx.Where("household_id = ? AND income_id IN ?", src.HouseholdID, ids).Delete(&incomeDeductionRow{}).Error; err != nil {
			return err
		}
		return insertDeductions(tx, src.HouseholdID, ids, tmpl)
	}
	return nil
}
