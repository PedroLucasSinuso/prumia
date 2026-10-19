package api

import (
	"testing"
	"time"
)

// relógio controlável para testar validade e renovação da sessão
type clock struct{ now time.Time }

func (c *clock) Now() time.Time          { return c.now }
func (c *clock) Advance(d time.Duration) { c.now = c.now.Add(d) }

func TestSessaoExpiraERenovaComUso(t *testing.T) {
	clk := &clock{now: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)}
	a := newApp(t, opts{now: clk.Now})
	c, _ := a.register("Pedro", "p@x.com", "Casa")

	// uso depois de 2h renova a sessão (sliding): last_seen e expires_at andam
	clk.Advance(2 * time.Hour)
	if r := a.do("GET", "/api/auth/me", nil, c); r.Code != 200 {
		t.Fatalf("me: %d", r.Code)
	}
	var expires time.Time
	a.db.Raw("SELECT expires_at FROM sessions").Scan(&expires)
	if want := clk.now.Add(30 * 24 * time.Hour); !expires.Equal(want) {
		t.Errorf("expires_at = %s, quer %s", expires, want)
	}

	// 29 dias depois do último uso ainda vale; 31 não
	clk.Advance(29 * 24 * time.Hour)
	if r := a.do("GET", "/api/auth/me", nil, c); r.Code != 200 {
		t.Errorf("sessão com 29 dias de inatividade deveria valer: %d", r.Code)
	}
	clk.Advance(31 * 24 * time.Hour)
	if r := a.do("GET", "/api/auth/me", nil, c); r.Code != 401 {
		t.Errorf("sessão expirada deveria dar 401: %d", r.Code)
	}
}

func TestLoginLimpaSessoesVencidas(t *testing.T) {
	clk := &clock{now: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)}
	a := newApp(t, opts{now: clk.Now})
	a.register("Pedro", "p@x.com", "Casa")
	clk.Advance(40 * 24 * time.Hour)
	a.do("POST", "/api/auth/login", map[string]any{"email": "p@x.com", "password": "senha-muito-segura"}, nil)
	var n int64
	a.db.Raw("SELECT count(*) FROM sessions").Scan(&n)
	if n != 1 {
		t.Errorf("deveria sobrar só a sessão nova, há %d", n)
	}
}
