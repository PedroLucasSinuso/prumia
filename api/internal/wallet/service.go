package wallet

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

var (
	ErrNotFound  = errors.New("carteira não encontrada")
	ErrNameTaken = errors.New("já existe uma carteira ativa com este nome")
	ErrForbidden = errors.New("apenas administradores da casa")
	ErrIsDefault = errors.New("a carteira padrão não pode ser arquivada: escolha outra como padrão antes")
)

// MaxBalance limita o saldo inicial (R$ 10 bilhões, o mesmo teto dos demais valores), para a soma nunca estourar int64.
const MaxBalance money.Cents = 1_000_000_000_000

type Service struct{ db *gorm.DB }

func NewService(db *gorm.DB) *Service { return &Service{db: db} }

// Todas as consultas filtram por household_id: uma casa nunca enxerga carteira de outra.

// requireAdmin: só o Responsável (role admin) mexe nas carteiras. A checagem fica no service (regra 2 do CLAUDE.md),
// não só no handler. Não importa o pacote household (ele é quem chama este pacote ao criar a casa): consulta direto.
func (s *Service) requireAdmin(ctx context.Context, householdID, actor uuid.UUID) error {
	var n int64
	err := s.db.WithContext(ctx).Raw(
		`SELECT count(*) FROM household_members WHERE household_id = ? AND user_id = ? AND role = 'admin' AND left_at IS NULL`,
		householdID, actor).Scan(&n).Error
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrForbidden
	}
	return nil
}

// List devolve as carteiras da casa: a padrão primeiro, depois por sort_order e nome.
func (s *Service) List(ctx context.Context, householdID uuid.UUID, includeArchived bool) ([]Wallet, error) {
	q := s.db.WithContext(ctx).Where("household_id = ?", householdID)
	if !includeArchived {
		q = q.Where("archived_at IS NULL")
	}
	var out []Wallet
	err := q.Order("is_default DESC, sort_order, lower(name), id").Find(&out).Error
	return out, err
}

func (s *Service) Get(ctx context.Context, householdID, id uuid.UUID) (Wallet, error) {
	return get(s.db.WithContext(ctx), householdID, id)
}

func get(db *gorm.DB, householdID, id uuid.UUID) (Wallet, error) {
	var w Wallet
	err := db.Where("household_id = ? AND id = ?", householdID, id).First(&w).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Wallet{}, ErrNotFound
	}
	return w, err
}

func cleanName(name string, v *validation.Collector) string {
	name = strings.TrimSpace(name)
	if n := len([]rune(name)); n < 1 || n > 40 {
		v.Add("name", "informe um nome de 1 a 40 caracteres")
	}
	return name
}

func checkBalance(c money.Cents, v *validation.Collector) {
	if c > MaxBalance || c < -MaxBalance {
		v.Add("openingBalanceCents", "valor alto demais")
	}
}

// checkOpeningMonth: o mês de início tem de ser o dia 1 (nil = sem mês de início).
func checkOpeningMonth(m *caldate.Date, v *validation.Collector) {
	if m != nil && (m.IsZero() || !m.IsStartOfMonth()) {
		v.Add("openingBalanceMonth", "informe o primeiro dia do mês (AAAA-MM-01)")
	}
}

// checkOwner: o dono (etiqueta) tem de ser membro ATIVO da casa.
func checkOwner(db *gorm.DB, householdID uuid.UUID, owner *uuid.UUID, v *validation.Collector) error {
	if owner == nil {
		return nil
	}
	var n int64
	err := db.Raw(`SELECT count(*) FROM household_members WHERE household_id = ? AND user_id = ? AND left_at IS NULL`,
		householdID, *owner).Scan(&n).Error
	if err != nil {
		return err
	}
	if n == 0 {
		v.Add("ownerUserId", "o dono deve ser membro da casa")
	}
	return nil
}

