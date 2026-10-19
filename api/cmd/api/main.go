// Comando api: servidor HTTP do prumia.
//
//	api          sobe o servidor (padrão)
//	api migrate  aplica as migrations pendentes e sai
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/config"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
)

func main() {
	// run devolve erro em vez de chamar os.Exit lá no fundo: assim os `defer` rodam e o main decide o código de saída.
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "erro:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("configuração: %w", err)
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	// Cancela o contexto ao receber Ctrl+C ou SIGTERM (docker stop): base do desligamento limpo.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	gdb, err := db.Open(ctx, cfg.DatabaseURL, !cfg.IsProduction())
	if err != nil {
		return err
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		return err
	}
	defer sqlDB.Close()

	if len(args) > 0 && args[0] == "migrate" {
		if err := db.Migrate(ctx, sqlDB); err != nil {
			return fmt.Errorf("migrations: %w", err)
		}
		log.Info("migrations aplicadas")
		return nil
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httpx.NewRouter(cfg.IsProduction(), sqlDB, log),
		ReadHeaderTimeout: 5 * time.Second,
	}

	// ListenAndServe bloqueia; roda numa goroutine (thread leve) para podermos esperar o sinal de parada.
	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	log.Info("servidor no ar", "addr", cfg.HTTPAddr, "env", cfg.Env)

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		log.Info("desligando...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx) // termina as requisições em andamento
	}
	return nil
}
