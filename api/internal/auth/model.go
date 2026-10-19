package auth

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbmodel"
)

type User struct {
	dbmodel.Base
	Email        string
	Name         string
	PasswordHash string
	DeletedAt    gorm.DeletedAt
}

func (User) TableName() string { return "users" }

// Session é uma sessão de login. A chave primária é o hash do token (ver NewToken).
type Session struct {
	TokenHash  []byte `gorm:"primaryKey"`
	UserID     uuid.UUID
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
	UserAgent  *string
	IP         *string
}

func (Session) TableName() string { return "sessions" }
