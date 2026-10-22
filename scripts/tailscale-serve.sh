#!/usr/bin/env bash
# Publica o prumia no seu tailnet com HTTPS, via `tailscale serve` (só para os seus aparelhos; NÃO é o funnel/internet).
# Não instala nada: se o comando `tailscale` não existir, só mostra o que rodaria.
#
# Uso: scripts/tailscale-serve.sh up       # aplica (idempotente: rodar de novo só regrava a mesma regra)
#      scripts/tailscale-serve.sh status   # mostra o que está publicado e o endereço
#      scripts/tailscale-serve.sh off      # desliga o HTTPS na porta 443
#
# A porta local vem de WEB_PORT no .env (padrão 8080). O nginx precisa estar em 127.0.0.1:WEB_PORT (make up).
# Guias: docs/developer-guide/deployment.md e docs/user-guides/acessar-pelo-celular.md.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PRUMIA_ENV_FILE:-$REPO_DIR/.env}"

# envval NOME PADRAO: lê NOME=valor do .env sem executar o arquivo (o .env não é script).
envval() {
  local v=""
  if [ -f "$ENV_FILE" ]; then
    v="$(grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"' || true)"
  fi
  echo "${v:-$2}"
}

PORT="$(envval WEB_PORT 8080)"
APP_ENV="$(envval APP_ENV development)"
CMD=(tailscale serve --bg --https=443 "http://127.0.0.1:$PORT")

if ! command -v tailscale >/dev/null 2>&1; then
  echo "tailscale não encontrado neste computador (nada foi alterado)."
  echo "Instale em https://tailscale.com/download e rode de novo. O comando que seria aplicado:"
  echo "  ${CMD[*]}"
  exit 1
fi

# Endereço <máquina>.<tailnet>.ts.net a partir do DNSName do próprio aparelho (sem depender de jq).
address() {
  tailscale status --json 2>/dev/null |
    tr -d '\n' | grep -o '"Self": *{[^}]*"DNSName": *"[^"]*"' | grep -o '"DNSName": *"[^"]*"' |
    sed -E 's/.*"([^"]*)"$/\1/; s/\.$//' || true
}

case "${1:-up}" in
  up)
    if [ "$APP_ENV" != "production" ]; then
      echo "aviso: APP_ENV=$APP_ENV no .env. Para uso real com HTTPS use APP_ENV=production e rode make up de novo"
      echo "       (cookie de sessão Secure). Em development o app funciona, só fica menos protegido."
    fi
    echo "==> ${CMD[*]}"
    "${CMD[@]}"
    host="$(address)"
    if [ -n "$host" ]; then
      echo "prumia no tailnet: https://$host"
    else
      echo "pronto. Veja o endereço com: tailscale serve status"
    fi
    ;;
  status)
    tailscale serve status
    host="$(address)"
    if [ -n "$host" ]; then echo "endereço: https://$host"; fi
    ;;
  off)
    echo "==> tailscale serve --https=443 off"
    tailscale serve --https=443 off
    ;;
  *)
    echo "uso: $0 [up|status|off]" >&2
    exit 2
    ;;
esac
