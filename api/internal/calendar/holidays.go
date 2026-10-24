package calendar

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
)

// Esta é, com a consulta de CNPJ, a única saída de rede da API. Só o ANO vai na URL (nenhum dado pessoal).
// Regras (as mesmas do pacote brasilapi): prazo curto, resposta com tamanho máximo, cache e degradação graciosa:
// se a API cair, o app segue com os feriados calculados localmente (fallback.go).
const (
	DefaultBaseURL = "https://brasilapi.com.br/api/feriados/v1"
	timeout        = 4 * time.Second
	maxBody        = 1 << 20
	okTTL          = 30 * 24 * time.Hour // feriados nacionais quase não mudam
	failTTL        = 10 * time.Minute    // depois de uma falha, usa o cálculo local e tenta a API de novo mais tarde
	minYear        = 1900                // faixa que a BrasilAPI atende; fora dela, só cálculo local
	maxYear        = 2199
	maxEntries     = 100
	minHolidays    = 8 // resposta com menos feriados que isso é considerada estranha
)

type yearEntry struct {
	days    map[caldate.Date]string
	expires time.Time
}

// Calendar entrega os feriados nacionais por ano: API (com cache em memória) ou, na falta dela, o cálculo local.
// O valor zero NÃO serve: use New. É seguro para uso simultâneo (o servidor atende requisições em paralelo).
type Calendar struct {
	baseURL string // vazio = modo offline
	http    *http.Client
	now     func() time.Time

	mu    sync.Mutex
	cache map[int]yearEntry
}

// New cria o calendário. baseURL "off" (ou vazio) desliga a consulta externa: só o cálculo local.
// Nunca devolve nil, para quem usa não precisar checar.
func New(baseURL string) *Calendar {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.EqualFold(baseURL, "off") {
		baseURL = ""
	}
	return &Calendar{baseURL: baseURL, http: &http.Client{Timeout: timeout}, now: time.Now, cache: map[int]yearEntry{}}
}

// Func devolve um HolidayFunc ligado ao contexto da requisição, para passar às funções puras. Cada chamada resolve o ano
// da data (cache em memória) e nunca falha: no pior caso usa o cálculo local.
func (c *Calendar) Func(ctx context.Context) HolidayFunc {
	return func(d caldate.Date) bool {
		_, ok := c.year(ctx, d.Year())[d]
		return ok
	}
}

// Holidays lista os feriados do ano (para exibir na tela ou depurar).
func (c *Calendar) Holidays(ctx context.Context, year int) map[caldate.Date]string {
	return c.year(ctx, year)
}

func (c *Calendar) year(ctx context.Context, year int) map[caldate.Date]string {
	if e, ok := c.cached(year); ok {
		return e
	}
	days, ok := c.fetch(ctx, year)
	ttl := okTTL
	if !ok {
		days = computedSet(year)
		ttl = failTTL
		if c.baseURL == "" {
			ttl = okTTL // offline de propósito: não há o que tentar de novo
		}
	}
	c.store(year, yearEntry{days: days, expires: c.now().Add(ttl)})
	return days
}

func computedSet(year int) map[caldate.Date]string {
	out := map[caldate.Date]string{}
	for _, h := range ComputedHolidays(year) {
		out[h.Date] = h.Name
	}
	return out
}

// fetch consulta a API. ok=false em qualquer problema (rede, status, JSON, resposta estranha).
func (c *Calendar) fetch(ctx context.Context, year int) (map[caldate.Date]string, bool) {
	if c.baseURL == "" || year < minYear || year > maxYear {
		return nil, false
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/%d", c.baseURL, year), nil)
	if err != nil {
		return nil, false
	}
	req.Header.Set("Accept", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, false
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, false
	}
	var body []struct {
		Date string `json:"date"`
		Name string `json:"name"`
		Type string `json:"type"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, maxBody)).Decode(&body); err != nil {
		return nil, false
	}
	out := map[caldate.Date]string{}
	for _, h := range body {
		d, err := caldate.ParseISO(h.Date)
		// Só feriados nacionais do ano pedido (defesa contra resposta trocada ou com lixo).
		if err != nil || d.Year() != year || (h.Type != "" && h.Type != "national") {
			continue
		}
		out[d] = h.Name
	}
	if len(out) < minHolidays {
		return nil, false
	}
	return out, true
}

func (c *Calendar) cached(year int) (map[caldate.Date]string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.cache[year]
	if !ok || !c.now().Before(e.expires) {
		delete(c.cache, year)
		return nil, false
	}
	return e.days, true
}

func (c *Calendar) store(year int, e yearEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.cache) >= maxEntries { // teto simples: zera tudo (uso doméstico, nunca chega perto)
		c.cache = map[int]yearEntry{}
	}
	c.cache[year] = e
}
