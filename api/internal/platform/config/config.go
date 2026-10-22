// Package config lê a configuração da aplicação das variáveis de ambiente (12-factor).
// Nada de arquivo de config: no Docker/compose as variáveis vêm do ambiente, e o .env local
// é carregado pelo próprio compose.
package config

import (
	"errors"
	"fmt"
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
	}

	var problems []error
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
