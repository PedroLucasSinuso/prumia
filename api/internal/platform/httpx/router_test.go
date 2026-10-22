package httpx

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
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

// Pânico vira 500 genérico: nada de stack trace, mensagem interna ou caminho de arquivo na resposta.
func TestPanicoNaoVazaDetalhes(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := NewRouter(false, log)
	r.GET("/boom", func(c *gin.Context) { panic("senha=segredo /src/internal/x.go:42") })
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/boom", nil))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", w.Code)
	}
	body := w.Body.String()
	for _, leak := range []string{"segredo", ".go", "goroutine"} {
		if strings.Contains(body, leak) {
			t.Errorf("resposta vazou %q: %s", leak, body)
		}
	}
}

// clientIPOf monta o roteador real e devolve o IP que o Gin enxerga para a requisição.
func clientIPOf(t *testing.T, remote string, headers map[string]string) string {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := NewRouter(false, log)
	var got string
	r.GET("/ip", func(c *gin.Context) { got = c.ClientIP() })
	req := httptest.NewRequest(http.MethodGet, "/ip", nil)
	req.RemoteAddr = remote
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	r.ServeHTTP(httptest.NewRecorder(), req)
	return got
}

// O IP do cliente (base do limite de tentativas de login) não pode ser escolhido por quem faz a requisição.
func TestIPDoClienteNaoPodeSerForjado(t *testing.T) {
	cases := []struct {
		name    string
		remote  string
		headers map[string]string
		want    string
	}{
		{
			// nginx (rede do Docker) repassa em X-Real-IP o IP que ELE viu; X-Forwarded-For não é usado.
			name:   "atrás do nginx, X-Forwarded-For forjado",
			remote: "172.18.0.3:40000",
			headers: map[string]string{
				"X-Real-IP":       "100.101.102.103",
				"X-Forwarded-For": "1.2.3.4, 100.101.102.103",
			},
			want: "100.101.102.103",
		},
		{
			// cliente com IP privado (LAN, host, `tailscale serve`) chegando pelo nginx: o valor forjado à esquerda
			// do X-Forwarded-For não pode vencer (antes o Gin "pulava" os IPs privados e confiava nele).
			name:   "cliente com IP privado forjando X-Forwarded-For",
			remote: "172.18.0.3:40000",
			headers: map[string]string{
				"X-Real-IP":       "172.18.0.1",
				"X-Forwarded-For": "9.9.9.9, 172.18.0.1",
			},
			want: "172.18.0.1",
		},
		{
			// conexão direta de fora (sem proxy confiável na frente): cabeçalhos ignorados, vale o endereço da conexão.
			name:   "conexão direta pública forjando cabeçalhos",
			remote: "203.0.113.7:5555",
			headers: map[string]string{
				"X-Real-IP":       "1.1.1.1",
				"X-Forwarded-For": "1.1.1.1",
			},
			want: "203.0.113.7",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := clientIPOf(t, tc.remote, tc.headers); got != tc.want {
				t.Errorf("ClientIP = %q, quer %q", got, tc.want)
			}
		})
	}
}

func TestServidorTemTimeoutsELimiteDeCabecalho(t *testing.T) {
	s := NewServer(":0", http.NotFoundHandler())
	if s.ReadHeaderTimeout == 0 || s.ReadTimeout == 0 || s.WriteTimeout == 0 || s.IdleTimeout == 0 {
		t.Errorf("timeouts zerados (sem limite): %+v", s)
	}
	if s.MaxHeaderBytes == 0 || s.MaxHeaderBytes > 1<<20 {
		t.Errorf("MaxHeaderBytes = %d", s.MaxHeaderBytes)
	}
}
