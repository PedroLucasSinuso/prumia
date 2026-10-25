package adjustment

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
	"github.com/PedroLucasSinuso/prumia/api/internal/summary"
	"github.com/PedroLucasSinuso/prumia/api/internal/wallet"
)

var (
	ErrNotFound   = errors.New("ajuste não encontrado")
	ErrNotDeleted = errors.New("o ajuste não está excluído")
)

// Service: toda consulta filtra por household_id. A permissão de escrita (viewer nunca escreve) é do porteiro das rotas
// (auth.Middleware, 403 read_only), igual às transferências; admin e member escrevem.
// O saldo calculado vem do summary.Service: é a MESMA conta do resumo e do aviso de saldo (uma só implementação).
type Service struct {
	db       *gorm.DB
	balances *summary.Service
	today    func() caldate.Date // "hoje" no fuso da aplicação; injetável nos testes
}

func NewService(db *gorm.DB, balances *summary.Service, today func() caldate.Date) *Service {
	return &Service{db: db, balances: balances, today: today}
}

type CreateInput struct {
	WalletID uuid.UUID
	// CompetenceMonth: o mês conferido (dia 1). Zero = mês atual.
	CompetenceMonth caldate.Date
	// ActualBalance: quanto há de verdade na carteira no fim do mês (pode ser negativo: cheque especial).
	ActualBalance money.Cents
	Notes         *string
}

// Create confere o saldo: calcula o saldo REALIZADO da carteira até o fim do mês (anterior + recebido - pago ±
// transferências + ajustes já feitos) e grava a diferença para o saldo informado. Regras:
//   - carteira ATIVA da casa (arquivada não recebe ajuste);
//   - mês até o atual (o saldo de um mês que ainda não chegou não tem o que conferir);
//   - mês a partir do mês de início da carteira, se houver (antes dele a carteira "ainda não começou");
//   - diferença zero não grava nada (400: o saldo já confere).
func (s *Service) Create(ctx context.Context, householdID, actor uuid.UUID, in CreateInput) (Adjustment, error) {
	db := s.db.WithContext(ctx)
	var v validation.Collector
	if in.ActualBalance > invoice.MaxAmount || in.ActualBalance < -invoice.MaxAmount {
		v.Add("actualBalanceCents", "valor fora do limite")
	}
	in.Notes = invoice.CheckNotes(in.Notes, &v)
	if in.CompetenceMonth.IsZero() {
		in.CompetenceMonth = s.today().StartOfMonth()
	} else {
		invoice.CheckCompetence(in.CompetenceMonth, &v)
		if in.CompetenceMonth.After(s.today().StartOfMonth()) {
			v.Add("competenceMonth", "só dá para conferir o saldo até o mês atual")
		}
	}
	if err := wallet.CheckUsable(db, householdID, in.WalletID, "walletId", &v); err != nil {
		return Adjustment{}, err
	}
	if err := v.Err(); err != nil {
		return Adjustment{}, err
	}

	b, w, err := s.balances.WalletMonth(ctx, householdID, in.WalletID, in.CompetenceMonth)
	if err != nil {
		return Adjustment{}, fmt.Errorf("calculando o saldo da carteira: %w", err)
	}
	if w == nil { // CheckUsable já garantiu que é da casa; só por segurança
		return Adjustment{}, validation.New("walletId", "carteira inválida")
	}
	if w.OpeningBalanceMonth != nil && in.CompetenceMonth.Before(*w.OpeningBalanceMonth) {
		return Adjustment{}, validation.New("competenceMonth", "a carteira começa num mês posterior; confira a partir do mês de início")
	}
	diff := in.ActualBalance - b.Balance()
	if diff == 0 {
		return Adjustment{}, validation.New("actualBalanceCents", "o saldo já confere: não há diferença para ajustar")
	}

	a := Adjustment{HouseholdID: householdID, WalletID: in.WalletID, CompetenceMonth: in.CompetenceMonth, AmountCents: diff,
		Notes: in.Notes, CreatedBy: actor}
	if err := db.Create(&a).Error; err != nil {
		return Adjustment{}, fmt.Errorf("criando ajuste de saldo: %w", err)
	}
	return a, nil
}

// List devolve os ajustes (não excluídos) da competência, do mais recente para o mais antigo.
func (s *Service) List(ctx context.Context, householdID uuid.UUID, month caldate.Date) ([]Adjustment, error) {
	var v validation.Collector
	invoice.CheckCompetence(month, &v)
	if err := v.Err(); err != nil {
		return nil, err
	}
	var out []Adjustment
	err := s.db.WithContext(ctx).Where("household_id = ? AND competence_month = ?", householdID, month).
		Order("created_at DESC, id DESC").Find(&out).Error
	return out, err
}

// Delete exclui logicamente (deleted_at); o Desfazer é o Restore. Já excluído ou de outra casa = não encontrado.
func (s *Service) Delete(ctx context.Context, householdID, id uuid.UUID) error {
	res := s.db.WithContext(ctx).Where("household_id = ? AND id = ?", householdID, id).Delete(&Adjustment{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// Restore desfaz a exclusão (devolve a mesma diferença, sem recalcular). Unscoped: sem ele o GORM esconderia justamente
// os excluídos.
func (s *Service) Restore(ctx context.Context, householdID, id uuid.UUID) (Adjustment, error) {
	// Cada consulta parte de um *gorm.DB novo: reaproveitar o mesmo encadeado acumularia as cláusulas WHERE/Model.
	fresh := func() *gorm.DB { return s.db.WithContext(ctx).Unscoped() }
	var a Adjustment
	err := fresh().Where("household_id = ? AND id = ?", householdID, id).First(&a).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Adjustment{}, ErrNotFound
	}
	if err != nil {
		return Adjustment{}, err
	}
	if !a.DeletedAt.Valid {
		return Adjustment{}, ErrNotDeleted
	}
	if err := fresh().Model(&Adjustment{}).Where("household_id = ? AND id = ?", householdID, id).Update("deleted_at", nil).Error; err != nil {
		return Adjustment{}, err
	}
	a.DeletedAt = gorm.DeletedAt{}
	return a, nil
}
