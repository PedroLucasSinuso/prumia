package db_test

import (
	"context"
	"testing"

	"github.com/pressly/goose/v3"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
	"github.com/PedroLucasSinuso/prumia/api/migrations"
)

func gooseTo(t *testing.T, gdb *gorm.DB, version int64) {
	t.Helper()
	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := gdb.DB()
	if err := goose.UpToContext(context.Background(), sqlDB, ".", version); err != nil {
		t.Fatalf("up até %d: %v", version, err)
	}
}

// TestMigracaoCarteirasConverteFreeEBenefit: sobe até a 00007 (texto 'free'/'benefit'), cria dados nos dois formatos de
// uso (receitas, fontes, contas pagas, categoria) em duas casas, aplica a 00008 e confere que 'free' virou a carteira
// "Geral" e 'benefit' a "Benefício" DA MESMA CASA; depois desce a 00008 (volta ao texto) e sobe de novo.
func TestMigracaoCarteirasConverteFreeEBenefit(t *testing.T) {
	gdb := dbtest.New(t)
	ctx := context.Background()
	sqlDB, _ := gdb.DB()
	gooseTo(t, gdb, 7)
	f := seed(t, gdb)

	one := func(dst *string, sql string, args ...any) {
		t.Helper()
		if err := gdb.Raw(sql, args...).Scan(dst).Error; err != nil || *dst == "" {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	// casa excluída (soft delete): o backfill cobre todas as linhas de households
	var houseGone string
	one(&houseGone, `INSERT INTO households (name, created_by, deleted_at) VALUES ('Casa Velha', ?, now()) RETURNING id::text`, f.userA)

	insIncome := func(house, user, kind, wallet string) string {
		var id string
		one(&id, `INSERT INTO incomes (household_id, user_id, kind, description, wallet, competence_month, expected_date, gross_amount_cents, created_by)
			VALUES (?, ?, ?, 'x', ?, '2026-10-01', '2026-10-05', 1000, ?) RETURNING id::text`, house, user, kind, wallet, user)
		return id
	}
	incSalA := insIncome(f.houseA, f.userA, "salary", "free")
	incVRA := insIncome(f.houseA, f.userA, "benefit", "benefit")
	incSalB := insIncome(f.houseB, f.userB, "salary", "free")
	var srcVRA string
	one(&srcVRA, `INSERT INTO income_sources (household_id, user_id, kind, name, wallet, gross_amount_cents, day_of_month, date_rule_n, start_month, generated_through, created_by)
		VALUES (?, ?, 'benefit', 'VR', 'benefit', 5000, 5, 5, '2026-09-01', '2026-12-01', ?) RETURNING id::text`, f.houseA, f.userA, f.userA)
	insInvoice := func(house, cat, user string, wallet *string) string {
		var id string
		if wallet == nil {
			one(&id, `INSERT INTO invoices (household_id, category_id, description, amount_cents, due_date, competence_month, created_by)
				VALUES (?, ?, 'pendente', 100, '2026-10-10', '2026-10-01', ?) RETURNING id::text`, house, cat, user)
			return id
		}
		one(&id, `INSERT INTO invoices (household_id, category_id, description, amount_cents, due_date, competence_month, created_by, paid_at, paid_wallet, paid_amount_cents)
			VALUES (?, ?, 'paga', 100, '2026-10-10', '2026-10-01', ?, '2026-10-11', ?, 100) RETURNING id::text`, house, cat, user, *wallet)
		return id
	}
	benefit, free := "benefit", "free"
	invBenA := insInvoice(f.houseA, f.catA, f.userA, &benefit)
	invFreeA := insInvoice(f.houseA, f.catA, f.userA, &free)
	invPendA := insInvoice(f.houseA, f.catA, f.userA, nil)
	invBenB := insInvoice(f.houseB, f.catB, f.userB, &benefit)
	if err := gdb.Exec(`UPDATE categories SET default_wallet = 'benefit' WHERE id = ?`, f.catA).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("up 00008: %v", err)
	}

	walletName := func(table, col, id string) string {
		var n string
		gdb.Raw(`SELECT w.name FROM `+table+` t JOIN wallets w ON w.household_id = t.household_id AND w.id = t.`+col+` WHERE t.id = ?`, id).Scan(&n)
		return n
	}
	// 1) toda casa (inclusive a excluída) ganhou Geral (padrão, sem aviso) e Benefício (com aviso)
	for _, h := range []string{f.houseA, f.houseB, houseGone} {
		var w struct {
			Total, Defaults int
			GeralDefault    bool
			GeralWarns      bool
			BenWarns        bool
		}
		gdb.Raw(`SELECT count(*) AS total, count(*) FILTER (WHERE is_default) AS defaults,
			bool_or(is_default AND name = 'Geral') AS geral_default,
			bool_or(name = 'Geral' AND warn_on_overdraft) AS geral_warns,
			bool_or(name = 'Benefício' AND warn_on_overdraft) AS ben_warns
			FROM wallets WHERE household_id = ?`, h).Scan(&w)
		if w.Total != 2 || w.Defaults != 1 || !w.GeralDefault || w.GeralWarns || !w.BenWarns {
			t.Errorf("carteiras da casa %s: %+v", h, w)
		}
	}
	// 2) 'free' -> Geral, 'benefit' -> Benefício, na carteira da própria casa (a FK composta garante)
	checks := []struct{ what, table, col, id, want string }{
		{"salário A", "incomes", "wallet_id", incSalA, "Geral"},
		{"VR A", "incomes", "wallet_id", incVRA, "Benefício"},
		{"salário B", "incomes", "wallet_id", incSalB, "Geral"},
		{"fonte VR A", "income_sources", "wallet_id", srcVRA, "Benefício"},
		{"conta paga com benefit A", "invoices", "paid_wallet_id", invBenA, "Benefício"},
		{"conta paga com free A", "invoices", "paid_wallet_id", invFreeA, "Geral"},
		{"conta paga com benefit B", "invoices", "paid_wallet_id", invBenB, "Benefício"},
		{"categoria sugerida A", "categories", "default_wallet_id", f.catA, "Benefício"},
	}
	for _, c := range checks {
		if got := walletName(c.table, c.col, c.id); got != c.want {
			t.Errorf("%s: carteira %q, quer %q", c.what, got, c.want)
		}
	}
	var pend *string
	gdb.Raw(`SELECT paid_wallet_id::text FROM invoices WHERE id = ?`, invPendA).Scan(&pend)
	if pend != nil {
		t.Errorf("conta pendente não tem carteira: %v", *pend)
	}
	var catB *string
	gdb.Raw(`SELECT default_wallet_id::text FROM categories WHERE id = ?`, f.catB).Scan(&catB)
	if catB != nil {
		t.Errorf("categoria sem sugestão continua sem: %v", *catB)
	}
	// 3) as colunas de texto e os CHECKs kind/wallet foram embora
	var old int
	gdb.Raw(`SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
		AND ((table_name IN ('incomes', 'income_sources') AND column_name = 'wallet')
		  OR (table_name = 'invoices' AND column_name = 'paid_wallet')
		  OR (table_name = 'categories' AND column_name = 'default_wallet'))`).Scan(&old)
	if old != 0 {
		t.Errorf("sobraram %d colunas de carteira em texto", old)
	}
	// agora VR em qualquer carteira é válido (a coerência kind <-> wallet caiu); depois devolve para o Benefício
	var geralA string
	one(&geralA, `SELECT id::text FROM wallets WHERE household_id = ? AND name = 'Geral'`, f.houseA)
	if err := gdb.Exec(`UPDATE incomes SET wallet_id = ? WHERE id = ?`, geralA, incVRA).Error; err != nil {
		t.Errorf("VR na carteira Geral deveria valer: %v", err)
	}
	gdb.Exec(`UPDATE incomes SET wallet_id = (SELECT id FROM wallets WHERE household_id = ? AND name = 'Benefício') WHERE id = ?`, f.houseA, incVRA)

	// 4) Down da 00008: volta ao texto (benefício pelo NOME da carteira; receitas pelo tipo). Antes, desce a 00009
	// (transferências), que depende de wallets.
	for _, v := range []string{"00009", "00008"} {
		if err := db.Rollback(ctx, sqlDB); err != nil {
			t.Fatalf("down %s: %v", v, err)
		}
	}
	text := func(table, col, id string) string {
		var s *string
		gdb.Raw(`SELECT `+col+` FROM `+table+` WHERE id = ?`, id).Scan(&s)
		if s == nil {
			return "<null>"
		}
		return *s
	}
	back := []struct{ what, table, col, id, want string }{
		{"salário A", "incomes", "wallet", incSalA, "free"},
		{"VR A", "incomes", "wallet", incVRA, "benefit"},
		{"fonte VR A", "income_sources", "wallet", srcVRA, "benefit"},
		{"paga com benefit", "invoices", "paid_wallet", invBenA, "benefit"},
		{"paga com free", "invoices", "paid_wallet", invFreeA, "free"},
		{"pendente", "invoices", "paid_wallet", invPendA, "<null>"},
		{"categoria sugerida A", "categories", "default_wallet", f.catA, "benefit"},
		{"categoria sem sugestão B", "categories", "default_wallet", f.catB, "<null>"},
	}
	for _, c := range back {
		if got := text(c.table, c.col, c.id); got != c.want {
			t.Errorf("down, %s: %q, quer %q", c.what, got, c.want)
		}
	}
	// o CHECK antigo voltou
	if err := gdb.Exec(`UPDATE incomes SET wallet = 'free' WHERE id = ?`, incVRA).Error; err == nil {
		t.Error("depois do down, VR em 'free' deveria ser recusado de novo")
	}

	// 5) Up de novo (agora que as casas já têm... nada: a tabela foi removida e refeita) mantém a conversão
	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("up de novo: %v", err)
	}
	if got := walletName("incomes", "wallet_id", incVRA); got != "Benefício" {
		t.Errorf("depois de subir de novo, VR A: %q", got)
	}
	if got := walletName("invoices", "paid_wallet_id", invFreeA); got != "Geral" {
		t.Errorf("depois de subir de novo, conta paga com free: %q", got)
	}
}

