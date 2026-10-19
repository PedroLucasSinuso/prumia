package household

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ErrNotFound: a casa não existe ou o usuário não é membro dela (não distinguimos, para não vazar a existência).
var ErrNotFound = errors.New("casa não encontrada")

// ErrInvalidName: nome vazio ou longo demais.
var ErrInvalidName = errors.New("nome da casa deve ter de 1 a 80 caracteres")

// defaultCategories são criadas com a casa (spec, seção 5). Mercado e Alimentação fora sugerem VR.
var defaultCategories = []struct {
	name      string
	wallet    string // "" = sem sugestão
	essential bool
}{
	{"Moradia", "", true},
	{"Mercado", "benefit", true},
	{"Alimentação fora", "benefit", false},
	{"Transporte", "", true},
	{"Saúde", "", true},
	{"Educação", "", false},
	{"Lazer", "", false},
	{"Assinaturas", "", false},
	{"Compras", "", false},
	{"Outros", "", false},
}

type Service struct{ db *gorm.DB }

func NewService(db *gorm.DB) *Service { return &Service{db: db} }

// NormalizeName valida e limpa o nome.
func NormalizeName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if n := len([]rune(name)); n < 1 || n > 80 {
		return "", ErrInvalidName
	}
	return name, nil
}

// CreateWithin cria a casa, torna o criador admin e semeia as categorias padrão, tudo dentro da
// transação `tx` recebida. Assim quem chama (cadastro de usuário, criação de casa) decide o limite
// da transação: ou tudo é gravado, ou nada.
func (s *Service) CreateWithin(tx *gorm.DB, name string, creator uuid.UUID) (Household, error) {
	name, err := NormalizeName(name)
	if err != nil {
		return Household{}, err
	}
	h := Household{Name: name, CreatedBy: creator}
	if err := tx.Create(&h).Error; err != nil {
		return Household{}, fmt.Errorf("criando casa: %w", err)
	}
	if err := tx.Create(&Member{HouseholdID: h.ID, UserID: creator, Role: RoleAdmin}).Error; err != nil {
		return Household{}, fmt.Errorf("criando membro admin: %w", err)
	}
	cats := make([]Category, len(defaultCategories))
	for i, c := range defaultCategories {
		cats[i] = Category{HouseholdID: h.ID, Name: c.name, IsEssential: c.essential, SortOrder: i}
		if c.wallet != "" {
			w := c.wallet
			cats[i].DefaultWallet = &w
		}
	}
	if err := tx.Create(&cats).Error; err != nil {
		return Household{}, fmt.Errorf("criando categorias padrão: %w", err)
	}
	return h, nil
}

// Create cria uma casa nova para um usuário já existente.
func (s *Service) Create(ctx context.Context, name string, creator uuid.UUID) (Household, error) {
	var h Household
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		h, err = s.CreateWithin(tx, name, creator)
		return err
	})
	return h, err
}

// Get devolve a casa, desde que o usuário seja membro ativo dela.
func (s *Service) Get(ctx context.Context, householdID, userID uuid.UUID) (Household, error) {
	var h Household
	err := s.db.WithContext(ctx).
		Joins("JOIN household_members m ON m.household_id = households.id AND m.user_id = ? AND m.left_at IS NULL", userID).
		First(&h, "households.id = ?", householdID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Household{}, ErrNotFound
	}
	return h, err
}

// MemberView é um membro com os dados do usuário, pronto para a listagem.
type MemberView struct {
	UserID   uuid.UUID
	Name     string
	Email    string
	Role     Role
	JoinedAt string // ISO 8601; formatado pelo handler
}

// Membership devolve o papel do usuário na casa (membro ativo) ou ErrNotFound.
func (s *Service) Membership(ctx context.Context, householdID, userID uuid.UUID) (Role, error) {
	var m Member
	err := s.db.WithContext(ctx).
		Where("household_id = ? AND user_id = ? AND left_at IS NULL", householdID, userID).
		First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	// a casa em si pode ter sido excluída (soft delete)
	var n int64
	if err := s.db.WithContext(ctx).Model(&Household{}).Where("id = ?", householdID).Count(&n).Error; err != nil {
		return "", err
	}
	if n == 0 {
		return "", ErrNotFound
	}
	return m.Role, nil
}
