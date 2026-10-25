package income

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/PedroLucasSinuso/prumia/api/internal/calendar"
	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
	"github.com/PedroLucasSinuso/prumia/api/internal/wallet"
)

var (
	ErrNotFound        = errors.New("receita não encontrada")
	ErrAlreadyReceived = errors.New("esta receita já foi recebida")
	ErrNotReceived     = errors.New("esta receita não está recebida")
	ErrNotDeleted      = errors.New("a receita não está excluída")
	// ErrSeriesChanged: o Desfazer em lote não se aplica porque a repetição mudou depois da exclusão.
	ErrSeriesChanged = errors.New("a repetição mudou depois desta exclusão; restaure uma a uma")
)

// Scope define o alcance de editar, excluir e restaurar numa receita que se repete: só este mês, ou este e os seguintes.
type Scope string

const (
	ScopeThis      Scope = "this"
	ScopeFollowing Scope = "following"
)

// Service cuida dos lançamentos mensais (incomes) e das fontes (income_sources). O "hoje" é injetável nos testes.
// Toda consulta filtra por household_id, que vem da rota autorizada, nunca do corpo da requisição.
type Service struct {
	db    *gorm.DB
	today func() caldate.Date
	cal   *calendar.Calendar
}

// NewService começa com o calendário OFFLINE (feriados calculados, sem rede): é o que os testes querem.
// Em produção, ligue a BrasilAPI com WithCalendar.
func NewService(db *gorm.DB, today func() caldate.Date) *Service {
	return &Service{db: db, today: today, cal: calendar.New("off")}
}

// WithCalendar troca o calendário (por exemplo, o que consulta a BrasilAPI). Devolve o próprio serviço para encadear.
func (s *Service) WithCalendar(c *calendar.Calendar) *Service {
	if c != nil {
		s.cal = c
	}
	return s
}

// holidays entrega a função de feriados ligada ao contexto da requisição.
func (s *Service) holidays(ctx context.Context) calendar.HolidayFunc { return s.cal.Func(ctx) }

// ---------------------------------------------------------------- helpers

// checkMember confere que o usuário é membro ATIVO da casa (quem saiu não recebe receita nova).
func (s *Service) checkMember(ctx context.Context, householdID, userID uuid.UUID, v *validation.Collector) error {
	var n int64
	err := s.db.WithContext(ctx).Table("household_members").
		Where("household_id = ? AND user_id = ? AND left_at IS NULL", householdID, userID).Count(&n).Error
	if err != nil {
		return err
	}
	if n == 0 {
		v.Add("userId", "o responsável deve ser membro da casa")
	}
	return nil
}

func checkName(field, s string, maxLen int, v *validation.Collector) string {
	s = strings.TrimSpace(s)
	if n := len([]rune(s)); n < 1 || n > maxLen {
		v.Add(field, fmt.Sprintf("informe de 1 a %d caracteres", maxLen))
	}
	return s
}

func checkMonth(field string, m caldate.Date, v *validation.Collector) {
	if m.IsZero() || !m.IsStartOfMonth() {
		v.Add(field, "informe o primeiro dia do mês (AAAA-MM-01)")
	}
}

// views anexa os descontos, calcula o líquido, o estado derivado (recebida) e se a repetição continua.
// Duas consultas para a lista inteira (descontos e fontes), sem N+1.
func (s *Service) views(ctx context.Context, householdID uuid.UUID, rows []Income) ([]View, error) {
	out := make([]View, len(rows))
	if len(rows) == 0 {
		return out, nil
	}
	ids := make([]uuid.UUID, len(rows))
	srcIDs := map[uuid.UUID]bool{}
	for i, r := range rows {
		ids[i] = r.ID
		if r.SourceID != nil {
			srcIDs[*r.SourceID] = true
		}
	}
	var ds []incomeDeductionRow
	err := s.db.WithContext(ctx).Where("household_id = ? AND income_id IN ?", householdID, ids).
		Order("position, id").Find(&ds).Error
	if err != nil {
		return nil, fmt.Errorf("lendo descontos: %w", err)
	}
	byIncome := map[uuid.UUID][]Deduction{}
	for _, d := range ds {
		byIncome[d.IncomeID] = append(byIncome[d.IncomeID], Deduction{Kind: d.Kind, Name: d.Name, AmountCents: d.AmountCents})
	}
	// Fontes vivas: dizem se a repetição continua (um mapa de id para o fim; zero = sem fim).
	alive := map[uuid.UUID]caldate.Date{}
	if len(srcIDs) > 0 {
		list := make([]uuid.UUID, 0, len(srcIDs))
		for id := range srcIDs {
			list = append(list, id)
		}
		var srcs []Source
		if err := s.db.WithContext(ctx).Select("id", "end_month").Where("household_id = ? AND id IN ?", householdID, list).Find(&srcs).Error; err != nil {
			return nil, fmt.Errorf("lendo fontes: %w", err)
		}
		for _, src := range srcs {
			alive[src.ID] = src.EndMonth
		}
	}
	today := s.today()
	for i, r := range rows {
		d := byIncome[r.ID]
		if d == nil {
			d = []Deduction{}
		}
		v := View{Income: r, Deductions: d, Net: Net(r.GrossAmountCents, d), Received: r.IsReceived(today)}
		if r.SourceID != nil {
			if end, ok := alive[*r.SourceID]; ok && (end.IsZero() || r.CompetenceMonth.Before(end)) {
				v.Repeats, v.Until = true, end
			} else if ok {
				v.Until = end
			}
		}
		out[i] = v
	}
	return out, nil
}

