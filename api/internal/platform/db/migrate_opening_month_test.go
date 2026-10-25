package db_test

import (
	"context"
	"testing"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
)

// TestMigracaoMesDeInicioUpDownUpComDados: sobe até a 00009 com uma carteira, aplica a 00011 (a carteira existente fica
// com mês NULL, ou seja, nada muda), confere o CHECK de dia 1, desce (a coluna some, o saldo inicial fica) e sobe de novo.
func TestMigracaoMesDeInicioUpDownUpComDados(t *testing.T) {
	gdb := dbtest.New(t)
	ctx := context.Background()
	sqlDB, _ := gdb.DB()
	gooseTo(t, gdb, 9)
	f := seed(t, gdb)
	var w string
	if err := gdb.Raw(`INSERT INTO wallets (household_id, name, is_default, opening_balance_cents) VALUES (?, 'Geral', true, 12345) RETURNING id::text`, f.houseA).Scan(&w).Error; err != nil || w == "" {
		t.Fatal(err)
	}

	// Só até a 00011 (e não até a última): o Rollback abaixo desfaz exatamente a 00011.
	gooseTo(t, gdb, 11)
	var nulls int
	gdb.Raw(`SELECT count(*) FROM wallets WHERE opening_balance_month IS NULL AND opening_balance_cents = 12345`).Scan(&nulls)
	if nulls != 1 {
		t.Errorf("carteira existente deveria ficar com mês nulo: %d", nulls)
	}
	if err := gdb.Exec(`UPDATE wallets SET opening_balance_month = '2026-10-01' WHERE id = ?`, w).Error; err != nil {
		t.Errorf("dia 1 recusado: %v", err)
	}
	if err := gdb.Exec(`UPDATE wallets SET opening_balance_month = '2026-10-15' WHERE id = ?`, w).Error; err == nil {
		t.Error("dia 15 deveria ser recusado pelo CHECK")
	}

	if err := db.Rollback(ctx, sqlDB); err != nil {
		t.Fatalf("down 00011: %v", err)
	}
	var cols, kept int
	gdb.Raw(`SELECT count(*) FROM information_schema.columns WHERE table_name='wallets' AND column_name='opening_balance_month'`).Scan(&cols)
	gdb.Raw(`SELECT count(*) FROM wallets WHERE id = ? AND opening_balance_cents = 12345`, w).Scan(&kept)
	if cols != 0 || kept != 1 {
		t.Errorf("depois do down: coluna=%d carteira=%d", cols, kept)
	}

	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("up de novo: %v", err)
	}
	gdb.Raw(`SELECT count(*) FROM wallets WHERE opening_balance_month IS NULL`).Scan(&nulls)
	if nulls != 1 {
		t.Errorf("depois do up de novo: %d", nulls)
	}
	if err := gdb.Exec(`UPDATE wallets SET opening_balance_month = '2026-10-02' WHERE id = ?`, w).Error; err == nil {
		t.Error("CHECK deveria voltar")
	}
}
