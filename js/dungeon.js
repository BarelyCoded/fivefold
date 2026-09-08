// Dungeon crawls: a small top-down stone maze drawn from the sprite sheet. Stationary monsters block
// corridors, chests hold life, gold and cards, scrolls hold riddles, and a door leads out.
// Layouts are plain data so they persist in the save.

const GW = 9, GH = 7;          // maze cells
const T = 37;                  // sprite tile size; each maze cell is one tile with passage tiles between
const TX = GW * 2 + 1, TY = GH * 2 + 1;
const OY = 34;                 // banner strip above the map
const key = (x, y) => `${x},${y}`;
import { present } from './world.js';
import { atlasReady, blit, blitAt, pick, DUNGEON_TILES, SPRITES, MONSTERS, DUNGEON_MONSTER } from './atlas.js';
import { costString } from './cards.js';
let labels = [];

// ---- generation ------------------------------------------------------------------
export function generateDungeon(rng, tpl, opts = {}) {
  const cells = {};
  const links = new Set();
  const link = (a, b) => { links.add(key(a.x, a.y) + '|' + key(b.x, b.y)); links.add(key(b.x, b.y) + '|' + key(a.x, a.y)); };
  const target = opts.size || 16 + Math.floor(rng() * 5);
  const start = { x: Math.floor(GW / 2), y: GH - 1 };
  cells[key(start.x, start.y)] = { x: start.x, y: start.y, type: 'entrance', done: true };
  // Growing tree: pick a random frontier cell (mostly the newest) and carve into an unvisited neighbour.
  const stack = [start];
  let guard = 0;
  while (Object.keys(cells).length < target && stack.length && guard++ < 2000) {
    const cur = rng() < 0.7 ? stack[stack.length - 1] : stack[Math.floor(rng() * stack.length)];
    const nbrs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: cur.x + dx, y: cur.y + dy })).filter(n => n.x >= 0 && n.y >= 0 && n.x < GW && n.y < GH && !cells[key(n.x, n.y)]);
    if (!nbrs.length) { stack.splice(stack.indexOf(cur), 1); continue; }
    const n = nbrs[Math.floor(rng() * nbrs.length)];
    cells[key(n.x, n.y)] = { x: n.x, y: n.y, type: 'floor', done: false };
    link(cur, n); stack.push(n);
  }
  // Distances from the entrance along the tree.
  const dist = {}; const q = [start]; dist[key(start.x, start.y)] = 0; const parent = {};
  while (q.length) {
    const c = q.shift();
    for (const n of neighbours(cells, links, c)) { const k = key(n.x, n.y); if (dist[k] === undefined) { dist[k] = dist[key(c.x, c.y)] + 1; parent[k] = key(c.x, c.y); q.push(n); } }
  }
  const all = Object.values(cells);
  const exit = all.filter(c => c.type === 'floor').sort((a, b) => dist[key(b.x, b.y)] - dist[key(a.x, a.y)])[0];
  exit.type = 'exit';
  // Main path from entrance to exit.
  const path = []; let k = key(exit.x, exit.y); while (k && k !== key(start.x, start.y)) { path.unshift(k); k = parent[k]; }
  const onPath = new Set(path);
  const deadEnds = all.filter(c => c.type === 'floor' && neighbours(cells, links, c).length === 1 && !onPath.has(key(c.x, c.y)));
  // Guardian on the cell before the exit; two more monsters spaced along the path; one guarding a branch.
  const monsters = [];
  const before = cells[path[path.length - 2]]; if (before && before.type === 'floor') { before.type = 'monster'; before.payload = { tier: 2, guardian: true }; monsters.push(before); }
  const spots = [Math.floor(path.length / 3), Math.floor(path.length * 2 / 3)];
  for (const i of spots) { const c = cells[path[i]]; if (c && c.type === 'floor') { c.type = 'monster'; c.payload = { tier: i < path.length / 2 ? 1 : 2 }; monsters.push(c); } }
  // Treasures at dead ends, one riddle scroll, and a monster guarding the richest branch.
  const shuffled = deadEnds.sort(() => rng() - 0.5);
  const kinds = ['card', 'gold', 'life', 'gold', 'card', 'amulet'];
  shuffled.forEach((c, i) => {
    if (i === 0 && shuffled.length > 1) { c.type = 'riddle'; c.payload = {}; return; }
    c.type = 'treasure'; c.payload = { kind: kinds[i % kinds.length] };
  });
  // Guard the first card treasure by putting a monster on the cell leading to it, if that cell is plain floor.
  const rich = shuffled.find(c => c.type === 'treasure' && c.payload.kind === 'card');
  if (rich) { const p = cells[parent[key(rich.x, rich.y)]]; if (p && p.type === 'floor' && !onPath.has(key(p.x, p.y))) { p.type = 'monster'; p.payload = { tier: 1 }; monsters.push(p); } }
  // Remaining plain floor dead ends near the path get small gold.
  for (const c of all) if (c.type === 'floor' && neighbours(cells, links, c).length === 1 && rng() < 0.5) { c.type = 'treasure'; c.payload = { kind: 'gold' }; }
  return { w: GW, h: GH, cells, links: [...links], entrance: { x: start.x, y: start.y }, exit: { x: exit.x, y: exit.y }, px: start.x, py: start.y, monsters: monsters.length, seed: Math.floor(rng() * 1e9), status: 'First move' };
}
export function neighbours(cells, links, c) {
  const ls = links instanceof Set ? links : new Set(links);
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => cells[key(c.x + dx, c.y + dy)]).filter(n => n && ls.has(key(c.x, c.y) + '|' + key(n.x, n.y)));
}
export function linked(layout, a, b) { return layout.links.includes(key(a.x, a.y) + '|' + key(b.x, b.y)); }
export function cellOf(layout, x, y) { return layout.cells[key(x, y)] || null; }
export function playerCell(layout) { return cellOf(layout, layout.px, layout.py); }
export function remainingMonsters(layout) { return Object.values(layout.cells).filter(c => c.type === 'monster' && !c.done).length; }

