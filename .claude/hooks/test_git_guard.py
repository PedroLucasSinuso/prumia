#!/usr/bin/env python3
"""Testes do git_guard.py. Rodar: make hooks-test (ou python3 -I .claude/hooks/test_git_guard.py)."""
import json
import subprocess
import sys
from pathlib import Path

GUARD = str(Path(__file__).with_name("git_guard.py"))

HEREDOC_OK = "git commit -m \"$(cat <<'EOF'\nfeat: gera parcelas\nEOF\n)\""
HEREDOC_TRAILER = "git commit -m \"$(cat <<'EOF'\nfeat: gera parcelas\n\nCo-Authored-By: Claude <x@y>\nEOF\n)\""
# Cenário real que já causou falso positivo: push seguido de gh pr create cujo corpo cita `docker rm -f`.
PR_BODY_COM_DASH_F = (
    'git commit -q -m "feat: x" && git push -q -u origin feat/x 2>&1 | tail -1\n'
    "gh pr create --title \"feat: x\" --body \"$(cat <<'EOF'\n"
    "1. docker run -d -p 5432:5432 postgres\n7. Limpeza: docker rm -f prumia-pg\nEOF\n)\""
)

# (comando, código de saída esperado: 0 = permitido, 2 = bloqueado)
CASES = [
    # --- permitidos ---
    ("ls -la", 0),
    ("git status", 0),
    ("git log --oneline", 0),
    ('git commit -m "feat: gera parcelas"', 0),
    ('git commit -am "fix: corrige filtro"', 0),
    ('git add -A && git commit -m "chore: ajusta gitignore"', 0),
    ('git commit -m "docs(plan): atualiza fase 0"', 0),
    ("git commit --amend --no-edit", 0),
    (HEREDOC_OK, 0),
    ("git push origin feat/parcelas", 0),
    ("git push -u origin main", 0),
    (PR_BODY_COM_DASH_F, 0),
    ('gh pr create --title "feat: x" --body "ok"', 0),
    ('git commit -m "feat: x" && git tag -m "v1" v1', 0),
    # --- texto que só menciona os comandos (não é comando) ---
    ('echo "use git commit -m ruim"', 0),
    ('grep -rn "git push --force" docs', 0),
    ("echo x > a.md # git commit --no-verify", 0),
    ('printf "Co-Authored-By: x" | wc -c', 0),
    # --- bloqueados ---
    ('git commit -m "added stuff"', 2),
    ('git commit -m "Feat: x"', 2),
    ('git commit -m "feat:sem espaco"', 2),
    ("git commit", 2),
    ('git commit -m "feat: a" -m "corpo"', 2),
    ('git commit -m "feat: a\n\nCo-Authored-By: Claude <noreply@anthropic.com>"', 2),
    (HEREDOC_TRAILER, 2),
    ('git commit -m "feat: x" --no-verify', 2),
    ('git commit -n -m "feat: x"', 2),
    ("git push --force origin main", 2),
    ("git push -f", 2),
    ("git push --force-with-lease", 2),
    ('git commit -m "feat: x" && git push --force', 2),
    ('git commit -m "feat: ' + "x" * 80 + '"', 2),
    ('git -C /tmp commit -m "bad msg"', 2),
    ('gh pr create --title "x" --body "ok\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"', 2),
]


def main() -> int:
    falhas = 0
    for cmd, esperado in CASES:
        r = subprocess.run(
            ["python3", GUARD], input=json.dumps({"tool_input": {"command": cmd}}), capture_output=True, text=True
        )
        if r.returncode != esperado:
            falhas += 1
            print(f"FALHOU (esperava {esperado}, veio {r.returncode}): {cmd[:90]!r}\n  {r.stderr.strip()[:120]}")
    print(f"{len(CASES) - falhas}/{len(CASES)} casos ok")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
