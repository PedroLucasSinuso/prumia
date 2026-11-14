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
	if cfg.CNPJLookupURL != "https://brasilapi.com.br/api/cnpj/v1" {
		t.Errorf("consulta de CNPJ por padrão = %q", cfg.CNPJLookupURL)
	}
	if cfg.HolidaysURL != "https://brasilapi.com.br/api/feriados/v1" {
		t.Errorf("feriados por padrão = %q", cfg.HolidaysURL)
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

func TestLoadPublicURL(t *testing.T) {
	env := func(v string) func(string) string {
		return func(k string) string {
			if k == "PUBLIC_URL" {
				return v
			}
			if k == "DATABASE_URL" {
				return "postgres://u:p@db/x"
			}
			return ""
		}
	}
	for _, c := range []struct{ in, want string }{
		{"", ""},
		{"https://app.exemplo.com.br", "https://app.exemplo.com.br"},
		{" https://app.exemplo.com.br/ ", "https://app.exemplo.com.br"},
		{"http://192.168.0.10:8080", "http://192.168.0.10:8080"},
	} {
		cfg, err := load(env(c.in))
		if err != nil || cfg.PublicURL != c.want {
			t.Errorf("PUBLIC_URL %q: got %q, %v; quero %q", c.in, cfg.PublicURL, err, c.want)
		}
	}
	for _, bad := range []string{"app.exemplo.com.br", "ftp://x.com", "https://x.com/caminho", "https://u:p@x.com", "https://x.com?a=1"} {
		if _, err := load(env(bad)); err == nil {
			t.Errorf("PUBLIC_URL %q devia ser recusado", bad)
		}
	}
}

func TestLoadPush(t *testing.T) {
	base := map[string]string{"DATABASE_URL": "postgres://x"}
	with := func(extra map[string]string) func(string) string {
		m := map[string]string{}
		for k, v := range base {
			m[k] = v
		}
		for k, v := range extra {
			m[k] = v
		}
		return env(m)
	}
	// sem chaves: desligado, hora padrão 9
	cfg, err := load(with(nil))
	if err != nil || cfg.PushEnabled() || cfg.PushDigestHour != 9 {
		t.Errorf("padrão: %+v %v", cfg, err)
	}
	// par completo + contato
	cfg, err = load(with(map[string]string{"VAPID_PUBLIC_KEY": "pub", "VAPID_PRIVATE_KEY": "priv", "VAPID_SUBJECT": "mailto:alguem@exemplo.test", "PUSH_DIGEST_HOUR": "0"}))
	if err != nil || !cfg.PushEnabled() || cfg.PushDigestHour != 0 {
		t.Errorf("ligado: %+v %v", cfg, err)
	}
	// sem VAPID_SUBJECT vale o PUBLIC_URL https
	cfg, err = load(with(map[string]string{"VAPID_PUBLIC_KEY": "pub", "VAPID_PRIVATE_KEY": "priv", "PUBLIC_URL": "https://app.exemplo.test"}))
	if err != nil || cfg.VAPIDSubject != "https://app.exemplo.test" {
		t.Errorf("contato pelo PUBLIC_URL: %q %v", cfg.VAPIDSubject, err)
	}
	for name, extra := range map[string]map[string]string{
		"só uma chave":  {"VAPID_PUBLIC_KEY": "pub"},
		"sem contato":   {"VAPID_PUBLIC_KEY": "pub", "VAPID_PRIVATE_KEY": "priv"},
		"contato ruim":  {"VAPID_PUBLIC_KEY": "pub", "VAPID_PRIVATE_KEY": "priv", "VAPID_SUBJECT": "alguem"},
		"hora inválida": {"PUSH_DIGEST_HOUR": "24"},
	} {
		if _, err := load(with(extra)); err == nil {
			t.Errorf("%s: deveria falhar", name)
		}
	}
}
