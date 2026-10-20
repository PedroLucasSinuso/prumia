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

	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/category"
	"github.com/PedroLucasSinuso/prumia/api/internal/household"
	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
)

// app é a API completa (serviços reais, Postgres real) montada para testes de ponta a ponta.
type app struct {
	t      *testing.T
	db     *gorm.DB
	router *gin.Engine
	auth   *auth.Service
	hs     *household.Service
	cookie auth.CookieConfig
}

type opts struct {
	openRegistration bool
	secureCookie     bool
	now              func() time.Time
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
	Mount(router, NewServer(sqlDB,
		auth.NewHandler(svc, cookie, log),
		&Households{Svc: hs, Log: log},
		&Categories{Svc: category.NewService(gdb), Log: log},
		&Invoices{Svc: invoice.NewService(gdb, today), Log: log},
	), auth.Middleware(svc, hs, cookie, log))
	return &app{t: t, db: gdb, router: router, auth: svc, hs: hs, cookie: cookie}
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
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rd)
	req.RemoteAddr = "203.0.113.7:1234"
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
