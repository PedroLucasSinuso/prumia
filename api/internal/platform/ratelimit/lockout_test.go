package ratelimit

import (
	"testing"
	"time"
)

func TestLockoutProgressivo(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	l := NewLockout(5, time.Minute, 15*time.Minute)
	l.now = func() time.Time { return now }

	for i := 0; i < 4; i++ {
		l.Fail("ana")
	}
	if b, _ := l.Blocked("ana"); b {
		t.Fatal("4 falhas ainda não bloqueiam")
	}
	l.Fail("ana") // 5ª: 1 min
	if b, left := l.Blocked("ana"); !b || left != time.Minute {
		t.Fatalf("5ª falha: bloqueada=%v por %v, quer 1 min", b, left)
	}
	if b, _ := l.Blocked("beto"); b {
		t.Fatal("outra chave não é afetada")
	}
	// cada falha depois do desbloqueio dobra: 2, 4, 8, 15 (teto), 15
	for _, want := range []time.Duration{2, 4, 8, 15, 15} {
		now = now.Add(time.Hour)
		l.Fail("ana")
		if _, left := l.Blocked("ana"); left != want*time.Minute {
			t.Fatalf("bloqueio = %v, quer %v min", left, want)
		}
	}
	now = now.Add(15 * time.Minute)
	if b, _ := l.Blocked("ana"); b {
		t.Fatal("passado o prazo, libera")
	}
	l.Reset("ana") // acertou a senha
	l.Fail("ana")
	if b, _ := l.Blocked("ana"); b {
		t.Fatal("depois do acerto, a contagem recomeça")
	}
}
