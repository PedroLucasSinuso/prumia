package db_test

import (
	"context"
	"fmt"
	"io/fs"
	"testing"

	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
	"github.com/PedroLucasSinuso/prumia/api/migrations"
)

// TestMigrationUpDownUp garante que a migration inicial aplica, reverte e reaplica sem erro,
// e que as principais garantias do schema valem de verdade no Postgres.
func TestMigrationUpDownUp(t *testing.T) {
	gdb := dbtest.New(t)
	ctx := context.Background()
	sqlDB, err := gdb.DB()
	if err != nil {
		t.Fatal(err)
	}

	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("up: %v", err)
	}
	// Rollback desfaz UMA migration: desce todas, da mais nova para a mais antiga.
	files, _ := fs.Glob(migrations.FS, "*.sql")
	for range files {
		if err := db.Rollback(ctx, sqlDB); err != nil {
			t.Fatalf("down: %v", err)
		}
	}
	var tables int
	gdb.Raw(`SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='invoices'`).Scan(&tables)
	if tables != 0 {
		t.Fatal("down deveria remover as tabelas")
	}
	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("up de novo: %v", err)
	}
}

// TestSchemaGarantias exercita as regras que o banco precisa impor sozinho.
func TestSchemaGarantias(t *testing.T) {
	gdb := dbtest.New(t)
	ctx := context.Background()
	sqlDB, _ := gdb.DB()
	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatal(err)
	}
	f := seed(t, gdb)

	mustFail := func(name, sql string, args ...any) {
		t.Helper()
		if err := gdb.Exec(sql, args...).Error; err == nil {
			t.Errorf("%s: deveria ter sido recusado pelo banco", name)
		}
	}
	const insert = `INSERT INTO invoices (household_id, category_id, responsible_user_id, description, amount_cents, due_date, competence_month, created_by %s)
		VALUES (?, ?, ?, 'x', ?, '2026-10-10', ?, ? %s)`
	ins := func(extraCols, extraVals string) string { return fmt.Sprintf(insert, extraCols, extraVals) }

	// válido: sanidade
	if err := gdb.Exec(ins("", ""), f.houseA, f.catA, f.userA, 1000, "2026-10-01", f.userA).Error; err != nil {
		t.Fatalf("invoice válida recusada: %v", err)
	}
	mustFail("categoria de outra casa", ins("", ""), f.houseA, f.catB, f.userA, 1000, "2026-10-01", f.userA)
	mustFail("responsável de fora da casa", ins("", ""), f.houseA, f.catA, f.userB, 1000, "2026-10-01", f.userA)
	mustFail("valor zero", ins("", ""), f.houseA, f.catA, f.userA, 0, "2026-10-01", f.userA)
	mustFail("competência fora do dia 1", ins("", ""), f.houseA, f.catA, f.userA, 1000, "2026-10-15", f.userA)
	mustFail("pago sem carteira", ins(", paid_at", ", '2026-10-11'"), f.houseA, f.catA, f.userA, 1000, "2026-10-01", f.userA)
	mustFail("categoria duplicada (case-insensitive)",
		`INSERT INTO categories (household_id, name) VALUES (?, 'MERCADO')`, f.houseA)
}

type fixture struct{ houseA, houseB, userA, userB, catA, catB string }

// seed cria duas casas, cada uma com um usuário e uma categoria "Mercado".
func seed(t *testing.T, gdb *gorm.DB) fixture {
	t.Helper()
	var f fixture
	one := func(dst *string, sql string, args ...any) {
		if err := gdb.Raw(sql, args...).Scan(dst).Error; err != nil || *dst == "" {
			t.Fatalf("seed: %v", err)
		}
	}
	one(&f.userA, `INSERT INTO users (email, name, password_hash) VALUES ('a@x.com','A','h') RETURNING id::text`)
	one(&f.userB, `INSERT INTO users (email, name, password_hash) VALUES ('b@x.com','B','h') RETURNING id::text`)
	one(&f.houseA, `INSERT INTO households (name, created_by) VALUES ('Casa A', ?) RETURNING id::text`, f.userA)
	one(&f.houseB, `INSERT INTO households (name, created_by) VALUES ('Casa B', ?) RETURNING id::text`, f.userB)
	gdb.Exec(`INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'admin')`, f.houseA, f.userA)
	gdb.Exec(`INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'admin')`, f.houseB, f.userB)
	one(&f.catA, `INSERT INTO categories (household_id, name) VALUES (?, 'Mercado') RETURNING id::text`, f.houseA)
	one(&f.catB, `INSERT INTO categories (household_id, name) VALUES (?, 'Mercado') RETURNING id::text`, f.houseB)
	return f
}