type CreateInput struct {
	Name                string
	OwnerUserID         *uuid.UUID
	WarnOnOverdraft     *bool // nil = true
	OpeningBalanceCents money.Cents
	OpeningBalanceMonth *caldate.Date // nil = o saldo inicial vale desde o começo
	SortOrder           *int          // nil = fim da lista
}

// Create cria uma carteira (somente admin). Nunca nasce como padrão: para isso, Update com IsDefault.
func (s *Service) Create(ctx context.Context, householdID, actor uuid.UUID, in CreateInput) (Wallet, error) {
	if err := s.requireAdmin(ctx, householdID, actor); err != nil {
		return Wallet{}, err
	}
	db := s.db.WithContext(ctx)
	var v validation.Collector
	in.Name = cleanName(in.Name, &v)
	checkBalance(in.OpeningBalanceCents, &v)
	checkOpeningMonth(in.OpeningBalanceMonth, &v)
	if err := checkOwner(db, householdID, in.OwnerUserID, &v); err != nil {
		return Wallet{}, err
	}
	if err := v.Err(); err != nil {
		return Wallet{}, err
	}
	w := Wallet{HouseholdID: householdID, Name: in.Name, OwnerUserID: in.OwnerUserID, WarnOnOverdraft: true,
		OpeningBalanceCents: in.OpeningBalanceCents, OpeningBalanceMonth: in.OpeningBalanceMonth}
	if in.WarnOnOverdraft != nil {
		w.WarnOnOverdraft = *in.WarnOnOverdraft
	}
	if in.SortOrder != nil {
		w.SortOrder = *in.SortOrder
	} else {
		var max *int
		db.Model(&Wallet{}).Where("household_id = ?", householdID).Select("max(sort_order)").Scan(&max)
		if max != nil {
			w.SortOrder = *max + 1
		}
	}
	if err := db.Create(&w).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return Wallet{}, ErrNameTaken
		}
		return Wallet{}, fmt.Errorf("criando carteira: %w", err)
	}
	return w, nil
}

// Patch: campos nil = não mexer. Dono aceita "limpar", então tem o flag OwnerSet (nil sozinho não diferencia
// "ausente" de "null").
type Patch struct {
	Name                *string
	OwnerSet            bool
	OwnerUserID         *uuid.UUID
	WarnOnOverdraft     *bool
	OpeningBalanceCents *money.Cents
	// OpeningMonthSet: o campo veio no PATCH (OpeningBalanceMonth nil + OpeningMonthSet = limpar o mês de início).
	OpeningMonthSet     bool
	OpeningBalanceMonth *caldate.Date
	IsDefault           *bool
	SortOrder           *int
}

