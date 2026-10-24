package calendar

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
)

func d(y int, m time.Month, day int) caldate.Date { return caldate.New(y, m, day) }

// Lista REAL da BrasilAPI para 2026 (GET /api/feriados/v1/2026, conferida em 23/10/2026), só as datas.
var brasilAPI2026 = []string{
	"2026-01-01", "2026-02-16", "2026-02-17", "2026-04-03", "2026-04-05", "2026-04-21", "2026-05-01",
	"2026-06-04", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25",
}

func TestFeriadosCalculadosBatemComALista2026(t *testing.T) {
	got := map[string]bool{}
	for _, h := range ComputedHolidays(2026) {
		got[h.Date.String()] = true
	}
	for _, want := range brasilAPI2026 {
		if !got[want] {
			t.Errorf("faltou %s no cálculo local", want)
		}
	}
	if len(got) != len(brasilAPI2026) {
		t.Errorf("o cálculo local tem %d feriados; a lista real tem %d", len(got), len(brasilAPI2026))
	}
}

func TestPascoa(t *testing.T) {
	for year, want := range map[int]caldate.Date{
		2024: d(2024, time.March, 31), 2025: d(2025, time.April, 20), 2026: d(2026, time.April, 5), 2027: d(2027, time.March, 28),
	} {
		if got := Easter(year); !got.Equal(want) {
			t.Errorf("Páscoa %d = %s, quer %s", year, got, want)
		}
	}
}

func TestConscienciaNegraSoDesde2024(t *testing.T) {
	has := func(year int) bool {
		for _, h := range ComputedHolidays(year) {
			if h.Date.Equal(d(year, time.November, 20)) {
				return true
			}
		}
		return false
	}
	if has(2023) || !has(2024) {
		t.Error("20/11 é feriado nacional só a partir de 2024")
	}
}

// holidays2026 usa a lista real como se fosse a resposta da API.
func holidays2026(day caldate.Date) bool {
	for _, s := range brasilAPI2026 {
		if day.String() == s {
			return true
		}
	}
	return false
}

func TestIsBusinessDay(t *testing.T) {
	cases := []struct {
		day  caldate.Date
		want bool
	}{
		{d(2026, time.October, 2), true},   // sexta
		{d(2026, time.October, 3), false},  // sábado
		{d(2026, time.October, 4), false},  // domingo
		{d(2026, time.October, 12), false}, // segunda, feriado
		{d(2026, time.February, 16), false},
		{d(2026, time.February, 18), true},
	}
	for _, c := range cases {
		if got := IsBusinessDay(c.day, holidays2026); got != c.want {
			t.Errorf("IsBusinessDay(%s) = %v", c.day, got)
		}
	}
	if IsBusinessDay(d(2026, time.October, 12), nil) != true {
		t.Error("sem feriados, segunda 12/10 é dia útil")
	}
}

func TestNthLastEContagem2026(t *testing.T) {
	cases := []struct {
		month       caldate.Date
		n           int
		nth         caldate.Date
		last        caldate.Date
		businessDay int
	}{
		{d(2026, time.October, 1), 2, d(2026, time.October, 2), d(2026, time.October, 30), 21},
		{d(2026, time.October, 1), 5, d(2026, time.October, 7), d(2026, time.October, 30), 21},
		{d(2026, time.November, 1), 2, d(2026, time.November, 4), d(2026, time.November, 30), 19},
		{d(2026, time.November, 1), 5, d(2026, time.November, 9), d(2026, time.November, 30), 19},
		{d(2026, time.December, 1), 5, d(2026, time.December, 7), d(2026, time.December, 31), 22},
		{d(2026, time.February, 1), 12, d(2026, time.February, 19), d(2026, time.February, 27), 18}, // Carnaval seg/ter
		{d(2026, time.October, 1), 40, d(2026, time.October, 30), d(2026, time.October, 30), 21},    // n além do mês: último útil
	}
	for _, c := range cases {
		if got := NthBusinessDay(c.month, c.n, holidays2026); !got.Equal(c.nth) {
			t.Errorf("%dº dia útil de %s = %s, quer %s", c.n, c.month, got, c.nth)
		}
		if got := LastBusinessDay(c.month, holidays2026); !got.Equal(c.last) {
			t.Errorf("último útil de %s = %s, quer %s", c.month, got, c.last)
		}
		if got := BusinessDaysInMonth(c.month, holidays2026); got != c.businessDay {
			t.Errorf("dias úteis de %s = %d, quer %d", c.month, got, c.businessDay)
		}
	}
}

