package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeDB struct{ err error }

func (f fakeDB) PingContext(context.Context) error { return f.err }

func serve(t *testing.T, db Pinger, path string) *httptest.ResponseRecorder {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	w := httptest.NewRecorder()
	NewRouter(false, db, log).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

func TestHealthzOK(t *testing.T) {
	w := serve(t, fakeDB{}, "/api/healthz")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestHealthzBancoCaido(t *testing.T) {
	w := serve(t, fakeDB{err: errors.New("boom")}, "/api/healthz")
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("content-type = %q", ct)
	}
	var p Problem
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil || p.Code != "db_unavailable" {
		t.Errorf("corpo = %s (%v)", w.Body.String(), err)
	}
}

func TestRotaInexistenteEhProblemJSON(t *testing.T) {
	w := serve(t, fakeDB{}, "/api/nao-existe")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d", w.Code)
	}
	var p Problem
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil || p.Code != "not_found" || p.Status != 404 {
		t.Errorf("corpo = %s (%v)", w.Body.String(), err)
	}
}
