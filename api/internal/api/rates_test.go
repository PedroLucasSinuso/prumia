package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

type ratesT struct {
	Available bool    `json:"available"`
	FetchedAt *string `json:"fetchedAt"`
	Rates     []struct {
		Code        string `json:"code"`
		Name        string `json:"name"`
		BasisPoints int    `json:"basisPoints"`
	} `json:"rates"`
}

// GET /rates: só logado; com a BrasilAPI (simulada) devolve CDI, Selic e IPCA em centésimos de ponto; desligada, 200 sem taxas.
func TestTaxasDeReferencia(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[{"nome":"Selic","valor":15},{"nome":"CDI","valor":14.9},{"nome":"IPCA","valor":5.17}]`))
	}))
	defer fake.Close()
	a := newApp(t, opts{openRegistration: true, ratesURL: fake.URL})
	if r := a.do("GET", "/api/rates", nil, nil); r.Code != http.StatusUnauthorized {
		t.Fatalf("sem login: %d", r.Code)
	}
	c, _ := a.register("Ana", "ana@x.com", "Casa A")
	r := a.do("GET", "/api/rates", nil, c)
	var got ratesT
	r.json(&got)
	if r.Code != 200 || !got.Available || got.FetchedAt == nil || len(got.Rates) != 3 ||
		got.Rates[0].Code != "cdi" || got.Rates[0].BasisPoints != 1490 || got.Rates[2].Name != "IPCA" || got.Rates[2].BasisPoints != 517 {
		t.Errorf("taxas: %d %s", r.Code, r.Body)
	}

	off := newApp(t, opts{openRegistration: true})
	c, _ = off.register("Ana", "ana@x.com", "Casa A")
	r = off.do("GET", "/api/rates", nil, c)
	got = ratesT{}
	r.json(&got)
	if r.Code != 200 || got.Available || got.Rates == nil || len(got.Rates) != 0 {
		t.Errorf("desligado: %d %s", r.Code, r.Body)
	}
}
