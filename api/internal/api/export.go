package api

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
)

// Exportação CSV (Ajustes > Dados). Formato pensado para abrir com dois cliques no Excel em português:
//   - BOM UTF-8 no início (sem ele o Excel lê os acentos como "Ã§");
//   - separador `;` (no Brasil a vírgula é o decimal, e o Excel pt-BR espera `;`);
//   - valores "1234,56" (sem "R$" nem ponto de milhar: a planilha reconhece como número).

// utf8BOM são os 3 bytes EF BB BF ("byte order mark"), escritos como escape para não ficarem invisíveis no código.
const utf8BOM = "\xEF\xBB\xBF"

var exportHeader = []string{"vencimento", "competência", "descrição", "categoria", "favorecido", "valor", "status", "pago em", "carteira", "valor pago"}

var exportStatus = map[invoice.Status]string{invoice.StatusPending: "pendente", invoice.StatusOverdue: "atrasada", invoice.StatusPaid: "paga"}
var exportWallet = map[string]string{"free": "livre", "benefit": "benefício"}

// sheetDecimal: 123456 -> "1234,56"; -500 -> "-5,00". Inteiros do começo ao fim (nada de float com dinheiro).
func sheetDecimal(c money.Cents) string {
	sign := ""
	if c < 0 {
		sign, c = "-", -c
	}
	return fmt.Sprintf("%s%d,%02d", sign, int64(c)/100, int64(c)%100)
}

func sheetDate(d caldate.Date) string {
	if d.IsZero() {
		return ""
	}
	return fmt.Sprintf("%02d/%02d/%04d", d.Day(), int(d.Month()), d.Year())
}

// sheetText neutraliza "injeção de fórmula": um texto que começa com = + - @ (ex.: descrição "=HYPERLINK(...)") seria
// executado pela planilha. O apóstrofo na frente faz o Excel tratar como texto puro.
func sheetText(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ExportInvoicesCsv: GET /households/{householdId}/export/invoices.csv?from=&to=
// Leitura: qualquer papel da casa (inclusive viewer) pode exportar. O porteiro (auth.Middleware) já validou a casa.
func (h *Invoices) ExportInvoicesCsv(c *gin.Context, householdId gen.HouseholdId, params gen.ExportInvoicesCsvParams) {
	rows, err := h.Svc.Export(c.Request.Context(), householdId, params.From, params.To)
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	var buf bytes.Buffer
	buf.WriteString(utf8BOM)
	w := csv.NewWriter(&buf)
	w.Comma = ';'
	w.UseCRLF = true // quebra de linha do Windows: o Excel prefere
	_ = w.Write(exportHeader)
	for _, r := range rows {
		paidAmount := ""
		if r.PaidAmountCents != nil {
			paidAmount = sheetDecimal(*r.PaidAmountCents)
		}
		wallet := ""
		if r.PaidWallet != nil {
			wallet = exportWallet[*r.PaidWallet]
		}
		_ = w.Write([]string{
			sheetDate(r.DueDate),
			fmt.Sprintf("%02d/%04d", int(r.CompetenceMonth.Month()), r.CompetenceMonth.Year()),
			sheetText(r.Description),
			sheetText(r.Category),
			sheetText(deref(r.Payee)),
			sheetDecimal(r.AmountCents),
			exportStatus[r.Status],
			sheetDate(r.PaidAt),
			wallet,
			paidAmount,
		})
	}
	w.Flush() // csv.Writer guarda em memória até o Flush; o erro de escrita (num bytes.Buffer, nunca) sairia em w.Error()
	name := "prumia-contas"
	if params.From != nil {
		name += "-" + params.From.String()
	}
	if params.To != nil {
		name += "-a-" + params.To.String()
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.csv"`, name))
	c.Header("Cache-Control", "no-store") // dado financeiro: nada de cache intermediário
	c.Data(http.StatusOK, "text/csv; charset=utf-8", buf.Bytes())
}
