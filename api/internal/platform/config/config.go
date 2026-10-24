// Package config lê a configuração da aplicação das variáveis de ambiente (12-factor).
// Nada de arquivo de config: no Docker/compose as variáveis vêm do ambiente, e o .env local
// é carregado pelo próprio compose.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env         string         // "development" ou "production"
	HTTPAddr    string         // ex.: ":8080"
	DatabaseURL string         // ex.: postgres://user:senha@db:5432/prumia?sslmode=disable
	Location    *time.Location // fuso usado para "hoje" (as datas em si não têm fuso)
	AutoMigrate bool           // aplica as migrations pendentes ao subir (útil no compose)
	// OpenRegistration permite cadastro sem convite mesmo já havendo usuários. Padrão: fechado
	// (só o primeiro usuário se cadastra sozinho; os demais entram por convite).
	OpenRegistration bool
	// MaxHouseholdsPerUser limita as casas ativas criadas por um usuário (MAX_HOUSEHOLDS_PER_USER, padrão 5).
	MaxHouseholdsPerUser int
	// SessionMaxAge é a validade absoluta da sessão (SESSION_MAX_AGE_DAYS, padrão 90 dias).
	SessionMaxAge time.Duration
	// CNPJLookupURL é a base da consulta de CNPJ (CNPJ_LOOKUP_URL; padrão BrasilAPI). "off" desliga a consulta externa.
	CNPJLookupURL string
	// HolidaysURL é a base da consulta de feriados nacionais (HOLIDAYS_URL; padrão BrasilAPI). "off" desliga a consulta
	// externa e usa só o cálculo local. Com a consulta de CNPJ, é a única saída de rede da API.
	HolidaysURL string
	// PublicURL é o endereço pelo qual as pessoas abrem o app (PUBLIC_URL, ex.: https://app.exemplo.com.br). Vai nos links de
	// convite e de nova senha: sem ele o front usaria o endereço do navegador de quem gera o link (localhost no seu computador,
	// que não abre no celular de quem recebe). Vazio = usa o endereço do navegador.
	PublicURL string
}

// IsProduction indica se estamos em produção (ajusta modo do Gin, cookies Secure etc.).
func (c Config) IsProduction() bool { return c.Env == "production" }

// Load lê e valida o ambiente. Devolve (valor, error): o jeito idiomático de Go reportar falhas,
// no lugar de exceções. Quem chama é obrigado a olhar o erro.
func Load() (Config, error) {
	return load(os.Getenv)
}

// load recebe a função de leitura como parâmetro para os testes não precisarem mexer no ambiente real.
func load(get func(string) string) (Config, error) {
	cfg := Config{
		Env:              valueOr(get("APP_ENV"), "development"),
		HTTPAddr:         valueOr(get("HTTP_ADDR"), ":8080"),
		DatabaseURL:      get("DATABASE_URL"),
		AutoMigrate:      get("AUTO_MIGRATE") == "true",
		OpenRegistration: get("OPEN_REGISTRATION") == "true",
		CNPJLookupURL:    valueOr(get("CNPJ_LOOKUP_URL"), "https://brasilapi.com.br/api/cnpj/v1"),
		HolidaysURL:      valueOr(get("HOLIDAYS_URL"), "https://brasilapi.com.br/api/feriados/v1"),
	}

	var problems []error
	publicURL, err := parsePublicURL(get("PUBLIC_URL"))
	if err != nil {
		problems = append(problems, fmt.Errorf("PUBLIC_URL: %w", err))
	}
	cfg.PublicURL = publicURL
	if cfg.Env != "development" && cfg.Env != "production" {
		problems = append(problems, fmt.Errorf("APP_ENV inválido %q (use development ou production)", cfg.Env))
	}
	if cfg.DatabaseURL == "" {
		problems = append(problems, errors.New("DATABASE_URL é obrigatório"))
	}
	maxHouses, err := positiveInt(get("MAX_HOUSEHOLDS_PER_USER"), 5)
	if err != nil {
		problems = append(problems, fmt.Errorf("MAX_HOUSEHOLDS_PER_USER: %w", err))
	}
	cfg.MaxHouseholdsPerUser = maxHouses
	maxDays, err := positiveInt(get("SESSION_MAX_AGE_DAYS"), 90)
	if err != nil {
		problems = append(problems, fmt.Errorf("SESSION_MAX_AGE_DAYS: %w", err))
	}
	cfg.SessionMaxAge = time.Duration(maxDays) * 24 * time.Hour

	tz := valueOr(get("APP_TIMEZONE"), "America/Sao_Paulo")
	loc, err := time.LoadLocation(tz)
	if err != nil {
		problems = append(problems, fmt.Errorf("APP_TIMEZONE inválido %q: %w", tz, err))
	}
	cfg.Location = loc

	if len(problems) > 0 {
		return Config{}, errors.Join(problems...) // junta todos os erros de uma vez
	}
	return cfg, nil
}

// positiveInt lê um inteiro > 0; vazio devolve o padrão.
func positiveInt(v string, def int) (int, error) {
	if strings.TrimSpace(v) == "" {
		return def, nil
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("use um inteiro maior que zero (recebido %q)", v)
	}
	return n, nil
}

func valueOr(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

// parsePublicURL aceita vazio (desligado) ou uma origem http(s) sem caminho, como https://app.exemplo.com.br.
// A barra final é removida, para o front poder juntar "/convite?..." sem duplicar.
func parsePublicURL(raw string) (string, error) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return "", errors.New("use só o endereço, como https://app.exemplo.com.br (sem caminho, sem usuário)")
	}
	return raw, nil
}
