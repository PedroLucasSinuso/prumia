#!/usr/bin/env bash
# Restaura um backup do prumia.
# Uso: scripts/restore.sh [--target <banco>] <arquivo.dump>      (ou: make restore FILE=... [TARGET=...])
#
# Sem --target, o alvo é o banco REAL do app: pede para digitar o nome do banco, faz antes um backup de segurança,
# para a API durante a restauração e a sobe de novo no fim.
# Com --target, restaura num outro banco do mesmo Postgres (criado do zero; se já existir, pede confirmação),
# sem tocar no banco real: bom para conferir um backup antes de confiar nele.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() {
  echo "uso: $0 [--target <banco>] <arquivo.dump>" >&2
  exit 2
}

target=""
file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target)
      [ $# -ge 2 ] || usage
      target="$2"
      shift 2
      ;;
    -h | --help) usage ;;
    -*) echo "opção desconhecida: $1" >&2; usage ;;
    *)
      [ -z "$file" ] || usage
      file="$1"
      shift
      ;;
  esac
done
[ -n "$file" ] || usage

require_db
real="$(db_name)"
[ -n "$target" ] || target="$real"
valid_db_ident "$target" || die "nome de banco inválido: $target (use letras minúsculas, números e _)"
case "$target" in
  postgres | template0 | template1) die "não restauro sobre o banco de sistema \"$target\"" ;;
esac

info "conferindo o arquivo $file"
check_dump "$file"

# confirm <banco>: exige que a pessoa digite o nome exato do banco.
confirm() {
  local answer=""
  printf 'Para continuar, digite o nome do banco (%s): ' "$1" >&2
  read -r answer || true
  [ "$answer" = "$1" ] || die "confirmação não confere; nada foi alterado"
}

exists=$(echo "SELECT 1 FROM pg_database WHERE datname = '$target';" | psql_in postgres)

api_stopped=0
restart_api() {
  if [ "$api_stopped" = 1 ]; then
    info "subindo a API de novo"
    dc start api >/dev/null </dev/null
  fi
}

if [ "$target" = "$real" ]; then
  echo "ATENÇÃO: isto SUBSTITUI todo o conteúdo do banco real \"$real\" pelo conteúdo de $(basename "$file")." >&2
  echo "Tudo o que foi lançado depois desse backup será perdido (um backup de segurança é feito antes)." >&2
  confirm "$real"

  info "backup de segurança antes de restaurar"
  "$REPO_DIR/scripts/backup.sh" </dev/null
  safety="$(latest_backup)"

  if [ -n "$(dc ps --status running -q api 2>/dev/null </dev/null)" ]; then
    info "parando a API durante a restauração"
    dc stop api >/dev/null </dev/null
    api_stopped=1
  fi
  trap restart_api EXIT

  info "recriando o banco \"$real\" e carregando o backup"
  recreate_db "$real"
  if ! restore_into "$file" "$real"; then
    echo "erro: a restauração falhou; o banco pode estar incompleto." >&2
    echo "Para voltar ao estado de antes: $0 $safety" >&2
    exit 1
  fi
  info "restauração concluída no banco real \"$real\" (backup de segurança: $safety)"
else
  if [ -n "$exists" ]; then
    echo "O banco \"$target\" já existe e será APAGADO e recriado." >&2
    confirm "$target"
  fi
  info "criando o banco \"$target\" e carregando o backup"
  recreate_db "$target"
  restore_into "$file" "$target" || die "a restauração em \"$target\" falhou"
  info "restauração concluída em \"$target\" (o banco real \"$real\" não foi tocado)"
  echo "Para apagar este banco depois, veja docs/developer-guide/backup-restore.md (seção \"Restaurar em outro banco\")."
fi