func (s *Service) find(ctx context.Context, householdID, id uuid.UUID) (Income, error) {
	var in Income
	err := s.db.WithContext(ctx).Where("household_id = ? AND id = ?", householdID, id).First(&in).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Income{}, ErrNotFound
	}
	return in, err
}

// lockFind lê o lançamento TRAVADO (FOR UPDATE) dentro de uma transação: edições simultâneas não se atropelam.
func lockFind(tx *gorm.DB, householdID, id uuid.UUID) (Income, error) {
	var cur Income
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("household_id = ? AND id = ?", householdID, id).First(&cur).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Income{}, ErrNotFound
	}
	return cur, err
}

// Get devolve um lançamento da casa.
func (s *Service) Get(ctx context.Context, householdID, id uuid.UUID) (View, error) {
	in, err := s.find(ctx, householdID, id)
	if err != nil {
		return View{}, err
	}
	vs, err := s.views(ctx, householdID, []Income{in})
	if err != nil {
		return View{}, err
	}
	return vs[0], nil
}

// replaceDeductions troca a lista de descontos do lançamento (apaga e regrava, dentro da transação do chamador).
func replaceDeductions(tx *gorm.DB, householdID, incomeID uuid.UUID, ds []Deduction) error {
	if err := tx.Where("household_id = ? AND income_id = ?", householdID, incomeID).Delete(&incomeDeductionRow{}).Error; err != nil {
		return err
	}
	return insertDeductions(tx, householdID, []uuid.UUID{incomeID}, ds)
}

// insertDeductions grava os mesmos descontos para cada lançamento de ids.
func insertDeductions(tx *gorm.DB, householdID uuid.UUID, ids []uuid.UUID, ds []Deduction) error {
	if len(ds) == 0 || len(ids) == 0 {
		return nil
	}
	rows := make([]incomeDeductionRow, 0, len(ids)*len(ds))
	for _, id := range ids {
		for pos, d := range ds {
			rows = append(rows, incomeDeductionRow{HouseholdID: householdID, IncomeID: id, Kind: d.Kind, Name: d.Name, AmountCents: d.AmountCents, Position: pos})
		}
	}
	return tx.CreateInBatches(&rows, 200).Error
}

func (s *Service) deductionsOf(tx *gorm.DB, householdID, incomeID uuid.UUID) ([]Deduction, error) {
	var rows []incomeDeductionRow
	err := tx.Where("household_id = ? AND income_id = ?", householdID, incomeID).Order("position, id").Find(&rows).Error
	out := make([]Deduction, len(rows))
	for i, r := range rows {
		out[i] = Deduction{Kind: r.Kind, Name: r.Name, AmountCents: r.AmountCents}
	}
	return out, err
}

// ---------------------------------------------------------------- listar

// List devolve os lançamentos (recebidos e a receber) da competência `month`, só da casa, ordenados pela data esperada.
// Não gera a previsão: quem chama (handler) garante o horizonte antes, via EnsureHorizon.
func (s *Service) List(ctx context.Context, householdID uuid.UUID, month caldate.Date) ([]View, error) {
	var v validation.Collector
	checkMonth("month", month, &v)
	if err := v.Err(); err != nil {
		return nil, err
	}
	var rows []Income
	err := s.db.WithContext(ctx).Where("household_id = ? AND competence_month = ?", householdID, month).
		Order("expected_date, id").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return s.views(ctx, householdID, rows)
}

// ---------------------------------------------------------------- criar

type CreateInput struct {
	UserID          uuid.UUID
	Kind            string
	WalletID        *uuid.UUID // opcional; padrão = carteira padrão da casa (benefício: a "Benefício" ativa, se existir)
	Description     string
	CompetenceMonth caldate.Date
	// ExpectedDate é uma data digitada. Sem Rule ela é obrigatória. Com Rule, ela só vale se enviada (a regra continua
	// valendo para os meses seguintes, no caso de Repeats).
	ExpectedDate *caldate.Date
	Amount       AmountInput
	Rule         *DateRule
	// Repeats cria a repetição (fonte) a partir de CompetenceMonth; RepeatUntil é o último mês (opcional). Exige Rule.
	Repeats     bool
	RepeatUntil *caldate.Date
	Deductions  []Deduction
	Notes       *string
}

