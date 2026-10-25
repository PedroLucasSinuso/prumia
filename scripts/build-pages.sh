#!/usr/bin/env bash
# Build do site público (Cloudflare Pages): documentação (site/) + demonstração (web/, build:demo) em site/dist/demo.
set -euo pipefail
cd "$(dirname "$0")/.."
(cd site && npm ci && npm run build)
(cd web && npm ci && npm run build:demo)
rm -rf site/dist/demo && cp -r web/dist-demo site/dist/demo
# Rotas da demo (SPA) caem no index.html dela
cat > site/dist/_redirects <<'R'
/demo/resumo* /demo/index.html 200
/demo/receitas* /demo/index.html 200
/demo/importar* /demo/index.html 200
/demo/ajustes* /demo/index.html 200
/demo/parcelas* /demo/index.html 200
/demo/casa* /demo/index.html 200
/demo/configuracoes* /demo/index.html 200
R
echo "pronto: site/dist"