// ---- riddles from real card facts ---------------------------------------------------
const COLOR_WORDS = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
// only: optional list of riddle kinds to allow ('cost', 'pt', 'power', 'toughness', 'color', 'cmc', 'keyword').
export function makeRiddle(rng, defs, only = null) {
  const pool = defs.filter(d => d && d.kind !== 'unsupported');
  if (!pool.length) return null;
  const d = pool[Math.floor(rng() * pool.length)];
  let kinds = [];
  if (d.kind === 'creature') kinds.push('power', 'toughness', 'pt');
  if (d.colors.length === 1) kinds.push('color');
  if (d.cmc > 0) kinds.push('cmc', 'cost');
  if (d.kwNames?.length) kinds.push('keyword');
  if (only) kinds = kinds.filter(k => only.includes(k));
  if (!kinds.length) return makeRiddle(rng, pool.filter(x => x !== d), only);
  const kind = kinds[Math.floor(rng() * kinds.length)];
  let q, answer, options;
  const nums = n => [...new Set([n, n + 1, Math.max(0, n - 1), n + 2, n + 3, Math.max(0, n - 2)])].slice(0, 4);
  switch (kind) {
    case 'power': q = `What is the power of ${d.name}?`; answer = String(d.power); options = nums(d.power).map(String); break;
    case 'toughness': q = `What is the toughness of ${d.name}?`; answer = String(d.toughness); options = nums(d.toughness).map(String); break;
    case 'color': q = `What color is ${d.name}?`; answer = COLOR_WORDS[d.colors[0]]; options = Object.values(COLOR_WORDS); break;
    case 'cmc': q = `What is the mana value of ${d.name}?`; answer = String(d.cmc); options = nums(d.cmc).map(String); break;
    case 'cost': {
      q = `What is the mana cost of ${d.name}?`; answer = costString(d.cost);
      const c = d.cost; const pipColor = c.pips[0]?.[0] || 'W'; const other = ['W', 'U', 'B', 'R', 'G'].filter(x => x !== pipColor);
      const vars = [
        { pips: c.pips, generic: c.generic + 1 }, { pips: c.pips, generic: Math.max(0, c.generic - 1) },
        { pips: [...c.pips, [pipColor]], generic: Math.max(0, c.generic - 1) }, { pips: c.pips.map(() => [other[Math.floor(rng() * other.length)]]), generic: c.generic },
        { pips: c.pips.slice(1), generic: c.generic + 1 },
      ].map(v => costString({ ...v, x: c.x })).filter(v => v && v !== answer);
      options = [answer, ...[...new Set(vars)].sort(() => rng() - 0.5).slice(0, 3)]; break;
    }
    case 'pt': {
      q = `What are the power and toughness of ${d.name}?`; answer = `${d.power}/${d.toughness}`;
      const vars = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dp, dt]) => `${Math.max(0, d.power + dp)}/${Math.max(1, d.toughness + dt)}`).filter(v => v !== answer);
      options = [answer, ...[...new Set(vars)].sort(() => rng() - 0.5).slice(0, 3)]; break;
    }
    case 'keyword': { const all = ['Flying', 'First strike', 'Trample', 'Banding', 'Regeneration', 'Swampwalk', 'Islandwalk', 'Forestwalk', 'Mountainwalk', 'Plainswalk', 'Protection from red', 'Vigilance', 'Haste']; answer = d.kwNames[0]; options = [answer, ...all.filter(k => !d.kwNames.includes(k)).sort(() => rng() - 0.5).slice(0, 5)]; q = `What special ability does ${d.name} have?`; break; }
  }
  options = [...new Set(options)].sort(() => rng() - 0.5);
  return { q, answer, options, card: d.name };
}

