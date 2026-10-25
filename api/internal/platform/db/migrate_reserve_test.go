package db_test

import (
	"context"
	"testing"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
)

// TestMigracaoReservaUpDownUpComDados: sobe até a 00013 com uma casa e uma carteira, aplica a 00014 (nada muda: meta
// nula e carteira fora da reserva), confere o CHECK de 1 a 36 meses, desce (colunas somem, casa e carteira ficam) e sobe.
func TestMigracaoReservaUpDownUpComDados(t *testing.T) {
	gdb := dbtest.New(t)
	ctx := context.Background()
	sqlDB, _ := gdb.DB()
	gooseTo(t, gdb, 13)
	f := seed(t, gdb)
	var w string
	if err := gdb.Raw(`INSERT INTO wallets (household_id, name, is_default) VALUES (?, 'Geral', true) RETURNING id::text`, f.houseA).Scan(&w).Error; err != nil || w == "" {
		t.Fatal(err)
	}

	// Só até a 00014 (e não até a última): o Rollback abaixo desfaz exatamente a 00014.
	gooseTo(t, gdb, 14)
	var nulls, off int
	gdb.Raw(`SELECT count(*) FROM households WHERE reserve_target_months IS NULL`).Scan(&nulls)
	gdb.Raw(`SELECT count(*) FROM wallets WHERE NOT counts_as_reserve`).Scan(&off)
	if nulls != 2 || off != 1 {
		t.Errorf("dados existentes deveriam ficar sem meta: casas=%d carteiras=%d", nulls, off)
	}
	if err := gdb.Exec(`UPDATE households SET reserve_target_months = 6 WHERE id = ?`, f.houseA).Error; err != nil {
		t.Errorf("6 meses recusado: %v", err)
	}
	for _, m := range []int{0, 37} {
		if err := gdb.Exec(`UPDATE households SET reserve_target_months = ? WHERE id = ?`, m, f.houseA).Error; err == nil {
			t.Errorf("%d meses deveria ser recusado pelo CHECK", m)
		}
	}

	if err := db.Rollback(ctx, sqlDB); err != nil {
		t.Fatalf("down 00014: %v", err)
	}
	var cols, kept int
	gdb.Raw(`SELECT count(*) FROM information_schema.columns WHERE (table_name='households' AND column_name='reserve_target_months')
		OR (table_name='wallets' AND column_name='counts_as_reserve')`).Scan(&cols)
	gdb.Raw(`SELECT count(*) FROM wallets WHERE id = ?`, w).Scan(&kept)
	if cols != 0 || kept != 1 {
		t.Errorf("depois do down: colunas=%d carteira=%d", cols, kept)
	}
	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("up de novo: %v", err)
	}
}
