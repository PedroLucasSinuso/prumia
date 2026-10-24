package db_test

import (
	"context"
	"testing"

	"github.com/pressly/goose/v3"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
	"github.com/PedroLucasSinuso/prumia/api/migrations"
)

// TestMigracaoReceitasV2PreservaDadosAntigos: as fontes e receitas criadas ANTES da migration 00007 continuam iguais
// (valor fixo, "dia N do mês", sem ajuste de fim de semana), sem ação do usuário; as novas colunas nascem com o padrão.
func TestMigracaoReceitasV2PreservaDadosAntigos(t *testing.T) {
	gdb := dbtest.New(t)
	ctx := context.Background()
	sqlDB, _ := gdb.DB()

	// Sobe só até a 00006 (o estado de um banco já em uso antes desta versão).
	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err := goose.UpToContext(ctx, sqlDB, ".", 6); err != nil {
		t.Fatalf("up até 6: %v", err)
	}
	f := seed(t, gdb)
	var src, inc string
	err := gdb.Raw(`INSERT INTO income_sources (household_id, user_id, kind, name, wallet, gross_amount_cents, day_of_month, start_month, generated_through, created_by)
		VALUES (?, ?, 'salary', 'Salário', 'free', 500000, 28, '2026-09-01', '2026-12-01', ?) RETURNING id::text`, f.houseA, f.userA, f.userA).Scan(&src).Error
	if err != nil {
		t.Fatal(err)
	}
	err = gdb.Raw(`INSERT INTO incomes (household_id, source_id, user_id, kind, description, wallet, competence_month, expected_date, gross_amount_cents, created_by)
		VALUES (?, ?, ?, 'salary', 'Salário', 'free', '2026-11-01', '2026-11-28', 500000, ?) RETURNING id::text`, f.houseA, src, f.userA, f.userA).Scan(&inc).Error
	if err != nil {
		t.Fatal(err)
	}

	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("up 00007: %v", err)
	}
	var s struct {
		AmountMode, DateRule, WeekendAdjust string
		DateRuleN                           int
		UnitPriceCents                      *int64
	}
	gdb.Raw(`SELECT amount_mode, date_rule, weekend_adjust, date_rule_n, unit_price_cents FROM income_sources WHERE id = ?`, src).Scan(&s)
	if s.AmountMode != "fixed" || s.DateRule != "day_of_month" || s.DateRuleN != 28 || s.WeekendAdjust != "none" || s.UnitPriceCents != nil {
		t.Errorf("fonte antiga: %+v", s)
	}
	var i struct {
		DateRule, WeekendAdjust string
		DateRuleN               int
		Quantity                *int
		HeldAt                  *string
	}
	gdb.Raw(`SELECT date_rule, weekend_adjust, date_rule_n, quantity, held_at::text AS held_at FROM incomes WHERE id = ?`, inc).Scan(&i)
	if i.DateRule != "day_of_month" || i.DateRuleN != 28 || i.WeekendAdjust != "none" || i.Quantity != nil || i.HeldAt != nil {
		t.Errorf("receita antiga: %+v", i)
	}
	// fonte nova (inserida depois): o padrão da coluna é o ajuste "forward"
	var adj string
	gdb.Raw(`INSERT INTO income_sources (household_id, user_id, kind, name, wallet, gross_amount_cents, day_of_month, date_rule_n, start_month, generated_through, created_by)
		VALUES (?, ?, 'salary', 'Novo', 'free', 100, 5, 5, '2026-09-01', '2026-12-01', ?) RETURNING weekend_adjust`, f.houseA, f.userA, f.userA).Scan(&adj)
	if adj != "forward" {
		t.Errorf("fonte nova deveria nascer com forward: %q", adj)
	}
	// as regras do banco: por unidade exige preço; dia útil fora de 1..23 é recusado
	if err := gdb.Exec(`UPDATE income_sources SET amount_mode = 'per_unit' WHERE id = ?`, src).Error; err == nil {
		t.Error("per_unit sem preço deveria ser recusado")
	}
	if err := gdb.Exec(`UPDATE income_sources SET date_rule = 'nth_business_day', date_rule_n = 24 WHERE id = ?`, src).Error; err == nil {
		t.Error("24º dia útil deveria ser recusado")
	}
}
