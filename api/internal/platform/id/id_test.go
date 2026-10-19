package id

import (
	"testing"

	"github.com/google/uuid"
)

func TestNewEhV7EOrdenavel(t *testing.T) {
	prev := New()
	if prev.Version() != 7 {
		t.Fatalf("versão = %d, quer 7", prev.Version())
	}
	seen := map[uuid.UUID]bool{prev: true}
	for i := 0; i < 1000; i++ {
		cur := New()
		if seen[cur] {
			t.Fatal("id repetido")
		}
		seen[cur] = true
		if cur.String() <= prev.String() {
			t.Fatalf("não crescente: %s depois de %s", cur, prev)
		}
		prev = cur
	}
}
