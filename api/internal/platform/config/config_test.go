package config

import (
	"strings"
	"testing"
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
