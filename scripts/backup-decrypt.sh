#!/usr/bin/env bash
# Abre uma cópia criptografada pelo backup-offsite.sh e a deixa em BACKUP_DIR, pronta para o make restore.
# Uso: scripts/backup-decrypt.sh /caminho/prumia-AAAAMMDD-HHMMSS.dump.gpg     (ou: make backup-decrypt FILE=...)
# A senha vem de BACKUP_PASSPHRASE_FILE (padrão .backup-passphrase); sem o arquivo, o gpg pergunta no terminal.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

src="${1:-}"
[ -n "$src" ] || die "uso: $0 arquivo.dump.gpg"
[ -f "$src" ] || die "arquivo não encontrado: $src"
case "$src" in *.dump.gpg) ;; *) die "esperava um arquivo .dump.gpg: $src" ;; esac

PASS_FILE="${BACKUP_PASSPHRASE_FILE:-.backup-passphrase}"
case "$PASS_FILE" in /*) ;; *) PASS_FILE="$REPO_DIR/$PASS_FILE" ;; esac

umask 077
mkdir -p "$BACKUP_DIR"
out="$BACKUP_DIR/$(basename "${src%.gpg}")"
[ -e "$out" ] && die "já existe: $out"
partial="$out.partial"
trap 'rm -f -- "${partial:?}"' EXIT

if [ -s "$PASS_FILE" ]; then
  gpg --batch --quiet --no-symkey-cache --pinentry-mode loopback --passphrase-file "$PASS_FILE" --output "$partial" --decrypt "$src" ||
    die "não consegui abrir a cópia (senha errada ou arquivo corrompido)"
else
  gpg --quiet --no-symkey-cache --output "$partial" --decrypt "$src" || die "não consegui abrir a cópia (senha errada ou arquivo corrompido)"
fi
mv "$partial" "$out"
trap - EXIT
info "aberto em $out"
info "para restaurar: make restore FILE=$out"
