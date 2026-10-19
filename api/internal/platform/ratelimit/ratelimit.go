// Package ratelimit limita tentativas por chave (IP, e-mail...) em memória.
// Suficiente para uma instância única, que é o nosso caso; se um dia houver várias, troque por Redis.
package ratelimit

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Limiter dá a cada chave um balde de fichas ("token bucket"): `burst` tentativas de imediato,
// reabastecendo uma a cada `every`.
type Limiter struct {
	mu      sync.Mutex // protege o mapa: o servidor atende requisições em paralelo (goroutines)
	every   time.Duration
	burst   int
	entries map[string]*entry
	now     func() time.Time
}

type entry struct {
	lim  *rate.Limiter
	seen time.Time
}

func New(every time.Duration, burst int) *Limiter {
	return &Limiter{every: every, burst: burst, entries: map[string]*entry{}, now: time.Now}
}

// Allow consome uma ficha da chave e diz se a tentativa pode seguir.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.sweep(now)
	e, ok := l.entries[key]
	if !ok {
		e = &entry{lim: rate.NewLimiter(rate.Every(l.every), l.burst)}
		l.entries[key] = e
	}
	e.seen = now
	return e.lim.AllowN(now, 1)
}

// sweep descarta chaves ociosas para o mapa não crescer sem limite (ataque com muitas chaves).
func (l *Limiter) sweep(now time.Time) {
	if len(l.entries) < 1024 {
		return
	}
	for k, e := range l.entries {
		if now.Sub(e.seen) > 10*l.every*time.Duration(l.burst) {
			delete(l.entries, k)
		}
	}
}
