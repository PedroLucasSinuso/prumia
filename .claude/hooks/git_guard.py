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


def segment(cmd: str, start: int) -> str:
    """Trecho do comando que começa em `start` e vai até o próximo separador (; & | quebra de linha)
    fora de aspas. Heredocs ($(cat <<EOF ... EOF)) ficam dentro de aspas, então entram inteiros."""
    quote = ""
    i = start
    while i < len(cmd):
        ch = cmd[i]
        if quote:
            if ch == "\\" and quote == '"':
                i += 2
                continue
            if ch == quote:
                quote = ""
        elif ch in "\"'":
            quote = ch
        elif ch in ";&|\n":
            break
        i += 1
    return cmd[start:i]


def unquoted(seg: str) -> str:
    """Troca o conteúdo de strings entre aspas por "" para checar flags sem olhar o texto das mensagens."""
    return re.sub(r"\"(?:\\.|[^\"\\])*\"|'[^']*'", '""', seg, flags=re.S)


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return
    cmd = (data.get("tool_input") or {}).get("command") or ""

    # Só conta como comando quando está no início de um segmento (início, ;, &&, ||, |, parêntese, quebra de linha),
    # para não bloquear texto que apenas menciona "git commit" (echo, grep, comentários).
    start = r"(?:^|[;&|(\n])\s*(?:\w+=\S+\s+)*"
    m_commit = re.search(start + r"(git\b(\s+-\S+(\s+\S+)?)*\s+commit\b)", cmd)
    m_push = re.search(start + r"(git\b(\s+-\S+(\s+\S+)?)*\s+push\b)", cmd)
    m_pr = re.search(start + r"(gh\s+pr\s+(create|edit)\b)", cmd)

    # Cada checagem olha só o próprio comando (segmento), não o resto da linha.
    commit_seg = segment(cmd, m_commit.start(1)) if m_commit else ""
    push_seg = segment(cmd, m_push.start(1)) if m_push else ""
    pr_seg = segment(cmd, m_pr.start(1)) if m_pr else ""

    if pr_seg and FORBIDDEN.search(pr_seg):
        block("PR sem atribuição ('Generated with Claude Code', Co-Authored-By).")

    for seg in (commit_seg, push_seg):
        if seg and "--no-verify" in unquoted(seg):
            block("não use --no-verify.")
    if commit_seg:
        flags = unquoted(commit_seg) + " "
        if "--no-edit" not in flags and re.search(r"\s-[a-zA-Z]*n[a-zA-Z]*\s", flags):
            block("não use -n (equivale a --no-verify).")
    if push_seg and re.search(r"(--force\b|--force-with-lease|\s-f\b|\s\+\S+:|\s\+\w)", unquoted(push_seg)):
        block("não use force push.")

    if not commit_seg:
        return
    if FORBIDDEN.search(commit_seg):
        block("commit sem trailer de atribuição (Co-Authored-By, 'Generated with Claude Code').")
    if "--no-edit" in unquoted(commit_seg):
        return

    msgs = commit_messages(commit_seg)
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
