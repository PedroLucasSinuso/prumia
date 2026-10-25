package db_test

import (
	"context"
	"testing"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
)

// TestMigracaoAjustesUpDownUpComDados: sobe até a 00011 com carteiras em duas casas, aplica a 00012 (ajustes de saldo),
// confere as garantias do banco (FK composta, dia 1, diferença diferente de zero), desce (a tabela some, carteiras e
// contas ficam) e sobe de novo.
func TestMigracaoAjustesUpDownUpComDados(t *testing.T) {
	gdb := dbtest.New(t)
	ctx := context.Background()
	sqlDB, _ := gdb.DB()
	gooseTo(t, gdb, 11)
	f := seed(t, gdb)

	one := func(sql string, args ...any) string {
		t.Helper()
		var id string
		if err := gdb.Raw(sql, args...).Scan(&id).Error; err != nil || id == "" {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	geralA := one(`INSERT INTO wallets (household_id, name, is_default, opening_balance_cents) VALUES (?, 'Geral', true, 5000) RETURNING id::text`, f.houseA)
	geralB := one(`INSERT INTO wallets (household_id, name, is_default) VALUES (?, 'Geral', true) RETURNING id::text`, f.houseB)

	// Só até a 00012 (e não até a última): o Rollback abaixo desfaz exatamente a 00012.
	gooseTo(t, gdb, 12)
	ins := `INSERT INTO wallet_adjustments (household_id, wallet_id, competence_month, amount_cents, created_by) VALUES (?, ?, ?, ?, ?)`
	if err := gdb.Exec(ins, f.houseA, geralA, "2026-10-01", -38000, f.userA).Error; err != nil {
		t.Fatalf("ajuste válido recusado: %v", err)
	}
	if err := gdb.Exec(ins, f.houseA, geralA, "2026-10-01", 1200, f.userA).Error; err != nil {
		t.Errorf("ajuste positivo recusado: %v", err)
	}
	if err := gdb.Exec(ins, f.houseA, geralB, "2026-10-01", 100, f.userA).Error; err == nil {
		t.Error("FK composta deveria recusar carteira de outra casa")
	}
	if err := gdb.Exec(ins, f.houseA, geralA, "2026-10-15", 100, f.userA).Error; err == nil {
		t.Error("CHECK deveria recusar mês fora do dia 1")
	}
	if err := gdb.Exec(ins, f.houseA, geralA, "2026-10-01", 0, f.userA).Error; err == nil {
		t.Error("CHECK deveria recusar diferença zero")
	}

	if err := db.Rollback(ctx, sqlDB); err != nil {
		t.Fatalf("down 00012: %v", err)
	}
	var tables, wallets int
	gdb.Raw(`SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='wallet_adjustments'`).Scan(&tables)
	gdb.Raw(`SELECT count(*) FROM wallets WHERE id IN (?, ?)`, geralA, geralB).Scan(&wallets)
	if tables != 0 || wallets != 2 {
		t.Errorf("depois do down: tabela=%d carteiras=%d", tables, wallets)
	}

	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("up de novo: %v", err)
	}
	if err := gdb.Exec(ins, f.houseA, geralA, "2026-11-01", 500, f.userA).Error; err != nil {
		t.Errorf("depois do up de novo: %v", err)
	}
}
