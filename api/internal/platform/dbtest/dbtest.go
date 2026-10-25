// Package dbtest sobe um Postgres real e descartável (Docker) para testes de integração.
// Usamos Postgres de verdade, e não SQLite/mocks, porque as garantias importantes do prumia
// (FKs compostas por casa, CHECKs, índices parciais) só existem no Postgres.
//
// Um único container é compartilhado por todos os testes do pacote (subir um custa ~2 s) e cada teste recebe
// um BANCO novo dentro dele (criar um custa milissegundos): isolamento total, sem o custo de um container por teste.
// NewMigrated vai além: as migrations rodam UMA vez num banco-modelo, e cada teste recebe uma cópia dele
// (CREATE DATABASE ... TEMPLATE), em vez de rodar as 14+ migrations de novo a cada teste.
//
// Sem Docker (ou para ir mais rápido), aponte TEST_DATABASE_URL para um Postgres seu (ex.:
// postgres://prumia@localhost:5432/postgres?sslmode=disable): o usuário precisa poder criar bancos. Os nomes levam o PID do
// processo, porque os pacotes de teste rodam em paralelo contra o mesmo servidor.
package dbtest

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
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

	tmplOnce sync.Once
	tmplErr  error
)

// templateDB é o banco-modelo já migrado. Ninguém fica conectado nele (o Postgres só copia modelo sem conexões).
var templateDB = fmt.Sprintf("t_%d_migrated", os.Getpid())

// migratedTemplate cria e migra o banco-modelo uma vez por processo de teste.
func migratedTemplate(base string) error {
	tmplOnce.Do(func() {
		ctx := context.Background()
		admin, err := sql.Open("pgx", base)
		if err != nil {
			tmplErr = err
			return
		}
		defer admin.Close()                                                          // defer: roda quando a função anônima termina, como um finally
		_, _ = admin.Exec("DROP DATABASE IF EXISTS " + templateDB + " WITH (FORCE)") // sobra de uma execução anterior com o mesmo PID
		if _, err := admin.Exec("CREATE DATABASE " + templateDB); err != nil {
			tmplErr = fmt.Errorf("criando o banco-modelo: %w", err)
			return
		}
		gdb, err := db.Open(ctx, withDatabase(base, templateDB), false)
		if err != nil {
			tmplErr = err
			return
		}
		sqlDB, err := gdb.DB()
		if err != nil {
			tmplErr = err
			return
		}
		defer sqlDB.Close() // fecha o pool: com conexão aberta, o modelo não pode ser copiado
		tmplErr = db.Migrate(ctx, sqlDB)
	})
	return tmplErr
}

// server sobe o container uma vez por processo de teste. Ele é encerrado pelo "reaper" do testcontainers
// (Ryuk) quando o processo termina.
func server() (string, error) {
	once.Do(func() {
		if u := os.Getenv("TEST_DATABASE_URL"); u != "" {
			baseURL = u // Postgres externo: nada de container
			return
		}
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
	return create(t, false)
}

// NewMigrated é o New com o schema já na última migration (cópia do banco-modelo): para testes que não testam as
// migrations em si. Os testes de migration continuam com New (banco vazio) e sobem a versão que precisam.
func NewMigrated(t *testing.T) *gorm.DB {
	t.Helper()
	return create(t, true)
}

func create(t *testing.T, migrated bool) *gorm.DB {
	t.Helper()
	if testing.Short() {
		t.Skip("teste de integração (Docker) pulado com -short")
	}
	if os.Getenv("TEST_DATABASE_URL") == "" {
		testcontainers.SkipIfProviderIsNotHealthy(t)
	}

	base, err := server()
	if err != nil {
		t.Fatalf("subindo postgres: %v", err)
	}
	name := fmt.Sprintf("t_%d_%d", os.Getpid(), counter.Add(1))
	stmt := "CREATE DATABASE " + name
	if migrated {
		if err := migratedTemplate(base); err != nil {
			t.Fatalf("banco-modelo migrado: %v", err)
		}
		stmt += " TEMPLATE " + templateDB
	}

	admin, err := sql.Open("pgx", base)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err := admin.Exec(stmt); err != nil {
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
