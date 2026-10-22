package config

import (
	"strings"
	"testing"
	"time"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := load(env(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Env != "development" || cfg.HTTPAddr != ":8080" || cfg.Location.String() != "America/Sao_Paulo" {
		t.Errorf("defaults inesperados: %+v", cfg)
	}
	if cfg.IsProduction() {
		t.Error("development não é produção")
	}
}

func TestLoadAutoMigrate(t *testing.T) {
	cfg, _ := load(env(map[string]string{"DATABASE_URL": "postgres://x", "AUTO_MIGRATE": "true"}))
	if !cfg.AutoMigrate {
		t.Error("AUTO_MIGRATE=true deveria ligar")
	}
	cfg, _ = load(env(map[string]string{"DATABASE_URL": "postgres://x"}))
	if cfg.AutoMigrate {
		t.Error("padrão deve ser desligado")
	}
}

func TestLoadAcumulaErros(t *testing.T) {
	_, err := load(env(map[string]string{"APP_ENV": "staging", "APP_TIMEZONE": "Marte/Olimpo"}))
	if err == nil {
		t.Fatal("deveria falhar")
	}
	for _, want := range []string{"APP_ENV", "DATABASE_URL", "APP_TIMEZONE"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("erro deveria citar %s: %v", want, err)
		}
	}
}

func TestLoadLimitesDeCasaESessao(t *testing.T) {
	cfg, err := load(env(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MaxHouseholdsPerUser != 5 || cfg.SessionMaxAge != 90*24*time.Hour {
		t.Errorf("padrões: %d casas, %s", cfg.MaxHouseholdsPerUser, cfg.SessionMaxAge)
	}
	cfg, err = load(env(map[string]string{"DATABASE_URL": "postgres://x", "MAX_HOUSEHOLDS_PER_USER": "2", "SESSION_MAX_AGE_DAYS": "7"}))
	if err != nil || cfg.MaxHouseholdsPerUser != 2 || cfg.SessionMaxAge != 7*24*time.Hour {
		t.Errorf("valores lidos: %+v %v", cfg, err)
	}
	_, err = load(env(map[string]string{"DATABASE_URL": "postgres://x", "MAX_HOUSEHOLDS_PER_USER": "0", "SESSION_MAX_AGE_DAYS": "abc"}))
	if err == nil || !strings.Contains(err.Error(), "MAX_HOUSEHOLDS_PER_USER") || !strings.Contains(err.Error(), "SESSION_MAX_AGE_DAYS") {
		t.Errorf("deveria recusar valores inválidos: %v", err)
	}
}
