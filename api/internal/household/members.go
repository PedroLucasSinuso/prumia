package household

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ListMembers devolve os membros ativos da casa, ordenados por entrada.
func (s *Service) ListMembers(ctx context.Context, householdID uuid.UUID) ([]MemberView, error) {
	type row struct {
		UserID   uuid.UUID
		Name     string
		Email    string
		Role     Role
		JoinedAt time.Time
	}
	var rows []row
	err := s.db.WithContext(ctx).Raw(`
		SELECT m.user_id, u.name, u.email, m.role, m.joined_at
		FROM household_members m
		JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
		WHERE m.household_id = ? AND m.left_at IS NULL
		ORDER BY m.joined_at, u.name`, householdID).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]MemberView, len(rows))
	for i, r := range rows {
		out[i] = MemberView{UserID: r.UserID, Name: r.Name, Email: r.Email, Role: r.Role, JoinedAt: r.JoinedAt.UTC().Format(time.RFC3339)}
	}
	return out, nil
}
