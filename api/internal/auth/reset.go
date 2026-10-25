package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/household"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/id"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/token"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// Redefinição de senha SEM e-mail: um admin gera um link de uso único e o entrega ao usuário por fora (WhatsApp etc.).
var (
	// ErrResetNotAllowed: o solicitante não é admin de TODAS as casas ativas do usuário-alvo.
	ErrResetNotAllowed = errors.New("você só pode redefinir a senha de quem participa apenas de casas que você administra")
	// ErrInvalidResetToken: token desconhecido, expirado ou já usado (sem distinguir, para não ajudar quem adivinha).
	ErrInvalidResetToken = errors.New("link de redefinição inválido ou expirado")
)

const defaultResetTTL = time.Hour

// PasswordResetToken é o token no banco. Só o hash é guardado.
type PasswordResetToken struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	UserID    uuid.UUID `gorm:"type:uuid"`
	TokenHash []byte
	CreatedBy uuid.UUID `gorm:"type:uuid"`
	CreatedAt time.Time
	ExpiresAt time.Time
	UsedAt    *time.Time
}

func (PasswordResetToken) TableName() string { return "password_reset_tokens" }

// requesterCoversUser diz se `requester` é admin ativo de TODAS as casas ativas (não excluídas) de `target`.
// É a regra que impede um admin de tomar a conta de alguém que também participa de casas que ele não administra.
func requesterCoversUser(tx *gorm.DB, requester, target uuid.UUID) (bool, error) {
	var uncovered int64
	err := tx.Raw(`
		SELECT count(*)
		FROM household_members t
		JOIN households h ON h.id = t.household_id AND h.deleted_at IS NULL
		WHERE t.user_id = ? AND t.left_at IS NULL
		  AND NOT EXISTS (
		    SELECT 1 FROM household_members r
		    WHERE r.household_id = t.household_id AND r.user_id = ? AND r.role = 'admin' AND r.left_at IS NULL)`,
		target, requester).Scan(&uncovered).Error
	return uncovered == 0, err
}

// CreateResetLink gera o token de redefinição para `target`, a pedido de `actor` na casa `householdID`.
// O token em claro é devolvido UMA vez; no banco fica só o hash. Gerar um novo invalida os pendentes do mesmo usuário.
func (s *Service) CreateResetLink(ctx context.Context, householdID, actor, target uuid.UUID) (string, time.Time, error) {
	role, err := s.households.Membership(ctx, householdID, actor)
	if err != nil {
		return "", time.Time{}, err
	}
	if role != household.RoleAdmin {
		return "", time.Time{}, household.ErrForbidden
	}
	tok, hash, err := token.New()
	if err != nil {
		return "", time.Time{}, err
	}
	now := s.cfg.Now()
	expires := now.Add(s.cfg.ResetTTL)
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// o alvo precisa ser membro ATIVO desta casa (senão 404: não revelamos usuários de outras casas)
		var n int64
		if err := tx.Table("household_members").
			Where("household_id = ? AND user_id = ? AND left_at IS NULL", householdID, target).Count(&n).Error; err != nil {
			return err
		}
		if n == 0 {
			return household.ErrNotFound
		}
		ok, err := requesterCoversUser(tx, actor, target)
		if err != nil {
			return err
		}
		if !ok {
			return ErrResetNotAllowed
		}
		if err := tx.Where("user_id = ? AND used_at IS NULL", target).Delete(&PasswordResetToken{}).Error; err != nil {
			return err
		}
		return tx.Create(&PasswordResetToken{
			ID: id.New(), UserID: target, TokenHash: hash, CreatedBy: actor, CreatedAt: now, ExpiresAt: expires,
		}).Error
	})
	if err != nil {
		return "", time.Time{}, err
	}
	return tok, expires, nil
}

// ResetPassword troca a senha com o token do link e ENCERRA todas as sessões do usuário.
//
// Uso único e atômico: um UPDATE condicional marca used_at só se o token está pendente e não expirou.
// Além disso, conferimos DE NOVO que quem gerou o link ainda é admin de todas as casas atuais do usuário
// (ele pode ter entrado em outra casa depois do link): senão o link vira inválido e a transação desfaz tudo.
func (s *Service) ResetPassword(ctx context.Context, tok, newPassword string) error {
	if n := len([]rune(newPassword)); n < MinPasswordLen || n > MaxPasswordLen {
		return validation.New("newPassword", fmt.Sprintf("a senha deve ter de %d a %d caracteres", MinPasswordLen, MaxPasswordLen))
	}
	hash, err := s.hash(newPassword) // caro: fora da transação
	if err != nil {
		return err
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := s.cfg.Now()
		var claimed struct{ UserID, CreatedBy uuid.UUID }
		res := tx.Raw(`
			UPDATE password_reset_tokens SET used_at = ?
			WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
			RETURNING user_id, created_by`, now, HashToken(tok), now).Scan(&claimed)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrInvalidResetToken
		}
		ok, err := requesterCoversUser(tx, claimed.CreatedBy, claimed.UserID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrInvalidResetToken
		}
		up := tx.Model(&User{}).Where("id = ?", claimed.UserID).
			Updates(map[string]any{"password_hash": hash, "updated_at": now})
		if up.Error != nil {
			return up.Error
		}
		if up.RowsAffected == 0 { // usuário excluído
			return ErrInvalidResetToken
		}
		// quem tinha a senha antiga (ou a sessão roubada) é desconectado em todos os dispositivos
		if err := tx.Where("user_id = ?", claimed.UserID).Delete(&Session{}).Error; err != nil {
			return err
		}
		return tx.Where("user_id = ? AND used_at IS NULL", claimed.UserID).Delete(&PasswordResetToken{}).Error
	})
}
