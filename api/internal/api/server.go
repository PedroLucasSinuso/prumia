// Package api liga o contrato (openapi.yaml, via código gerado em api/gen) às implementações.
//
// Fluxo: o OpenAPI gera a interface gen.ServerInterface (uma função por operação). O Server abaixo a
// satisfaz: embute Unimplemented (que responde 501 para tudo) e sobrescreve apenas as operações já
// implementadas. Cada módulo de domínio vai tirar operações do Unimplemented e passar a implementá-las.
package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
)

// Pinger é qualquer coisa que consiga dizer "estou vivo" (o pool do banco). Interface pequena,
// definida onde é usada (convenção de Go), para o teste poder passar um fake.
type Pinger interface {
	PingContext(ctx context.Context) error
}

// base existe só para colocar Unimplemented um nível mais fundo que os handlers reais. Em Go, quando dois tipos
// embutidos oferecem o mesmo método, o de nível mais RASO vence; no mesmo nível, o método fica ambíguo e o
// tipo deixa de satisfazer a interface. Com isso, cada handler real "sobrescreve" o stub 501.
type base struct{ Unimplemented }

// Server implementa gen.ServerInterface.
type Server struct {
	base
	*auth.Handler
	*Households
	*Categories
	*Invoices
	*Purchases
	*Recurrences
	*Incomes
	*Summaries
	DB Pinger
}

func NewServer(db Pinger, a *auth.Handler, h *Households, c *Categories, i *Invoices, p *Purchases, r *Recurrences, in *Incomes, sm *Summaries) Server {
	return Server{Handler: a, Households: h, Categories: c, Invoices: i, Purchases: p, Recurrences: r, Incomes: in, Summaries: sm, DB: db}
}

// Garantia em tempo de compilação: se Server deixar de satisfazer a interface, o build falha.
var _ gen.ServerInterface = Server{}

// Mount registra todas as rotas do contrato sob /api.
func Mount(r gin.IRouter, s gen.ServerInterface, middlewares ...gen.MiddlewareFunc) {
	gen.RegisterHandlersWithOptions(r, s, gen.GinServerOptions{
		BaseURL:     "/api",
		Middlewares: middlewares,
		// Erros de parâmetro (ex.: uuid inválido na URL) saem no mesmo formato problem+json do resto.
		ErrorHandler: func(c *gin.Context, err error, status int) {
			httpx.WriteProblem(c, httpx.Problem{Status: status, Code: "bad_request", Detail: err.Error()})
		},
	})
}

// GetHealth implementa GET /healthz.
func (s Server) GetHealth(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel() // defer: roda ao sair da função, mesmo em caso de erro (como um finally)
	if err := s.DB.PingContext(ctx); err != nil {
		httpx.WriteProblem(c, httpx.Problem{
			Status: http.StatusServiceUnavailable,
			Code:   "db_unavailable",
			Title:  "banco indisponível",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
