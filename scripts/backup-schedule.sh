#!/usr/bin/env bash
# Agenda o backup-offsite.sh para rodar todo dia, com um timer do systemd do usuário (sem root).
# Uso: scripts/backup-schedule.sh install [HH:MM] | remove | status     (ou: make backup-schedule / -unschedule / -status)
#
# install também cria a senha da criptografia (.backup-passphrase) se ela ainda não existir.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE="$UNIT_DIR/prumia-backup.service"
TIMER="$UNIT_DIR/prumia-backup.timer"
PASS_FILE="$REPO_DIR/.backup-passphrase"

case "${1:-}" in
  install)
    at="${2:-03:15}"
    [[ "$at" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "horário inválido: $at (use HH:MM, ex.: 03:15)"
    command -v systemctl >/dev/null 2>&1 || die "systemctl não encontrado (sem systemd, agende scripts/backup-offsite.sh no cron)"
    [ -f "$REPO_DIR/backup.env" ] || die "crie o backup.env antes (cp backup.env.example backup.env) e defina um destino"

    if [ ! -s "$PASS_FILE" ]; then
      (umask 077 && openssl rand -base64 36 >"$PASS_FILE")
      echo
      echo "  Criei a senha da criptografia em $PASS_FILE"
      echo "  >>> COPIE ESSA SENHA PARA UM GERENCIADOR DE SENHAS AGORA (cat $PASS_FILE)."
      echo "  >>> Se este computador se perder, sem ela as cópias externas NÃO abrem."
      echo
    fi

    mkdir -p "$UNIT_DIR"
    cat >"$SERVICE" <<UNIT
[Unit]
Description=Backup do prumia (conferido, criptografado e copiado para fora)

[Service]
Type=oneshot
WorkingDirectory=$REPO_DIR
ExecStart=$REPO_DIR/scripts/backup-offsite.sh
UNIT
    # Persistent=true: se o computador estava desligado na hora, roda assim que ligar.
    cat >"$TIMER" <<UNIT
[Unit]
Description=Backup diário do prumia

[Timer]
OnCalendar=*-*-* $at
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable --now prumia-backup.timer
    info "agendado: todo dia às $at (make backup-status para acompanhar)"
    if ! loginctl show-user "$USER" --property=Linger 2>/dev/null | grep -q 'Linger=yes'; then
      echo "aviso: o timer só roda com a sua sessão aberta. Para rodar sempre: sudo loginctl enable-linger $USER" >&2
    fi
    ;;
  remove)
    systemctl --user disable --now prumia-backup.timer 2>/dev/null || true
    rm -f -- "${SERVICE:?}" "${TIMER:?}"
    systemctl --user daemon-reload 2>/dev/null || true
    info "agendamento removido (os backups e a senha continuam onde estão)"
    ;;
  status)
    if systemctl --user list-timers prumia-backup.timer --no-pager 2>/dev/null | grep -q prumia-backup; then
      systemctl --user list-timers prumia-backup.timer --no-pager | head -n 2
    else
      echo "não agendado (make backup-schedule)"
    fi
    if [ -f "$BACKUP_DIR/last-run.txt" ]; then
      echo "última execução: $(cat "$BACKUP_DIR/last-run.txt")"
    else
      echo "última execução: nenhuma registrada"
    fi
    ;;
  *)
    die "uso: $0 install [HH:MM] | remove | status"
    ;;
esac
