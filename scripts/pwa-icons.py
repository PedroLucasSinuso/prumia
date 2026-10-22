#!/usr/bin/env python3
"""Gera os ícones PNG do PWA (web/public/icons/) a partir do símbolo vetorial da prumia.

PROVISÓRIO: os polígonos abaixo copiam web/public/favicon.svg e web/src/components/Logo.tsx (aproximação do símbolo).
Quando houver o SVG oficial da marca, troque POLYGONS (ou renderize o SVG oficial) e rode de novo:

    python3 scripts/pwa-icons.py

Requer Pillow (python3 -c "import PIL"). Fundo teal com o símbolo na variação "inverse" do Logo (ivory com opacidade e
cobalt), como no cabeçalho do app. Desenha em 4x e reduz (antialias).
"""
from pathlib import Path

from PIL import Image, ImageDraw

TEAL = (0x20, 0x3D, 0x40)
IVORY = (0xF3, 0xEB, 0xDD)
COBALT = (0x41, 0x6A, 0x91)


def over(fg, bg, alpha):
    """Cor `fg` com opacidade `alpha` sobre `bg` (igual a fill-ivory/60 do Tailwind sobre teal)."""
    return tuple(round(b + (f - b) * alpha) for f, b in zip(fg, bg))


# Coordenadas no viewBox 64x64 do favicon.svg. Cores = Logo tone="inverse".
POLYGONS = [
    ([(8, 14), (34, 4), (34, 34), (8, 46)], IVORY),
    ([(8, 46), (34, 34), (34, 60), (8, 52)], over(IVORY, TEAL, 0.6)),
    ([(34, 4), (58, 32), (34, 34)], COBALT),
    ([(34, 34), (58, 32), (34, 60)], over(IVORY, TEAL, 0.7)),
]
MIN_X, MAX_X, MIN_Y, MAX_Y = 8, 58, 4, 60  # caixa do símbolo


def render(size, symbol_height):
    """Ícone quadrado `size` px com o símbolo centralizado ocupando `symbol_height` (fração da altura)."""
    ss = 4
    big = size * ss
    img = Image.new("RGB", (big, big), TEAL)
    draw = ImageDraw.Draw(img)
    scale = big * symbol_height / (MAX_Y - MIN_Y)
    off_x = (big - (MAX_X - MIN_X) * scale) / 2
    off_y = (big - (MAX_Y - MIN_Y) * scale) / 2
    for points, color in POLYGONS:
        draw.polygon([(off_x + (x - MIN_X) * scale, off_y + (y - MIN_Y) * scale) for x, y in points], fill=color)
    return img.resize((size, size), Image.LANCZOS)


def main():
    out = Path(__file__).resolve().parent.parent / "web" / "public" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    # "any": símbolo grande, com respiro.
    render(192, 0.70).save(out / "icon-192.png", optimize=True)
    render(512, 0.70).save(out / "icon-512.png", optimize=True)
    # maskable: o sistema recorta em círculo/squircle; a zona segura é o círculo central de 80% (20% de margem).
    # Altura 0.52 deixa a diagonal da caixa do símbolo (~0.70) dentro desse círculo.
    render(512, 0.52).save(out / "maskable-512.png", optimize=True)
    # iOS arredonda os cantos sozinho e não aceita transparência.
    render(180, 0.66).save(out / "apple-touch-icon.png", optimize=True)
    print(f"ícones gerados em {out}")


if __name__ == "__main__":
    main()
