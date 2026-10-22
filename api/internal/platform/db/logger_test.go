package db_test

import (
	"bytes"
	"strings"
	"testing"

	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/db"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/dbtest"
)

// O log de SQL nunca pode levar os VALORES dos parâmetros: são e-mails, hashes de token e senha, linhas digitáveis,
// valores de contas. Vale para o modo verboso (desenvolvimento) e para os erros/lentidões logados em produção.
func TestLogDeSQLNaoTrazValoresDosParametros(t *testing.T) {
	gdb := dbtest.New(t)
	for _, verbose := range []bool{true, false} {
		var buf bytes.Buffer
		s := gdb.Session(&gorm.Session{Logger: db.NewLogger(&buf, verbose)})

		var out string
		s.Raw("SELECT ?::text", "segredo-consulta-123").Scan(&out)
		// erro de SQL: em produção é logado (o nível Warn inclui erros)
		s.Exec("SELECT nao_existe FROM users WHERE email = ?", "segredo-erro-456")
		// "não encontrado" é fluxo normal (login com e-mail errado): não deve nem ir para o log
		var u struct{ ID string }
		s.Table("users").Where("email = ?", "segredo-login-789").First(&u)

		logged := buf.String()
		for _, secret := range []string{"segredo-consulta-123", "segredo-erro-456", "segredo-login-789"} {
			if strings.Contains(logged, secret) {
				t.Errorf("verbose=%v: o log trouxe o valor %q:\n%s", verbose, secret, logged)
			}
		}
		if !strings.Contains(logged, "nao_existe") {
			t.Errorf("verbose=%v: o erro de SQL deveria aparecer no log (sem os valores):\n%s", verbose, logged)
		}
		if strings.Contains(logged, "record not found") {
			t.Errorf("verbose=%v: \"record not found\" não deveria ser logado:\n%s", verbose, logged)
		}
	}
}
