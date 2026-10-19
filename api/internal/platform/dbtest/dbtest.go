// Package dbtest sobe um Postgres real e descartável (Docker) para testes de integração.
// Usamos Postgres de verdade, e não SQLite/mocks, porque as garantias importantes do prumia
// (FKs compostas por casa, CHECKs, índices parciais) só existem no Postgres.
package dbtest

import (
	"context"
	"testing"

	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
)

// New sobe um container novo, devolve uma conexão GORM e o encerra ao fim do teste.
// O teste é PULADO (não falha) com `-short` ou se o Docker não estiver disponível, para `go test ./...` rodar em qualquer máquina.
func New(t *testing.T) *gorm.DB {
	t.Helper()
	if testing.Short() {
		t.Skip("teste de integração (Docker) pulado com -short")
	}
	testcontainers.SkipIfProviderIsNotHealthy(t)

	ctx := context.Background()
	ctr, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("prumia_test"),
		tcpostgres.WithUsername("prumia"),
		tcpostgres.WithPassword("prumia"),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("subindo postgres: %v", err)
	}
	t.Cleanup(func() { _ = testcontainers.TerminateContainer(ctr) })

	url, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	gdb, err := db.Open(ctx, url, false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if sqlDB, err := gdb.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	return gdb
}
