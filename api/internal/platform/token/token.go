// Package token gera e faz o hash dos tokens aleatórios (sessão, convite, redefinição de senha).
// Fica em platform para que auth e household usem a mesma regra sem importar um ao outro.
package token

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

// New gera um token aleatório (256 bits) e o seu hash SHA-256.
// O token vai para quem precisa dele (cookie, link); **só o hash** vai para o banco. Assim, se o banco vazar,
// os tokens não podem ser usados. SHA-256 (e não argon2) basta porque o token já é aleatório e longo.
func New() (token string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, fmt.Errorf("gerando token: %w", err)
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, Hash(token), nil
}

// Hash calcula o hash que é guardado/consultado no banco.
func Hash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
