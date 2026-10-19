#!/usr/bin/env bash
# PostToolUse (Edit|Write): formata o arquivo editado. Silencioso se a ferramenta/arquivo não existir.
f=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty' 2>/dev/null)
[ -n "$f" ] && [ -f "$f" ] || exit 0

case "$f" in
  *.go)
    command -v gofmt >/dev/null 2>&1 && gofmt -w "$f" 2>/dev/null
    ;;
  */web/*.ts|*/web/*.tsx)
    web="${f%%/web/*}/web"
    if [ -x "$web/node_modules/.bin/eslint" ]; then
      (cd "$web" && ./node_modules/.bin/eslint --fix "$f" >/dev/null 2>&1)
    fi
    ;;
esac
exit 0
