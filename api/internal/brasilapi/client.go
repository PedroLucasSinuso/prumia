// Package brasilapi consulta dados públicos de empresas (CNPJ) na BrasilAPI (https://brasilapi.com.br).
//
// Regras: só o CNPJ (dado público) sai do servidor; a chamada tem prazo curto e a resposta tem tamanho máximo; o resultado
// fica em cache; e a API é opcional: se cair, quem chama segue com o que já tinha (o app nunca depende dela).
package brasilapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/cnpj"
)

var (
	ErrNotFound    = errors.New("CNPJ não encontrado")
	ErrUnavailable = errors.New("consulta de CNPJ indisponível")
)

// Company é o que usamos da resposta: razão social e nome fantasia (pode vir vazio).
type Company struct {
	CNPJ      string
	LegalName string
	TradeName string
}

const (
	DefaultBaseURL = "https://brasilapi.com.br/api/cnpj/v1"
	timeout        = 4 * time.Second
	maxBody        = 1 << 20 // 1 MB: a resposta real tem poucos KB
	foundTTL       = 24 * time.Hour
	missTTL        = 10 * time.Minute // "não existe" também vai para o cache, para não repetir consulta inútil
	maxEntries     = 1000
)

type entry struct {
	company Company
	found   bool
	expires time.Time
}

// Client consulta e guarda em cache (em memória; some ao reiniciar, e tudo bem).
type Client struct {
	baseURL string
	http    *http.Client
	now     func() time.Time

	mu    sync.Mutex // o servidor atende requisições em paralelo: o mapa precisa de trava
	cache map[string]entry
}

// New devolve nil quando baseURL é "off" ou vazio: o chamador trata nil como "sem consulta".
func New(baseURL string) *Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" || strings.EqualFold(baseURL, "off") {
		return nil
	}
	return &Client{baseURL: baseURL, http: &http.Client{Timeout: timeout}, now: time.Now, cache: map[string]entry{}}
}

// Lookup devolve a empresa do CNPJ. ErrNotFound = a API respondeu que não existe; ErrUnavailable = falha, prazo estourado
// ou resposta estranha (nesse caso não guarda nada no cache).
func (c *Client) Lookup(ctx context.Context, raw string) (Company, error) {
	if c == nil {
		return Company{}, ErrUnavailable
	}
	// Valida antes de montar a URL: só 14 dígitos com DV corretos chegam à rede (nada de texto livre na URL).
	if !cnpj.Valid(raw) {
		return Company{}, ErrNotFound
	}
	d := cnpj.Digits(raw)
	if e, ok := c.cached(d); ok {
		if !e.found {
			return Company{}, ErrNotFound
		}
		return e.company, nil
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/"+d, nil)
	if err != nil {
		return Company{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	req.Header.Set("Accept", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return Company{}, ErrUnavailable
	}
	defer res.Body.Close()

	switch {
	case res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusBadRequest:
		c.store(d, entry{found: false, expires: c.now().Add(missTTL)})
		return Company{}, ErrNotFound
	case res.StatusCode != http.StatusOK:
		return Company{}, ErrUnavailable
	}
	var body struct {
		CNPJ         string `json:"cnpj"`
		RazaoSocial  string `json:"razao_social"`
		NomeFantasia string `json:"nome_fantasia"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, maxBody)).Decode(&body); err != nil || strings.TrimSpace(body.RazaoSocial) == "" {
		return Company{}, ErrUnavailable
	}
	// A resposta tem de ser da empresa que pedimos (defesa contra resposta trocada).
	if got := cnpj.Digits(body.CNPJ); got != "" && got != d {
		return Company{}, ErrUnavailable
	}
	company := Company{CNPJ: d, LegalName: clean(body.RazaoSocial), TradeName: clean(body.NomeFantasia)}
	c.store(d, entry{company: company, found: true, expires: c.now().Add(foundTTL)})
	return company, nil
}

func clean(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 120 {
		s = string(r[:120])
	}
	return s
}

func (c *Client) cached(d string) (entry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.cache[d]
	if !ok || !c.now().Before(e.expires) {
		delete(c.cache, d)
		return entry{}, false
	}
	return e, true
}

func (c *Client) store(d string, e entry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.cache) >= maxEntries { // teto simples: zera tudo (uso doméstico, nunca chega perto)
		c.cache = map[string]entry{}
	}
	c.cache[d] = e
}
