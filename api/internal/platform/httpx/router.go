package httpx

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// trustedProxies são as redes de onde aceitamos o cabeçalho de IP real: a rede interna do Docker (o nginx) e o loopback
// (rodando a API direto na máquina). A API não publica porta, então de fora ninguém chega aqui sem passar pelo nginx.
var trustedProxies = []string{"127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"}

// NewRouter monta o roteador base: recuperação de pânico, log de acesso e 404 em problem+json.
// As rotas do contrato são registradas depois por api.Mount.
func NewRouter(production bool, log *slog.Logger) *gin.Engine {
	if production {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New() // gin.New() sem middlewares; adicionamos só os nossos
	// IP real do cliente (base do limite de tentativas de login). Só lemos X-Real-IP, que o nginx SOBRESCREVE com o
	// endereço que ele próprio viu ($remote_addr), e só quando a conexão vem de um proxy confiável.
	// Por que não X-Forwarded-For: o cliente pode mandar um, o nginx só acrescenta ao fim, e o Gin percorre a lista da
	// direita para a esquerda pulando IPs "confiáveis". Um cliente com IP privado (LAN, o próprio host, `tailscale serve`)
	// fazia o Gin chegar ao valor forjado e escolhia o próprio IP a cada tentativa, furando o limite.
	r.RemoteIPHeaders = []string{"X-Real-IP"}
	_ = r.SetTrustedProxies(trustedProxies)
	r.Use(gin.CustomRecoveryWithWriter(nil, func(c *gin.Context, err any) {
		log.Error("pânico na requisição", "erro", err, "rota", c.FullPath())
		Internal(c)
	}))
	r.Use(accessLog(log))
	r.NoRoute(NotFound)
	return r
}

// NewServer devolve o servidor HTTP com limites de tempo e de cabeçalho: sem eles, uma conexão lenta (de propósito ou
// não) prende uma goroutine e um descritor para sempre. Os valores cobrem o caso mais lento, a leitura de boleto
// (upload de até 5 MB, que o nginx já entrega inteiro, e até 60 s de extração).
func NewServer(addr string, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      90 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}
}

// accessLog registra método, rota, status e duração. Não loga query string nem corpo
// (podem conter tokens e dados sensíveis).
func accessLog(log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Info("requisição",
			"método", c.Request.Method,
			"rota", c.FullPath(),
			"status", c.Writer.Status(),
			"ms", time.Since(start).Milliseconds(),
		)
	}
}
