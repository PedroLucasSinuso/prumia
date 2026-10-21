// Stubs de todas as operações do contrato, escritos uma vez a partir de gen.ServerInterface.
// Remova cada stub quando o handler real existir. Quando o contrato ganha uma operação nova, o build quebra aqui até alguém tratá-la (de propósito).

package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
)

// Unimplemented responde 501 em todas as operações. O Server a embute (em Go, "embutir" um tipo
// promove seus métodos) e sobrescreve só as operações que já existem de verdade.
type Unimplemented struct{}

func notImplemented(c *gin.Context) {
	httpx.WriteProblem(c, httpx.Problem{Status: http.StatusNotImplemented, Code: "not_implemented"})
}
