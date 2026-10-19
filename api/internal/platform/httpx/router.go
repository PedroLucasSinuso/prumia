package httpx

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Pinger é qualquer coisa que consiga dizer "estou vivo" (o pool do banco, por exemplo).
// Uma interface pequena, definida aqui onde é usada: convenção de Go ("aceite interfaces").
// Nos testes basta passar um fake.
type Pinger interface {
	PingContext(ctx context.Context) error
}

// NewRouter monta o roteador base: recuperação de pânico, log de acesso, 404 em problem+json
// e o healthcheck. Os módulos de domínio registram suas rotas depois, sob /api.
func NewRouter(production bool, db Pinger, log *slog.Logger) *gin.Engine {
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

	api := r.Group("/api")
	api.GET("/healthz", healthz(db))
	return r
}

func healthz(db Pinger) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel() // defer: roda ao sair da função, mesmo em caso de erro (como finally)
		if err := db.PingContext(ctx); err != nil {
			WriteProblem(c, Problem{
				Status: http.StatusServiceUnavailable,
				Code:   "db_unavailable",
				Title:  "banco indisponível",
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
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
