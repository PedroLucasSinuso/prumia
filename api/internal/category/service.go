package category

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

var (
	ErrNotFound  = errors.New("categoria não encontrada")
	ErrNameTaken = errors.New("já existe uma categoria com este nome")
	ErrInUse     = errors.New("categoria em uso: arquive em vez de excluir")
)

type Service struct{ db *gorm.DB }

func NewService(db *gorm.DB) *Service { return &Service{db: db} }

// Todas as consultas filtram por household_id: uma casa nunca enxerga categoria de outra.

func (s *Service) List(ctx context.Context, householdID uuid.UUID, includeArchived bool) ([]Category, error) {
	q := s.db.WithContext(ctx).Where("household_id = ?", householdID)
	if !includeArchived {
		q = q.Where("archived_at IS NULL")
	}
	var out []Category
	err := q.Order("sort_order, lower(name)").Find(&out).Error
	return out, err
}

func (s *Service) Get(ctx context.Context, householdID, id uuid.UUID) (Category, error) {
	var c Category
	err := s.db.WithContext(ctx).Where("household_id = ? AND id = ?", householdID, id).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Category{}, ErrNotFound
	}
	return c, err
}

type CreateInput struct {
	Name          string
	DefaultWallet *string
	IsEssential   bool
}

func cleanName(name string, v *validation.Collector) string {
	name = strings.TrimSpace(name)
	if n := len([]rune(name)); n < 1 || n > 60 {
		v.Add("name", "informe um nome de 1 a 60 caracteres")
	}
	return name
}

func checkWallet(w *string, v *validation.Collector) {
	if w != nil && !ValidWallet(*w) {
		v.Add("defaultWallet", "use free (livre) ou benefit (benefício)")
	}
}

func (s *Service) Create(ctx context.Context, householdID uuid.UUID, in CreateInput) (Category, error) {
	var v validation.Collector
	in.Name = cleanName(in.Name, &v)
	checkWallet(in.DefaultWallet, &v)
	if err := v.Err(); err != nil {
		return Category{}, err
	}
	// A nova categoria vai para o fim da lista.
	var max *int
	s.db.WithContext(ctx).Model(&Category{}).Where("household_id = ?", householdID).Select("max(sort_order)").Scan(&max)
	next := 0
	if max != nil {
		next = *max + 1
	}
	c := Category{HouseholdID: householdID, Name: in.Name, DefaultWallet: in.DefaultWallet, IsEssential: in.IsEssential, SortOrder: next}
	if err := s.db.WithContext(ctx).Create(&c).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return Category{}, ErrNameTaken
		}
		return Category{}, err
	}
	return c, nil
}

// Patch: campos nil = não mexer. Os que aceitam "limpar" (DefaultWallet) têm um flag Set separado,
// porque nil sozinho não diferencia "ausente" de "null".
type Patch struct {
	Name             *string
	DefaultWalletSet bool
	DefaultWallet    *string
	IsEssential      *bool
	SortOrder        *int
	Archived         *bool
}

func (s *Service) Update(ctx context.Context, householdID, id uuid.UUID, p Patch) (Category, error) {
	var v validation.Collector
	updates := map[string]any{} // map (e não struct) para poder gravar zero/false/nil de propósito
	if p.Name != nil {
		updates["name"] = cleanName(*p.Name, &v)
	}
	if p.DefaultWalletSet {
		checkWallet(p.DefaultWallet, &v)
		updates["default_wallet"] = p.DefaultWallet
	}
	if p.IsEssential != nil {
		updates["is_essential"] = *p.IsEssential
	}
	if p.SortOrder != nil {
		updates["sort_order"] = *p.SortOrder
	}
	if p.Archived != nil {
		if *p.Archived {
			updates["archived_at"] = time.Now().UTC()
		} else {
			updates["archived_at"] = nil
		}
	}
	if err := v.Err(); err != nil {
		return Category{}, err
	}
	if len(updates) > 0 {
		res := s.db.WithContext(ctx).Model(&Category{}).Where("household_id = ? AND id = ?", householdID, id).Updates(updates)
		if res.Error != nil {
			if errors.Is(res.Error, gorm.ErrDuplicatedKey) {
				return Category{}, ErrNameTaken
			}
			return Category{}, res.Error
		}
		if res.RowsAffected == 0 {
			return Category{}, ErrNotFound
		}
	}
	return s.Get(ctx, householdID, id)
}

// Delete exclui (lógico) uma categoria SEM uso. Em uso, o caminho é arquivar.
func (s *Service) Delete(ctx context.Context, householdID, id uuid.UUID) error {
	if _, err := s.Get(ctx, householdID, id); err != nil {
		return err
	}
	var used int64
	err := s.db.WithContext(ctx).Raw(`
		SELECT (SELECT count(*) FROM invoices    WHERE household_id = ? AND category_id = ? AND deleted_at IS NULL)
		     + (SELECT count(*) FROM purchases   WHERE household_id = ? AND category_id = ? AND deleted_at IS NULL)
		     + (SELECT count(*) FROM recurrences WHERE household_id = ? AND category_id = ? AND deleted_at IS NULL)`,
		householdID, id, householdID, id, householdID, id).Scan(&used).Error
	if err != nil {
		return err
	}
	if used > 0 {
		return ErrInUse
	}
	return s.db.WithContext(ctx).Where("household_id = ? AND id = ?", householdID, id).Delete(&Category{}).Error
}
