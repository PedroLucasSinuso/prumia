package caldate

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseISO(t *testing.T) {
	cases := []struct {
		in      string
		wantErr bool
	}{
		{"2026-10-18", false},
		{"2028-02-29", false}, // bissexto
		{"2026-02-29", true},  // não bissexto
		{"2026-13-01", true},
		{"18/10/2026", true},
		{"", true},
	}
	for _, c := range cases {
		_, err := ParseISO(c.in)
		if (err != nil) != c.wantErr {
			t.Errorf("ParseISO(%q) erro=%v, quer erro=%v", c.in, err, c.wantErr)
		}
	}
}

func TestAddMonthsTravaNoUltimoDia(t *testing.T) {
	cases := []struct {
		in, want string
		n        int
	}{
		{"2026-01-31", "2026-02-28", 1},
		{"2028-01-31", "2028-02-29", 1}, // bissexto
		{"2026-01-31", "2026-03-31", 2},
		{"2026-03-31", "2026-04-30", 1},
		{"2026-10-15", "2027-01-15", 3}, // vira o ano
		{"2026-01-15", "2025-11-15", -2},
		{"2026-08-01", "2027-01-01", 5},
	}
	for _, c := range cases {
		got := mustParse(t, c.in).AddMonths(c.n).String()
		if got != c.want {
			t.Errorf("%s + %d meses = %s, quer %s", c.in, c.n, got, c.want)
		}
	}
}

func TestWithDayClamped(t *testing.T) {
	if got := mustParse(t, "2026-02-01").WithDayClamped(31).String(); got != "2026-02-28" {
		t.Errorf("got %s", got)
	}
	if got := mustParse(t, "2026-05-01").WithDayClamped(31).String(); got != "2026-05-31" {
		t.Errorf("got %s", got)
	}
}

func TestStartOfMonth(t *testing.T) {
	d := mustParse(t, "2026-10-18")
	if got := d.StartOfMonth().String(); got != "2026-10-01" {
		t.Errorf("got %s", got)
	}
	if !d.StartOfMonth().IsStartOfMonth() || d.IsStartOfMonth() {
		t.Error("IsStartOfMonth incorreto")
	}
}

func TestFromTimeIgnoraFuso(t *testing.T) {
	sp, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Skip("tzdata indisponível")
	}
	// 01:00 de 19/out em UTC ainda é 18/out em São Paulo (UTC-3).
	instante := time.Date(2026, 10, 19, 1, 0, 0, 0, time.UTC)
	if got := FromTime(instante.In(sp)).String(); got != "2026-10-18" {
		t.Errorf("got %s, quer 2026-10-18", got)
	}
}

func TestJSON(t *testing.T) {
	type payload struct {
		D Date `json:"d"`
		Z Date `json:"z"`
	}
	b, err := json.Marshal(payload{D: mustParse(t, "2026-10-18")})
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"d":"2026-10-18","z":null}` {
		t.Errorf("marshal = %s", b)
	}
	var p payload
	if err := json.Unmarshal([]byte(`{"d":"2026-02-28","z":null}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.D.String() != "2026-02-28" || !p.Z.IsZero() {
		t.Errorf("unmarshal = %+v", p)
	}
	if err := json.Unmarshal([]byte(`{"d":"2026-02-30"}`), &p); err == nil {
		t.Error("deveria rejeitar data inexistente")
	}
	if err := json.Unmarshal([]byte(`{"d":20261018}`), &p); err == nil {
		t.Error("deveria rejeitar número")
	}
}

func TestScanValue(t *testing.T) {
	var d Date
	if err := d.Scan(time.Date(2026, 10, 18, 15, 30, 0, 0, time.UTC)); err != nil || d.String() != "2026-10-18" {
		t.Errorf("scan time: %v %s", err, d)
	}
	if err := d.Scan(nil); err != nil || !d.IsZero() {
		t.Errorf("scan nil: %v", err)
	}
	if err := d.Scan(42); err == nil {
		t.Error("deveria rejeitar int")
	}
	v, _ := mustParse(t, "2026-10-18").Value()
	if _, ok := v.(time.Time); !ok {
		t.Errorf("Value = %T", v)
	}
	if v, _ := (Date{}).Value(); v != nil {
		t.Error("zero deveria virar NULL")
	}
}

func mustParse(t *testing.T, s string) Date {
	t.Helper()
	d, err := ParseISO(s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}
