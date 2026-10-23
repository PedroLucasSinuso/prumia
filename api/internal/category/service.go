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
	ErrNotFound    = errors.New("categoria não encontrada")
	ErrNameTaken   = errors.New("já existe uma categoria com este nome")
	ErrInUse       = errors.New("categoria em uso: arquive em vez de excluir")
	ErrHasChildren = errors.New("categoria com subcategorias: mova ou apague as subcategorias primeiro")
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
	return get(s.db.WithContext(ctx), householdID, id)
}

func get(db *gorm.DB, householdID, id uuid.UUID) (Category, error) {
	var c Category
	err := db.Where("household_id = ? AND id = ?", householdID, id).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Category{}, ErrNotFound
	}
	return c, err
}

type CreateInput struct {
	Name          string
	DefaultWallet *string
	IsEssential   bool
	ParentID      *uuid.UUID
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

// checkParent confere a regra dos dois níveis: a mãe é da mesma casa, é de topo (não é filha de ninguém) e está ativa.
// `self` é o id da categoria que está sendo movida (uuid.Nil ao criar); `hasChildren` diz se ela tem filhas.
func checkParent(db *gorm.DB, householdID uuid.UUID, parentID *uuid.UUID, self uuid.UUID, hasChildren bool, v *validation.Collector) error {
	if parentID == nil {
		return nil
	}
	if *parentID == self {
		v.Add("parentId", "uma categoria não pode ficar dentro dela mesma")
		return nil
	}
	if hasChildren {
		v.Add("parentId", "esta categoria tem subcategorias e não pode ficar dentro de outra (só dois níveis)")
		return nil
	}
	parent, err := get(db, householdID, *parentID)
	switch {
	case errors.Is(err, ErrNotFound):
		v.Add("parentId", "categoria principal inválida")
	case err != nil:
		return err
	case parent.ParentID != nil:
		v.Add("parentId", "só dois níveis: escolha uma categoria principal, não uma subcategoria")
	case parent.Archived():
		v.Add("parentId", "a categoria principal está arquivada")
	}
	return nil
}

// nextSortOrder põe a categoria no fim da lista das suas irmãs (mesma mãe, ou o topo).
func nextSortOrder(db *gorm.DB, householdID uuid.UUID, parentID *uuid.UUID) int {
	var max *int
	q := db.Model(&Category{}).Where("household_id = ?", householdID).Select("max(sort_order)")
	if parentID == nil {
		q = q.Where("parent_id IS NULL")
	} else {
		q = q.Where("parent_id = ?", *parentID)
	}
	q.Scan(&max)
	if max == nil {
		return 0
	}
	return *max + 1
}

func (s *Service) Create(ctx context.Context, householdID uuid.UUID, in CreateInput) (Category, error) {
	db := s.db.WithContext(ctx)
	var v validation.Collector
	in.Name = cleanName(in.Name, &v)
	checkWallet(in.DefaultWallet, &v)
	if err := checkParent(db, householdID, in.ParentID, uuid.Nil, false, &v); err != nil {
		return Category{}, err
	}
	if err := v.Err(); err != nil {
		return Category{}, err
	}
	// A nova categoria vai para o fim da lista das irmãs.
	c := Category{HouseholdID: householdID, Name: in.Name, DefaultWallet: in.DefaultWallet, IsEssential: in.IsEssential,
		ParentID: in.ParentID, SortOrder: nextSortOrder(db, householdID, in.ParentID)}
	if err := db.Create(&c).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return Category{}, ErrNameTaken
		}
		return Category{}, err
	}
	return c, nil
}

// Patch: campos nil = não mexer. Os que aceitam "limpar" (DefaultWallet, ParentID) têm um flag Set separado,
// porque nil sozinho não diferencia "ausente" de "null".
type Patch struct {
	Name             *string
	DefaultWalletSet bool
	DefaultWallet    *string
	IsEssential      *bool
	SortOrder        *int
	Archived         *bool
	ParentSet        bool
	ParentID         *uuid.UUID
}

func (s *Service) Update(ctx context.Context, householdID, id uuid.UUID, p Patch) (Category, error) {
	cur, err := s.Get(ctx, householdID, id)
	if err != nil {
		return Category{}, err
	}
	db := s.db.WithContext(ctx)
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
	if p.ParentSet && !sameParent(cur.ParentID, p.ParentID) {
		var kids int64
		db.Model(&Category{}).Where("household_id = ? AND parent_id = ?", householdID, id).Count(&kids)
		if err := checkParent(db, householdID, p.ParentID, id, kids > 0, &v); err != nil {
			return Category{}, err
		}
		updates["parent_id"] = p.ParentID
		if p.SortOrder == nil { // mudou de grupo: vai para o fim das novas irmãs
			updates["sort_order"] = nextSortOrder(db, householdID, p.ParentID)
		}
	}
	var archiveAt *time.Time
	restore := false
	if p.Archived != nil {
		if *p.Archived {
			now := time.Now().UTC()
			archiveAt = &now
			updates["archived_at"] = now
		} else {
			restore = true
			updates["archived_at"] = nil
			// Restaurar uma subcategoria com a mãe arquivada deixaria uma filha ativa dentro de uma mãe escondida.
			if cur.ParentID != nil {
				parent, err := get(db, householdID, *cur.ParentID)
				if err == nil && parent.Archived() {
					v.Add("archived", "restaure primeiro a categoria principal")
				}
			}
		}
	}
	if err := v.Err(); err != nil {
		return Category{}, err
	}
	if len(updates) == 0 {
		return cur, nil
	}

	err = db.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&Category{}).Where("household_id = ? AND id = ?", householdID, id).Updates(updates)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrNotFound
		}
		// Arquivar a mãe esconde as filhas junto, com o MESMO instante; restaurar a mãe traz de volta só as que foram
		// escondidas junto com ela (uma filha arquivada à parte, antes, continua arquivada).
		if archiveAt != nil && cur.ParentID == nil {
			return tx.Model(&Category{}).Where("household_id = ? AND parent_id = ? AND archived_at IS NULL", householdID, id).
				Update("archived_at", *archiveAt).Error
		}
		if restore && cur.ParentID == nil && cur.ArchivedAt != nil {
			return tx.Model(&Category{}).Where("household_id = ? AND parent_id = ? AND archived_at = ?", householdID, id, *cur.ArchivedAt).
				Update("archived_at", nil).Error
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return Category{}, ErrNameTaken
		}
		return Category{}, err
	}
	return s.Get(ctx, householdID, id)
}

func sameParent(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// Delete exclui (lógico) uma categoria SEM uso e sem subcategorias. Em uso, o caminho é arquivar.
func (s *Service) Delete(ctx context.Context, householdID, id uuid.UUID) error {
	if _, err := s.Get(ctx, householdID, id); err != nil {
		return err
	}
	var kids int64
	if err := s.db.WithContext(ctx).Model(&Category{}).Where("household_id = ? AND parent_id = ?", householdID, id).Count(&kids).Error; err != nil {
		return err
	}
	if kids > 0 {
		return ErrHasChildren
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
