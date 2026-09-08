#!/usr/bin/env python3
"""Slice sprites out of a generated showcase image into art-src/<category>-<name>.png.

    python3 tools/slice.py assets/source/scenary.png scenery     # find sprites, write a labelled preview
    python3 tools/slice.py assets/source/scenary.png scenery names.txt   # cut them by name

The image may have a flat colour, a fake checkerboard or grid lines behind the sprites: every
colour seen on the image border (plus any given with --bg) is treated as background and flooded
away from the edge, then connected blobs become sprites. Blobs closer than --gap pixels merge.
names.txt lists one name per line in reading order (left to right, top to bottom); a line that
is '-' skips a blob, 'a+b' merges the next two blobs under one name.
"""
import sys, os, json
from collections import deque
from PIL import Image, ImageDraw

def parse_args(argv):
    args = {'gap': 14, 'tol': 26, 'min': 24, 'bg': [], 'grid': 0, 'cells': '', 'nokey': 0, 'blank': []}
    pos = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith('--'):
            k = a[2:]; v = argv[i + 1]; i += 2
            if k == 'bg': args['bg'].append(tuple(int(x) for x in v.split(',')))
            elif k == 'blank': args['blank'].append(tuple(int(x) for x in v.split(',')))
            elif k == 'cells': args[k] = v
            else: args[k] = int(v)
        else: pos.append(a); i += 1
    return args, pos

def border_colours(px, w, h, tol):
    pts = [px[x, y] for x in range(0, w, 3) for y in (0, 1, h - 2, h - 1)] + [px[x, y] for y in range(0, h, 3) for x in (0, 1, w - 2, w - 1)]
    cols = []
    for p in pts:
        p = p[:3]
        for c in cols:
            if max(abs(p[i] - c[0][i]) for i in range(3)) <= tol: c[1] += 1; break
        else: cols.append([p, 1])
    cols.sort(key=lambda c: -c[1])
    total = sum(c[1] for c in cols)
    return [c[0] for c in cols if c[1] >= max(8, total * 0.12)]

