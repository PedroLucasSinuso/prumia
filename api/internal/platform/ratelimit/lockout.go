package ratelimit

import (
	"sync"
	"time"
)

// Lockout é o bloqueio PROGRESSIVO por chave (no login, o e-mail normalizado): depois de `after` falhas seguidas, cada
// nova falha bloqueia a chave por `base`, dobrando a cada falha até `max`. Um acerto zera a contagem. Complementa o
// Limiter (balde de fichas): o balde limita o ritmo; o bloqueio corta a força bruta paciente (5 por minuto, o dia todo).
// O teto (`max`) limita o estrago de quem erra de propósito no e-mail de outra pessoa para trancá-la do lado de fora.
type Lockout struct {
	mu      sync.Mutex // o servidor atende requisições em paralelo (goroutines): o mapa precisa de trava
	after   int
	base    time.Duration
	max     time.Duration
	entries map[string]*lockEntry
	now     func() time.Time
}

type lockEntry struct {
	fails int
	until time.Time // bloqueada até aqui (zero = livre)
	seen  time.Time
}

func NewLockout(after int, base, max time.Duration) *Lockout {
	return &Lockout{after: after, base: base, max: max, entries: map[string]*lockEntry{}, now: time.Now}
}

// Blocked diz se a chave está bloqueada agora e por quanto tempo ainda (para o Retry-After).
func (l *Lockout) Blocked(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[key]
	if !ok {
		return false, 0
	}
	if left := e.until.Sub(l.now()); left > 0 {
		return true, left
	}
	return false, 0
}

// Fail registra uma falha. A partir da `after`-ésima falha seguida, bloqueia: base, 2×base, 4×base... até max.
func (l *Lockout) Fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.sweep(now)
	e, ok := l.entries[key]
	if !ok {
		e = &lockEntry{}
		l.entries[key] = e
	}
	e.fails++
	e.seen = now
	if e.fails < l.after {
		return
	}
	d := l.base
	for i := l.after; i < e.fails && d < l.max; i++ {
		d *= 2
	}
	if d > l.max {
		d = l.max
	}
	e.until = now.Add(d)
}

// Reset zera a chave (login certo).
func (l *Lockout) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, key)
}

// sweep descarta chaves paradas há mais de um dia (sem bloqueio vigente), para o mapa não crescer sem limite.
func (l *Lockout) sweep(now time.Time) {
	if len(l.entries) < 1024 {
		return
	}
	for k, e := range l.entries {
		if now.Sub(e.seen) > 24*time.Hour && !now.Before(e.until) {
			delete(l.entries, k)
		}
	}
}
