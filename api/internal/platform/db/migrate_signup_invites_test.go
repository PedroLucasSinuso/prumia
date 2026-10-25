package db_test

import (
	"context"
	"testing"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
)

// TestMigracaoConvitesDeCadastroUpDownUpComDados: sobe até a 00012 com dois usuários, aplica a 00013 (o mais antigo vira
// o dono do sistema), confere as garantias do banco (um dono só, uso único coerente, validade depois da criação), desce
// (tabela e coluna somem, usuários ficam) e sobe de novo.
func TestMigracaoConvitesDeCadastroUpDownUpComDados(t *testing.T) {
	gdb := dbtest.New(t)
	ctx := context.Background()
	sqlDB, _ := gdb.DB()
	gooseTo(t, gdb, 12)
	f := seed(t, gdb) // userA é criado antes de userB
	gdb.Exec(`UPDATE users SET created_at = now() - interval '1 day' WHERE id = ?`, f.userA)

	// Só até a 00013 (e não até a última): o Rollback abaixo desfaz exatamente a 00013.
	gooseTo(t, gdb, 13)
	var owner string
	gdb.Raw(`SELECT id::text FROM users WHERE is_system_owner`).Scan(&owner)
	if owner != f.userA {
		t.Fatalf("o dono do sistema deveria ser o usuário mais antigo: %q (quer %q)", owner, f.userA)
	}
	if err := gdb.Exec(`UPDATE users SET is_system_owner = true WHERE id = ?`, f.userB).Error; err == nil {
		t.Error("o índice único deveria recusar um segundo dono do sistema")
	}
	ins := `INSERT INTO signup_invites (token_hash, created_by, expires_at, used_at, used_by) VALUES (?, ?, now() + interval '1 day', ?, ?)`
	if err := gdb.Exec(ins, []byte("h1"), f.userA, nil, nil).Error; err != nil {
		t.Fatalf("convite válido recusado: %v", err)
	}
	if err := gdb.Exec(ins, []byte("h1"), f.userA, nil, nil).Error; err == nil {
		t.Error("token_hash deveria ser único")
	}
	if err := gdb.Exec(`INSERT INTO signup_invites (token_hash, created_by, expires_at, used_at) VALUES ('h2', ?, now() + interval '1 day', now())`, f.userA).Error; err == nil {
		t.Error("used_at sem used_by deveria ser recusado")
	}
	if err := gdb.Exec(`INSERT INTO signup_invites (token_hash, created_by, created_at, expires_at) VALUES ('h3', ?, now(), now() - interval '1 hour')`, f.userA).Error; err == nil {
		t.Error("validade antes da criação deveria ser recusada")
	}

	if err := db.Rollback(ctx, sqlDB); err != nil {
		t.Fatalf("down 00013: %v", err)
	}
	var tables, cols, users int
	gdb.Raw(`SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='signup_invites'`).Scan(&tables)
	gdb.Raw(`SELECT count(*) FROM information_schema.columns WHERE table_name='users' AND column_name='is_system_owner'`).Scan(&cols)
	gdb.Raw(`SELECT count(*) FROM users WHERE id IN (?, ?)`, f.userA, f.userB).Scan(&users)
	if tables != 0 || cols != 0 || users != 2 {
		t.Errorf("depois do down: tabela=%d coluna=%d usuários=%d", tables, cols, users)
	}

	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("up de novo: %v", err)
	}
	gdb.Raw(`SELECT id::text FROM users WHERE is_system_owner`).Scan(&owner)
	if owner != f.userA {
		t.Errorf("depois do up de novo, dono: %q", owner)
	}
}
