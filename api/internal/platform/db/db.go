// Package db abre a conexão com o Postgres (via GORM) e aplica as migrations (via goose).
package db

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"log"
	"os"
	"time"

	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/PedroLucasSinuso/prumia/api/migrations"
)

// Open conecta e confirma que o banco responde. Note que NÃO há AutoMigrate: o schema só muda
// por migrations versionadas (ver Migrate). É regra do projeto.
func Open(ctx context.Context, url string, verbose bool) (*gorm.DB, error) {
	gdb, err := gorm.Open(postgres.Open(url), &gorm.Config{
		Logger:         NewLogger(os.Stdout, verbose),
		NowFunc:        func() time.Time { return time.Now().UTC() },
		TranslateError: true, // traduz erros do driver para gorm.ErrDuplicatedKey etc.
	})
	if err != nil {
		return nil, fmt.Errorf("abrindo conexão: %w", err)
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		return nil, fmt.Errorf("obtendo pool: %w", err)
	}
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("banco não respondeu: %w", err)
	}
	return gdb, nil
}

// Armadilha do GORM: `Scan` (usado com `Raw`) loga por um "gravador" à parte, que ignora ParameterizedQueries e
// interpola os valores. Esta variável do pacote existe para ser trocada; aqui, sem valores, igual ao resto.
// (init roda uma vez, quando o pacote é carregado: como um bootstrap estático.)
func init() {
	logger.RecorderParamsFilter = func(_ context.Context, sql string, _ ...any) (string, []any) { return sql, nil }
}

// NewLogger é o log de SQL do GORM. verbose (desenvolvimento) mostra toda consulta, ótimo para achar N+1; sem ele,
// só erros e consultas lentas (> 200 ms).
//
// ParameterizedQueries: o SQL vai para o log com `$1, $2` e SEM os valores. O padrão do GORM é interpolar os valores,
// o que despejava no log e-mails, hashes de senha e de token, linhas digitáveis e valores de contas.
// IgnoreRecordNotFoundError: "não encontrado" é fluxo normal (login com e-mail errado, 404), não erro.
func NewLogger(w io.Writer, verbose bool) logger.Interface {
	level := logger.Warn
	if verbose {
		level = logger.Info
	}
	return logger.New(log.New(w, "\r\n", log.LstdFlags), logger.Config{
		SlowThreshold:             200 * time.Millisecond,
		LogLevel:                  level,
		IgnoreRecordNotFoundError: true,
		ParameterizedQueries:      true,
	})
}

// Migrate aplica todas as migrations pendentes (goose up).
func Migrate(ctx context.Context, sqlDB *sql.DB) error {
	return withGoose(func() error { return goose.UpContext(ctx, sqlDB, ".") })
}

// Rollback desfaz a última migration (goose down). Usado em testes e manutenção.
func Rollback(ctx context.Context, sqlDB *sql.DB) error {
	return withGoose(func() error { return goose.DownContext(ctx, sqlDB, ".") })
}

// withGoose configura o goose (que usa estado global) para ler as migrations embutidas.
func withGoose(fn func() error) error {
	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return fn()
}
