package auth

import "github.com/PedroLucasSinuso/prumia/api/internal/platform/token"

// NewToken gera um token aleatório e o seu hash SHA-256 (ver platform/token). O token vai para o cookie;
// só o hash vai para o banco.
func NewToken() (tok string, hash []byte, err error) { return token.New() }

// HashToken calcula o hash que é guardado/consultado no banco.
func HashToken(tok string) []byte { return token.Hash(tok) }
