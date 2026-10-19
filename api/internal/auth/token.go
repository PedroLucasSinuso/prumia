package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

// NewToken gera um token aleatório (256 bits) e o seu hash SHA-256.
// O token vai para o cookie; **só o hash** vai para o banco. Assim, se o banco vazar, as sessões
// não podem ser usadas. SHA-256 (e não argon2) basta aqui porque o token já é aleatório e longo.
func NewToken() (token string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, fmt.Errorf("gerando token: %w", err)
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, HashToken(token), nil
}

// HashToken calcula o hash que é guardado/consultado no banco.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
