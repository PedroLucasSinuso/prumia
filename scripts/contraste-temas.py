#!/usr/bin/env python3
"""Mede o contraste (WCAG) dos pares de cor de cada tema, lendo web/src/index.css. Uso: python3 scripts/contraste-temas.py
Texto precisa de 4,5:1 (AA); elementos de interface, 3:1. Falha (código 1) se algum par de TEXTO ficar abaixo de 4,5
ou se faltar algum papel obrigatório num tema."""
import re, sys, pathlib

css = (pathlib.Path(__file__).resolve().parent.parent / "web/src/index.css").read_text()


def lum(h):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def cr(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def mix(a, b, p):  # p% de a sobre b (aproximação em sRGB; o navegador mistura em oklab)
    a, b = a.lstrip("#"), b.lstrip("#")
    return "#" + "".join("%02x" % round(int(a[i:i + 2], 16) * p / 100 + int(b[i:i + 2], 16) * (100 - p) / 100) for i in (0, 2, 4))


themes = {}
for sel, body in re.findall(r"((?:\[data-theme='[a-z]+'\],?\s*|:root,?\s*)+)\{([^}]*)\}", css):
    vals = dict(re.findall(r"--prumia-([a-z-]+):\s*(#[0-9a-fA-F]{6});", body))
    if len(vals) < 8:
        continue
    for name in re.findall(r"data-theme='([a-z]+)'", sel):
        if name != "sistema":  # o Sistema é o Marfim (de dia) ou o Dracula (no escuro)
            themes.setdefault(name, vals)

# (rótulo, frente, fundo, mínimo, é texto?) — os pares de TEXTO reprovam o script; alerta e painel são marcas (3:1).
rows = [
    ("texto/fundo", "ink", "surface", 4.5, True),
    ("texto/cartão", "ink", "raised", 4.5, True),
    ("texto/poço", "ink", "sunken", 4.5, True),
    ("2º/fundo", "muted", "surface", 4.5, True),
    ("2º/cartão", "muted", "raised", 4.5, True),
    ("2º/poço", "muted", "sunken", 4.5, True),
    ("título/fundo", "heading", "surface", 4.5, True),
    ("título/cartão", "heading", "raised", 4.5, True),
    ("erro/fundo", "alert-text", "surface", 4.5, True),
    ("erro/cartão", "alert-text", "raised", 4.5, True),
    ("link/fundo", "accent-text", "surface", 4.5, True),
    ("sobre painel", "on-structure", "structure", 4.5, True),
    ("sobre nav", "on-nav", "nav", 4.5, True),
    ("alerta/fundo", "alert", "surface", 3.0, False),
    ("painel/fundo", "structure", "surface", 3.0, False),
]
required = {a for _, a, _, _, _ in rows} | {b for _, _, b, _, _ in rows}

W = 9
print(f"{'tema':10}" + "".join(f"{r[0]:>{W + 5}}" for r in rows))
bad = 0
for name, t in themes.items():
    missing = sorted(required - t.keys())
    if missing:
        print(f"{name:10} FALTAM papéis: {', '.join(missing)}")
        bad += 1
        continue
    cells = []
    for _, a, b, need, text in rows:
        v = cr(t[a], t[b])
        fail = v < need
        cells.append(f"{v:{W + 3}.2f}{'*' if fail else ' '} ")
        if text and fail:
            bad += 1
    print(f"{name:10}" + "".join(cells))
print("\n* = abaixo do mínimo (texto 4,5:1; alerta e painel 3:1, só informativo).")
print("2º = texto secundário (`muted`); erro = `alert-text`; cartão = `raised`; poço = `sunken`.")
# Referência: o texto secundário ANTIGO (ink a 70% sobre o fundo), que motivou o papel `muted`.
print("antigo ink/70 sobre o fundo: " + ", ".join(f"{n} {cr(mix(t['ink'], t['surface'], 70), t['surface']):.2f}" for n, t in themes.items()))
sys.exit(1 if bad else 0)
