package httpx

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
)

// NewRouter monta o roteador base: recuperação de pânico, log de acesso e 404 em problem+json.
// As rotas do contrato são registradas depois por api.Mount.
func NewRouter(production bool, log *slog.Logger) *gin.Engine {
	if production {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New() // gin.New() sem middlewares; adicionamos só os nossos
	r.Use(gin.CustomRecoveryWithWriter(nil, func(c *gin.Context, err any) {
		log.Error("pânico na requisição", "erro", err, "rota", c.FullPath())
		Internal(c)
	}))
	r.Use(accessLog(log))
	r.NoRoute(NotFound)
	return r
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
