package api

import (
	"context"
	"database/sql"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"testing"
)

func migrate(t *testing.T, sqlDB *sql.DB) error {
	t.Helper()
	return db.Migrate(context.Background(), sqlDB)
}
