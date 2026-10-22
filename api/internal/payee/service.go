package payee

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/category"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/cnpj"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

var (
	ErrNotFound  = errors.New("favorecido não encontrado")
	ErrNameTaken = errors.New("já existe um favorecido com este nome")
	ErrCNPJTaken = errors.New("já existe um favorecido com este CNPJ")
	ErrInUse     = errors.New("favorecido em uso: arquive em vez de excluir")
)

type Service struct{ db *gorm.DB }

func NewService(db *gorm.DB) *Service { return &Service{db: db} }

// Todas as consultas filtram por household_id: uma casa nunca enxerga favorecido de outra.

func (s *Service) List(ctx context.Context, householdID uuid.UUID, includeArchived bool) ([]Payee, error) {
	q := s.db.WithContext(ctx).Where("household_id = ?", householdID)
	if !includeArchived {
		q = q.Where("archived_at IS NULL")
	}
	var out []Payee
	err := q.Order("lower(name)").Find(&out).Error
	return out, err
}

func (s *Service) Get(ctx context.Context, householdID, id uuid.UUID) (Payee, error) {
	var p Payee
	err := s.db.WithContext(ctx).Where("household_id = ? AND id = ?", householdID, id).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Payee{}, ErrNotFound
	}
	return p, err
}

// FindByCNPJ devolve o favorecido (não excluído) da casa com este CNPJ, ou ErrNotFound. Usado pelo boleto (PR seguinte).
func (s *Service) FindByCNPJ(ctx context.Context, householdID uuid.UUID, raw string) (Payee, error) {
	var p Payee
	err := s.db.WithContext(ctx).Where("household_id = ? AND cnpj = ?", householdID, cnpj.Digits(raw)).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Payee{}, ErrNotFound
	}
	return p, err
}

// AdoptCNPJ grava o CNPJ (e a razão social, se faltar) num favorecido que ainda não tem um, quando nenhum outro
// favorecido da casa já usa esse CNPJ. Usado ao lançar um boleto com um favorecido escolhido à mão. Devolve false
// (sem erro) quando não há o que fazer.
func (s *Service) AdoptCNPJ(ctx context.Context, householdID, id uuid.UUID, raw string, legalName *string) (bool, error) {
	if !cnpj.Valid(raw) {
		return false, nil
	}
	d := cnpj.Digits(raw)
	res := s.db.WithContext(ctx).Exec(`
		UPDATE payees SET cnpj = ?, legal_name = COALESCE(legal_name, ?), updated_at = now()
		WHERE household_id = ? AND id = ? AND cnpj IS NULL AND deleted_at IS NULL
		  AND NOT EXISTS (SELECT 1 FROM payees WHERE household_id = ? AND cnpj = ? AND deleted_at IS NULL)`,
		d, legalName, householdID, id, householdID, d)
	return res.RowsAffected > 0, res.Error
}

type CreateInput struct {
	Name              string
	CNPJ              *string
	LegalName         *string
	DefaultCategoryID *uuid.UUID
}

func cleanName(name string, v *validation.Collector) string {
	name = strings.TrimSpace(name)
	if n := len([]rune(name)); n < 1 || n > 60 {
		v.Add("name", "informe um nome de 1 a 60 caracteres")
	}
	return name
}

// cleanCNPJ normaliza para só dígitos; vazio vira nil (campo opcional).
func cleanCNPJ(raw *string, v *validation.Collector) *string {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil
	}
	if !cnpj.Valid(*raw) {
		v.Add("cnpj", "CNPJ inválido: confira os números")
		return nil
	}
	d := cnpj.Digits(*raw)
	return &d
}

func cleanLegalName(raw *string, v *validation.Collector) *string {
	if raw == nil {
		return nil
	}
	s := strings.Join(strings.Fields(*raw), " ")
	if s == "" {
		return nil
	}
	if len([]rune(s)) > 120 {
		v.Add("legalName", "use até 120 caracteres")
	}
	return &s
}

