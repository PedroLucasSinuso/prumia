// Package rates lê as taxas de referência (CDI, Selic e IPCA acumulado em 12 meses) da BrasilAPI (GET /taxas/v1). Servem só
// para comparar: o app nunca depende delas. Regras de API de terceiros (as mesmas de calendar e brasilapi): só o servidor
// chama, nenhum dado vai na requisição (a URL é fixa), prazo curto, resposta com tamanho máximo, cache em memória e
// degradação graciosa (sem a API, devolve a última leitura boa marcada como indisponível, ou nada).
package rates

import (
	"context"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	DefaultURL = "https://brasilapi.com.br/api/taxas/v1"
	timeout    = 4 * time.Second
	maxBody    = 64 << 10
	okTTL      = 12 * time.Hour   // as taxas mudam no máximo uma vez por dia (IPCA, uma vez por mês)
	failTTL    = 10 * time.Minute // depois de uma falha, espera um pouco antes de tentar de novo
	// Faixa plausível em centésimos de ponto percentual (-50% a 100% ao ano): fora disso, a resposta é tratada como lixo.
	minBP = -5000
	maxBP = 10000
)

// Rate: uma taxa. BasisPoints são centésimos de ponto percentual (1490 = 14,90% ao ano): inteiro, como o dinheiro no app,
// para nada de float no domínio. O IPCA da BrasilAPI é o acumulado em 12 meses.
type Rate struct {
	Code        string // cdi, selic, ipca
	Name        string // para exibir
	BasisPoints int64
}

// Snapshot é o que o app sabe agora. Available=false: a última consulta falhou (ou está desligada); Rates traz então a
// última leitura boa, se houver, e FetchedAt diz de quando ela é.
type Snapshot struct {
	Available bool
	FetchedAt *time.Time
	Rates     []Rate
}

// known: as taxas que o app usa, na ordem de exibição. A BrasilAPI devolve "CDI", "SELIC" e "IPCA" (ignoramos maiúsculas).
var known = []struct{ api, code, name string }{
	{"cdi", "cdi", "CDI"},
	{"selic", "selic", "Selic"},
	{"ipca", "ipca", "IPCA"},
}

// Client: use New. Seguro para uso simultâneo (o servidor atende requisições em paralelo; o mutex protege o cache).
type Client struct {
	url  string // vazio = desligado
	http *http.Client
	now  func() time.Time

	mu       sync.Mutex
	last     []Rate    // última leitura boa
	lastAt   time.Time // quando ela foi lida
	ok       bool      // a última tentativa deu certo
	retryAt  time.Time // antes disso, não consulta de novo
	inFlight bool
}

// New cria o cliente. url "off" (ou vazio) desliga a consulta: Current sempre devolve indisponível.
func New(url string) *Client {
	url = strings.TrimRight(strings.TrimSpace(url), "/")
	if strings.EqualFold(url, "off") {
		url = ""
	}
	return &Client{url: url, http: &http.Client{Timeout: timeout}, now: time.Now}
}

// Current devolve as taxas, consultando a BrasilAPI só quando o cache venceu. Nunca devolve erro: falha vira Available=false.
func (c *Client) Current(ctx context.Context) Snapshot {
	if c.url == "" {
		return Snapshot{Rates: []Rate{}}
	}
	c.mu.Lock()
	due := !c.now().Before(c.retryAt) && !c.inFlight
	if due {
		c.inFlight = true // só uma consulta por vez; as outras requisições usam o que já há
	}
	c.mu.Unlock()

	if due {
		got, ok := c.fetch(ctx)
		c.mu.Lock()
		c.inFlight = false
		c.ok = ok
		if ok {
			c.last, c.lastAt = got, c.now()
			c.retryAt = c.now().Add(okTTL)
		} else {
			c.retryAt = c.now().Add(failTTL)
		}
		c.mu.Unlock()
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	out := Snapshot{Available: c.ok, Rates: append([]Rate{}, c.last...)}
	if !c.lastAt.IsZero() {
		at := c.lastAt
		out.FetchedAt = &at
	}
	return out
}

// fetch consulta a API. ok=false em qualquer problema (rede, status, JSON, nenhuma taxa conhecida, valor fora da faixa).
func (c *Client) fetch(ctx context.Context) ([]Rate, bool) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel() // defer: roda ao sair da função, como um finally do PHP
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
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
		Nome  string      `json:"nome"`
		Valor json.Number `json:"valor"` // json.Number guarda o texto do número: convertemos sem passar por float
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, maxBody)).Decode(&body); err != nil {
		return nil, false
	}
	byName := map[string]int64{}
	for _, r := range body {
		bp, ok := basisPoints(r.Valor)
		if !ok {
			return nil, false // um valor estranho invalida a resposta toda
		}
		byName[strings.ToLower(strings.TrimSpace(r.Nome))] = bp
	}
	out := []Rate{}
	for _, k := range known {
		if bp, ok := byName[k.api]; ok {
			out = append(out, Rate{Code: k.code, Name: k.name, BasisPoints: bp})
		}
	}
	return out, len(out) > 0
}

// basisPoints converte "14.9" em 1490 (arredonda para o centésimo mais próximo), com aritmética exata (big.Rat).
func basisPoints(n json.Number) (int64, bool) {
	r, ok := new(big.Rat).SetString(n.String())
	if !ok {
		return 0, false
	}
	r.Mul(r, big.NewRat(100, 1))
	// Arredonda meio para longe do zero: soma ±1/2 e trunca.
	half := big.NewRat(1, 2)
	if r.Sign() < 0 {
		half.Neg(half)
	}
	r.Add(r, half)
	q := new(big.Int).Quo(r.Num(), r.Denom())
	if !q.IsInt64() {
		return 0, false
	}
	v := q.Int64()
	return v, v >= minBP && v <= maxBP
}
