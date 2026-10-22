#!/usr/bin/env bash
# Gera um backup do banco do prumia (pg_dump formato custom) em BACKUP_DIR e aplica a rotação.
# Uso: scripts/backup.sh        (ou: make backup)
# Variáveis: BACKUP_DIR (padrão ./backups), BACKUP_KEEP (padrão 14). Ver scripts/lib.sh.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[[ "$BACKUP_KEEP" =~ ^[1-9][0-9]*$ ]] || die "BACKUP_KEEP deve ser um inteiro >= 1 (veio: $BACKUP_KEEP)"
require_db

# umask 077: diretório 700 e arquivos 600 desde a criação (o dump tem dados financeiros e hashes de senha).
umask 077
mkdir -p "$BACKUP_DIR"

db="$(db_name)"
name="prumia-$(date +%Y%m%d-%H%M%S).dump"
final="$BACKUP_DIR/$name"
[ -e "$final" ] && die "já existe um backup com este nome: $final (espere um segundo e tente de novo)"
tmp="$BACKUP_DIR/.$name.partial"

# Se algo falhar no meio, não deixa arquivo parcial para trás.
trap 'rm -f "$tmp"' EXIT

info "gerando backup do banco \"$db\""
# shellcheck disable=SC2016 # variáveis expandem dentro do container
dc exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' </dev/null >"$tmp"

check_dump "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$final"
trap - EXIT

size=$(du -h "$final" | cut -f1)
info "backup ok: $final ($size)"

# Rotação: mantém só os BACKUP_KEEP mais recentes (o nome com data e hora ordena do mais antigo ao mais novo).
mapfile -t old < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'prumia-*.dump' | sort | head -n "-$BACKUP_KEEP")
for f in "${old[@]}"; do
  rm -f -- "$f"
  info "rotação: removido $(basename "$f")"
done
