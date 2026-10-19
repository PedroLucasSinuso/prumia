// Package httpx reúne o que é comum a todos os handlers HTTP: formato de erro, roteador base.
package httpx

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Problem é o corpo de erro padrão da API (application/problem+json, RFC 9457), o mesmo
// schema "Problem" do openapi.yaml. O front usa Code para decidir o que mostrar.
type Problem struct {
	Title  string            `json:"title"`
	Status int               `json:"status"`
	Code   string            `json:"code,omitempty"`
	Detail string            `json:"detail,omitempty"`
	Fields map[string]string `json:"fields,omitempty"` // erros por campo (validação)
}

// WriteProblem responde com o erro e interrompe a cadeia de handlers (Abort).
func WriteProblem(c *gin.Context, p Problem) {
	if p.Title == "" {
		p.Title = http.StatusText(p.Status)
	}
	c.Header("Content-Type", "application/problem+json")
	c.AbortWithStatusJSON(p.Status, p)
}

// Atalhos para os erros mais comuns.
func NotFound(c *gin.Context) {
	WriteProblem(c, Problem{Status: http.StatusNotFound, Code: "not_found"})
}

func Internal(c *gin.Context) {
	// Nunca devolva o erro interno ao cliente (pode vazar detalhes); ele vai para o log.
	WriteProblem(c, Problem{Status: http.StatusInternalServerError, Code: "internal_error"})
}
