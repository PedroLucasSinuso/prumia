package auth

import (
	"strings"
	"testing"
)

func TestHashEVerify(t *testing.T) {
	h, err := HashPassword("uma senha bem longa")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$v=19$m=65536,t=3,p=2$") {
		t.Errorf("formato inesperado: %s", h)
	}
	if !VerifyPassword("uma senha bem longa", h) {
		t.Error("senha correta deveria validar")
	}
	if VerifyPassword("outra senha", h) {
		t.Error("senha errada não pode validar")
	}
	h2, _ := HashPassword("uma senha bem longa")
	if h == h2 {
		t.Error("salts devem diferir: dois hashes da mesma senha não podem ser iguais")
	}
}

func TestVerifyHashMalformado(t *testing.T) {
	for _, bad := range []string{"", "abc", "$argon2id$v=19$m=1,t=1,p=1$xx", "$bcrypt$v=19$m=1,t=1,p=1$YQ$YQ",
		"$argon2id$v=18$m=65536,t=3,p=2$YQ$YQ", "$argon2id$v=19$m=999999999,t=3,p=2$YQ$YQ"} {
		if VerifyPassword("x", bad) {
			t.Errorf("hash inválido %q não pode validar", bad)
		}
	}
}

func TestToken(t *testing.T) {
	tok, hash, err := NewToken()
	if err != nil || len(tok) < 40 || len(hash) != 32 {
		t.Fatalf("token=%q hash=%d err=%v", tok, len(hash), err)
	}
	if string(HashToken(tok)) != string(hash) {
		t.Error("HashToken deve reproduzir o hash")
	}
	tok2, _, _ := NewToken()
	if tok == tok2 {
		t.Error("tokens devem ser únicos")
	}
}

func TestNormalizeEmail(t *testing.T) {
	ok := map[string]string{" Pedro@Exemplo.COM ": "pedro@exemplo.com", "a@b.co": "a@b.co"}
	for in, want := range ok {
		if got, err := NormalizeEmail(in); err != nil || got != want {
			t.Errorf("%q => %q, %v", in, got, err)
		}
	}
	for _, bad := range []string{"", "sem-arroba", "Nome <a@b.co>", "a@", "@b.co", "a b@c.co"} {
		if _, err := NormalizeEmail(bad); err == nil {
			t.Errorf("%q deveria ser inválido", bad)
		}
	}
}
