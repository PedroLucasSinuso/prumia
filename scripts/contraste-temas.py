#!/usr/bin/env python3
"""Mede o contraste (WCAG) dos pares de cor de cada tema, lendo web/src/index.css. Uso: python3 scripts/contraste-temas.py
Texto precisa de 4,5:1 (AA); elementos de interface, 3:1. Falha (código 1) se algum par de TEXTO ficar abaixo de 4,5."""
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

rows = [("texto/fundo", "ink", "surface", 4.5), ("título/fundo", "heading", "surface", 4.5),
        ("sobre painel", "on-structure", "structure", 4.5), ("link/fundo", "accent-text", "surface", 4.5),
        ("alerta/fundo", "alert", "surface", 3.0), ("painel/fundo", "structure", "surface", 3.0)]
print(f"{'tema':10}" + "".join(f"{r[0]:>14}" for r in rows) + f"{'texto 70%':>12}")
bad = 0
for name, t in themes.items():
    cells = []
    for _, a, b, need in rows:
        v = cr(t[a], t[b])
        cells.append(f"{v:11.2f}{'*' if v < need else ' '}  ")
        if a != "structure" and a != "alert" and v < need:
            bad += 1
    print(f"{name:10}" + "".join(cells) + f"{cr(mix(t['ink'], t['surface'], 70), t['surface']):10.2f}")
print("\n* = abaixo do mínimo (texto 4,5:1; alerta e painel 3:1). 'texto 70%' = texto secundário (ink/70), só informativo.")
sys.exit(1 if bad else 0)
