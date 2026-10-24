#!/usr/bin/env bash
# Cria o Cloudflare Tunnel do prumia (uma vez) e grava .cloudflared/config.yml.
# Pré-requisitos: domínio já ATIVO na Cloudflare (nameservers trocados) e Docker. Uso: make tunnel-setup
# Passos: (1) login no navegador (autoriza o domínio) -> cert.pem; (2) cria o túnel -> <id>.json; (3) cria o DNS do host.
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE="cloudflare/cloudflared:2026.10.3"
DIR="$PWD/.cloudflared"
HOST="${TUNNEL_HOSTNAME:-$(grep -E '^TUNNEL_HOSTNAME=' .env 2>/dev/null | cut -d= -f2- || true)}"
NAME="prumia"

if [ -z "$HOST" ]; then
  echo "Defina o endereço público no .env: TUNNEL_HOSTNAME=app.seudominio.com.br" >&2
  exit 1
fi

mkdir -p "$DIR"
chmod 700 "$DIR"

# HOME aponta para uma pasta montada: o cloudflared guarda cert.pem e o JSON do túnel em $HOME/.cloudflared.
cf() { docker run --rm -i --user "$(id -u):$(id -g)" -e HOME=/home/cf -v "$DIR:/home/cf/.cloudflared" "$IMAGE" "$@"; }

if [ ! -f "$DIR/cert.pem" ]; then
  echo "==> 1/3 login: abra o endereço que aparecer, escolha o domínio e autorize"
  cf tunnel login
fi

if ! ls "$DIR"/*.json >/dev/null 2>&1; then
  echo "==> 2/3 criando o túnel \"$NAME\""
  cf tunnel create "$NAME"
fi

ID="$(basename "$(ls "$DIR"/*.json | head -1)" .json)"

echo "==> 3/3 apontando $HOST para o túnel"
cf tunnel route dns --overwrite-dns "$NAME" "$HOST"

cat > "$DIR/config.yml" <<YAML
tunnel: $ID
credentials-file: /etc/cloudflared/$ID.json
ingress:
  - hostname: $HOST
    service: http://web:8081
  - service: http_status:404
YAML
chmod 600 "$DIR"/*.json "$DIR/cert.pem" 2>/dev/null || true
echo "pronto: .cloudflared/config.yml gravado. Agora: make tunnel-up"