// ---- rendering ---------------------------------------------------------------------
function hash(x, y, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 1103515245) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
const px = (ctx, x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
export const CANVAS = { w: TX * T, h: OY + TY * T };
// Centre of a maze cell in canvas pixels.
export function isoPos(x, y) { return [(2 * x + 1) * T + T / 2, OY + (2 * y + 1) * T + T / 2]; }
// Inverse: canvas pixel -> maze cell. Clicking a passage tile picks the cell on its far side from the player.
export function cellAtPixel(layout, cx, cy) {
  const tx = Math.floor(cx / T), ty = Math.floor((cy - OY) / T);
  if (tx < 0 || ty < 0 || tx >= TX || ty >= TY) return null;
  if (tx % 2 === 1 && ty % 2 === 1) return cellOf(layout, (tx - 1) / 2, (ty - 1) / 2);
  const cands = tx % 2 === 0 && ty % 2 === 1 ? [cellOf(layout, tx / 2 - 1, (ty - 1) / 2), cellOf(layout, tx / 2, (ty - 1) / 2)]
    : ty % 2 === 0 && tx % 2 === 1 ? [cellOf(layout, (tx - 1) / 2, ty / 2 - 1), cellOf(layout, (tx - 1) / 2, ty / 2)] : [];
  return cands.find(c => c && !(c.x === layout.px && c.y === layout.py)) || null;
}

let frame = null;
const TREASURE_SPRITE = { card: 'chest', gold: 'chestSmall', life: 'potion', amulet: 'amulet' };
export function drawDungeon(canvas, layout, tpl, opts = {}) {
  const W = CANVAS.w, H = CANVAS.h;
  labels = [];
  if (!frame) frame = document.createElement('canvas');
  frame.width = W; frame.height = H;
  const ctx = frame.getContext('2d'); ctx.imageSmoothingEnabled = false;
  px(ctx, 0, 0, W, H, '#0a0908');
  const links = new Set(layout.links);
  const open = (c, dx, dy) => links.has(key(c.x, c.y) + '|' + key(c.x + dx, c.y + dy));
  const cells = Object.values(layout.cells);
  const seed = layout.seed || 0;
  const ready = atlasReady();
  // tile kinds: floor for cells and open passages, wall around them, rock beyond
  const kind = Array.from({ length: TY }, () => new Array(TX).fill('rock'));
  for (const c of cells) {
    kind[2 * c.y + 1][2 * c.x + 1] = 'floor';
    if (open(c, 1, 0)) kind[2 * c.y + 1][2 * c.x + 2] = 'floor';
    if (open(c, 0, 1)) kind[2 * c.y + 2][2 * c.x + 1] = 'floor';
  }
  for (let ty = 0; ty < TY; ty++) for (let tx = 0; tx < TX; tx++) {
    if (kind[ty][tx] !== 'rock') continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (kind[ty + dy]?.[tx + dx] === 'floor') { near = true; break; }
    if (near) kind[ty][tx] = 'wall';
  }
  const at = (tx, ty) => kind[ty]?.[tx] || 'rock';
  for (let ty = 0; ty < TY; ty++) for (let tx = 0; tx < TX; tx++) {
    const k = at(tx, ty), x = tx * T, y = OY + ty * T, r = hash(tx, ty, seed), r2 = hash(tx, ty, seed + 1);
    if (!ready) { px(ctx, x, y, T, T, k === 'floor' ? '#4a443e' : k === 'wall' ? '#6b6258' : r < 0.1 ? '#b3401a' : '#1c1816'); continue; }
    if (k === 'floor') blit(ctx, pick(DUNGEON_TILES.floor, r), x, y, T, T);
    else if (k === 'wall') blit(ctx, at(tx, ty + 1) === 'floor' ? pick(DUNGEON_TILES.wallFace, r) : pick(DUNGEON_TILES.wallTop, r), x, y, T, T);
    else blit(ctx, r < 0.035 ? pick(DUNGEON_TILES.lava, r2) : r < 0.18 ? pick(DUNGEON_TILES.rockCrack, r2) : pick(DUNGEON_TILES.rock, r2), x, y, T, T);
    if (k === 'wall' && at(tx, ty + 1) === 'floor' && r2 < 0.22) blitAt(ctx, SPRITES.torch, x + T / 2, y + T - 4, Math.min(0.7, 26 / SPRITES.torch[3]));
  }
  // reachable cells
  const reach = neighbours(layout.cells, links, playerCell(layout));
  if (opts.showReach !== false) for (const c of reach) { const [cx, cy] = isoPos(c.x, c.y); ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.setLineDash([3, 3]); ctx.strokeRect(cx - T / 2 + 2.5, cy - T / 2 + 2.5, T - 5, T - 5); ctx.setLineDash([]); }
  // objects
  const monster = MONSTERS[DUNGEON_MONSTER[tpl?.color] || 'skeleton'];
  const drawObj = (rect, cx, cy, s) => { if (ready && rect) blitAt(ctx, rect, cx, cy + T / 2 - 3, Math.min(s, 30 / rect[3])); };
  for (const c of cells) {
    const [cx, cy] = isoPos(c.x, c.y);
    if (c.type === 'monster' && !c.done) {
      const g = c.payload.guardian;
      if (ready) { const m = monster.idle[0]; const k = Math.min(g ? 0.85 : 0.7, (g ? 44 : 36) / m[3]); blitAt(ctx, m, cx, cy + T / 2 - 2, k); } else px(ctx, cx - 8, cy - 10, 16, 20, '#c04040');
      px(ctx, cx + 9, cy + 7, 10, 10, '#15120f'); labels.push({ x: cx + 14, y: cy + 12, text: g ? 'G' : String(c.payload.tier), size: 6.5, box: false, color: g ? '#ffd27a' : '#fff' });
    }
    else if (c.type === 'treasure') drawObj(c.done ? SPRITES.chestOpen : SPRITES[TREASURE_SPRITE[c.payload.kind] || 'chest'], cx, cy, 0.8);
    else if (c.type === 'riddle') { if (!c.done) drawObj(SPRITES.scroll, cx, cy, 0.8); }
    else if (c.type === 'exit') { if (ready) blit(ctx, SPRITES.door, cx - T / 2, cy - T / 2, T, T); label(cx, cy + T / 2 + 6, 'Exit'); }
    else if (c.type === 'entrance') { if (ready) blit(ctx, SPRITES.portal, cx - T / 2, cy - T / 2, T, T); label(cx, cy + T / 2 + 6, 'Entrance'); }
    if (c.x === layout.px && c.y === layout.py) { if (ready) blitAt(ctx, SPRITES.hero, cx, cy + T / 2 - 1, Math.min(0.8, 40 / SPRITES.hero[3])); else px(ctx, cx - 6, cy - 12, 12, 22, '#e0604a'); }
  }
  // banner
  const title = tpl?.name || 'Dungeon'; const sub = layout.status || '';
  px(ctx, 0, 0, W, OY - 4, '#1d2a1b'); ctx.strokeStyle = '#6fa04a'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, W - 1, OY - 5);
  labels.push({ x: W / 2, y: 11, text: title, size: 11, box: false, color: '#e8ffd0', font: 'Georgia, serif' });
  labels.push({ x: W / 2, y: 23, text: sub, size: 7, box: false, color: '#9fe08a', weight: 'normal' });
  present(canvas, frame, W, H, labels);
}
function label(cx, cy, text) { labels.push({ x: cx, y: cy, text, size: 7.5, bg: 'rgba(0,0,0,.7)' }); }
