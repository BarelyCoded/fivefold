#!/usr/bin/env python3
"""Pack individually generated sprites into game sheets.

    python3 tools/pack.py            # reads art-src/, writes assets/*.png and assets/atlas.json

Put one PNG per sprite in art-src/, named <category>-<name>.png, for example
scenery-pine.png, figures-mage-R-2.png, monsters-dragon-attack-1.png, terrain-grass-1.png.
Any size, any flat background colour: the packer keys the background out (flood fill from the
image border), trims, scales to the category's cell size with nearest-neighbour, and packs each
category into assets/<category>.png with a JSON index the game reads at startup.
Terrain images are kept opaque and only resized. See docs/art-spec.md for the names the game knows.
"""
import json, os, sys
from collections import deque
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art-src')
OUT = os.path.join(ROOT, 'assets')
CELL = { 'terrain': (64, 64), 'scenery': (48, 48), 'locations': (64, 64), 'figures': (48, 64), 'townsfolk': (48, 64),
         'monsters': (96, 96), 'dungeon': (32, 32), 'ui': (64, 64) }
OPAQUE = {'terrain'}            # never keyed, only resized (must tile seamlessly)
DUNGEON_OPAQUE = ('floor', 'rock', 'rockcrack', 'lava')  # dungeon floors stay opaque too
COLS = 8

def key_background(im, tol=28):
    """Flood-fill transparency from the border over pixels close to the border's median colour."""
    im = im.convert('RGBA'); w, h = im.size; px = im.load()
    if all(px[x, y][3] < 255 for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]):
        return im  # already transparent
    border = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)] + [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    med = tuple(sorted(p[c] for p in border)[len(border) // 2] for c in range(3))
    seen = bytearray(w * h); q = deque()
    def push(x, y):
        i = y * w + x
        if seen[i]: return
        seen[i] = 1
        p = px[x, y]
        if max(abs(p[0] - med[0]), abs(p[1] - med[1]), abs(p[2] - med[2])) <= tol: q.append((x, y))
    for x in range(w): push(x, 0); push(x, h - 1)
    for y in range(h): push(0, y); push(w - 1, y)
    while q:
        x, y = q.popleft(); p = px[x, y]; px[x, y] = (p[0], p[1], p[2], 0)
        if x > 0: push(x - 1, y)
        if x < w - 1: push(x + 1, y)
        if y > 0: push(x, y - 1)
        if y < h - 1: push(x, y + 1)
    # soften the fringe: pixels that still blend toward the background go semi-transparent
    return im

def trim(im):
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im

def fit(im, cell):
    cw, ch = cell; w, h = im.size
    if w <= cw and h <= ch: return im
    k = min(cw / w, ch / h)
    # generated sprites are drawn several times larger than their pixel grid: box-filter big reductions
    return im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS if k < 0.5 else Image.NEAREST)

def main():
    if not os.path.isdir(SRC): sys.exit(f'No {SRC}: put <category>-<name>.png files there first.')
    files = sorted(f for f in os.listdir(SRC) if f.lower().endswith('.png') and '-' in f)
    by_cat = {}
    for f in files:
        cat, name = f[:-4].split('-', 1)
        if cat not in CELL: print(f'skip {f}: unknown category'); continue
        by_cat.setdefault(cat, []).append((name, f))
    os.makedirs(OUT, exist_ok=True)
    index = {}
    for cat, items in by_cat.items():
        cw, ch = CELL[cat]
        rows = (len(items) + COLS - 1) // COLS
        sheet = Image.new('RGBA', (COLS * cw, rows * ch), (0, 0, 0, 0))
        for i, (name, f) in enumerate(items):
            im = Image.open(os.path.join(SRC, f))
            opaque = cat in OPAQUE or (cat == 'dungeon' and name.split('-')[0] in DUNGEON_OPAQUE)
            if opaque:
                im = im.convert('RGBA').resize((cw, ch), Image.LANCZOS if im.size[0] > cw * 2 else Image.NEAREST)
                im.putalpha(255)
                x, y = (i % COLS) * cw, (i // COLS) * ch
            else:
                im = fit(trim(key_background(im)), (cw, ch))
                x = (i % COLS) * cw + (cw - im.size[0]) // 2
                y = (i // COLS) * ch + (ch - im.size[1])       # feet on the cell floor
            sheet.alpha_composite(im, (x, y))
            index[f'{cat}.{name}'] = { 'file': f'{cat}.png', 'rect': [x, y, im.size[0], im.size[1]] }
            print(f'{cat:10} {name:24} {im.size[0]}x{im.size[1]}')
        sheet.save(os.path.join(OUT, f'{cat}.png'))
    with open(os.path.join(OUT, 'atlas.json'), 'w') as fh: json.dump(index, fh, indent=1)
    print(f'wrote {len(index)} sprites into {len(by_cat)} sheets and assets/atlas.json')

if __name__ == '__main__': main()
