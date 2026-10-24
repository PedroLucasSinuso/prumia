package transfer

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
	"github.com/PedroLucasSinuso/prumia/api/internal/wallet"
)

var (
	ErrNotFound   = errors.New("transferência não encontrada")
	ErrNotDeleted = errors.New("a transferência não está excluída")
)

// Service: toda consulta filtra por household_id. A permissão de escrita (viewer nunca escreve) é do porteiro das rotas
// (auth.Middleware, 403 read_only), igual às demais entidades da casa; admin e member escrevem.
type Service struct {
	db    *gorm.DB
	today func() caldate.Date // "hoje" no fuso da aplicação; injetável nos testes
}

func NewService(db *gorm.DB, today func() caldate.Date) *Service {
	return &Service{db: db, today: today}
}

type CreateInput struct {
	FromWalletID    uuid.UUID
	ToWalletID      uuid.UUID
	AmountCents     money.Cents
	TransferDate    caldate.Date // zero = hoje
	CompetenceMonth caldate.Date // zero = mês da data
	Notes           *string
}

// Create grava a transferência. Origem e destino têm de ser carteiras ATIVAS da casa e diferentes entre si; carteira
// arquivada só vale para transferências antigas.
func (s *Service) Create(ctx context.Context, householdID, actor uuid.UUID, in CreateInput) (Transfer, error) {
	db := s.db.WithContext(ctx)
	var v validation.Collector
	invoice.CheckAmount(in.AmountCents, "amountCents", &v)
	in.Notes = invoice.CheckNotes(in.Notes, &v)
	if in.TransferDate.IsZero() {
		in.TransferDate = s.today()
	}
	if in.CompetenceMonth.IsZero() {
		in.CompetenceMonth = in.TransferDate.StartOfMonth()
	} else {
		invoice.CheckCompetence(in.CompetenceMonth, &v)
	}
	if in.FromWalletID == in.ToWalletID {
		v.Add("toWalletId", "escolha uma carteira de destino diferente da origem")
	}
	if err := wallet.CheckUsable(db, householdID, in.FromWalletID, "fromWalletId", &v); err != nil {
		return Transfer{}, err
	}
	if in.ToWalletID != in.FromWalletID {
		if err := wallet.CheckUsable(db, householdID, in.ToWalletID, "toWalletId", &v); err != nil {
			return Transfer{}, err
		}
	}
	if err := v.Err(); err != nil {
		return Transfer{}, err
	}
	t := Transfer{HouseholdID: householdID, FromWalletID: in.FromWalletID, ToWalletID: in.ToWalletID, AmountCents: in.AmountCents,
		TransferDate: in.TransferDate, CompetenceMonth: in.CompetenceMonth, Notes: in.Notes, CreatedBy: actor}
	if err := db.Create(&t).Error; err != nil {
		return Transfer{}, fmt.Errorf("criando transferência: %w", err)
	}
	return t, nil
}

// List devolve as transferências (não excluídas) da competência, da data mais recente para a mais antiga.
func (s *Service) List(ctx context.Context, householdID uuid.UUID, month caldate.Date) ([]Transfer, error) {
	var v validation.Collector
	invoice.CheckCompetence(month, &v)
	if err := v.Err(); err != nil {
		return nil, err
	}
	var out []Transfer
	err := s.db.WithContext(ctx).Where("household_id = ? AND competence_month = ?", householdID, month).
		Order("transfer_date DESC, created_at DESC, id DESC").Find(&out).Error
	return out, err
}

// Delete exclui logicamente (deleted_at); o Desfazer é o Restore. Já excluída ou de outra casa = não encontrada.
func (s *Service) Delete(ctx context.Context, householdID, id uuid.UUID) error {
	res := s.db.WithContext(ctx).Where("household_id = ? AND id = ?", householdID, id).Delete(&Transfer{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// Restore desfaz a exclusão. Unscoped: sem ele o GORM esconderia justamente as excluídas.
func (s *Service) Restore(ctx context.Context, householdID, id uuid.UUID) (Transfer, error) {
	// Cada consulta parte de um *gorm.DB novo: reaproveitar o mesmo encadeado acumularia as cláusulas WHERE/Model.
	fresh := func() *gorm.DB { return s.db.WithContext(ctx).Unscoped() }
	var t Transfer
	err := fresh().Where("household_id = ? AND id = ?", householdID, id).First(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Transfer{}, ErrNotFound
	}
	if err != nil {
		return Transfer{}, err
	}
	if !t.DeletedAt.Valid {
		return Transfer{}, ErrNotDeleted
	}
	if err := fresh().Model(&Transfer{}).Where("household_id = ? AND id = ?", householdID, id).Update("deleted_at", nil).Error; err != nil {
		return Transfer{}, err
	}
	t.DeletedAt = gorm.DeletedAt{}
	return t, nil
}