// Create lança uma receita. Sem Repeats, é um lançamento avulso; com Repeats, cria a repetição (a "fonte") e devolve o
// lançamento do mês pedido. Para quem usa a tela é uma lista só: a diferença entre fonte e lançamento não aparece.
func (s *Service) Create(ctx context.Context, householdID, createdBy uuid.UUID, in CreateInput) (View, error) {
	if in.Repeats {
		return s.createRepeating(ctx, householdID, createdBy, in)
	}
	var v validation.Collector
	in.Description = checkName("description", in.Description, 120, &v)
	CheckKind(in.Kind, &v)
	walletID, err := s.resolveWallet(s.db.WithContext(ctx), householdID, in.Kind, in.WalletID, &v)
	if err != nil {
		return View{}, err
	}
	checkMonth("competenceMonth", in.CompetenceMonth, &v)
	amount := in.Amount.Resolve(calendar.BusinessDaysInMonth(in.CompetenceMonth, s.holidays(ctx)), &v)
	var rule *DateRule
	if in.Rule != nil {
		r := in.Rule.Check("dateRule", &v)
		rule = &r
	}
	expected := s.expectedFor(ctx, in.ExpectedDate, rule, in.CompetenceMonth, &v)
	ds := CheckDeductions(amount.GrossCents, in.Deductions, &v)
	CheckSalaryTaxes(in.Kind, ds, &v)
	in.Notes = invoice.CheckNotes(in.Notes, &v)
	if err := s.checkMember(ctx, householdID, in.UserID, &v); err != nil {
		return View{}, err
	}
	if err := v.Err(); err != nil {
		return View{}, err
	}
	row := Income{
		HouseholdID: householdID, UserID: in.UserID, Kind: in.Kind, Description: in.Description, WalletID: walletID,
		CompetenceMonth: in.CompetenceMonth, ExpectedDate: expected, GrossAmountCents: amount.GrossCents,
		Quantity: amount.Quantity, UnitPriceCents: amount.UnitPriceCents, UnitLabel: amount.UnitLabel,
		Notes: in.Notes, CreatedBy: createdBy,
	}
	if rule != nil {
		rs, adj := rule.Rule, string(rule.Adjust)
		row.DateRule, row.DateRuleN, row.WeekendAdjust, row.DateRuleOffset = &rs, rule.nPtr(), &adj, rule.Offset
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return fmt.Errorf("criando receita: %w", err)
		}
		return insertDeductions(tx, householdID, []uuid.UUID{row.ID}, ds)
	})
	if err != nil {
		return View{}, err
	}
	return s.Get(ctx, householdID, row.ID)
}

// resolveWallet decide a carteira de uma receita: a informada (tem de ser ativa e da casa) ou, sem ela, a sugerida pelo
// tipo (benefício: a carteira "Benefício" ativa, se existir; senão a padrão da casa). Qualquer tipo pode ir para qualquer
// carteira, então não há mais coerência tipo <-> carteira. Erro de validação vai para o campo `walletId`.
func (s *Service) resolveWallet(db *gorm.DB, householdID uuid.UUID, kind string, requested *uuid.UUID, v *validation.Collector) (uuid.UUID, error) {
	if requested != nil {
		return *requested, wallet.CheckSpendable(db, householdID, *requested, "walletId", v)
	}
	if kind == KindBenefit {
		return wallet.BenefitOrDefaultID(db, householdID)
	}
	return wallet.DefaultID(db, householdID)
}

// expectedFor decide a data esperada: a digitada, ou a calculada pela regra no mês de competência.
func (s *Service) expectedFor(ctx context.Context, typed *caldate.Date, rule *DateRule, month caldate.Date, v *validation.Collector) caldate.Date {
	switch {
	case typed != nil && !typed.IsZero():
		return *typed
	case typed != nil:
		v.Add("expectedDate", "data inválida")
	case rule != nil && !month.IsZero() && month.IsStartOfMonth():
		return rule.ExpectedDate(month, s.holidays(ctx))
	case rule == nil:
		v.Add("expectedDate", "informe a data esperada ou uma regra de data")
	}
	return caldate.Date{}
}

