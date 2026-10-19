#!/usr/bin/env python3
"""PreToolUse (Bash): faz valer as regras de Git do CLAUDE.md.

Bloqueia (exit 2, motivo no stderr, que volta para o Claude):
  - `git commit` sem mensagem `-m "tag: descrição"` de uma linha só (<= 72 caracteres)
  - qualquer trailer/atribuição (Co-Authored-By, "Generated with Claude Code")
  - `--no-verify` e `git push --force` / `-f`
Qualquer comando que não envolva git commit/push passa em silêncio.
"""
import json
import re
import shlex
import sys

TAGS = "feat|fix|chore|docs|refactor|test|build|ci|perf"
MSG_RE = re.compile(rf"^({TAGS})(\([a-z0-9_./-]+\))?: \S.*$")
FORBIDDEN = re.compile(r"co-authored-by|generated with|claude\.com/claude-code|noreply@anthropic", re.I)


def block(reason: str) -> None:
    print(f"BLOQUEADO (regras Git do CLAUDE.md): {reason}", file=sys.stderr)
    sys.exit(2)


def commit_messages(cmd: str) -> list[str]:
    """Extrai os valores de -m/--message. Entende aspas e heredoc $(cat <<'EOF' ... EOF)."""
    # Troca heredocs por uma única string entre aspas, para o shlex enxergar como um argumento.
    def heredoc(m: re.Match) -> str:
        return shlex.quote(m.group("body").strip("\n"))

    cmd = re.sub(
        r"\"?\$\(\s*cat\s*<<-?\s*['\"]?(?P<tag>\w+)['\"]?\s*\n(?P<body>.*?)\n\s*(?P=tag)\s*\)\"?",
        heredoc,
        cmd,
        flags=re.S,
    )
    try:
        parts = shlex.split(cmd, posix=True)
    except ValueError:
        return []
    msgs = []
    for i, p in enumerate(parts):
        if p in ("-m", "--message") and i + 1 < len(parts):
            msgs.append(parts[i + 1])
        elif p.startswith("--message="):
            msgs.append(p.split("=", 1)[1])
        elif re.fullmatch(r"-[a-zA-Z]*m", p) and i + 1 < len(parts):  # ex.: -am "msg"
            msgs.append(parts[i + 1])
    return msgs


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return
    cmd = (data.get("tool_input") or {}).get("command") or ""

    # Só conta como comando quando está no início de um segmento (início, ;, &&, ||, |, parêntese, quebra de linha),
    # para não bloquear texto que apenas menciona "git commit" (echo, grep, comentários).
    start = r"(?:^|[;&|(\n])\s*(?:\w+=\S+\s+)*"
    is_commit = re.search(start + r"git\b(\s+-\S+(\s+\S+)?)*\s+commit\b", cmd)
    is_push = re.search(start + r"git\b(\s+-\S+(\s+\S+)?)*\s+push\b", cmd)
    is_pr = re.search(start + r"gh\s+pr\s+(create|edit)\b", cmd)
    if is_pr and FORBIDDEN.search(cmd):
        block("PR sem atribuição ('Generated with Claude Code', Co-Authored-By).")
    if not (is_commit or is_push):
        return

    if "--no-verify" in cmd or (is_commit and re.search(r"\s-[a-zA-Z]*n[a-zA-Z]*\s", cmd + " ") and "--no-edit" not in cmd):
        block("não use --no-verify (nem -n).")
    if is_push and re.search(r"(--force\b|--force-with-lease|\s-f\b|\s\+\S+:|\s\+\w)", cmd):
        block("não use force push.")
    if FORBIDDEN.search(cmd):
        block("commit/PR sem trailer de atribuição (Co-Authored-By, 'Generated with Claude Code').")

    if not is_commit or "--no-edit" in cmd:
        return

    msgs = commit_messages(cmd)
    if not msgs:
        block('use `git commit -m "tag: descrição"` (mensagem obrigatória, inline).')
    if len(msgs) > 1:
        block("use um único -m; mensagem de uma linha só, sem corpo nem rodapé.")
    msg = msgs[0]
    if "\n" in msg.strip():
        block("a mensagem deve ter uma linha só (curta), sem corpo nem rodapé.")
    msg = msg.strip()
    if not MSG_RE.match(msg):
        block(f'formato inválido: "{msg}". Use "tag: descrição" com tag em {TAGS.replace("|", ", ")}.')
    if len(msg) > 72:
        block(f"mensagem longa ({len(msg)} > 72 caracteres). Deixe curta e compreensível.")


if __name__ == "__main__":
    main()
