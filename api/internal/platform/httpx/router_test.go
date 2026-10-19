package httpx

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRotaInexistenteEhProblemJSON(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	w := httptest.NewRecorder()
	NewRouter(false, log).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/nao-existe", nil))

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("content-type = %q", ct)
	}
	var p Problem
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil || p.Code != "not_found" || p.Status != 404 {
		t.Errorf("corpo = %s (%v)", w.Body.String(), err)
	}
}