func (s *Service) createRepeating(ctx context.Context, householdID, createdBy uuid.UUID, in CreateInput) (View, error) {
	var v validation.Collector
	if in.Rule == nil {
		v.Add("dateRule", "informe quando a receita cai para ela se repetir")
	}
	if err := v.Err(); err != nil {
		return View{}, err
	}
	src, err := s.createSource(ctx, householdID, createdBy, SourceInput{
		UserID: in.UserID, Kind: in.Kind, WalletID: in.WalletID, Name: in.Description, Amount: in.Amount, Rule: *in.Rule,
		StartMonth: in.CompetenceMonth, EndMonth: in.RepeatUntil, Notes: in.Notes, Deductions: in.Deductions,
	})
	if err != nil {
		return View{}, err
	}
	var first Income
	err = s.db.WithContext(ctx).Where("household_id = ? AND source_id = ? AND competence_month = ?", householdID, src.ID, in.CompetenceMonth).
		First(&first).Error
	if err != nil {
		return View{}, fmt.Errorf("lendo o primeiro mês da repetição: %w", err)
	}
	// Uma data digitada vale só para o primeiro mês (os seguintes seguem a regra).
	if in.ExpectedDate != nil && !in.ExpectedDate.IsZero() {
		if err := s.db.WithContext(ctx).Model(&Income{}).Where("household_id = ? AND id = ?", householdID, first.ID).
			Update("expected_date", *in.ExpectedDate).Error; err != nil {
			return View{}, err
		}
	}
	return s.Get(ctx, householdID, first.ID)
}

// ---------------------------------------------------------------- receber / não caiu

// Receive diz "caiu": desfaz o "não caiu" e, se a data esperada ainda não chegou, marca como recebida de propósito
// (hoje, ou a data informada). O UPDATE roda com a linha travada: dois cliques simultâneos não se atropelam e o segundo
// recebe ErrAlreadyReceived. Receber o que já conta como recebida (inclusive automaticamente) também é ErrAlreadyReceived.
func (s *Service) Receive(ctx context.Context, householdID, id uuid.UUID, at *caldate.Date) (View, error) {
	if at != nil && at.IsZero() {
		return View{}, validation.New("receivedAt", "data de recebimento inválida")
	}
	today := s.today()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		cur, err := lockFind(tx, householdID, id)
		if err != nil {
			return err
		}
		if cur.IsReceived(today) {
			return ErrAlreadyReceived
		}
		upd := map[string]any{"held_at": nil}
		switch {
		case at != nil:
			upd["received_at"] = *at
		case cur.ExpectedDate.After(today):
			upd["received_at"] = today // recebida antes da data esperada: a pessoa disse que caiu
		}
		return tx.Model(&Income{}).Where("household_id = ? AND id = ?", householdID, id).Updates(upd).Error
	})
	if err != nil {
		return View{}, err
	}
	return s.Get(ctx, householdID, id)
}

// Unreceive diz "não caiu": a receita deixa de contar como recebida (volta a "a receber", ou "atrasada" se a data já
// passou) e não conta no saldo até alguém dizer "caiu". Se já não contava como recebida, ErrNotReceived.
func (s *Service) Unreceive(ctx context.Context, householdID, id uuid.UUID) (View, error) {
	today := s.today()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		cur, err := lockFind(tx, householdID, id)
		if err != nil {
			return err
		}
		if !cur.IsReceived(today) {
			return ErrNotReceived
		}
		return tx.Model(&Income{}).Where("household_id = ? AND id = ?", householdID, id).
			Updates(map[string]any{"held_at": time.Now().UTC().Truncate(time.Microsecond), "received_at": nil}).Error
	})
	if err != nil {
		return View{}, err
	}
	return s.Get(ctx, householdID, id)
}

// ---------------------------------------------------------------- prévia da regra de data

// PreviewItem é um mês da prévia: a data em que a regra cai e quantos dias úteis o mês tem (a quantidade sugerida
// para receitas por unidade).
type PreviewItem struct {
	Month        caldate.Date
	ExpectedDate caldate.Date
	BusinessDays int
}

// Preview calcula, sem gravar nada, as datas das próximas `count` competências a partir de `from`.
func (s *Service) Preview(ctx context.Context, rule DateRule, from caldate.Date, count int) ([]PreviewItem, error) {
	var v validation.Collector
	rule = rule.Check("dateRule", &v)
	if from.IsZero() {
		v.Add("month", "informe um mês")
	}
	if count < 1 || count > 24 {
		v.Add("count", "use de 1 a 24")
	}
	if err := v.Err(); err != nil {
		return nil, err
	}
	h := s.holidays(ctx)
	out := make([]PreviewItem, 0, count)
	for m, i := from.StartOfMonth(), 0; i < count; m, i = m.AddMonths(1), i+1 {
		out = append(out, PreviewItem{Month: m, ExpectedDate: rule.ExpectedDate(m, h), BusinessDays: calendar.BusinessDaysInMonth(m, h)}) // dias úteis da COMPETÊNCIA, não do mês em que cai
	}
	return out, nil
}
