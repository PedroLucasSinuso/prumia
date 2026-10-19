// Package id gera os identificadores (UUIDv7) das tabelas.
//
// UUIDv7 começa com o timestamp, então os ids nascem em ordem crescente. Isso mantém os índices
// do Postgres compactos (ao contrário do UUIDv4 aleatório) e não revela quantos registros existem
// (ao contrário de um inteiro sequencial).
package id

import "github.com/google/uuid"

// New devolve um UUIDv7 novo. Só falha se o sistema não tiver fonte de aleatoriedade,
// situação em que não há como continuar; por isso a função entra em pânico em vez de devolver erro
// (convenção de Go: panic para "isto não pode acontecer", error para falhas esperadas).
func New() uuid.UUID {
	v, err := uuid.NewV7()
	if err != nil {
		panic("id: sem aleatoriedade disponível: " + err.Error())
	}
	return v
}
