// Comando api: servidor HTTP do prumia.
//
//	api          sobe o servidor (padrão)
//	api migrate  aplica as migrations pendentes e sai
//	api push-keys  gera um par de chaves VAPID para os avisos por Web Push e sai (não precisa de banco)
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

	"github.com/PedroLucasSinuso/prumia/api/internal/adjustment"
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
	"github.com/PedroLucasSinuso/prumia/api/internal/push"
	"github.com/PedroLucasSinuso/prumia/api/internal/rates"
	"github.com/PedroLucasSinuso/prumia/api/internal/reserve"
	"github.com/PedroLucasSinuso/prumia/api/internal/series"
	"github.com/PedroLucasSinuso/prumia/api/internal/summary"
	"github.com/PedroLucasSinuso/prumia/api/internal/transfer"
	"github.com/PedroLucasSinuso/prumia/api/internal/wallet"
)

func main() {
	// run devolve erro em vez de chamar os.Exit lá no fundo: assim os `defer` rodam e o main decide o código de saída.
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "erro:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	// Antes da configuração: gerar chaves não precisa de banco nem de .env.
	if len(args) > 0 && args[0] == "push-keys" {
		private, public, err := push.GenerateKeys()
		if err != nil {
			return fmt.Errorf("gerando chaves VAPID: %w", err)
		}
		fmt.Printf("VAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\n", public, private)
		return nil
	}

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
		auth.NewHandler(authSvc, cookie, log).WithPublicURL(cfg.PublicURL),
		&api.Households{Svc: households, Log: log},
		&api.Categories{Svc: category.NewService(gdb), Log: log},
		&api.Payees{Svc: payeeSvc, Log: log},
		&api.Wallets{Svc: wallet.NewService(gdb), Log: log},
		&api.Transfers{Svc: transfer.NewService(gdb, today), Log: log, Balance: summaries},
		&api.Adjustments{Svc: adjustment.NewService(gdb, summaries, today), Log: log},
		&api.Reserves{Svc: reserve.NewService(gdb, summaries), Log: log, Today: today},
		api.NewCNPJLookups(cnpjClient, log),
		&api.Invoices{Svc: invoices, Log: log, Horizon: recurrences, Balance: summaries},
		&api.Purchases{Svc: series.NewPurchaseService(gdb, invoices), Invoices: invoices, Log: log},
		&api.Recurrences{Svc: recurrences, Log: log},
		&api.Incomes{Svc: incomes, Log: log},
		&api.Summaries{Svc: summaries, Log: log, Horizons: []api.HorizonEnsurer{incomes, recurrences}},
		api.NewBoletos(boleto.NewExtractor(), invoices, payeeSvc, cnpjClient, log),
	).WithRates(&api.Rates{Client: rates.New(cfg.RatesURL)}) // taxas de referência: BrasilAPI com cache, "off" desliga

	// Avisos por Web Push: sem chaves VAPID o sender fica nil e o módulo inteiro se declara desligado.
	var sender push.Sender
	if cfg.PushEnabled() {
		sender = push.NewWebPushSender(push.VAPID{PublicKey: cfg.VAPIDPublicKey, PrivateKey: cfg.VAPIDPrivateKey, Subject: cfg.VAPIDSubject})
	}
	pushSvc := push.NewService(gdb, sender, time.Now, cfg.Location)
	pushSvc.DigestHour = cfg.PushDigestHour
	server = server.WithPushes(api.NewPushes(pushSvc, cfg.VAPIDPublicKey, cookie, log))
	api.Mount(router, server, auth.Middleware(authSvc, households, cookie, log))

	if cfg.AutoMigrate {
		if err := db.Migrate(ctx, sqlDB); err != nil {
			return fmt.Errorf("migrations: %w", err)
		}
		log.Info("migrations aplicadas")
	}

	// Agendador dos avisos: uma goroutine (thread leve do Go) que acorda a cada 10 minutos e manda os avisos do dia que
	// ainda não saíram. O RunDue é idempotente (push_digests), então reiniciar a API não repete aviso. Para quando o
	// contexto é cancelado (Ctrl+C / docker stop).
	if pushSvc.Enabled() {
		go func() {
			ticker := time.NewTicker(10 * time.Minute)
			defer ticker.Stop()
			for {
				if n, err := pushSvc.RunDue(ctx); err != nil {
					log.Error("avisos por push", "erro", err)
				} else if n > 0 {
					log.Info("avisos por push enviados", "avisos", n)
				}
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
				}
			}
		}()
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
