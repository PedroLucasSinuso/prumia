// Package dbmodel tem o que todos os modelos GORM compartilham.
package dbmodel

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/id"
)

// Base é embutida nos modelos que têm id uuid. Em Go, "embutir" uma struct promove seus campos e métodos
// para a struct externa, então todo modelo ganha ID, CreatedAt, UpdatedAt e o hook abaixo sem repetir código.
type Base struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

// BeforeCreate é um "hook" do GORM: roda antes de cada INSERT. Gera o UUIDv7 na aplicação
// (o default do banco é só rede de segurança, ver docs/developer-guide/schema.md).
func (b *Base) BeforeCreate(*gorm.DB) error {
	if b.ID == uuid.Nil {
		b.ID = id.New()
	}
	return nil
}