// TestSchemaCarteiras: as garantias da tabela wallets valem no Postgres (uma padrão por casa, nome único entre as
// ativas, padrão não arquivada, FKs compostas por casa).
func TestSchemaCarteiras(t *testing.T) {
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
	mustWork := func(name, sql string, args ...any) {
		t.Helper()
		if err := gdb.Exec(sql, args...).Error; err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
	const ins = `INSERT INTO wallets (household_id, name, is_default, owner_user_id) VALUES (?, ?, ?, ?)`
	mustWork("primeira padrão", ins, f.houseA, "Geral", true, nil)
	mustFail("segunda padrão na mesma casa", ins, f.houseA, "Outra", true, nil)
	mustWork("padrão em outra casa", ins, f.houseB, "Geral", true, nil)
	mustWork("carteira comum", ins, f.houseA, "Benefício", false, f.userA)
	mustFail("nome repetido (sem diferenciar maiúsculas)", ins, f.houseA, "BENEFÍCIO", false, nil)
	mustFail("dono de fora da casa", ins, f.houseA, "Do Beto", false, f.userB)
	mustFail("nome vazio", ins, f.houseA, "", false, nil)
	mustFail("nome com mais de 40 caracteres", ins, f.houseA, "abcdefghijabcdefghijabcdefghijabcdefghija", false, nil)
	mustFail("padrão arquivada", `UPDATE wallets SET archived_at = now() WHERE household_id = ? AND is_default`, f.houseA)
	// arquivada libera o nome para uma nova (o índice só vale entre as ativas)
	mustWork("arquivar comum", `UPDATE wallets SET archived_at = now() WHERE household_id = ? AND name = 'Benefício'`, f.houseA)
	mustWork("nome liberado", ins, f.houseA, "Benefício", false, nil)

	// FK composta: lançamento não aponta para carteira de outra casa
	var walletB, walletA string
	gdb.Raw(`SELECT id::text FROM wallets WHERE household_id = ? AND is_default`, f.houseB).Scan(&walletB)
	gdb.Raw(`SELECT id::text FROM wallets WHERE household_id = ? AND is_default`, f.houseA).Scan(&walletA)
	const insInc = `INSERT INTO incomes (household_id, user_id, kind, description, wallet_id, competence_month, expected_date, gross_amount_cents, created_by)
		VALUES (?, ?, ?, 'x', ?, '2026-10-01', '2026-10-05', 1000, ?)`
	mustFail("receita com carteira de outra casa", insInc, f.houseA, f.userA, "salary", walletB, f.userA)
	mustWork("receita com a própria carteira", insInc, f.houseA, f.userA, "salary", walletA, f.userA)
	mustWork("VR na carteira padrão", insInc, f.houseA, f.userA, "benefit", walletA, f.userA)
	const insInv = `INSERT INTO invoices (household_id, category_id, description, amount_cents, due_date, competence_month, created_by, paid_at, paid_wallet_id, paid_amount_cents)
		VALUES (?, ?, 'x', 100, '2026-10-10', '2026-10-01', ?, '2026-10-11', ?, 100)`
	mustFail("pago com carteira de outra casa", insInv, f.houseA, f.catA, f.userA, walletB)
	mustWork("pago com a própria carteira", insInv, f.houseA, f.catA, f.userA, walletA)
	mustFail("pago sem carteira", `INSERT INTO invoices (household_id, category_id, description, amount_cents, due_date, competence_month, created_by, paid_at, paid_amount_cents)
		VALUES (?, ?, 'x', 100, '2026-10-10', '2026-10-01', ?, '2026-10-11', 100)`, f.houseA, f.catA, f.userA)
	mustFail("categoria sugere carteira de outra casa", `UPDATE categories SET default_wallet_id = ? WHERE id = ?`, walletB, f.catA)
}