func TestRoll(t *testing.T) {
	cases := []struct {
		name string
		day  caldate.Date
		adj  Adjust
		want caldate.Date
	}{
		{"sábado para a frente", d(2026, time.November, 28), Forward, d(2026, time.November, 30)},
		{"sábado para trás", d(2026, time.November, 28), Backward, d(2026, time.November, 27)},
		{"sábado mantido", d(2026, time.November, 28), None, d(2026, time.November, 28)},
		{"dia útil não muda", d(2026, time.November, 27), Forward, d(2026, time.November, 27)},
		{"domingo + feriado de segunda", d(2026, time.February, 15), Forward, d(2026, time.February, 18)},
		{"feriado de segunda para trás", d(2026, time.October, 12), Backward, d(2026, time.October, 9)},
		{"atravessa o mês", d(2026, time.October, 31), Forward, d(2026, time.November, 3)}, // sáb 31, seg 2/11 é feriado
		{"ajuste desconhecido não mexe", d(2026, time.November, 28), Adjust("x"), d(2026, time.November, 28)},
	}
	for _, c := range cases {
		if got := Roll(c.day, c.adj, holidays2026); !got.Equal(c.want) {
			t.Errorf("%s: Roll(%s) = %s, quer %s", c.name, c.day, got, c.want)
		}
	}
}

// servidor falso que imita a BrasilAPI.
func fakeAPI(t *testing.T, status int, body string) (*Calendar, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/2026" {
			t.Errorf("caminho inesperado %s", r.URL.Path)
		}
		w.WriteHeader(status)
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return New(srv.URL), &calls
}

func TestAPIUsadaEGuardadaEmCache(t *testing.T) {
	// Resposta com um feriado inventado (2026-03-10) para provar que veio da API e não do cálculo local.
	body := `[{"date":"2026-01-01","name":"a","type":"national"},{"date":"2026-03-10","name":"inventado","type":"national"},
	{"date":"2026-04-03","name":"c","type":"national"},{"date":"2026-04-21","name":"d","type":"national"},
	{"date":"2026-05-01","name":"e","type":"national"},{"date":"2026-09-07","name":"f","type":"national"},
	{"date":"2026-10-12","name":"g","type":"national"},{"date":"2026-12-25","name":"h","type":"national"},
	{"date":"2026-07-09","name":"estadual","type":"state"}]`
	c, calls := fakeAPI(t, 200, body)
	h := c.Func(context.Background())
	for i := 0; i < 3; i++ {
		if !h(d(2026, time.March, 10)) {
			t.Fatal("deveria usar a lista da API")
		}
	}
	if h(d(2026, time.July, 9)) {
		t.Error("feriado que não é nacional não conta")
	}
	if calls.Load() != 1 {
		t.Errorf("%d chamadas à API; o cache deveria resolver", calls.Load())
	}
	c.now = func() time.Time { return time.Now().Add(31 * 24 * time.Hour) }
	h(d(2026, time.March, 10))
	if calls.Load() != 2 {
		t.Errorf("depois do TTL deveria consultar de novo: %d", calls.Load())
	}
}

func TestFalhaDaAPICaiNoCalculoLocal(t *testing.T) {
	for name, tc := range map[string]struct {
		status int
		body   string
	}{
		"erro 500":           {500, `{"x":1}`},
		"json quebrado":      {200, `não é json`},
		"lista curta demais": {200, `[{"date":"2026-01-01","name":"a","type":"national"}]`},
	} {
		c, calls := fakeAPI(t, tc.status, tc.body)
		h := c.Func(context.Background())
		if !h(d(2026, time.November, 20)) || h(d(2026, time.November, 19)) {
			t.Errorf("%s: o cálculo local deveria responder", name)
		}
		h(d(2026, time.November, 20))
		if calls.Load() != 1 {
			t.Errorf("%s: não deveria insistir logo após falhar (%d chamadas)", name, calls.Load())
		}
	}
}

func TestOffNaoFazRede(t *testing.T) {
	c := New("off")
	if !c.Func(context.Background())(d(2026, time.December, 25)) {
		t.Error("Natal é feriado")
	}
	if got := New(" OFF ").baseURL; got != "" {
		t.Errorf("OFF deveria desligar a rede, baseURL = %q", got)
	}
}

func TestAnoForaDaFaixaUsaCalculoLocal(t *testing.T) {
	c := New("http://127.0.0.1:1") // nunca deveria ser chamado
	if !c.Func(context.Background())(d(1800, time.January, 1)) {
		t.Error("1º de janeiro é feriado em qualquer ano")
	}
}
