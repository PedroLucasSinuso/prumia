package household

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// Rename renomeia a casa (somente admin).
func (s *Service) Rename(ctx context.Context, householdID, actor uuid.UUID, name string) (Household, error) {
	if err := s.requireAdmin(ctx, householdID, actor); err != nil {
		return Household{}, err
	}
	name, err := NormalizeName(name)
	if err != nil {
		return Household{}, err
	}
	var h Household
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Household{}).Where("id = ? AND deleted_at IS NULL", householdID).
			Updates(map[string]any{"name": name, "updated_at": s.Now()}).Error; err != nil {
			return err
		}
		return tx.First(&h, "id = ?", householdID).Error
	})
	return h, err
}

// Delete faz a exclusão LÓGICA da casa (somente admin): deleted_at é preenchido, nada é apagado.
// A casa some para todos os membros (Membership e Get a tratam como inexistente) e convites pendentes
// deixam de valer (AcceptWithin confere deleted_at).
func (s *Service) Delete(ctx context.Context, householdID, actor uuid.UUID) error {
	if err := s.requireAdmin(ctx, householdID, actor); err != nil {
		return err
	}
	return s.db.WithContext(ctx).Model(&Household{}).Where("id = ? AND deleted_at IS NULL", householdID).
		Update("deleted_at", s.Now()).Error
}

// lockMembers carrega os membros ATIVOS da casa travando as linhas (SELECT ... FOR UPDATE) até o fim da transação.
// Duas operações simultâneas que poderiam deixar a casa sem admin (ex.: dois admins se rebaixando ao mesmo tempo)
// são serializadas aqui: a segunda só lê depois da primeira confirmar e enxerga o estado novo.
func lockMembers(tx *gorm.DB, householdID uuid.UUID) ([]Member, error) {
	var ms []Member
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("household_id = ? AND left_at IS NULL", householdID).Order("user_id").Find(&ms).Error
	return ms, err
}

func findMember(ms []Member, userID uuid.UUID) *Member {
	for i := range ms {
		if ms[i].UserID == userID {
			return &ms[i]
		}
	}
	return nil
}

func countAdmins(ms []Member) int {
	n := 0
	for _, m := range ms {
		if m.Role == RoleAdmin {
			n++
		}
	}
	return n
}

// revokePendingInvites revoga os convites ainda pendentes criados por quem deixou de ser admin da casa
// (saiu, foi removido ou rebaixado): ele não tem mais o direito de convidar.
func (s *Service) revokePendingInvites(tx *gorm.DB, householdID, createdBy uuid.UUID) error {
	return tx.Model(&Invite{}).
		Where("household_id = ? AND created_by = ? AND used_at IS NULL AND revoked_at IS NULL", householdID, createdBy).
		Update("revoked_at", s.Now()).Error
}

// UpdateMemberRole muda o papel de um membro ativo (somente admin). Nunca deixa a casa sem admin ativo.
func (s *Service) UpdateMemberRole(ctx context.Context, householdID, actor, target uuid.UUID, role Role) (MemberView, error) {
	if !validRole(role) {
		return MemberView{}, validation.New("role", "use admin, member ou viewer")
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		ms, err := lockMembers(tx, householdID)
		if err != nil {
			return err
		}
		a := findMember(ms, actor)
		if a == nil {
			return ErrNotFound
		}
		if a.Role != RoleAdmin {
			return ErrForbidden
		}
		t := findMember(ms, target)
		if t == nil {
			return ErrNotFound
		}
		demoting := t.Role == RoleAdmin && role != RoleAdmin
		if demoting && countAdmins(ms) <= 1 {
			return ErrLastAdmin
		}
		if err := tx.Model(&Member{}).Where("household_id = ? AND user_id = ?", householdID, target).
			Update("role", role).Error; err != nil {
			return err
		}
		if demoting {
			return s.revokePendingInvites(tx, householdID, target)
		}
		return nil
	})
	if err != nil {
		return MemberView{}, err
	}
	members, err := s.ListMembers(ctx, householdID)
	if err != nil {
		return MemberView{}, err
	}
	for _, m := range members {
		if m.UserID == target {
			return m, nil
		}
	}
	return MemberView{}, ErrNotFound
}

// RemoveMember tira um membro da casa: define left_at, NUNCA apaga a linha (invoices antigas apontam para ele).
// Admin remove qualquer um; qualquer membro (inclusive viewer) pode sair (actor == target).
// Nunca deixa a casa sem admin ativo.
func (s *Service) RemoveMember(ctx context.Context, householdID, actor, target uuid.UUID) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		ms, err := lockMembers(tx, householdID)
		if err != nil {
			return err
		}
		a := findMember(ms, actor)
		if a == nil {
			return ErrNotFound
		}
		if actor != target && a.Role != RoleAdmin {
			return ErrForbidden
		}
		t := findMember(ms, target)
		if t == nil {
			return ErrNotFound
		}
		if t.Role == RoleAdmin && countAdmins(ms) <= 1 {
			return ErrLastAdmin
		}
		if err := tx.Model(&Member{}).Where("household_id = ? AND user_id = ? AND left_at IS NULL", householdID, target).
			Update("left_at", s.Now()).Error; err != nil {
			return err
		}
		return s.revokePendingInvites(tx, householdID, target)
	})
}
