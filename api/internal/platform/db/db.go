// Package db abre a conexão com o Postgres (via GORM) e aplica as migrations (via goose).
package db

import (
	"context"
	"database/sql"
	"fmt"
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
	level := logger.Warn
	if verbose {
		level = logger.Info // mostra o SQL gerado: ótimo para achar N+1 em desenvolvimento
	}
	gdb, err := gorm.Open(postgres.Open(url), &gorm.Config{
		Logger:         logger.Default.LogMode(level),
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
