package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
)

type fakeDB struct{ err error }

func (f fakeDB) PingContext(context.Context) error { return f.err }

func do(t *testing.T, db Pinger, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	r := httpx.NewRouter(false, slog.New(slog.NewTextHandler(io.Discard, nil)))
	Mount(r, Server{DB: db})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(method, path, nil))
	return w
}

func problem(t *testing.T, w *httptest.ResponseRecorder) httpx.Problem {
	t.Helper()
	if ct := w.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("content-type = %q", ct)
	}
	var p httpx.Problem
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
		t.Fatalf("corpo não é problem+json: %s", w.Body.String())
	}
	return p
}

func TestHealthzOK(t *testing.T) {
	w := do(t, fakeDB{}, http.MethodGet, "/api/healthz")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestHealthzBancoCaido(t *testing.T) {
	w := do(t, fakeDB{err: errors.New("boom")}, http.MethodGet, "/api/healthz")
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", w.Code)
	}
	if p := problem(t, w); p.Code != "db_unavailable" {
		t.Errorf("code = %q", p.Code)
	}
}

// Operações do contrato ainda sem módulo respondem 501 em problem+json (não 404).
func TestOperacaoSemHandlerEh501(t *testing.T) {
	w := do(t, fakeDB{}, http.MethodGet, "/api/households/0190f0f0-0000-7000-8000-000000000000/incomes?month=2026-10-01")
	if w.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d", w.Code)
	}
	if p := problem(t, w); p.Code != "not_implemented" {
		t.Errorf("code = %q", p.Code)
	}
}

// Parâmetro de rota inválido (uuid) vira 400 em problem+json, validado pelo código gerado.
func TestUUIDInvalidoEh400(t *testing.T) {
	w := do(t, fakeDB{}, http.MethodGet, "/api/households/nao-e-uuid")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, corpo = %s", w.Code, w.Body.String())
	}
	if p := problem(t, w); p.Code != "bad_request" {
		t.Errorf("code = %q", p.Code)
	}
}
