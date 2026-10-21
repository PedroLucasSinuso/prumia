package income

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

var (
	ErrNotFound        = errors.New("receita não encontrada")
	ErrAlreadyReceived = errors.New("esta receita já foi recebida")
	ErrNotReceived     = errors.New("esta receita não está recebida")
)

// Service cuida dos lançamentos mensais (incomes) e das fontes (income_sources). O "hoje" é injetável nos testes.
// Toda consulta filtra por household_id, que vem da rota autorizada, nunca do corpo da requisição.
type Service struct {
	db    *gorm.DB
	today func() caldate.Date
}

func NewService(db *gorm.DB, today func() caldate.Date) *Service {
	return &Service{db: db, today: today}
}

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

// views anexa os descontos e calcula o líquido. Uma consulta só de descontos para a lista inteira (sem N+1).
func (s *Service) views(ctx context.Context, householdID uuid.UUID, rows []Income) ([]View, error) {
	out := make([]View, len(rows))
	if len(rows) == 0 {
		return out, nil
	}
	ids := make([]uuid.UUID, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
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
	for i, r := range rows {
		d := byIncome[r.ID]
		if d == nil {
			d = []Deduction{}
		}
		out[i] = View{Income: r, Deductions: d, Net: Net(r.GrossAmountCents, d)}
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

// ---------------------------------------------------------------- listar

// List devolve os lançamentos (previstos e recebidos) da competência `month`, só da casa, ordenados pela data esperada.
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

// ---------------------------------------------------------------- criar (avulsa)

type CreateInput struct {
	UserID           uuid.UUID
	Kind             string
	Wallet           *string // opcional; derivada do tipo (se informada, tem de ser coerente)
	Description      string
	CompetenceMonth  caldate.Date
	ExpectedDate     caldate.Date
	GrossAmountCents money.Cents
	Deductions       []Deduction
	Notes            *string
}

// Create lança uma receita AVULSA (sem fonte).
func (s *Service) Create(ctx context.Context, householdID, createdBy uuid.UUID, in CreateInput) (View, error) {
	var v validation.Collector
	in.Description = checkName("description", in.Description, 120, &v)
	wallet := ResolveWallet(in.Kind, in.Wallet, &v)
	checkMonth("competenceMonth", in.CompetenceMonth, &v)
	if in.ExpectedDate.IsZero() {
		v.Add("expectedDate", "informe a data esperada")
	}
	CheckGross(in.GrossAmountCents, &v)
	ds := CheckDeductions(in.GrossAmountCents, in.Deductions, &v)
	in.Notes = invoice.CheckNotes(in.Notes, &v)
	if err := s.checkMember(ctx, householdID, in.UserID, &v); err != nil {
		return View{}, err
	}
	if err := v.Err(); err != nil {
		return View{}, err
	}
	row := Income{
		HouseholdID: householdID, UserID: in.UserID, Kind: in.Kind, Description: in.Description, Wallet: wallet,
		CompetenceMonth: in.CompetenceMonth, ExpectedDate: in.ExpectedDate, GrossAmountCents: in.GrossAmountCents,
		Notes: in.Notes, CreatedBy: createdBy,
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
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

// ---------------------------------------------------------------- editar / excluir / receber

// Patch: nil = não mexer. DeductionsSet distingue "não enviado" de "lista vazia" (que remove todos os descontos).
type Patch struct {
	Description      *string
	ExpectedDate     *caldate.Date
	GrossAmountCents *money.Cents
	DeductionsSet    bool
	Deductions       []Deduction
	NotesSet         bool
	Notes            *string
}

// Update ajusta o lançamento do mês. NÃO altera a fonte (a coparticipação deste mês é só deste mês). Descontos enviados
// SUBSTITUEM a lista inteira. A soma dos descontos é revalidada contra o bruto resultante (novo ou atual).
func (s *Service) Update(ctx context.Context, householdID, id uuid.UUID, p Patch) (View, error) {
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var cur Income
		// Trava a linha: edições simultâneas do mesmo lançamento não se atropelam.
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("household_id = ? AND id = ?", householdID, id).First(&cur).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		var v validation.Collector
		upd := map[string]any{}
		if p.Description != nil {
			upd["description"] = checkName("description", *p.Description, 120, &v)
		}
		if p.ExpectedDate != nil {
			if p.ExpectedDate.IsZero() {
				v.Add("expectedDate", "informe a data esperada")
			}
			upd["expected_date"] = *p.ExpectedDate
		}
		gross := cur.GrossAmountCents
		if p.GrossAmountCents != nil {
			gross = *p.GrossAmountCents
			CheckGross(gross, &v)
			upd["gross_amount_cents"] = gross
		}
		if p.NotesSet {
			upd["notes"] = invoice.CheckNotes(p.Notes, &v)
		}
		// Descontos efetivos depois do patch: os enviados, ou os atuais (quando só o bruto muda).
		var ds []Deduction
		switch {
		case p.DeductionsSet:
			ds = CheckDeductions(gross, p.Deductions, &v)
		case p.GrossAmountCents != nil:
			ds, err = s.deductionsOf(tx, householdID, id)
			if err != nil {
				return err
			}
			if SumDeductions(ds) > gross {
				v.Add("grossAmountCents", "o bruto não pode ficar menor que a soma dos descontos")
			}
		}
		if err := v.Err(); err != nil {
			return err
		}
		if len(upd) > 0 {
			if err := tx.Model(&Income{}).Where("household_id = ? AND id = ?", householdID, id).Updates(upd).Error; err != nil {
				return err
			}
		}
		if p.DeductionsSet {
			return replaceDeductions(tx, householdID, id, ds)
		}
		return nil
	})
	if err != nil {
		return View{}, err
	}
	return s.Get(ctx, householdID, id)
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

// Delete faz a exclusão lógica. O índice único (source_id, competence_month) inclui excluídas, então o gerador de
// previsão nunca recria um mês que o usuário apagou.
func (s *Service) Delete(ctx context.Context, householdID, id uuid.UUID) error {
	res := s.db.WithContext(ctx).Where("household_id = ? AND id = ?", householdID, id).Delete(&Income{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// Receive marca como recebida. O UPDATE é condicional (`received_at IS NULL`): dois cliques simultâneos não recebem duas
// vezes, e o segundo recebe ErrAlreadyReceived.
func (s *Service) Receive(ctx context.Context, householdID, id uuid.UUID, at *caldate.Date) (View, error) {
	receivedAt := s.today()
	if at != nil {
		if at.IsZero() {
			return View{}, validation.New("receivedAt", "data de recebimento inválida")
		}
		receivedAt = *at
	}
	res := s.db.WithContext(ctx).Model(&Income{}).
		Where("household_id = ? AND id = ? AND received_at IS NULL", householdID, id).Update("received_at", receivedAt)
	if res.Error != nil {
		return View{}, res.Error
	}
	if res.RowsAffected == 0 {
		if _, err := s.find(ctx, householdID, id); err != nil {
			return View{}, err
		}
		return View{}, ErrAlreadyReceived
	}
	return s.Get(ctx, householdID, id)
}

// Unreceive desfaz o recebimento (volta a previsto).
func (s *Service) Unreceive(ctx context.Context, householdID, id uuid.UUID) (View, error) {
	res := s.db.WithContext(ctx).Model(&Income{}).
		Where("household_id = ? AND id = ? AND received_at IS NOT NULL", householdID, id).Update("received_at", nil)
	if res.Error != nil {
		return View{}, res.Error
	}
	if res.RowsAffected == 0 {
		if _, err := s.find(ctx, householdID, id); err != nil {
			return View{}, err
		}
		return View{}, ErrNotReceived
	}
	return s.Get(ctx, householdID, id)
}