// Update edita a carteira (somente admin). Tudo numa transação, com as carteiras da casa travadas: duas trocas de
// padrão simultâneas não deixam a casa com duas padrões nem com nenhuma.
func (s *Service) Update(ctx context.Context, householdID, actor, id uuid.UUID, p Patch) (Wallet, error) {
	if err := s.requireAdmin(ctx, householdID, actor); err != nil {
		return Wallet{}, err
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var locked []Wallet
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("household_id = ?", householdID).Find(&locked).Error; err != nil {
			return err
		}
		var cur *Wallet
		for i := range locked {
			if locked[i].ID == id {
				cur = &locked[i]
			}
		}
		if cur == nil {
			return ErrNotFound
		}
		var v validation.Collector
		updates := map[string]any{} // map (e não struct) para poder gravar zero/false/nil de propósito
		if p.Name != nil {
			updates["name"] = cleanName(*p.Name, &v)
		}
		if p.OwnerSet {
			if err := checkOwner(tx, householdID, p.OwnerUserID, &v); err != nil {
				return err
			}
			updates["owner_user_id"] = p.OwnerUserID
		}
		if p.WarnOnOverdraft != nil {
			updates["warn_on_overdraft"] = *p.WarnOnOverdraft
		}
		if p.OpeningBalanceCents != nil {
			checkBalance(*p.OpeningBalanceCents, &v)
			updates["opening_balance_cents"] = *p.OpeningBalanceCents
		}
		if p.OpeningMonthSet {
			checkOpeningMonth(p.OpeningBalanceMonth, &v)
			updates["opening_balance_month"] = p.OpeningBalanceMonth // nil grava NULL
		}
		if p.SortOrder != nil {
			updates["sort_order"] = *p.SortOrder
		}
		makeDefault := false
		if p.IsDefault != nil {
			switch {
			case *p.IsDefault && !cur.IsDefault:
				if cur.Archived() {
					v.Add("isDefault", "restaure a carteira antes de torná-la a padrão")
				}
				makeDefault = true
			case !*p.IsDefault && cur.IsDefault:
				v.Add("isDefault", "a casa precisa de uma carteira padrão: escolha outra como padrão")
			}
		}
		if err := v.Err(); err != nil {
			return err
		}
		if makeDefault {
			// Primeiro tira a marca da antiga (o índice único parcial só admite uma padrão por vez), depois põe na nova.
			if err := tx.Model(&Wallet{}).Where("household_id = ? AND is_default", householdID).
				Update("is_default", false).Error; err != nil {
				return err
			}
			updates["is_default"] = true
		}
		if len(updates) == 0 {
			return nil
		}
		updates["updated_at"] = time.Now().UTC()
		return tx.Model(&Wallet{}).Where("household_id = ? AND id = ?", householdID, id).Updates(updates).Error
	})
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return Wallet{}, ErrNameTaken
		}
		return Wallet{}, err
	}
	return s.Get(ctx, householdID, id)
}

// SetArchived arquiva (archived=true) ou restaura uma carteira (somente admin). Não existe exclusão: a carteira com uso
// continua no histórico e no resumo. A padrão não pode ser arquivada. Restaurar pode bater no nome de outra ativa.
func (s *Service) SetArchived(ctx context.Context, householdID, actor, id uuid.UUID, archived bool) (Wallet, error) {
	if err := s.requireAdmin(ctx, householdID, actor); err != nil {
		return Wallet{}, err
	}
	cur, err := s.Get(ctx, householdID, id)
	if err != nil {
		return Wallet{}, err
	}
	if archived && cur.IsDefault {
		return Wallet{}, ErrIsDefault
	}
	if archived == cur.Archived() {
		return cur, nil // já está no estado pedido
	}
	var at any // nil = restaurar
	if archived {
		at = time.Now().UTC()
	}
	err = s.db.WithContext(ctx).Model(&Wallet{}).Where("household_id = ? AND id = ?", householdID, id).
		Updates(map[string]any{"archived_at": at, "updated_at": time.Now().UTC()}).Error
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return Wallet{}, ErrNameTaken
		}
		return Wallet{}, err
	}
	return s.Get(ctx, householdID, id)
}

// CreateDefaults cria "Geral" (padrão, sem aviso de saldo) e "Benefício" (com aviso) para uma casa nova. Recebe a
// transação de quem cria a casa, então ou tudo é gravado, ou nada.
// Devolve as duas (em Go uma função pode devolver vários valores) porque a categoria Mercado sugere a de benefício.
func CreateDefaults(tx *gorm.DB, householdID uuid.UUID) (general, benefit Wallet, err error) {
	general = Wallet{HouseholdID: householdID, Name: DefaultName, IsDefault: true, WarnOnOverdraft: false, SortOrder: 0}
	benefit = Wallet{HouseholdID: householdID, Name: BenefitName, WarnOnOverdraft: true, SortOrder: 1}
	if err := tx.Create(&general).Error; err != nil {
		return Wallet{}, Wallet{}, fmt.Errorf("criando carteira padrão: %w", err)
	}
	if err := tx.Create(&benefit).Error; err != nil {
		return Wallet{}, Wallet{}, fmt.Errorf("criando carteira de benefício: %w", err)
	}
	return general, benefit, nil
}
