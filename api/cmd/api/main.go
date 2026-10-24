// Comando api: servidor HTTP do prumia.
//
//	api          sobe o servidor (padrão)
//	api migrate  aplica as migrations pendentes e sai
//	api horizon  estende as contas recorrentes e as fontes de receita de todas as casas até o horizonte e sai (job diário, via cron)
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
	_ "time/tzdata" // embute o banco de fusos: imagens mínimas (Alpine) não têm /usr/share/zoneinfo

	"github.com/PedroLucasSinuso/prumia/api/internal/api"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/boleto"
	"github.com/PedroLucasSinuso/prumia/api/internal/brasilapi"
	"github.com/PedroLucasSinuso/prumia/api/internal/calendar"
	"github.com/PedroLucasSinuso/prumia/api/internal/category"
	"github.com/PedroLucasSinuso/prumia/api/internal/household"
	"github.com/PedroLucasSinuso/prumia/api/internal/income"
	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/payee"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/config"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
	"github.com/PedroLucasSinuso/prumia/api/internal/series"
	"github.com/PedroLucasSinuso/prumia/api/internal/summary"
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

	today := func() caldate.Date { return caldate.Today(cfg.Location) }
	invoices := invoice.NewService(gdb, today)
	recurrences := series.NewRecurrenceService(gdb, invoices, today)
	incomes := income.NewService(gdb, today).WithCalendar(calendar.New(cfg.HolidaysURL)) // feriados: BrasilAPI ou cálculo local

	if len(args) > 0 && args[0] == "horizon" {
		if err := recurrences.EnsureHorizonAll(ctx); err != nil {
			return fmt.Errorf("horizonte das recorrências: %w", err)
		}
		if err := incomes.EnsureHorizonAll(ctx); err != nil {
			return fmt.Errorf("horizonte das fontes de receita: %w", err)
		}
		log.Info("horizonte das recorrências e das fontes de receita em dia")
		return nil
	}

	summaries := summary.NewService(gdb, today)
	households := household.NewService(gdb)
	payeeSvc := payee.NewService(gdb)
	cnpjClient := brasilapi.New(cfg.CNPJLookupURL) // nil se CNPJ_LOOKUP_URL=off
	households.MaxPerUser = cfg.MaxHouseholdsPerUser
	authSvc, err := auth.NewService(gdb, households, auth.Config{OpenRegistration: cfg.OpenRegistration, SessionMaxAge: cfg.SessionMaxAge})
	if err != nil {
		return err
	}
	cookie := auth.CookieConfig{Name: "prumia_session", Secure: cfg.IsProduction(), MaxAge: 30 * 24 * time.Hour}

	router := httpx.NewRouter(cfg.IsProduction(), log)
	server := api.NewServer(sqlDB,
		auth.NewHandler(authSvc, cookie, log),
		&api.Households{Svc: households, Log: log},
		&api.Categories{Svc: category.NewService(gdb), Log: log},
		&api.Payees{Svc: payeeSvc, Log: log},
		api.NewCNPJLookups(cnpjClient, log),
		&api.Invoices{Svc: invoices, Log: log, Horizon: recurrences, Balance: summaries},
		&api.Purchases{Svc: series.NewPurchaseService(gdb, invoices), Invoices: invoices, Log: log},
		&api.Recurrences{Svc: recurrences, Log: log},
		&api.Incomes{Svc: incomes, Log: log},
		&api.Summaries{Svc: summaries, Log: log, Horizons: []api.HorizonEnsurer{incomes, recurrences}},
		api.NewBoletos(boleto.NewExtractor(), invoices, payeeSvc, cnpjClient, log),
	)
	api.Mount(router, server, auth.Middleware(authSvc, households, cookie, log))

	if cfg.AutoMigrate {
		if err := db.Migrate(ctx, sqlDB); err != nil {
			return fmt.Errorf("migrations: %w", err)
		}
		log.Info("migrations aplicadas")
	}

	srv := httpx.NewServer(cfg.HTTPAddr, router)

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
