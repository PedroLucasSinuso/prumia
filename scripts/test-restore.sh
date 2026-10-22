#!/usr/bin/env bash
# Teste automatizado de restore: prova que um backup volta inteiro.
# Uso: scripts/test-restore.sh [arquivo.dump]      (ou: make test-restore [FILE=...])
#
# Sem arquivo, gera um backup novo agora (assim a comparação com o banco real é justa). Com arquivo, usa esse
# (ou "latest" para o mais recente de BACKUP_DIR); nesse caso, se o app recebeu dados depois do backup, as contagens
# divergem de propósito e o teste falha.
#
# Restaura num banco temporário (prumia_restore_test) do mesmo Postgres, compara com o banco real a contagem de linhas
# de TODAS as tabelas do schema public (users, households, invoices, incomes, ...) e a versão do goose, e apaga o banco
# temporário no fim (mesmo se falhar). Sai com código 1 se algo divergir.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TEST_DB="prumia_restore_test"

require_db
real="$(db_name)"

file="${1:-}"
if [ -z "$file" ]; then
  info "gerando um backup novo para testar"
  "$REPO_DIR/scripts/backup.sh"
  file="$(latest_backup)"
elif [ "$file" = "latest" ]; then
  file="$(latest_backup)"
  [ -n "$file" ] || die "nenhum backup em $BACKUP_DIR"
fi
info "testando $file"
check_dump "$file"

trap 'drop_db "$TEST_DB" || echo "aviso: não consegui apagar o banco $TEST_DB" >&2' EXIT

info "restaurando em \"$TEST_DB\""
recreate_db "$TEST_DB"
restore_into "$file" "$TEST_DB" || die "pg_restore falhou"

# Uma linha por tabela: "tabela|linhas". query_to_xml permite contar todas numa consulta só, sem SQL dinâmico no shell.
COUNTS_SQL="
SELECT table_name || '|' ||
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;"
GOOSE_SQL="SELECT coalesce(max(version_id), 0) FROM goose_db_version WHERE is_applied;"

src_counts=$(psql_in "$real" <<<"$COUNTS_SQL")
dst_counts=$(psql_in "$TEST_DB" <<<"$COUNTS_SQL")
src_goose=$(psql_in "$real" <<<"$GOOSE_SQL")
dst_goose=$(psql_in "$TEST_DB" <<<"$GOOSE_SQL") || dst_goose="(sem goose_db_version)"

fail=0
printf '%-28s %10s %10s\n' "tabela" "origem" "restaurado"
# join -a1 -a2: mostra também tabelas que só existem de um lado.
while IFS='|' read -r table src dst; do
  mark=""
  if [ "$src" != "$dst" ]; then
    mark="  <- DIVERGE"
    fail=1
  fi
  printf '%-28s %10s %10s%s\n' "$table" "${src:--}" "${dst:--}" "$mark"
done < <(LC_ALL=C join -t '|' -a1 -a2 -e '' -o '0,1.2,2.2' \
  <(LC_ALL=C sort -t '|' -k1,1 <<<"$src_counts") <(LC_ALL=C sort -t '|' -k1,1 <<<"$dst_counts"))

printf '%-28s %10s %10s' "goose: max(version_id)" "$src_goose" "$dst_goose"
if [ "$src_goose" != "$dst_goose" ]; then
  printf '  <- DIVERGE'
  fail=1
fi
echo

[ -n "$src_counts" ] || { echo "erro: o banco de origem não tem tabelas" >&2; fail=1; }

if [ "$fail" = 1 ]; then
  echo "FALHOU: o backup restaurado não confere com o banco \"$real\"." >&2
  exit 1
fi
info "OK: restore conferido ($(echo "$dst_counts" | wc -l) tabelas, goose $dst_goose)"
