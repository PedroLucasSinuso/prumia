package db_test

import (
	"context"
	"testing"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
)

// TestMigracaoPushUpDownUpComDados: sobe até a 00015 com usuários e casas, aplica a 00016 (tabelas novas, nada existente
// muda), confere as regras do schema (endpoint https e único, assinatura some com a sessão), desce e sobe de novo.
func TestMigracaoPushUpDownUpComDados(t *testing.T) {
	gdb := dbtest.New(t)
	ctx := context.Background()
	sqlDB, _ := gdb.DB()
	gooseTo(t, gdb, 15)
	f := seed(t, gdb)

	// Só até a 00016 (e não até a última): o Rollback abaixo desfaz exatamente a 00016.
	gooseTo(t, gdb, 16)
	if err := gdb.Exec(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('\x01', ?, now() + interval '1 day')`, f.userA).Error; err != nil {
		t.Fatal(err)
	}
	ins := func(endpoint string) error {
		return gdb.Exec(`INSERT INTO push_subscriptions (user_id, session_hash, endpoint, p256dh, auth) VALUES (?, '\x01', ?, 'k', 'a')`, f.userA, endpoint).Error
	}
	if err := ins("https://push.exemplo.test/a"); err != nil {
		t.Fatalf("assinatura válida recusada: %v", err)
	}
	if err := ins("https://push.exemplo.test/a"); err == nil {
		t.Error("endpoint repetido deveria ser recusado (UNIQUE)")
	}
	if err := ins("http://push.exemplo.test/b"); err == nil {
		t.Error("endpoint sem https deveria ser recusado (CHECK)")
	}
	if err := gdb.Exec(`INSERT INTO push_digests (user_id, household_id, day) VALUES (?, ?, '2026-10-18')`, f.userA, f.houseA).Error; err != nil {
		t.Fatalf("registro de aviso recusado: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO push_digests (user_id, household_id, day) VALUES (?, ?, '2026-10-18')`, f.userA, f.houseA).Error; err == nil {
		t.Error("segundo aviso no mesmo dia deveria ser recusado (PK)")
	}
	// Sessão apagada (logout) leva a assinatura junto.
	gdb.Exec(`DELETE FROM sessions WHERE token_hash = '\x01'`)
	var subs int
	gdb.Raw(`SELECT count(*) FROM push_subscriptions`).Scan(&subs)
	if subs != 0 {
		t.Errorf("assinatura deveria sumir com a sessão: %d", subs)
	}

	if err := db.Rollback(ctx, sqlDB); err != nil {
		t.Fatalf("down 00016: %v", err)
	}
	var tables, users int
	gdb.Raw(`SELECT count(*) FROM information_schema.tables WHERE table_name IN ('push_subscriptions', 'push_digests')`).Scan(&tables)
	gdb.Raw(`SELECT count(*) FROM users`).Scan(&users)
	if tables != 0 || users != 2 {
		t.Errorf("depois do down: tabelas=%d usuários=%d", tables, users)
	}
	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("up de novo: %v", err)
	}
}
