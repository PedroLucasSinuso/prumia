package household

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

const (
	DefaultInviteHours = 48
	MaxInviteHours     = 168 // 7 dias
)

// Invite é o convite no banco. Só o hash do token é guardado (o token em claro é devolvido uma única vez).
type Invite struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	HouseholdID uuid.UUID `gorm:"type:uuid"`
	TokenHash   []byte
	Role        Role
	CreatedBy   uuid.UUID `gorm:"type:uuid"`
	CreatedAt   time.Time
	ExpiresAt   time.Time
	UsedAt      *time.Time
	UsedBy      *uuid.UUID `gorm:"type:uuid"`
	RevokedAt   *time.Time
}

func (Invite) TableName() string { return "household_invites" }

func validRole(r Role) bool { return r == RoleAdmin || r == RoleMember || r == RoleViewer }

// requireAdmin confirma que `actor` é admin ativo da casa (e a casa existe). É a checagem de papel NO SERVIÇO:
// não dependemos só do handler/middleware para o que é exclusivo de admin.
func (s *Service) requireAdmin(ctx context.Context, householdID, actor uuid.UUID) error {
	role, err := s.Membership(ctx, householdID, actor)
	if err != nil {
		return err
	}
	if role != RoleAdmin {
		return ErrForbidden
	}
	return nil
}

// CreateInvite gera um convite de uso único. Devolve o convite e o TOKEN EM CLARO (a única vez que existe).
// hours == 0 usa o padrão (48h); o máximo é 168h.
func (s *Service) CreateInvite(ctx context.Context, householdID, actor uuid.UUID, role Role, hours int) (Invite, string, error) {
	if err := s.requireAdmin(ctx, householdID, actor); err != nil {
		return Invite{}, "", err
	}
	if !validRole(role) {
		return Invite{}, "", validation.New("role", "use admin, member ou viewer")
	}
	if hours == 0 {
		hours = DefaultInviteHours
	}
	if hours < 1 || hours > MaxInviteHours {
		return Invite{}, "", validation.New("expiresInHours", fmt.Sprintf("use de 1 a %d horas", MaxInviteHours))
	}
	tok, hash, err := token.New()
	if err != nil {
		return Invite{}, "", err
	}
	now := s.Now()
	inv := Invite{
		ID: id.New(), HouseholdID: householdID, TokenHash: hash, Role: role, CreatedBy: actor,
		CreatedAt: now, ExpiresAt: now.Add(time.Duration(hours) * time.Hour),
	}
	if err := s.db.WithContext(ctx).Create(&inv).Error; err != nil {
		return Invite{}, "", fmt.Errorf("criando convite: %w", err)
	}
	return inv, tok, nil
}

// RevokeInvite revoga um convite pendente DESTA casa. Já revogado: sucesso (idempotente). Já usado: ErrInviteUsed.
// O filtro por household_id impede revogar convite de outra casa (que responde 404, como se não existisse).
func (s *Service) RevokeInvite(ctx context.Context, householdID, actor, inviteID uuid.UUID) error {
	if err := s.requireAdmin(ctx, householdID, actor); err != nil {
		return err
	}
	db := s.db.WithContext(ctx)
	res := db.Model(&Invite{}).
		Where("id = ? AND household_id = ? AND used_at IS NULL AND revoked_at IS NULL", inviteID, householdID).
		Update("revoked_at", s.Now())
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		return nil
	}
	var inv Invite
	err := db.Where("id = ? AND household_id = ?", inviteID, householdID).First(&inv).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return ErrInviteNotFound
	case err != nil:
		return err
	case inv.UsedAt != nil:
		return ErrInviteUsed
	}
	return nil // já estava revogado
}

// AcceptWithin consome o convite dentro da transação `tx` e coloca o usuário na casa.
//
// Uso único e atômico: um único UPDATE condicional marca used_at/used_by só se o convite ainda está
// pendente (não usado, não revogado, não expirado, casa existente). Duas requisições simultâneas com o mesmo
// token: o Postgres serializa o UPDATE e só uma vê a linha ainda pendente; a outra recebe 0 linhas.
// Qualquer falha devolve ErrInviteInvalid sem dizer o motivo (não revela se o token existiu).
//
// Se o usuário já é membro ativo, devolvemos ErrAlreadyMember e, como quem chama desfaz a transação, o convite NÃO é consumido.
// Quem saiu antes (left_at preenchido) é reativado na mesma linha (a PK é household_id+user_id), com o papel do
// convite e joined_at renovado.
func (s *Service) AcceptWithin(tx *gorm.DB, tok string, userID uuid.UUID) (Household, error) {
	var claimed struct {
		HouseholdID uuid.UUID
		Role        Role
	}
	now := s.Now()
	res := tx.Raw(`
		UPDATE household_invites i SET used_at = ?, used_by = ?
		WHERE i.token_hash = ? AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?
		  AND EXISTS (SELECT 1 FROM households h WHERE h.id = i.household_id AND h.deleted_at IS NULL)
		RETURNING i.household_id, i.role`, now, userID, token.Hash(tok), now).Scan(&claimed)
	if res.Error != nil {
		return Household{}, fmt.Errorf("consumindo convite: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return Household{}, ErrInviteInvalid
	}

	// Insere o membro, ou reativa quem já saiu. Se já é membro ativo, o WHERE não casa e nada muda (0 linhas).
	up := tx.Exec(`
		INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (household_id, user_id) DO UPDATE
		   SET role = EXCLUDED.role, joined_at = EXCLUDED.joined_at, left_at = NULL
		 WHERE household_members.left_at IS NOT NULL`, claimed.HouseholdID, userID, claimed.Role, now)
	if up.Error != nil {
		return Household{}, fmt.Errorf("entrando na casa: %w", up.Error)
	}
	if up.RowsAffected == 0 {
		return Household{}, ErrAlreadyMember
	}
	var h Household
	if err := tx.First(&h, "id = ?", claimed.HouseholdID).Error; err != nil {
		return Household{}, err
	}
	return h, nil
}

// Accept: o usuário já logado entra na casa do convite.
func (s *Service) Accept(ctx context.Context, tok string, userID uuid.UUID) (Household, error) {
	var h Household
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		h, err = s.AcceptWithin(tx, tok, userID)
		return err
	})
	return h, err
}
