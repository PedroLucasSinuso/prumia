# shellcheck shell=bash disable=SC2016
# (SC2016: as aspas simples em `sh -c '...$POSTGRES_USER...'` são de propósito: as variáveis expandem DENTRO do container.)
# Funções comuns de backup.sh, restore.sh e test-restore.sh. Não execute direto: é carregado com `source`.
#
# Tudo roda DENTRO do container `db` (docker compose exec), então o host não precisa de cliente Postgres.
# Usuário e banco vêm das variáveis do próprio container (POSTGRES_USER/POSTGRES_DB); a senha nunca é lida nem impressa
# (dentro do container o psql conecta pelo socket local, sem senha).
#
# Variáveis aceitas (todas opcionais):
#   PRUMIA_ENV_FILE         .env usado pelo compose (padrão: <repo>/.env)
#   PRUMIA_COMPOSE_PROJECT  nome do projeto compose (padrão: o do compose.yaml, "prumia")
#   BACKUP_DIR              onde ficam os backups (padrão: <repo>/backups; caminho relativo = relativo à raiz do repo)
#   BACKUP_KEEP             quantos backups manter na rotação (padrão: 14)

# Raiz do repositório, a partir da localização deste arquivo (funciona de qualquer diretório).
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_FILE="${PRUMIA_ENV_FILE:-$REPO_DIR/.env}"
COMPOSE_FILE="$REPO_DIR/deploy/compose.yaml"

BACKUP_DIR="${BACKUP_DIR:-backups}"
case "$BACKUP_DIR" in
  /*) ;;
  *) BACKUP_DIR="$REPO_DIR/$BACKUP_DIR" ;;
esac
BACKUP_KEEP="${BACKUP_KEEP:-14}"

die() {
  echo "erro: $*" >&2
  exit 1
}

info() {
  echo "==> $*"
}

# dc: docker compose apontando para o compose e o .env do projeto.
# Cuidado: `dc exec -T` lê a entrada padrão. Quando o comando não precisa dela, use `</dev/null`, senão ele "come" o que
# a pessoa digitaria depois (ex.: a confirmação do restore).
dc() {
  local args=(--env-file "$ENV_FILE" -f "$COMPOSE_FILE")
  if [ -n "${PRUMIA_COMPOSE_PROJECT:-}" ]; then
    args+=(-p "$PRUMIA_COMPOSE_PROJECT")
  fi
  docker compose "${args[@]}" "$@"
}

# require_db: falha com mensagem clara se o .env ou o container do banco não estiverem prontos.
require_db() {
  command -v docker >/dev/null 2>&1 || die "docker não encontrado"
  [ -f "$ENV_FILE" ] || die "arquivo de ambiente $ENV_FILE não existe (rode make env)"
  if [ -z "$(dc ps --status running -q db 2>/dev/null </dev/null)" ]; then
    die "o container do banco (db) não está rodando; suba o app com make up"
  fi
}

# db_name: nome do banco real (POSTGRES_DB do container).
db_name() {
  dc exec -T db sh -c 'printf %s "$POSTGRES_DB"' </dev/null
}

# psql_in <banco>: roda o SQL lido da entrada padrão no banco indicado; saída sem cabeçalho, colunas separadas por "|".
psql_in() {
  dc exec -T db sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -At' sh "$1"
}

# check_dump <arquivo>: confere que o arquivo existe, não está vazio e é um dump válido (pg_restore --list).
check_dump() {
  local f="$1"
  [ -f "$f" ] || die "arquivo não encontrado: $f"
  [ -s "$f" ] || die "arquivo vazio: $f"
  local n
  if ! n=$(dc exec -T db pg_restore --list <"$f" 2>/dev/null | grep -cv '^;'); then
    die "arquivo não é um backup válido (pg_restore --list falhou): $f"
  fi
  [ "$n" -gt 0 ] || die "backup sem nenhum objeto: $f"
}

# valid_db_ident <nome>: só aceita nomes simples (evita injeção de SQL e erros de digitação estranhos).
valid_db_ident() {
  [[ "$1" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]
}

# recreate_db <banco>: apaga (derrubando conexões) e cria o banco vazio. Conecta no banco "postgres" para isso.
recreate_db() {
  local target="$1"
  valid_db_ident "$target" || die "nome de banco inválido: $target"
  psql_in postgres <<SQL >/dev/null
SET client_min_messages = warning;
DROP DATABASE IF EXISTS "$target" WITH (FORCE);
CREATE DATABASE "$target";
SQL
}

# drop_db <banco>: apaga o banco se existir.
drop_db() {
  local target="$1"
  valid_db_ident "$target" || die "nome de banco inválido: $target"
  printf 'SET client_min_messages = warning;\nDROP DATABASE IF EXISTS "%s" WITH (FORCE);\n' "$target" | psql_in postgres >/dev/null
}

# restore_into <arquivo> <banco>: carrega o dump num banco (que já deve existir, vazio).
# --no-owner/--no-privileges: o dono vira o usuário do container, mesmo que o dump venha de outro usuário.
restore_into() {
  local f="$1" target="$2"
  dc exec -T db sh -c 'pg_restore --no-owner --no-privileges --exit-on-error -U "$POSTGRES_USER" -d "$1"' sh "$target" <"$f"
}

# latest_backup: caminho do backup mais recente em BACKUP_DIR (vazio se não houver).
latest_backup() {
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'prumia-*.dump' 2>/dev/null | sort | tail -n 1
}
