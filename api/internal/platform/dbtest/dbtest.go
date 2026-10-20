// Package dbtest sobe um Postgres real e descartável (Docker) para testes de integração.
// Usamos Postgres de verdade, e não SQLite/mocks, porque as garantias importantes do prumia
// (FKs compostas por casa, CHECKs, índices parciais) só existem no Postgres.
//
// Um único container é compartilhado por todos os testes do pacote (subir um custa ~2 s) e cada teste recebe
// um BANCO novo dentro dele (criar um custa milissegundos): isolamento total, sem o custo de um container por teste.
package dbtest

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
)

var (
	once     sync.Once
	baseURL  string // URL do servidor (banco "postgres" de manutenção)
	startErr error
	counter  atomic.Int64
)

// server sobe o container uma vez por processo de teste. Ele é encerrado pelo "reaper" do testcontainers
// (Ryuk) quando o processo termina.
func server() (string, error) {
	once.Do(func() {
		ctx := context.Background()
		ctr, err := tcpostgres.Run(ctx, "postgres:16-alpine",
			tcpostgres.WithDatabase("postgres"),
			tcpostgres.WithUsername("prumia"),
			tcpostgres.WithPassword("prumia"),
			tcpostgres.BasicWaitStrategies(),
		)
		if err != nil {
			startErr = err
			return
		}
		baseURL, startErr = ctr.ConnectionString(ctx, "sslmode=disable")
	})
	return baseURL, startErr
}

// withDatabase troca o nome do banco na URL de conexão.
func withDatabase(raw, name string) string {
	u, _ := url.Parse(raw)
	u.Path = "/" + name
	return u.String()
}

// New devolve uma conexão GORM com um banco vazio e exclusivo deste teste (removido ao final).
// O teste é PULADO (não falha) com `-short` ou se o Docker não estiver disponível, para `go test ./...`
// rodar em qualquer máquina.
func New(t *testing.T) *gorm.DB {
	t.Helper()
	if testing.Short() {
		t.Skip("teste de integração (Docker) pulado com -short")
	}
	testcontainers.SkipIfProviderIsNotHealthy(t)

	base, err := server()
	if err != nil {
		t.Fatalf("subindo postgres: %v", err)
	}
	name := fmt.Sprintf("t_%d", counter.Add(1))

	admin, err := sql.Open("pgx", base)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err := admin.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatalf("criando banco de teste: %v", err)
	}

	gdb, err := db.Open(context.Background(), withDatabase(base, name), false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if sqlDB, err := gdb.DB(); err == nil {
			_ = sqlDB.Close()
		}
		if a, err := sql.Open("pgx", base); err == nil {
			_, _ = a.Exec("DROP DATABASE IF EXISTS " + name + " WITH (FORCE)")
			_ = a.Close()
		}
	})
	return gdb
}
