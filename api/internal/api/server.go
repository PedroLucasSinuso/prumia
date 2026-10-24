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
	*Payees
	*Wallets
	*Transfers
	*CNPJLookups
	*Invoices
	*Purchases
	*Recurrences
	*Incomes
	*Summaries
	*Boletos
	DB Pinger
}

func NewServer(db Pinger, a *auth.Handler, h *Households, c *Categories, pa *Payees, wa *Wallets, tr *Transfers, cl *CNPJLookups, i *Invoices, p *Purchases, r *Recurrences, in *Incomes, sm *Summaries, b *Boletos) Server {
	return Server{Handler: a, Households: h, Categories: c, Payees: pa, Wallets: wa, Transfers: tr, CNPJLookups: cl, Invoices: i, Purchases: p, Recurrences: r, Incomes: in, Summaries: sm, Boletos: b, DB: db}
}

// Garantia em tempo de compilação: se Server deixar de satisfazer a interface, o build falha.
var _ gen.ServerInterface = Server{}

// maxJSONBody limita o corpo das requisições JSON. O maior corpo legítimo (receita com 20 descontos, compra com
// observação) não passa de poucos KB; o nginx aceita até 6 MB só por causa do upload de boleto.
const maxJSONBody = 64 << 10

// As rotas de upload têm limite próprio (5 MB, conferido em readUpload).
var uploadRoutes = map[string]bool{
	"/api/households/:householdId/boletos/extract":   true,
	"/api/households/:householdId/documents/extract": true,
}

// O lote de invoices (até 50 itens, cada um com observação de até 500 caracteres) passa dos 64 KB.
const (
	batchRoute   = "/api/households/:householdId/invoices/batch"
	maxBatchBody = 512 << 10
)

// limitBody recusa corpo grande demais antes de qualquer outra coisa (inclusive antes do argon2 do login):
// 413 se o Content-Length já denuncia; sem Content-Length, o MaxBytesReader corta a leitura no limite.
func limitBody(c *gin.Context) {
	if uploadRoutes[c.FullPath()] || c.Request.Body == nil {
		return
	}
	limit := int64(maxJSONBody)
	if c.FullPath() == batchRoute {
		limit = maxBatchBody
	}
	if c.Request.ContentLength > limit {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusRequestEntityTooLarge, Code: "body_too_large"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
}

// Mount registra todas as rotas do contrato sob /api.
func Mount(r gin.IRouter, s gen.ServerInterface, middlewares ...gen.MiddlewareFunc) {
	gen.RegisterHandlersWithOptions(r, s, gen.GinServerOptions{
		BaseURL:     "/api",
		Middlewares: append([]gen.MiddlewareFunc{limitBody}, middlewares...),
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
