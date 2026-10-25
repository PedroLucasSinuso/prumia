package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/id"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/token"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// Convite de cadastro (sem e-mail): o DONO DO SISTEMA (a primeira conta criada) gera um link de uso único e o entrega por
// fora (WhatsApp etc.). Quem abre cria a PRÓPRIA conta e a própria casa, como se fosse o primeiro usuário. É o único jeito
// de cadastrar sem convite de casa depois do primeiro usuário (salvo OPEN_REGISTRATION).
var (
	// ErrNotSystemOwner: só o dono do sistema gera, lista e revoga convites de cadastro.
	ErrNotSystemOwner = errors.New("só o dono do sistema gerencia convites de cadastro")
	// ErrSignupInviteInvalid: token desconhecido, expirado, usado ou revogado (sem distinguir, para não ajudar quem adivinha).
	ErrSignupInviteInvalid = errors.New("convite de cadastro inválido, expirado, usado ou revogado")
	// ErrSignupInviteLimit: já há MaxPendingSignupInvites convites pendentes (revogue um ou espere vencer).
	ErrSignupInviteLimit = errors.New("limite de convites de cadastro pendentes atingido: revogue um ou espere vencer")
	// ErrSignupInviteNotFound: revogar um id que não é deste dono (ou não existe).
	ErrSignupInviteNotFound = errors.New("convite de cadastro não encontrado")
)

const (
	DefaultSignupInviteHours = 48
	MaxSignupInviteHours     = 168 // 7 dias
	// MaxPendingSignupInvites: teto de links pendentes ao mesmo tempo (um link vazado não vira uma enxurrada de contas).
	MaxPendingSignupInvites = 5
)

// SignupInvite espelha `signup_invites`. Só o hash do token é guardado (o token em claro é devolvido uma única vez).
type SignupInvite struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	TokenHash []byte
	CreatedBy uuid.UUID `gorm:"type:uuid"`
	CreatedAt time.Time
	ExpiresAt time.Time
	UsedAt    *time.Time
	UsedBy    *uuid.UUID `gorm:"type:uuid"`
	RevokedAt *time.Time
}

func (SignupInvite) TableName() string { return "signup_invites" }

// requireSystemOwner confere NO SERVIÇO que `actor` é o dono do sistema (não depende só do handler).
func (s *Service) requireSystemOwner(db *gorm.DB, actor uuid.UUID) error {
	var u User
	err := db.Select("id", "is_system_owner").First(&u, "id = ?", actor).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNotSystemOwner
	}
	if err != nil {
		return err
	}
	if !u.IsSystemOwner {
		return ErrNotSystemOwner
	}
	return nil
}

// CreateSignupInvite gera um convite de cadastro. Devolve o convite e o TOKEN EM CLARO (a única vez que existe).
// hours == 0 usa o padrão (48h); o máximo é 168h. Teto de MaxPendingSignupInvites pendentes (não usados, não revogados,
// não vencidos). A contagem e a gravação ficam numa transação com trava de aplicação, para dois cliques simultâneos não
// furarem o teto.
func (s *Service) CreateSignupInvite(ctx context.Context, actor uuid.UUID, hours int) (SignupInvite, string, error) {
	if hours == 0 {
		hours = DefaultSignupInviteHours
	}
	if hours < 1 || hours > MaxSignupInviteHours {
		return SignupInvite{}, "", validation.New("expiresInHours", fmt.Sprintf("use de 1 a %d horas", MaxSignupInviteHours))
	}
	tok, hash, err := token.New()
	if err != nil {
		return SignupInvite{}, "", err
	}
	now := s.cfg.Now()
	inv := SignupInvite{ID: id.New(), TokenHash: hash, CreatedBy: actor, CreatedAt: now, ExpiresAt: now.Add(time.Duration(hours) * time.Hour)}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.requireSystemOwner(tx, actor); err != nil {
			return err
		}
		if err := tx.Exec("SELECT pg_advisory_xact_lock(7102)").Error; err != nil {
			return err
		}
		var pending int64
		if err := tx.Model(&SignupInvite{}).
			Where("created_by = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?", actor, now).
			Count(&pending).Error; err != nil {
			return err
		}
		if pending >= MaxPendingSignupInvites {
			return ErrSignupInviteLimit
		}
		if err := tx.Create(&inv).Error; err != nil {
			return fmt.Errorf("criando convite de cadastro: %w", err)
		}
		return nil
	})
	if err != nil {
		return SignupInvite{}, "", err
	}
	return inv, tok, nil
}

// ListSignupInvites devolve os convites de cadastro PENDENTES do dono do sistema, do mais novo para o mais antigo.
func (s *Service) ListSignupInvites(ctx context.Context, actor uuid.UUID) ([]SignupInvite, error) {
	db := s.db.WithContext(ctx)
	if err := s.requireSystemOwner(db, actor); err != nil {
		return nil, err
	}
	var out []SignupInvite
	err := db.Where("created_by = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?", actor, s.cfg.Now()).
		Order("created_at DESC, id DESC").Find(&out).Error
	return out, err
}

// RevokeSignupInvite revoga um convite pendente do dono do sistema. Já revogado: sucesso (idempotente).
// Já usado ou de outra pessoa: ErrSignupInviteNotFound (404).
func (s *Service) RevokeSignupInvite(ctx context.Context, actor, inviteID uuid.UUID) error {
	db := s.db.WithContext(ctx)
	if err := s.requireSystemOwner(db, actor); err != nil {
		return err
	}
	res := db.Model(&SignupInvite{}).Where("id = ? AND created_by = ? AND used_at IS NULL", inviteID, actor).
		Update("revoked_at", gorm.Expr("COALESCE(revoked_at, ?)", s.cfg.Now()))
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrSignupInviteNotFound
	}
	return nil
}

// claimSignupInvite consome o convite DENTRO da transação do cadastro. Uso único e atômico: um UPDATE condicional só
// marca used_at/used_by se o convite ainda está pendente; duas requisições com o mesmo token são serializadas pelo
// Postgres e só uma vê a linha pendente. Falha = ErrSignupInviteInvalid (quem chama desfaz a transação inteira).
func (s *Service) claimSignupInvite(tx *gorm.DB, tok string, userID uuid.UUID) error {
	now := s.cfg.Now()
	res := tx.Exec(`
		UPDATE signup_invites SET used_at = ?, used_by = ?
		WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
		now, userID, token.Hash(tok), now)
	if res.Error != nil {
		return fmt.Errorf("consumindo convite de cadastro: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return ErrSignupInviteInvalid
	}
	return nil
}
