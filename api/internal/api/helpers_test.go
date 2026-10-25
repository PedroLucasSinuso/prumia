package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/adjustment"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/boleto"
	"github.com/PedroLucasSinuso/prumia/api/internal/category"
	"github.com/PedroLucasSinuso/prumia/api/internal/household"
	"github.com/PedroLucasSinuso/prumia/api/internal/income"
	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/payee"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
	"github.com/PedroLucasSinuso/prumia/api/internal/reserve"
	"github.com/PedroLucasSinuso/prumia/api/internal/series"
	"github.com/PedroLucasSinuso/prumia/api/internal/summary"
	"github.com/PedroLucasSinuso/prumia/api/internal/transfer"
	"github.com/PedroLucasSinuso/prumia/api/internal/wallet"
)

// app é a API completa (serviços reais, Postgres real) montada para testes de ponta a ponta.
type app struct {
	t      *testing.T
	db     *gorm.DB
	router *gin.Engine
	auth   *auth.Service
	hs     *household.Service
	cookie auth.CookieConfig
	rec    *series.RecurrenceService
	inc    *income.Service
}

type opts struct {
	openRegistration bool
	secureCookie     bool
	now              func() time.Time
	// company simula a BrasilAPI nos testes (nil = sem consulta).
	company CNPJLooker
	// extractor troca o leitor de boleto (nil = testExtractor).
	extractor *boleto.Extractor
}

func newApp(t *testing.T, o opts) *app {
	t.Helper()
	gdb := dbtest.New(t)
	sqlDB, _ := gdb.DB()
	if err := migrate(t, sqlDB); err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hs := household.NewService(gdb)
	svc, err := auth.NewService(gdb, hs, auth.Config{OpenRegistration: o.openRegistration, Now: o.now})
	if err != nil {
		t.Fatal(err)
	}
	cookie := auth.CookieConfig{Name: "prumia_session", Secure: o.secureCookie, MaxAge: 30 * 24 * time.Hour}
	router := httpx.NewRouter(false, log)
	nowFn := o.now
	if nowFn == nil {
		nowFn = time.Now
	}
	today := func() caldate.Date { return caldate.FromTime(nowFn()) }
	invSvc := invoice.NewService(gdb, today)
	recSvc := series.NewRecurrenceService(gdb, invSvc, today)
	incSvc := income.NewService(gdb, today)
	sumSvc := summary.NewService(gdb, today)
	payeeSvc := payee.NewService(gdb)
	Mount(router, NewServer(sqlDB,
		auth.NewHandler(svc, cookie, log),
		&Households{Svc: hs, Log: log},
		&Categories{Svc: category.NewService(gdb), Log: log},
		&Payees{Svc: payeeSvc, Log: log},
		&Wallets{Svc: wallet.NewService(gdb), Log: log},
		&Transfers{Svc: transfer.NewService(gdb, today), Log: log, Balance: sumSvc},
		&Adjustments{Svc: adjustment.NewService(gdb, sumSvc, today), Log: log},
		&Reserves{Svc: reserve.NewService(gdb, sumSvc), Log: log, Today: today},
		NewCNPJLookups(o.company, log),
		&Invoices{Svc: invSvc, Log: log, Horizon: recSvc, Balance: sumSvc},
		&Purchases{Svc: series.NewPurchaseService(gdb, invSvc), Invoices: invSvc, Log: log},
		&Recurrences{Svc: recSvc, Log: log},
		&Incomes{Svc: incSvc, Log: log},
		&Summaries{Svc: sumSvc, Log: log, Horizons: []HorizonEnsurer{incSvc, recSvc}},
		NewBoletos(o.extractorOrDefault(), invSvc, payeeSvc, o.company, log),
	), auth.Middleware(svc, hs, cookie, log))
	return &app{t: t, db: gdb, router: router, auth: svc, hs: hs, cookie: cookie, rec: recSvc, inc: incSvc}
}

type resp struct {
	*httptest.ResponseRecorder
}

func (r resp) json(v any) {
	r.ResponseRecorder.Result() // garante o corpo completo
	if err := json.Unmarshal(r.Body.Bytes(), v); err != nil {
		panic("resposta não é JSON: " + r.Body.String())
	}
}

func (r resp) sessionCookie() *http.Cookie {
	for _, c := range r.Result().Cookies() {
		if c.Name == "prumia_session" {
			return c
		}
	}
	return nil
}

// do faz uma requisição. cookie e headers são opcionais.
func (a *app) do(method, path string, body any, cookie *http.Cookie, headers ...string) resp {
	a.t.Helper()
	return a.doFrom("203.0.113.7:1234", method, path, body, cookie, headers...)
}

// doFrom é o do com o endereço da conexão escolhido (ex.: simular o nginx na rede do Docker).
func (a *app) doFrom(remote, method, path string, body any, cookie *http.Cookie, headers ...string) resp {
	a.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rd)
	req.RemoteAddr = remote
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	w := httptest.NewRecorder()
	a.router.ServeHTTP(w, req)
	return resp{w}
}

// register cadastra um usuário e devolve o cookie de sessão e o id da casa criada.
func (a *app) register(name, email, house string) (*http.Cookie, string) {
	a.t.Helper()
	r := a.do("POST", "/api/auth/register", map[string]any{
		"name": name, "email": email, "password": "senha-muito-segura", "householdName": house,
	}, nil)
	if r.Code != http.StatusCreated {
		a.t.Fatalf("register %s: %d %s", email, r.Code, r.Body.String())
	}
	var me struct {
		Households []struct{ Id string } `json:"households"`
	}
	r.json(&me)
	return r.sessionCookie(), me.Households[0].Id
}

func (o opts) extractorOrDefault() *boleto.Extractor {
	if o.extractor != nil {
		return o.extractor
	}
	return testExtractor()
}
