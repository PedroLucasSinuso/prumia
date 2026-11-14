#!/usr/bin/env bash
# Backup automático completo: gera o backup, confere que ele restaura, criptografa e copia para FORA deste computador.
# Uso: scripts/backup-offsite.sh        (ou: make backup-offsite; agendado por make backup-schedule)
#
# Passos (para no primeiro que falhar, com código de saída != 0; nada é enviado sem ter sido conferido):
#   1. backup.sh + test-restore.sh: dump novo, restaurado num banco temporário e comparado com o real;
#   2. gpg simétrico (AES-256) com a senha de BACKUP_PASSPHRASE_FILE: quem pega a cópia externa não lê os dados;
#   3. cópia para BACKUP_OFFSITE_DIR (pasta) e/ou BACKUP_RCLONE_REMOTE (rclone), com rotação própria;
#   4. registro em backups/last-run.txt e, se configurado, aviso ao monitor (BACKUP_HEALTHCHECK_URL).
#
# Configuração: variáveis de ambiente ou o arquivo backup.env na raiz (ver backup.env.example).
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# backup.env: só linhas CHAVE=valor das chaves conhecidas (não é executado como script). O ambiente tem prioridade.
CONF="${BACKUP_ENV_FILE:-$REPO_DIR/backup.env}"
if [ -f "$CONF" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      BACKUP_OFFSITE_DIR | BACKUP_RCLONE_REMOTE | BACKUP_OFFSITE_KEEP | BACKUP_PASSPHRASE_FILE | BACKUP_VERIFY | BACKUP_HEALTHCHECK_URL)
        [ -n "${!key:-}" ] || printf -v "$key" '%s' "$value"
        ;;
    esac
  done < <(grep -E '^[A-Z_]+=' "$CONF" || true)
fi

OFFSITE_DIR="${BACKUP_OFFSITE_DIR:-}"
RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-}"
OFFSITE_KEEP="${BACKUP_OFFSITE_KEEP:-30}"
VERIFY="${BACKUP_VERIFY:-1}"
PASS_FILE="${BACKUP_PASSPHRASE_FILE:-.backup-passphrase}"
case "$PASS_FILE" in /*) ;; *) PASS_FILE="$REPO_DIR/$PASS_FILE" ;; esac
STATUS_FILE="$BACKUP_DIR/last-run.txt"

umask 077
mkdir -p "$BACKUP_DIR"

# Qualquer saída com erro fica registrada: é o que o make backup-status mostra.
enc_tmp=""
finish() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    printf '%s FALHOU (código %s): %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$code" "${STEP:-início}" >"$STATUS_FILE"
  fi
  if [ -n "$enc_tmp" ]; then
    rm -f -- "${enc_tmp:?}"
  fi
}
trap finish EXIT

STEP="configuração"
[[ "$OFFSITE_KEEP" =~ ^[1-9][0-9]*$ ]] || die "BACKUP_OFFSITE_KEEP deve ser um inteiro >= 1 (veio: $OFFSITE_KEEP)"
[ -n "$OFFSITE_DIR$RCLONE_REMOTE" ] || die "nenhum destino: defina BACKUP_OFFSITE_DIR e/ou BACKUP_RCLONE_REMOTE no backup.env (modelo: backup.env.example)"
command -v gpg >/dev/null 2>&1 || die "gpg não encontrado (instale o pacote gnupg)"
[ -s "$PASS_FILE" ] || die "senha da criptografia não encontrada em $PASS_FILE (rode make backup-schedule, que cria uma, ou aponte BACKUP_PASSPHRASE_FILE)"
if [ -n "$RCLONE_REMOTE" ]; then
  command -v rclone >/dev/null 2>&1 || die "BACKUP_RCLONE_REMOTE definido, mas o rclone não está instalado"
fi
if [ -n "$OFFSITE_DIR" ]; then
  # A pasta precisa existir: se o HD externo ou a montagem sumiu, criar a pasta esconderia o problema (cópia no mesmo disco).
  [ -d "$OFFSITE_DIR" ] || die "BACKUP_OFFSITE_DIR não existe ou não está montado: $OFFSITE_DIR"
fi

STEP="backup e conferência"
if [ "$VERIFY" = "1" ]; then
  "$REPO_DIR/scripts/test-restore.sh"
else
  "$REPO_DIR/scripts/backup.sh"
fi
dump="$(latest_backup)"
[ -n "$dump" ] || die "nenhum backup em $BACKUP_DIR"

STEP="criptografia"
name="$(basename "$dump").gpg"
enc_tmp="$BACKUP_DIR/.$name.partial"
# --passphrase-file: a senha não aparece na linha de comando (nem em `ps`) nem no log.
gpg --batch --yes --quiet --no-symkey-cache --pinentry-mode loopback --symmetric --cipher-algo AES256 \
  --passphrase-file "$PASS_FILE" --output "$enc_tmp" "$dump"
# Confere que a cópia abre com a senha e é idêntica ao original, antes de mandar para fora.
gpg --batch --quiet --no-symkey-cache --pinentry-mode loopback --passphrase-file "$PASS_FILE" --decrypt "$enc_tmp" 2>/dev/null |
  cmp -s - "$dump" || die "a cópia criptografada não confere com o backup"

sent=()
if [ -n "$OFFSITE_DIR" ]; then
  STEP="cópia para $OFFSITE_DIR"
  cp "$enc_tmp" "$OFFSITE_DIR/.$name.partial"
  mv "$OFFSITE_DIR/.$name.partial" "$OFFSITE_DIR/$name"
  # Rotação: só arquivos prumia-*.dump.gpg da própria pasta, do mais antigo ao mais novo, deixando os OFFSITE_KEEP últimos.
  mapfile -t old < <(find "$OFFSITE_DIR" -maxdepth 1 -type f -name 'prumia-*.dump.gpg' | sort | head -n "-$OFFSITE_KEEP")
  for f in "${old[@]}"; do
    rm -f -- "${f:?}"
    info "rotação externa: removido $(basename "$f")"
  done
  sent+=("$OFFSITE_DIR")
fi
if [ -n "$RCLONE_REMOTE" ]; then
  STEP="envio para $RCLONE_REMOTE"
  rclone copyto "$enc_tmp" "$RCLONE_REMOTE/$name"
  mapfile -t old < <(rclone lsf --files-only --include 'prumia-*.dump.gpg' "$RCLONE_REMOTE" | sort | head -n "-$OFFSITE_KEEP")
  for f in "${old[@]}"; do
    rclone deletefile "$RCLONE_REMOTE/${f:?}"
    info "rotação externa: removido $f"
  done
  sent+=("$RCLONE_REMOTE")
fi

STEP="registro"
printf '%s OK: %s enviado para %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$name" "${sent[*]}" >"$STATUS_FILE"
info "backup externo ok: $name -> ${sent[*]}"

if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ]; then
  curl -fsS -m 10 -o /dev/null "$BACKUP_HEALTHCHECK_URL" || echo "aviso: não consegui avisar o monitor (o backup em si deu certo)" >&2
fi