// checkCategory exige categoria da própria casa e ativa (a FK composta reforça, mas queremos erro de validação, não 500).
func (s *Service) checkCategory(ctx context.Context, householdID uuid.UUID, id *uuid.UUID, v *validation.Collector) error {
	if id == nil {
		return nil
	}
	var n int64
	err := s.db.WithContext(ctx).Model(&category.Category{}).
		Where("household_id = ? AND id = ? AND archived_at IS NULL", householdID, *id).Count(&n).Error
	if err != nil {
		return err
	}
	if n == 0 {
		v.Add("defaultCategoryId", "categoria inválida ou arquivada")
	}
	return nil
}

func duplicate(err error) error {
	if !errors.Is(err, gorm.ErrDuplicatedKey) {
		return nil
	}
	// O índice que estourou diz qual campo repetiu.
	if strings.Contains(err.Error(), "payees_cnpj_uq") {
		return ErrCNPJTaken
	}
	return ErrNameTaken
}

func (s *Service) Create(ctx context.Context, householdID uuid.UUID, in CreateInput) (Payee, error) {
	var v validation.Collector
	in.Name = cleanName(in.Name, &v)
	in.CNPJ = cleanCNPJ(in.CNPJ, &v)
	in.LegalName = cleanLegalName(in.LegalName, &v)
	if err := s.checkCategory(ctx, householdID, in.DefaultCategoryID, &v); err != nil {
		return Payee{}, err
	}
	if err := v.Err(); err != nil {
		return Payee{}, err
	}
	p := Payee{HouseholdID: householdID, Name: in.Name, CNPJ: in.CNPJ, LegalName: in.LegalName, DefaultCategoryID: in.DefaultCategoryID}
	if err := s.db.WithContext(ctx).Create(&p).Error; err != nil {
		if d := duplicate(err); d != nil {
			return Payee{}, d
		}
		return Payee{}, err
	}
	return p, nil
}

// Patch: nil = não mexer. Os campos que aceitam "limpar" têm um flag Set (nil sozinho não diferencia ausente de null).
type Patch struct {
	Name               *string
	CNPJSet            bool
	CNPJ               *string
	LegalNameSet       bool
	LegalName          *string
	DefaultCategorySet bool
	DefaultCategoryID  *uuid.UUID
	Archived           *bool
}

func (s *Service) Update(ctx context.Context, householdID, id uuid.UUID, p Patch) (Payee, error) {
	var v validation.Collector
	updates := map[string]any{} // map para poder gravar nil (limpar) de propósito
	if p.Name != nil {
		updates["name"] = cleanName(*p.Name, &v)
	}
	if p.CNPJSet {
		updates["cnpj"] = cleanCNPJ(p.CNPJ, &v)
	}
	if p.LegalNameSet {
		updates["legal_name"] = cleanLegalName(p.LegalName, &v)
	}
	if p.DefaultCategorySet {
		if err := s.checkCategory(ctx, householdID, p.DefaultCategoryID, &v); err != nil {
			return Payee{}, err
		}
		updates["default_category_id"] = p.DefaultCategoryID
	}
	if p.Archived != nil {
		if *p.Archived {
			updates["archived_at"] = time.Now().UTC()
		} else {
			updates["archived_at"] = nil
		}
	}
	if err := v.Err(); err != nil {
		return Payee{}, err
	}
	if len(updates) > 0 {
		res := s.db.WithContext(ctx).Model(&Payee{}).Where("household_id = ? AND id = ?", householdID, id).Updates(updates)
		if res.Error != nil {
			if d := duplicate(res.Error); d != nil {
				return Payee{}, d
			}
			return Payee{}, res.Error
		}
		if res.RowsAffected == 0 {
			return Payee{}, ErrNotFound
		}
	}
	return s.Get(ctx, householdID, id)
}

// Delete exclui (lógico) um favorecido SEM uso. Em uso, o caminho é arquivar.
func (s *Service) Delete(ctx context.Context, householdID, id uuid.UUID) error {
	if _, err := s.Get(ctx, householdID, id); err != nil {
		return err
	}
	var used int64
	err := s.db.WithContext(ctx).Table("invoices").
		Where("household_id = ? AND payee_id = ? AND deleted_at IS NULL", householdID, id).Count(&used).Error
	if err != nil {
		return err
	}
	if used > 0 {
		return ErrInUse
	}
	return s.db.WithContext(ctx).Where("household_id = ? AND id = ?", householdID, id).Delete(&Payee{}).Error
}