def key(im, bgs, tol, lines=None):
    """Flood transparency from the border (and from any grid lines given as ([xs], [ys])) over background colours.
    Near a grid line, dark neutral greys count as background too, so anti-aliased line pixels go with it."""
    w, h = im.size; px = im.load()
    nearx = bytearray(w); neary = bytearray(h)
    if lines:
        for lx in lines[0]:
            for x in range(max(0, lx - 6), min(w, lx + 7)): nearx[x] = 1
        for ly in lines[1]:
            for y in range(max(0, ly - 6), min(h, ly + 7)): neary[y] = 1
    # a fake checkerboard has two colours with soft edges: anything between them counts as background
    between = None
    if len(bgs) >= 2:
        a, b = bgs[0], bgs[1]
        if max(abs(a[i] - b[i]) for i in range(3)) <= 90: between = tuple((min(a[i], b[i]) - tol // 2, max(a[i], b[i]) + tol // 2) for i in range(3))
    def isbg(p, x, y):
        if any(max(abs(p[i] - c[i]) for i in range(3)) <= tol for c in bgs): return True
        if between and all(between[i][0] <= p[i] <= between[i][1] for i in range(3)) and max(p[:3]) - min(p[:3]) <= 18: return True
        return (nearx[x] or neary[y]) and 24 <= max(p[:3]) <= 120 and max(p[:3]) - min(p[:3]) <= 16
    seen = bytearray(w * h); q = deque()
    def push(x, y):
        i = y * w + x
        if seen[i]: return
        seen[i] = 1
        if isbg(px[x, y], x, y): q.append((x, y))
    for x in range(w): push(x, 0); push(x, h - 1)
    for y in range(h): push(0, y); push(w - 1, y)
    if lines:
        for lx in lines[0]:
            for y in range(h):
                for x in (lx - 1, lx, lx + 1):
                    if 0 <= x < w: push(x, y)
        for ly in lines[1]:
            for x in range(w):
                for y in (ly - 1, ly, ly + 1):
                    if 0 <= y < h: push(x, y)
    while q:
        x, y = q.popleft(); p = px[x, y]; px[x, y] = (p[0], p[1], p[2], 0)
        if x > 0: push(x - 1, y)
        if x < w - 1: push(x + 1, y)
        if y > 0: push(x, y - 1)
        if y < h - 1: push(x, y + 1)
    return im

def fill_holes(im, maxarea=600):
    """Re-opaque small transparent pockets that are not connected to the outside (speckle holes inside sprites)."""
    w, h = im.size; px = im.load(); seen = bytearray(w * h); q = deque()
    def push(x, y):
        i = y * w + x
        if seen[i] or px[x, y][3]: return
        seen[i] = 1; q.append((x, y))
    for x in range(w): push(x, 0); push(x, h - 1)
    for y in range(h): push(0, y); push(w - 1, y)
    while q:
        x, y = q.popleft()
        if x > 0: push(x - 1, y)
        if x < w - 1: push(x + 1, y)
        if y > 0: push(x, y - 1)
        if y < h - 1: push(x, y + 1)
    # anything transparent and unseen is enclosed; fill pockets up to maxarea
    for y0 in range(h):
        for x0 in range(w):
            i = y0 * w + x0
            if seen[i] or px[x0, y0][3]: continue
            pocket = [(x0, y0)]; seen[i] = 1; k = 0
            while k < len(pocket):
                x, y = pocket[k]; k += 1
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if not seen[j] and not px[nx, ny][3]: seen[j] = 1; pocket.append((nx, ny))
            if len(pocket) <= maxarea:
                for x, y in pocket: p = px[x, y]; px[x, y] = (p[0], p[1], p[2], 255)
    return im

def components(im, minsize):
    w, h = im.size; px = im.load(); lab = bytearray(w * h); boxes = []
    for y0 in range(h):
        for x0 in range(w):
            if lab[y0 * w + x0] or px[x0, y0][3] == 0: continue
            q = deque([(x0, y0)]); lab[y0 * w + x0] = 1; xs = [x0, x0]; ys = [y0, y0]; n = 0
            while q:
                x, y = q.popleft(); n += 1
                if x < xs[0]: xs[0] = x
                if x > xs[1]: xs[1] = x
                if y < ys[0]: ys[0] = y
                if y > ys[1]: ys[1] = y
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and not lab[ny * w + nx] and px[nx, ny][3]:
                            lab[ny * w + nx] = 1; q.append((nx, ny))
            if n >= minsize: boxes.append([xs[0], ys[0], xs[1] + 1, ys[1] + 1])
    return boxes

def merge(boxes, gap, lines=([], [])):
    """Join boxes closer than gap. Across a grid line, join only when both boxes reach the line (one sprite cut in two)."""
    def crosses(a, b):
        for lx in lines[0]:
            if (a[2] <= lx + 3 and b[0] >= lx - 3) or (b[2] <= lx + 3 and a[0] >= lx - 3):
                if not (max(a[2], b[2]) >= lx - 4 and min(a[0], b[0]) <= lx + 4 and min(a[2], b[2]) >= lx - 4 and max(a[0], b[0]) <= lx + 4): return True
        for ly in lines[1]:
            if (a[3] <= ly + 3 and b[1] >= ly - 3) or (b[3] <= ly + 3 and a[1] >= ly - 3):
                if not (min(a[3], b[3]) >= ly - 4 and max(a[1], b[1]) <= ly + 4): return True
        return False
    changed = True
    while changed:
        changed = False
        out = []
        for b in boxes:
            for o in out:
                if b[0] < o[2] + gap and b[2] > o[0] - gap and b[1] < o[3] + gap and b[3] > o[1] - gap and not crosses(b, o):
                    o[0] = min(o[0], b[0]); o[1] = min(o[1], b[1]); o[2] = max(o[2], b[2]); o[3] = max(o[3], b[3]); changed = True; break
            else: out.append(list(b))
        boxes = out
    return boxes

def reading_order(boxes):
    rows = []
    for b in sorted(boxes, key=lambda b: b[1]):
        cy = (b[1] + b[3]) / 2
        for r in rows:
            if abs(r['cy'] - cy) < max(40, (b[3] - b[1]) * 0.5): r['items'].append(b); r['cy'] = sum((x[1] + x[3]) / 2 for x in r['items']) / len(r['items']); break
        else: rows.append({'cy': cy, 'items': [b]})
    rows.sort(key=lambda r: r['cy'])
    return [b for r in rows for b in sorted(r['items'], key=lambda b: b[0])]

def grid_lines(im, axis, dark=90, frac=0.6):
    """Positions of dark grid lines along an axis: columns (axis 0) or rows (axis 1) that are mostly dark."""
    w, h = im.size; px = im.load(); n = w if axis == 0 else h; m = h if axis == 0 else w
    hits = []
    for i in range(n):
        cnt = 0
        for j in range(0, m, 2):
            p = px[i, j] if axis == 0 else px[j, i]
            if p[0] + p[1] + p[2] < dark * 3: cnt += 1
        hits.append(cnt / (m / 2) >= frac)
    lines = []; start = None
    for i, v in enumerate(hits + [False]):
        if v and start is None: start = i
        if not v and start is not None: lines.append((start + i - 1) // 2); start = None
    return lines

def grid_cells(im, minsize=40):
    w, h = im.size
    xs = [-1] + grid_lines(im, 0) + [w]; ys = [-1] + grid_lines(im, 1) + [h]
    cells = []
    for r in range(len(ys) - 1):
        for c in range(len(xs) - 1):
            x0, x1, y0, y1 = xs[c] + 2, xs[c + 1] - 1, ys[r] + 2, ys[r + 1] - 1
            if x1 - x0 >= minsize and y1 - y0 >= minsize: cells.append((x0, y0, x1, y1))
    return cells

def main():
    args, pos = parse_args(sys.argv[1:])
    if len(pos) < 2: sys.exit(__doc__)
    src, cat = pos[0], pos[1]; names = [l.strip() for l in open(pos[2])] if len(pos) > 2 else None
    im = Image.open(src).convert('RGBA'); w, h = im.size
    if args['grid']:
        # gridded sheet: key each cell against its own border colours, one sprite per non-empty cell
        keyed = Image.new('RGBA', im.size, (0, 0, 0, 0)); boxes = []
        cells = grid_cells(im)
        print(len(cells), 'cells')
        for (x0, y0, x1, y1) in cells:
            cell = im.crop((x0, y0, x1, y1)); cw, ch = cell.size
            bgs = border_colours(cell.load(), cw, ch, args['tol']) + args['bg']
            k = key(cell, bgs, args['tol'])
            parts = components(k, args['min'])
            if not parts: continue
            b = [min(p[0] for p in parts), min(p[1] for p in parts), max(p[2] for p in parts), max(p[3] for p in parts)]
            keyed.paste(k, (x0, y0)); boxes.append([b[0] + x0, b[1] + y0, b[2] + x0, b[3] + y0])
        boxes = reading_order(boxes)
    elif args['cells']:
        # fixed cells, no keying: textures. --cells WxH[+X+Y] crops that square from the centre of each cell
        spec = args['cells'].replace('+', 'x').split('x'); cw, ch = int(spec[0]), int(spec[1]); sq = int(spec[2]) if len(spec) > 2 else min(cw, ch)
        keyed = im.copy(); boxes = []
        for r in range(int(h // ch)):
            for c in range(int(w // cw)):
                x0 = int(c * cw + (cw - sq) / 2); y0 = int(r * ch + (ch - sq) / 2); boxes.append([x0, y0, x0 + sq, y0 + sq])
    else:
        bgs = border_colours(im.load(), w, h, args['tol']) + args['bg']
        print('background colours', bgs)
        dark = max(36, min(sum(c) // 3 for c in bgs) - 40)   # grid lines are much darker than the background
        lines = (grid_lines(im, 0, dark), grid_lines(im, 1, dark))
        if not (lines[0] and lines[1]): lines = ([], [])   # a real grid has both; anything else is a false positive
        print('grid lines', len(lines[0]), 'columns,', len(lines[1]), 'rows')
        keyed = key(im.copy(), bgs, args['tol'], lines=lines if lines[0] else None)
        # cut along the grid lines so neighbouring cells never merge; pieces of one sprite rejoin in merge()
        kp = keyed.load()
        for lx in lines[0]:
            for x in range(max(0, lx - 2), min(w, lx + 3)):
                for y in range(h): p = kp[x, y]; kp[x, y] = (p[0], p[1], p[2], 0)
        for ly in lines[1]:
            for y in range(max(0, ly - 2), min(h, ly + 3)):
                for x in range(w): p = kp[x, y]; kp[x, y] = (p[0], p[1], p[2], 0)
        for (bx0, by0, bx1, by1) in args['blank']:
            for y in range(by0, by1):
                for x in range(bx0, bx1): p = kp[x, y]; kp[x, y] = (p[0], p[1], p[2], 0)
        raw = components(keyed, args['min'])
        # the grid lattice, if any, is one enormous thin component: drop anything spanning most of the sheet
        raw = [b for b in raw if (b[2] - b[0]) < w * 0.45 and (b[3] - b[1]) < h * 0.45]
        # cells with their own background survive as solid rectangles: key those against their own border
        px = keyed.load(); out = []
        for b in raw:
            bw, bh = b[2] - b[0], b[3] - b[1]
            if bw * bh > 150 * 150:
                filled = sum(1 for x in range(b[0], b[2], 4) for y in range(b[1], b[3], 4) if px[x, y][3]) / max(1, (bw // 4) * (bh // 4))
                if filled > 0.92:
                    cell = keyed.crop(b); cb = border_colours(cell.load(), bw, bh, args['tol'])
                    k = key(cell, cb, args['tol']); keyed.paste(k, (b[0], b[1]))
                    out += [[p[0] + b[0], p[1] + b[1], p[2] + b[0], p[3] + b[1]] for p in components(k, args['min'])]
                    continue
            out.append(b)
        boxes = reading_order(merge(out, args['gap'], lines))
    print(len(boxes), 'sprites')
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if names is None:
        prev = keyed.copy(); d = ImageDraw.Draw(prev)
        for i, b in enumerate(boxes): d.rectangle([b[0], b[1], b[2] - 1, b[3] - 1], outline=(255, 0, 255, 255), width=3); d.text((b[0] + 4, b[1] + 4), str(i), fill=(255, 255, 0, 255))
        out = os.path.join(root, 'art-src', f'_{cat}-preview.png'); os.makedirs(os.path.dirname(out), exist_ok=True); prev.save(out)
        print('preview', out); return
    os.makedirs(os.path.join(root, 'art-src'), exist_ok=True)
    i = 0; written = 0
    for name in names:
        if not name or name.startswith('#'): continue
        if name == '-': i += 1; continue
        if '@' in name:
            # "name @x,y": the blob under that sheet coordinate (or the nearest blob centre within 140px)
            name, pt = [t.strip() for t in name.split('@')]; x, y = [int(v) for v in pt.split(',')]
            hit = [b for b in boxes if b[0] <= x < b[2] and b[1] <= y < b[3]]
            if not hit:
                near = sorted(boxes, key=lambda b: ((b[0] + b[2]) / 2 - x) ** 2 + ((b[1] + b[3]) / 2 - y) ** 2)
                if near and ((near[0][0] + near[0][2]) / 2 - x) ** 2 + ((near[0][1] + near[0][3]) / 2 - y) ** 2 <= 140 ** 2: hit = [near[0]]
            if not hit: print('no sprite at', x, y, 'for', name); continue
            bs = hit
        else:
            count = 1
            if '*' in name: name, n = name.split('*'); count = int(n)
            elif name.endswith('+'): count = 2; name = name[:-1]
            if i >= len(boxes): print('ran out of sprites at', name); break
            bs = boxes[i:i + count]; i += count
        b = [min(x[0] for x in bs), min(x[1] for x in bs), max(x[2] for x in bs), max(x[3] for x in bs)]
        sp = keyed.crop(b)
        if not args['cells']: sp = fill_holes(sp)
        sp.save(os.path.join(root, 'art-src', f'{cat}-{name}.png')); written += 1
    print('wrote', written, 'sprites; unused blobs:', len(boxes) - i)

if __name__ == '__main__': main()
