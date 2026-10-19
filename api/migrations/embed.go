// Package migrations embute os arquivos .sql no binário (go:embed), então a API leva o schema
// consigo e não depende de a pasta existir no servidor. As migrations são aplicadas com goose.
package migrations

import "embed"

// FS contém todos os arquivos *.sql desta pasta.
//
//go:embed *.sql
var FS embed.FS
