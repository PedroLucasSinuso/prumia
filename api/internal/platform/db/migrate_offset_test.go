package db_test

import (
	"context"
	"testing"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
)

// TestMigracaoMesDaRegraUpDownUpComDados: sobe até a 00009 com uma fonte e um lançamento, aplica a 00010 e confere o
// backfill (tudo em 0 = mês da competência) e o CHECK (só -1 ou 0); o Down remove só as colunas e o Up seguinte devolve
// o padrão 0.
func TestMigracaoMesDaRegraUpDownUpComDados(t *testing.T) {
	gdb := dbtest.New(t)
	ctx := context.Background()
	sqlDB, _ := gdb.DB()
	gooseTo(t, gdb, 9)
	f := seed(t, gdb)

	one := func(sql string, args ...any) string {
		t.Helper()
		var id string
		if err := gdb.Raw(sql, args...).Scan(&id).Error; err != nil || id == "" {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	wal := one(`INSERT INTO wallets (household_id, name, is_default) VALUES (?, 'Geral', true) RETURNING id::text`, f.houseA)
	src := one(`INSERT INTO income_sources (household_id, user_id, kind, name, wallet_id, gross_amount_cents, day_of_month, start_month, generated_through, created_by)
		VALUES (?, ?, 'salary', 'Salário', ?, 500000, 5, '2026-09-01', '2026-12-01', ?) RETURNING id::text`, f.houseA, f.userA, wal, f.userA)
	inc := one(`INSERT INTO incomes (household_id, source_id, user_id, kind, description, wallet_id, competence_month, expected_date, gross_amount_cents, created_by)
		VALUES (?, ?, ?, 'salary', 'Salário', ?, '2026-11-01', '2026-11-05', 500000, ?) RETURNING id::text`, f.houseA, src, f.userA, wal, f.userA)

	gooseTo(t, gdb, 10) // só até a 00010: o Rollback abaixo desfaz exatamente ela (a 00011 ainda não foi aplicada)
	offsets := func() (int, int) {
		var s, i int
		gdb.Raw(`SELECT date_rule_offset FROM income_sources WHERE id = ?`, src).Scan(&s)
		gdb.Raw(`SELECT date_rule_offset FROM incomes WHERE id = ?`, inc).Scan(&i)
		return s, i
	}
	if s, i := offsets(); s != 0 || i != 0 {
		t.Errorf("backfill: fonte=%d lançamento=%d, quer 0 e 0 (nada muda para quem já tem dados)", s, i)
	}
	if err := gdb.Exec(`UPDATE income_sources SET date_rule_offset = -1 WHERE id = ?`, src).Error; err != nil {
		t.Errorf("-1 deveria valer: %v", err)
	}
	if err := gdb.Exec(`UPDATE incomes SET date_rule_offset = -1 WHERE id = ?`, inc).Error; err != nil {
		t.Errorf("-1 deveria valer: %v", err)
	}
	for _, v := range []int{1, -2} {
		if err := gdb.Exec(`UPDATE income_sources SET date_rule_offset = ? WHERE id = ?`, v, src).Error; err == nil {
			t.Errorf("fonte com offset %d deveria ser recusada pelo banco", v)
		}
		if err := gdb.Exec(`UPDATE incomes SET date_rule_offset = ? WHERE id = ?`, v, inc).Error; err == nil {
			t.Errorf("lançamento com offset %d deveria ser recusado pelo banco", v)
		}
	}

	// Down: só as colunas somem; os dados continuam
	if err := db.Rollback(ctx, sqlDB); err != nil {
		t.Fatalf("down 00010: %v", err)
	}
	var cols, rows int
	gdb.Raw(`SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name='date_rule_offset'`).Scan(&cols)
	gdb.Raw(`SELECT count(*) FROM incomes WHERE id = ? AND expected_date = '2026-11-05'`, inc).Scan(&rows)
	if cols != 0 || rows != 1 {
		t.Errorf("depois do down: colunas=%d lançamento=%d", cols, rows)
	}

	// Up de novo: as linhas antigas voltam com o padrão 0
	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("up de novo: %v", err)
	}
	if s, i := offsets(); s != 0 || i != 0 {
		t.Errorf("depois do up de novo: fonte=%d lançamento=%d, quer 0 e 0", s, i)
	}
}
