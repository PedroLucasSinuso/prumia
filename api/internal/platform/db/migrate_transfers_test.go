package db_test

import (
	"context"
	"testing"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
)

// TestMigracaoTransferenciasUpDownUpComDados: sobe até a 00008 com dados (duas casas, carteiras, uma conta paga), aplica a
// 00009 e confere as garantias da tabela wallet_transfers; o Down remove só a tabela (os dados antigos ficam) e o Up
// seguinte recria a tabela vazia.
func TestMigracaoTransferenciasUpDownUpComDados(t *testing.T) {
	gdb := dbtest.New(t)
	ctx := context.Background()
	sqlDB, _ := gdb.DB()
	gooseTo(t, gdb, 8)
	f := seed(t, gdb)

	one := func(sql string, args ...any) string {
		t.Helper()
		var id string
		if err := gdb.Raw(sql, args...).Scan(&id).Error; err != nil || id == "" {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	wallet := func(house, name string, def bool) string {
		return one(`INSERT INTO wallets (household_id, name, is_default) VALUES (?, ?, ?) RETURNING id::text`, house, name, def)
	}
	geralA, reservaA := wallet(f.houseA, "Geral", true), wallet(f.houseA, "Reserva", false)
	geralB := wallet(f.houseB, "Geral", true)
	inv := one(`INSERT INTO invoices (household_id, category_id, description, amount_cents, due_date, competence_month, created_by, paid_at, paid_wallet_id, paid_amount_cents)
		VALUES (?, ?, 'paga', 100, '2026-10-10', '2026-10-01', ?, '2026-10-11', ?, 100) RETURNING id::text`, f.houseA, f.catA, f.userA, geralA)

	// Só até a 00009 (e não até a última): o Rollback abaixo desfaz exatamente a 00009.
	gooseTo(t, gdb, 9)
	ins := `INSERT INTO wallet_transfers (household_id, from_wallet_id, to_wallet_id, amount_cents, transfer_date, competence_month, created_by)
		VALUES (?, ?, ?, ?, '2026-10-12', ?, ?)`
	if err := gdb.Exec(ins, f.houseA, geralA, reservaA, 5000, "2026-10-01", f.userA).Error; err != nil {
		t.Fatalf("transferência válida recusada: %v", err)
	}
	mustFail := func(name string, args ...any) {
		t.Helper()
		if err := gdb.Exec(ins, args...).Error; err == nil {
			t.Errorf("%s: deveria ter sido recusado pelo banco", name)
		}
	}
	mustFail("mesma carteira", f.houseA, geralA, geralA, 5000, "2026-10-01", f.userA)
	mustFail("valor zero", f.houseA, geralA, reservaA, 0, "2026-10-01", f.userA)
	mustFail("valor negativo", f.houseA, geralA, reservaA, -1, "2026-10-01", f.userA)
	mustFail("competência fora do dia 1", f.houseA, geralA, reservaA, 5000, "2026-10-15", f.userA)
	mustFail("destino de outra casa", f.houseA, geralA, geralB, 5000, "2026-10-01", f.userA)
	mustFail("origem de outra casa", f.houseA, geralB, reservaA, 5000, "2026-10-01", f.userA)

	// Down: remove a tabela e preserva o resto
	if err := db.Rollback(ctx, sqlDB); err != nil { // estamos na 00009 (gooseTo acima): desce exatamente ela
		t.Fatalf("down 00009: %v", err)
	}
	var tables, wallets, paid int
	gdb.Raw(`SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='wallet_transfers'`).Scan(&tables)
	gdb.Raw(`SELECT count(*) FROM wallets`).Scan(&wallets)
	gdb.Raw(`SELECT count(*) FROM invoices WHERE id = ? AND paid_wallet_id = ?`, inv, geralA).Scan(&paid)
	if tables != 0 || wallets != 3 || paid != 1 {
		t.Errorf("depois do down: tabela=%d carteiras=%d conta paga=%d", tables, wallets, paid)
	}

	// Up de novo: tabela vazia, garantias de volta
	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("up de novo: %v", err)
	}
	var n int
	gdb.Raw(`SELECT count(*) FROM wallet_transfers`).Scan(&n)
	if n != 0 {
		t.Errorf("tabela deveria voltar vazia: %d", n)
	}
	if err := gdb.Exec(ins, f.houseA, geralA, reservaA, 700, "2026-10-01", f.userA).Error; err != nil {
		t.Errorf("transferência depois do up de novo: %v", err)
	}
	mustFail("mesma carteira (depois do up de novo)", f.houseA, geralA, geralA, 5000, "2026-10-01", f.userA)
}
