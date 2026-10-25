package rates

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// server simula a BrasilAPI: devolve `body` com `status` e conta as chamadas.
func server(t *testing.T, status *int, body *string) (*httptest.Server, *int32) {
	t.Helper()
	var hits int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(*status)
		_, _ = w.Write([]byte(*body))
	}))
	t.Cleanup(s.Close)
	return s, &hits
}

func TestCurrentLeCacheiaEDegrada(t *testing.T) {
	status, body := http.StatusOK, `[{"nome":"Selic","valor":15},{"nome":"CDI","valor":14.9},{"nome":"IPCA","valor":5.175},{"nome":"TR","valor":1.2}]`
	s, hits := server(t, &status, &body)
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	c := New(s.URL + "/")
	c.now = func() time.Time { return now }

	got := c.Current(context.Background())
	want := []Rate{{"cdi", "CDI", 1490}, {"selic", "Selic", 1500}, {"ipca", "IPCA", 518}}
	if !got.Available || got.FetchedAt == nil || len(got.Rates) != 3 {
		t.Fatalf("primeira leitura: %+v", got)
	}
	for i, r := range want {
		if got.Rates[i] != r {
			t.Errorf("taxa %d = %+v, quer %+v", i, got.Rates[i], r)
		}
	}

	// dentro do cache: não consulta de novo
	now = now.Add(11 * time.Hour)
	c.Current(context.Background())
	if *hits != 1 {
		t.Errorf("consultou %d vezes dentro do cache", *hits)
	}

	// cache venceu e a API caiu: devolve a última leitura boa, marcada como indisponível
	now = now.Add(2 * time.Hour)
	status = http.StatusInternalServerError
	got = c.Current(context.Background())
	if got.Available || len(got.Rates) != 3 || got.Rates[0].BasisPoints != 1490 {
		t.Errorf("com a API fora: %+v", got)
	}
	// depois da falha, espera failTTL antes de tentar de novo
	c.Current(context.Background())
	if *hits != 2 {
		t.Errorf("tentou de novo antes do prazo: %d chamadas", *hits)
	}
	now = now.Add(failTTL)
	status = http.StatusOK
	if got := c.Current(context.Background()); !got.Available || *hits != 3 {
		t.Errorf("voltou: %+v, %d chamadas", got, *hits)
	}
}

func TestRespostaEstranhaEDesligado(t *testing.T) {
	for name, b := range map[string]string{
		"não é JSON":         `<html>`,
		"sem taxa conhecida": `[{"nome":"TR","valor":1}]`,
		"valor absurdo":      `[{"nome":"CDI","valor":1500}]`,
		"valor não numérico": `[{"nome":"CDI","valor":"x"}]`,
	} {
		status, body := http.StatusOK, b
		s, _ := server(t, &status, &body)
		if got := New(s.URL).Current(context.Background()); got.Available || len(got.Rates) != 0 {
			t.Errorf("%s: %+v", name, got)
		}
	}
	if got := New("off").Current(context.Background()); got.Available || got.Rates == nil || len(got.Rates) != 0 {
		t.Errorf("desligado: %+v", got)
	}
}

func TestBasisPoints(t *testing.T) {
	for in, want := range map[string]int64{"14.9": 1490, "15": 1500, "5.175": 518, "0.004": 0, "-0.125": -13, "4.1449": 414} {
		if got, ok := basisPoints(json.Number(in)); !ok || got != want {
			t.Errorf("%s = %d (%v), quer %d", in, got, ok, want)
		}
	}
}
