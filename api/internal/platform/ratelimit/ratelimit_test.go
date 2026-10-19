package ratelimit

import (
	"testing"
	"time"
)

func TestBurstEReabastecimento(t *testing.T) {
	l := New(time.Minute, 3)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	l.now = func() time.Time { return now }

	for i := 0; i < 3; i++ {
		if !l.Allow("a") {
			t.Fatalf("tentativa %d deveria passar (burst)", i+1)
		}
	}
	if l.Allow("a") {
		t.Fatal("4ª tentativa deveria ser barrada")
	}
	if !l.Allow("b") {
		t.Fatal("outra chave tem balde próprio")
	}
	now = now.Add(time.Minute) // uma ficha de volta
	if !l.Allow("a") {
		t.Fatal("depois de 1 intervalo deveria passar de novo")
	}
	if l.Allow("a") {
		t.Fatal("e só uma")
	}
}
