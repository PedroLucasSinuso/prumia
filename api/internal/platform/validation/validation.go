// Package validation tem o erro de validação por campo, compartilhado pelos serviços.
package validation

// Error agrupa os problemas de validação por campo. O handler o converte em 400 `validation_error`
// com `fields` (o front mostra cada mensagem junto ao campo certo).
type Error struct{ Fields map[string]string }

func (e *Error) Error() string { return "dados inválidos" }

// New cria um erro com um único campo.
func New(field, msg string) *Error { return &Error{Fields: map[string]string{field: msg}} }

// Collector acumula erros de vários campos e devolve nil se não houve nenhum.
type Collector struct{ fields map[string]string }

func (c *Collector) Add(field, msg string) {
	if c.fields == nil {
		c.fields = map[string]string{}
	}
	if _, exists := c.fields[field]; !exists { // mantém a primeira mensagem do campo
		c.fields[field] = msg
	}
}

func (c *Collector) Err() error {
	if len(c.fields) == 0 {
		return nil
	}
	return &Error{Fields: c.fields}
}
