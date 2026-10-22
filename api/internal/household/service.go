package household

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/category"
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

// Erros de negócio de convites e membros (mapeados para HTTP em um único lugar, no pacote api/auth).
var (
	ErrForbidden      = errors.New("apenas administradores da casa")
	ErrLastAdmin      = errors.New("a casa precisa de ao menos um administrador ativo")
	ErrInviteInvalid  = errors.New("convite inválido, expirado, usado ou revogado")
	ErrInviteNotFound = errors.New("convite não encontrado")
	ErrInviteUsed     = errors.New("convite já foi usado")
	ErrAlreadyMember  = errors.New("você já faz parte desta casa")
	ErrLimitReached   = errors.New("você atingiu o limite de casas criadas por você")
)

// DefaultMaxPerUser é o limite padrão de casas ativas criadas por um mesmo usuário (MAX_HOUSEHOLDS_PER_USER).
// Evita que uma conta crie casas sem fim (cada casa leva 10 categorias e linhas de membro).
const DefaultMaxPerUser = 5

type Service struct {
	db         *gorm.DB
	Now        func() time.Time // relógio injetável (testes)
	MaxPerUser int              // limite de casas ativas criadas por usuário; 0 = DefaultMaxPerUser
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db, Now: time.Now, MaxPerUser: DefaultMaxPerUser}
}

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
	cats := make([]category.Category, len(defaultCategories))
	for i, c := range defaultCategories {
		cats[i] = category.Category{HouseholdID: h.ID, Name: c.name, IsEssential: c.essential, SortOrder: i}
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

// Create cria uma casa nova para um usuário já existente, respeitando o limite de casas ativas criadas por ele.
func (s *Service) Create(ctx context.Context, name string, creator uuid.UUID) (Household, error) {
	var h Household
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Trava de aplicação por usuário (liberada no fim da transação): duas criações simultâneas do mesmo
		// usuário são serializadas, então a contagem abaixo não deixa passar a 6ª casa numa corrida.
		// hashtext devolve int4; a forma de dois argumentos (classe, chave) não colide com a trava 7101 do cadastro.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(7102, hashtext(?))", creator.String()).Error; err != nil {
			return err
		}
		var n int64
		if err := tx.Model(&Household{}).Where("created_by = ? AND deleted_at IS NULL", creator).Count(&n).Error; err != nil {
			return err
		}
		limit := s.MaxPerUser
		if limit <= 0 {
			limit = DefaultMaxPerUser
		}
		if n >= int64(limit) {
			return ErrLimitReached
		}
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
