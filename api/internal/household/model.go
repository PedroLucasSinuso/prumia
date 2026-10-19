// Package household cuida das casas (a unidade de dados do prumia), seus membros e categorias padrão.
package household

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbmodel"
)

// Role é o papel de um membro na casa. Os valores são os mesmos do CHECK no banco e do OpenAPI.
type Role string

const (
	RoleAdmin  Role = "admin"
	RoleMember Role = "member"
	RoleViewer Role = "viewer"
)

// CanWrite diz se o papel pode criar/editar dados da casa (viewer é somente leitura).
func (r Role) CanWrite() bool { return r == RoleAdmin || r == RoleMember }

type Household struct {
	dbmodel.Base
	Name      string
	CreatedBy uuid.UUID `gorm:"type:uuid"`
	DeletedAt gorm.DeletedAt
}

func (Household) TableName() string { return "households" }

// Member é a ligação usuário-casa (N:N com papel). Nunca é apagado: quem sai ganha LeftAt,
// para as invoices antigas que o citam como responsável continuarem válidas.
type Member struct {
	HouseholdID uuid.UUID `gorm:"type:uuid;primaryKey"`
	UserID      uuid.UUID `gorm:"type:uuid;primaryKey"`
	Role        Role
	// autoCreateTime: o GORM preenche na criação. Sem isso, o zero do Go (0001-01-01) sobrescreve o DEFAULT now() do banco.
	JoinedAt time.Time `gorm:"autoCreateTime"`
	LeftAt   *time.Time
}

func (Member) TableName() string { return "household_members" }

type Category struct {
	dbmodel.Base
	HouseholdID   uuid.UUID `gorm:"type:uuid"`
	Name          string
	DefaultWallet *string
	IsEssential   bool
	SortOrder     int
	ArchivedAt    *time.Time
	DeletedAt     gorm.DeletedAt
}

func (Category) TableName() string { return "categories" }
