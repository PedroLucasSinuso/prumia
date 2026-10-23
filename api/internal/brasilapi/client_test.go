package brasilapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

const gas = "11222333000181"

func server(t *testing.T, status int, body string) (*Client, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/"+gas {
			t.Errorf("caminho inesperado: %s", r.URL.Path)
		}
		w.WriteHeader(status)
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return New(srv.URL), &calls
}

func TestLookupAchaEGuardaEmCache(t *testing.T) {
	c, calls := server(t, 200, `{"cnpj":"11222333000181","razao_social":" GASCO  DISTRIBUIDORA S/A ","nome_fantasia":"GASCO"}`)
	for i := 0; i < 3; i++ {
		co, err := c.Lookup(context.Background(), "11.222.333/0001-81")
		if err != nil || co.LegalName != "GASCO DISTRIBUIDORA S/A" || co.TradeName != "GASCO" || co.CNPJ != gas {
			t.Fatalf("lookup %d: %+v %v", i, co, err)
		}
	}
	if calls.Load() != 1 {
		t.Errorf("%d chamadas à API; o cache deveria resolver as outras", calls.Load())
	}
	// o cache expira
	c.now = func() time.Time { return time.Now().Add(25 * time.Hour) }
	c.Lookup(context.Background(), gas)
	if calls.Load() != 2 {
		t.Errorf("depois do TTL deveria consultar de novo: %d", calls.Load())
	}
}

func TestLookup404ViraNotFoundEFicaEmCache(t *testing.T) {
	c, calls := server(t, 404, `{"message":"CNPJ não encontrado"}`)
	for i := 0; i < 2; i++ {
		if _, err := c.Lookup(context.Background(), gas); !errors.Is(err, ErrNotFound) {
			t.Fatalf("err = %v", err)
		}
	}
	if calls.Load() != 1 {
		t.Errorf("chamadas = %d", calls.Load())
	}
}

func TestLookupFalhasNaoVaoParaOCache(t *testing.T) {
	for name, tc := range map[string]struct {
		status int
		body   string
	}{
		"500":              {500, `oops`},
		"429":              {429, `{}`},
		"json quebrado":    {200, `{`},
		"sem razão social": {200, `{"cnpj":"11222333000181"}`},
		"CNPJ trocado":     {200, `{"cnpj":"45678901000175","razao_social":"OUTRA"}`},
	} {
		c, calls := server(t, tc.status, tc.body)
		for i := 0; i < 2; i++ {
			if _, err := c.Lookup(context.Background(), gas); !errors.Is(err, ErrUnavailable) {
				t.Fatalf("%s: err = %v", name, err)
			}
		}
		if calls.Load() != 2 {
			t.Errorf("%s: falha não pode ficar em cache (%d chamadas)", name, calls.Load())
		}
	}
}

func TestLookupPrazoEstourado(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer srv.Close()
	c := New(srv.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := c.Lookup(ctx, gas); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v", err)
	}
}

func TestCNPJInvalidoNemChegaARede(t *testing.T) {
	c, calls := server(t, 200, `{}`)
	for _, bad := range []string{"", "123", "45678901000176", "../etc/passwd"} {
		if _, err := c.Lookup(context.Background(), bad); !errors.Is(err, ErrNotFound) {
			t.Errorf("%q: err = %v", bad, err)
		}
	}
	if calls.Load() != 0 {
		t.Errorf("CNPJ inválido gerou %d chamadas", calls.Load())
	}
}

func TestDesligado(t *testing.T) {
	for _, off := range []string{"", "off", "OFF", "  "} {
		if New(off) != nil {
			t.Errorf("%q deveria desligar", off)
		}
	}
	var c *Client
	if _, err := c.Lookup(context.Background(), gas); !errors.Is(err, ErrUnavailable) {
		t.Errorf("nil: %v", err)
	}
}

// A URL só leva os dígitos: mesmo com lixo em volta do CNPJ, nada além deles chega à rede.
func TestURLSoLevaDigitos(t *testing.T) {
	c, calls := server(t, 200, `{"cnpj":"11222333000181","razao_social":"GASCO DISTRIBUIDORA S/A"}`)
	if _, err := c.Lookup(context.Background(), "11222333000181/../x?y=a"); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Errorf("chamadas = %d", calls.Load())
	}
}
