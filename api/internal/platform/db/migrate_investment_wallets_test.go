package db_test

import (
	"context"
	"testing"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
)

// TestMigracaoInvestimentosUpDownUpComDados: sobe até a 00014 com duas carteiras, aplica a 00015 (as existentes viram
// 'regular', sem instituição), confere os CHECKs (tipo, instituição, padrão não é investimento), desce (colunas somem,
// carteiras ficam) e sobe de novo.
func TestMigracaoInvestimentosUpDownUpComDados(t *testing.T) {
	gdb := dbtest.New(t)
	ctx := context.Background()
	sqlDB, _ := gdb.DB()
	gooseTo(t, gdb, 14)
	f := seed(t, gdb)
	var geral, outra string
	if err := gdb.Raw(`INSERT INTO wallets (household_id, name, is_default) VALUES (?, 'Geral', true) RETURNING id::text`, f.houseA).Scan(&geral).Error; err != nil || geral == "" {
		t.Fatal(err)
	}
	if err := gdb.Raw(`INSERT INTO wallets (household_id, name) VALUES (?, 'Outra') RETURNING id::text`, f.houseA).Scan(&outra).Error; err != nil || outra == "" {
		t.Fatal(err)
	}

	// Só até a 00015 (e não até a última): o Rollback abaixo desfaz exatamente a 00015.
	gooseTo(t, gdb, 15)
	var regular int
	gdb.Raw(`SELECT count(*) FROM wallets WHERE kind = 'regular' AND institution IS NULL`).Scan(&regular)
	if regular != 2 {
		t.Errorf("carteiras existentes deveriam virar regular sem instituição: %d", regular)
	}
	if err := gdb.Exec(`UPDATE wallets SET kind = 'investment', institution = 'Banco Fictício' WHERE id = ?`, outra).Error; err != nil {
		t.Errorf("investimento recusado: %v", err)
	}
	for name, sql := range map[string]string{
		"tipo desconhecido":        `UPDATE wallets SET kind = 'acoes' WHERE id = '` + outra + `'`,
		"instituição vazia":        `UPDATE wallets SET institution = '' WHERE id = '` + outra + `'`,
		"padrão como investimento": `UPDATE wallets SET kind = 'investment' WHERE id = '` + geral + `'`,
	} {
		if err := gdb.Exec(sql).Error; err == nil {
			t.Errorf("%s deveria ser recusado pelo CHECK", name)
		}
	}

	if err := db.Rollback(ctx, sqlDB); err != nil {
		t.Fatalf("down 00015: %v", err)
	}
	var cols, kept int
	gdb.Raw(`SELECT count(*) FROM information_schema.columns WHERE table_name='wallets' AND column_name IN ('kind', 'institution')`).Scan(&cols)
	gdb.Raw(`SELECT count(*) FROM wallets WHERE household_id = ?`, f.houseA).Scan(&kept)
	if cols != 0 || kept != 2 {
		t.Errorf("depois do down: colunas=%d carteiras=%d", cols, kept)
	}
	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("up de novo: %v", err)
	}
}
