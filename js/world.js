// Overworld generation and pixel-painted rendering in the spirit of the 1997 original:
// oblique 3/4 view, dithered ground, winding dirt roads, palms on beaches, pines in forests,
// gnarled trees in swamps, stone castles and domed keeps. Rendered at half resolution and
// scaled 2x with smoothing off for chunky pixels. A camera follows the player.
import { COLORS } from './cards.js';

export const W = 30, H = 20;
export const PX = 32;          // internal pixels per tile
export const TILE = PX * 2;    // displayed pixels per tile
export const VIEW = { w: 16, h: 11 };

export const PAL = {
  W: { name: 'Plains', ground: ['#b9a56a', '#c9b678', '#a99459', '#d3c084'], grass: '#7e9a3c', grassL: '#a6c455', rock: '#8f8779', rockL: '#b5ad9e', wood: '#5a4530', leaf: '#6b8f3a', leafL: '#8fb452' },
  U: { name: 'Coast', ground: ['#1f8ea6', '#2199b3', '#1a7f96', '#24a3bd'], deep: '#156f86', ripple: '#5fc7d6', rippleD: '#136a80', sand: ['#dcc78a', '#cdb676', '#e6d39a'], palm: '#2f7a3a', palmL: '#5aa54a', trunk: '#8a6a3a' },
  B: { name: 'Swamp', ground: ['#6a6256', '#5b544a', '#77705f', '#4f4940'], pool: '#2c3c3b', poolL: '#3f5652', wood: '#2a2320', reed: '#6f7e3f', shroom: '#a86a8a' },
  R: { name: 'Mountains', ground: ['#8b7a68', '#9a8977', '#7a6a5a', '#a69584'], faceL: '#bcaa98', faceM: '#8c7b6c', faceD: '#5a4c42', snow: '#f1ede6', rock: '#6f6154' },
  G: { name: 'Forest', ground: ['#4f7d3a', '#5a8b42', '#456f33', '#66984c'], pine: '#1e4b2c', pineL: '#3c7a46', pineD: '#123420', leaf: '#2f6b2f', leafL: '#4f9a3f', trunk: '#4a3220' },
};
export const BIOME = Object.fromEntries(COLORS.map(c => [c, { name: PAL[c].name, fill: PAL[c].ground[0], dark: PAL[c].ground[2] }]));
export const CITY_NAME = { W: 'Alabaster', U: 'Tidewater', B: 'Mirehold', R: 'Cinderfall', G: 'Greenhollow' };

// ---- generation ------------------------------------------------------------------
function field(rng, w, h, passes = 2) {
  let f = Array.from({ length: h }, () => Array.from({ length: w }, () => rng()));
  for (let p = 0; p < passes; p++) {
    const g = f.map(r => r.slice());
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue; s += f[yy][xx]; n++; }
      g[y][x] = s / n;
    }
    f = g;
  }
  return f;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function generateWorld(rng, enemies, startColor) {
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.36;
  const rot = rng() * Math.PI * 2;
  const seeds = COLORS.map((c, i) => { const a = rot + i * Math.PI * 2 / 5 + (rng() - 0.5) * 0.4; return { c, x: Math.round(cx + Math.cos(a) * r * 1.25), y: Math.round(cy + Math.sin(a) * r) }; });
  const noise = COLORS.map(() => field(rng, W, H));
  const tiles = new Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let best = 0, bd = Infinity;
    seeds.forEach((s, i) => { const d = dist({ x, y }, s) + (noise[i][y][x] - 0.5) * 9; if (d < bd) { bd = d; best = i; } });
    tiles[y * W + x] = COLORS[best];
  }
  const at = (x, y) => tiles[y * W + x];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const cities = seeds.map(s => ({ x: clamp(s.x, 1, W - 2), y: clamp(s.y, 1, H - 2), color: s.c, name: CITY_NAME[s.c] }));
  for (const c of cities) tiles[c.y * W + c.x] = c.color;
  const occupied = new Set(cities.map(c => `${c.x},${c.y}`));
  const start = cities.find(c => c.color === startColor);
  const randomTile = (pred, tries = 400) => { for (let i = 0; i < tries; i++) { const x = Math.floor(rng() * W), y = Math.floor(rng() * H); if (occupied.has(`${x},${y}`)) continue; if (pred(x, y)) return { x, y }; } return null; };
  const links = [];
  for (const c of cities) { const t = randomTile((x, y) => at(x, y) === c.color && dist({ x, y }, c) >= 4 && dist({ x, y }, start) >= 3); if (t) { links.push({ ...t, color: c.color, taken: false }); occupied.add(`${t.x},${t.y}`); } }
  let castle = null, far = -1;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { if (occupied.has(`${x},${y}`)) continue; const d = dist({ x, y }, start); if (d > far) { far = d; castle = { x, y }; } }
  occupied.add(`${castle.x},${castle.y}`);
  const roam = [];
  let uid = 1;
  for (let i = 0; i < 16; i++) {
    const t = randomTile((x, y) => dist({ x, y }, start) >= 3); if (!t) continue;
    const color = at(t.x, t.y); const tier = dist(t, start) < 9 ? 1 : 2;
    const pool = enemies.filter(e => e.color === color && !e.boss); const tpl = pool.find(e => e.tier === tier) || pool[0]; if (!tpl) continue;
    roam.push({ uid: uid++, x: t.x, y: t.y, template: tpl.id, tier: tpl.tier, color }); occupied.add(`${t.x},${t.y}`);
  }
  return { w: W, h: H, tiles, cities, links, castle, enemies: roam, start: { x: start.x, y: start.y }, seed: Math.floor(rng() * 1e9) };
}

export const tileAt = (world, x, y) => world.tiles[y * world.w + x];
export const inBounds = (world, x, y) => x >= 0 && y >= 0 && x < world.w && y < world.h;
export const cityAt = (world, x, y) => world.cities.find(c => c.x === x && c.y === y);
export const linkAt = (world, x, y) => world.links.find(l => l.x === x && l.y === y);
export const enemyAt = (world, x, y) => world.enemies.find(e => e.x === x && e.y === y);
export const dungeonAt = (world, x, y) => (world.dungeons || []).find(d => d.x === x && d.y === y);

// Place one hidden dungeon per template in matching terrain. Safe to call on old saves.
export function placeDungeons(world, rng, templates) {
  if (world.dungeons) return world.dungeons;
  const taken = new Set([...world.cities.map(c => `${c.x},${c.y}`), ...world.links.map(l => `${l.x},${l.y}`), `${world.castle.x},${world.castle.y}`, ...world.enemies.map(e => `${e.x},${e.y}`)]);
  const out = [];
  for (const t of templates) {
    let best = null;
    for (let i = 0; i < 500 && !best; i++) {
      const x = Math.floor(rng() * world.w), y = Math.floor(rng() * world.h);
      if (taken.has(`${x},${y}`) || tileAt(world, x, y) !== t.color) continue;
      if (dist({ x, y }, world.start) < 4) continue;
      best = { x, y };
    }
    if (!best) { for (let i = 0; i < 500 && !best; i++) { const x = Math.floor(rng() * world.w), y = Math.floor(rng() * world.h); if (!taken.has(`${x},${y}`) && dist({ x, y }, world.start) >= 4) best = { x, y }; } }
    if (!best) continue;
    taken.add(`${best.x},${best.y}`);
    out.push({ id: t.id, x: best.x, y: best.y, color: t.color, revealed: false, cleared: false });
  }
  world.dungeons = out;
  return out;
}

export function stepEnemies(world, rng, player) {
  for (const e of world.enemies) {
    if (rng() > 0.45) continue;
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rng() * 4)];
    const nx = e.x + dx, ny = e.y + dy;
    if (!inBounds(world, nx, ny)) continue;
    if (cityAt(world, nx, ny) || linkAt(world, nx, ny) || enemyAt(world, nx, ny)) continue;
    if (world.castle.x === nx && world.castle.y === ny) continue;
    if (dungeonAt(world, nx, ny)) continue;
    if (player.x === nx && player.y === ny) continue;
    if (tileAt(world, nx, ny) !== e.color && rng() < 0.7) continue;
    e.x = nx; e.y = ny;
  }
}

export function cameraFor(world, player) {
  const cx = Math.max(0, Math.min(world.w - VIEW.w, player.x - Math.floor(VIEW.w / 2)));
  const cy = Math.max(0, Math.min(world.h - VIEW.h, player.y - Math.floor(VIEW.h / 2)));
  return { x: cx, y: cy };
}

// ---- pixel helpers -----------------------------------------------------------------
function hash(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 1103515245) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, s) { // value noise on an 8px lattice
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}
function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
const px = (ctx, x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
// Fill a rect with a dithered mix of colours driven by noise and a checker pattern.
function dither(img, W_, x0, y0, w, h, cols, seed, scale = 6) {
  const rgb = cols.map(hexRgb);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const n = vnoise(x / scale, y / scale, seed) * 0.7 + hash(x, y, seed + 9) * 0.3;
    let i = Math.min(rgb.length - 1, Math.floor(n * rgb.length));
    if (((x + y) & 1) && hash(x, y, seed + 5) < 0.35) i = Math.min(rgb.length - 1, i + 1);
    const o = (y * W_ + x) * 4; img[o] = rgb[i][0]; img[o + 1] = rgb[i][1]; img[o + 2] = rgb[i][2]; img[o + 3] = 255;
  }
}

// ---- terrain painter -------------------------------------------------------------
const terrainCache = new WeakMap();
function paintTerrain(world) {
  const Wp = world.w * PX, Hp = world.h * PX;
  const c = document.createElement('canvas'); c.width = Wp; c.height = Hp;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const seed = world.seed || 0;
  const h = (x, y, s) => hash(x, y, s + seed);
  const at = (x, y) => inBounds(world, x, y) ? tileAt(world, x, y) : null;
  const isBeach = (x, y) => at(x, y) === 'U' && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => at(x + dx, y + dy) && at(x + dx, y + dy) !== 'U');
  const image = ctx.createImageData(Wp, Hp); const img = image.data;

  // 1. ground with organic borders: each pixel picks its biome from the nearest tile centre with noise
  const owner = (x, y) => {
    const tx = Math.floor(x / PX), ty = Math.floor(y / PX);
    let best = at(tx, ty), bd = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = at(tx + dx, ty + dy); if (!t) continue;
      const cx = (tx + dx) * PX + PX / 2 + (vnoise(x / 11, y / 11, seed + dx * 3 + dy * 7) - 0.5) * 22;
      const cy = (ty + dy) * PX + PX / 2 + (vnoise(x / 13, y / 13, seed + dx * 5 + dy * 11) - 0.5) * 22;
      const d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = t; }
    }
    return best;
  };
  const beachMap = new Uint8Array(world.w * world.h);
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) beachMap[y * world.w + x] = isBeach(x, y) ? 1 : 0;
  for (let y = 0; y < Hp; y++) for (let x = 0; x < Wp; x++) {
    const b = owner(x, y);
    const tx = Math.floor(x / PX), ty = Math.floor(y / PX);
    let cols = PAL[b].ground, scale = 6;
    if (b === 'U') {
      // beaches: sand near land, water elsewhere, with a noisy shoreline
      const nearLand = beachMap[ty * world.w + tx] || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(tx + dx, ty + dy) && at(tx + dx, ty + dy) !== 'U');
      let sandy = false;
      if (nearLand) {
        let dl = 99;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const t = at(tx + dx, ty + dy); if (t && t !== 'U') { const ex = (tx + dx) * PX + PX / 2, ey = (ty + dy) * PX + PX / 2; dl = Math.min(dl, Math.hypot(x - ex, y - ey)); } }
        sandy = dl < PX * 0.95 + (vnoise(x / 7, y / 7, seed + 77) - 0.5) * 14;
      }
      if (sandy) { cols = PAL.U.sand; scale = 5; }
      else if (h(tx, ty, 300) < 0.08 && Math.hypot(x - tx * PX - PX / 2, y - ty * PX - PX / 2) < 7 + vnoise(x / 5, y / 5, seed + 4) * 5) { cols = PAL.U.sand; scale = 5; } // islet
      else cols = PAL.U.ground;
    }
    dither(img, Wp, x, y, 1, 1, cols, seed + (cols === PAL.U.sand ? 2 : 1), scale);
  }
  ctx.putImageData(image, 0, 0);

  // 2. small ground details per tile
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    const b = at(x, y), X = x * PX, Y = y * PX, p = PAL[b];
    if (b === 'U') {
      const sand = beachMap[y * world.w + x];
      for (let i = 0; i < (sand ? 1 : 3); i++) {
        const wx = X + 3 + Math.floor(h(x, y, 100 + i) * (PX - 12)), wy = Y + 3 + Math.floor(h(x, y, 110 + i) * (PX - 6));
        px(ctx, wx, wy, 5, 1, p.rippleD); px(ctx, wx + 2, wy - 1, 4, 1, p.ripple);
      }
      if (sand && h(x, y, 120) < 0.5) { const gx = X + 4 + Math.floor(h(x, y, 121) * 20), gy = Y + 6 + Math.floor(h(x, y, 122) * 18); px(ctx, gx, gy, 1, 3, PAL.G.leaf); px(ctx, gx + 2, gy - 1, 1, 4, PAL.G.leafL); px(ctx, gx - 2, gy + 1, 1, 2, PAL.G.leaf); }
    } else if (b === 'W') {
      for (let i = 0; i < 3; i++) { const gx = X + 2 + Math.floor(h(x, y, 130 + i) * (PX - 6)), gy = Y + 3 + Math.floor(h(x, y, 140 + i) * (PX - 6)); px(ctx, gx, gy, 1, 3, p.grass); px(ctx, gx + 2, gy - 1, 1, 4, p.grassL); px(ctx, gx - 1, gy + 1, 1, 2, p.grass); }
      if (h(x, y, 150) < 0.25) { const rx = X + 4 + Math.floor(h(x, y, 151) * 22), ry = Y + 6 + Math.floor(h(x, y, 152) * 20); px(ctx, rx, ry, 5, 3, p.rock); px(ctx, rx + 1, ry - 1, 3, 1, p.rockL); }
    } else if (b === 'B') {
      if (h(x, y, 160) < 0.6) { const pxx = X + 6 + Math.floor(h(x, y, 161) * 16), pyy = Y + 8 + Math.floor(h(x, y, 162) * 14); const w = 8 + Math.floor(h(x, y, 163) * 8); px(ctx, pxx - w / 2, pyy - 2, w, 5, p.pool); px(ctx, pxx - w / 2 + 2, pyy - 3, w - 4, 1, p.poolL); px(ctx, pxx - w / 2 - 1, pyy, w + 2, 2, p.pool); }
      for (let i = 0; i < 3; i++) { const rx = X + 2 + Math.floor(h(x, y, 170 + i) * (PX - 4)), ry = Y + 4 + Math.floor(h(x, y, 180 + i) * (PX - 8)); px(ctx, rx, ry, 1, 5, p.reed); px(ctx, rx + 1, ry - 1, 1, 2, p.reed); }
      if (h(x, y, 190) < 0.15) { const sx = X + 5 + Math.floor(h(x, y, 191) * 20), sy = Y + 8 + Math.floor(h(x, y, 192) * 18); px(ctx, sx, sy, 1, 3, '#d8d0b8'); px(ctx, sx - 2, sy - 1, 5, 2, p.shroom); }
    } else if (b === 'R') {
      for (let i = 0; i < 4; i++) { const rx = X + 2 + Math.floor(h(x, y, 200 + i) * (PX - 6)), ry = Y + 3 + Math.floor(h(x, y, 210 + i) * (PX - 6)); px(ctx, rx, ry, 3 + Math.floor(h(x, y, 220 + i) * 3), 2, p.rock); px(ctx, rx + 1, ry - 1, 2, 1, p.faceL); }
    } else if (b === 'G') {
      for (let i = 0; i < 4; i++) { const gx = X + 2 + Math.floor(h(x, y, 230 + i) * (PX - 4)), gy = Y + 3 + Math.floor(h(x, y, 240 + i) * (PX - 6)); px(ctx, gx, gy, 1, 2, p.ground[3]); px(ctx, gx + 1, gy + 1, 1, 1, p.ground[2]); }
    }
  }

  // 3. roads: each city to its nearest two cities
  const roads = [];
  for (const a of world.cities) {
    const near = world.cities.filter(b => b !== a).sort((p1, p2) => dist(a, p1) - dist(a, p2)).slice(0, 2);
    for (const b of near) if (!roads.some(r => (r[0] === b && r[1] === a))) roads.push([a, b]);
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [a, b] of roads) {
    const pts = []; const n = Math.ceil(dist(a, b) * 3);
    for (let i = 0; i <= n; i++) {
      const t = i / n; const bx = a.x + (b.x - a.x) * t, by = a.y + (b.y - a.y) * t;
      const perp = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
      const wob = (vnoise(t * 6, roads.indexOf([a, b]) + 1, seed + 500 + a.x) - 0.5) * 1.6 * Math.sin(t * Math.PI);
      pts.push([bx * PX + PX / 2 + Math.cos(perp) * wob * PX, by * PX + PX / 2 + Math.sin(perp) * wob * PX]);
    }
    ctx.strokeStyle = '#6f4f2c'; ctx.lineWidth = 6; ctx.beginPath(); pts.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]))); ctx.stroke();
    ctx.strokeStyle = '#a07c48'; ctx.lineWidth = 3; ctx.beginPath(); pts.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]))); ctx.stroke();
    ctx.strokeStyle = '#c29a5c'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); pts.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]))); ctx.stroke(); ctx.setLineDash([]);
  }

  // 4. tall features, back to front
  const reserved = new Set([...world.cities.map(c => `${c.x},${c.y}`), `${world.castle.x},${world.castle.y}`, ...world.links.map(l => `${l.x},${l.y}`)]);
  const feats = [];
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    const b = at(x, y), X = x * PX, Y = y * PX;
    const busy = reserved.has(`${x},${y}`);
    const spot = (i, minY = 10) => [X + 4 + Math.floor(h(x, y, 400 + i) * (PX - 8)), Y + minY + Math.floor(h(x, y, 420 + i) * (PX - minY))];
    if (b === 'G') {
      const n = busy ? 0 : 2 + Math.floor(h(x, y, 440) * 3);
      for (let i = 0; i < n; i++) { const [fx, fy] = spot(i); const pine = h(x, y, 460 + i) < 0.65; feats.push({ y: fy, draw: () => pine ? drawPine(ctx, fx, fy, 14 + Math.floor(h(x, y, 480 + i) * 10)) : drawLeafTree(ctx, fx, fy, 6 + Math.floor(h(x, y, 480 + i) * 4), PAL.G) }); }
    } else if (b === 'W' && !busy) {
      if (h(x, y, 500) < 0.22) { const [fx, fy] = spot(0); feats.push({ y: fy, draw: () => drawLeafTree(ctx, fx, fy, 5 + Math.floor(h(x, y, 501) * 3), PAL.W) }); }
      if (h(x, y, 502) < 0.12) { const [fx, fy] = spot(1); feats.push({ y: fy, draw: () => drawDeadTree(ctx, fx, fy, 10, PAL.W.wood) }); }
    } else if (b === 'B' && !busy) {
      if (h(x, y, 520) < 0.55) { const [fx, fy] = spot(0); feats.push({ y: fy, draw: () => drawDeadTree(ctx, fx, fy, 12 + Math.floor(h(x, y, 521) * 8), PAL.B.wood) }); }
    } else if (b === 'R' && !busy) {
      const n = h(x, y, 540) < 0.3 ? 0 : 1 + (h(x, y, 541) < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) { const [fx, fy] = spot(i, 14); feats.push({ y: fy, draw: () => drawPeak(ctx, fx, fy, 12 + Math.floor(h(x, y, 560 + i) * 12)) }); }
    } else if (b === 'U' && !busy) {
      const sand = beachMap[y * world.w + x] || h(x, y, 300) < 0.08;
      if (sand && h(x, y, 580) < 0.55) { const [fx, fy] = spot(0, 12); feats.push({ y: fy, draw: () => drawPalm(ctx, fx, fy, 10 + Math.floor(h(x, y, 581) * 6)) }); }
      else if (!sand && h(x, y, 590) < 0.05) { const [fx, fy] = spot(0, 12); feats.push({ y: fy, draw: () => { px(ctx, fx - 3, fy - 2, 7, 3, '#5a5045'); px(ctx, fx - 2, fy - 3, 5, 1, '#7a6f60'); } }); }
    }
  }
  feats.sort((a, b) => a.y - b.y);
  for (const f of feats) f.draw();
  return c;
}

// ---- sprites (drawn at PX scale) --------------------------------------------------
function shade(ctx, x, y, w) { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(Math.round(x - w / 2), Math.round(y), Math.round(w), 2); }
function drawPine(ctx, x, y, hgt) {
  shade(ctx, x, y, 8);
  px(ctx, x - 1, y - 4, 2, 4, PAL.G.trunk);
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const ty = y - 3 - i * (hgt / tiers) * 0.9, w = (tiers - i) * 3 + 2, hh = hgt / tiers + 2;
    ctx.fillStyle = PAL.G.pineD; ctx.beginPath(); ctx.moveTo(x - w, ty); ctx.lineTo(x, ty - hh); ctx.lineTo(x + w, ty); ctx.closePath(); ctx.fill();
    ctx.fillStyle = PAL.G.pine; ctx.beginPath(); ctx.moveTo(x - w + 1, ty); ctx.lineTo(x, ty - hh + 1); ctx.lineTo(x + w - 2, ty); ctx.closePath(); ctx.fill();
    ctx.fillStyle = PAL.G.pineL; ctx.beginPath(); ctx.moveTo(x - w + 2, ty - 1); ctx.lineTo(x - 1, ty - hh + 2); ctx.lineTo(x, ty - 1); ctx.closePath(); ctx.fill();
  }
}
function drawLeafTree(ctx, x, y, r, p) {
  shade(ctx, x, y, r * 2);
  px(ctx, x - 1, y - r, 2, r, p.trunk || p.wood);
  const dark = p.leaf, light = p.leafL;
  px(ctx, x - r, y - r - r * 0.6, r * 2, r * 1.2, dark);
  px(ctx, x - r + 1, y - r - r * 0.6 - 2, r * 2 - 2, 2, dark);
  px(ctx, x - r + 2, y - r - r * 0.6 - 3, r * 2 - 4, 1, dark);
  px(ctx, x - r + 1, y - r - r * 0.5, r, r * 0.6, light);
  px(ctx, x - r + 2, y - r - r * 0.6 - 1, r - 2, 2, light);
  px(ctx, x - r + 3, y - r - r * 0.6 - 2, r - 4, 1, light);
}
function drawDeadTree(ctx, x, y, hgt, wood) {
  shade(ctx, x, y, 6);
  ctx.strokeStyle = wood; ctx.lineWidth = 2; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1, y - hgt * 0.55); ctx.lineTo(x - 1, y - hgt); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 1, y - hgt * 0.5); ctx.lineTo(x + 5, y - hgt * 0.75); ctx.lineTo(x + 7, y - hgt * 0.7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - hgt * 0.7); ctx.lineTo(x - 5, y - hgt * 0.95); ctx.lineTo(x - 6, y - hgt * 1.1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 1, y - hgt); ctx.lineTo(x + 2, y - hgt - 4); ctx.stroke();
}
function drawPeak(ctx, x, y, hgt) {
  const w = hgt * 1.3;
  shade(ctx, x, y, w);
  ctx.fillStyle = PAL.R.faceM; ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x - w * 0.1, y - hgt * 0.55); ctx.lineTo(x + 1, y - hgt); ctx.lineTo(x + w / 2, y); ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.R.faceL; ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x - w * 0.1, y - hgt * 0.55); ctx.lineTo(x + 1, y - hgt); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.R.faceD; ctx.beginPath(); ctx.moveTo(x + 1, y - hgt); ctx.lineTo(x + w * 0.2, y - hgt * 0.5); ctx.lineTo(x + w / 2, y); ctx.lineTo(x + 3, y); ctx.closePath(); ctx.fill();
  if (hgt > 16) { ctx.fillStyle = PAL.R.snow; ctx.beginPath(); ctx.moveTo(x + 1, y - hgt); ctx.lineTo(x + w * 0.12, y - hgt * 0.7); ctx.lineTo(x + 1, y - hgt * 0.74); ctx.lineTo(x - w * 0.06, y - hgt * 0.68); ctx.closePath(); ctx.fill(); }
}
function drawPalm(ctx, x, y, hgt) {
  shade(ctx, x, y, 6);
  ctx.strokeStyle = PAL.U.trunk; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 3, y - hgt * 0.6, x + 2, y - hgt); ctx.stroke();
  const tx = x + 2, ty = y - hgt;
  ctx.strokeStyle = PAL.U.palm; ctx.lineWidth = 2;
  for (const [dx, dy] of [[-9, 2], [-7, -4], [0, -7], [7, -4], [9, 2], [4, 4], [-4, 4]]) { ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + dx * 0.6, ty + dy * 0.6 - 3, tx + dx, ty + dy); ctx.stroke(); }
  ctx.strokeStyle = PAL.U.palmL; ctx.lineWidth = 1;
  for (const [dx, dy] of [[-8, 1], [0, -6], [8, 1]]) { ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + dx * 0.6, ty + dy * 0.6 - 3, tx + dx, ty + dy); ctx.stroke(); }
}

function drawCity(ctx, cx, cy, color, name) {
  shade(ctx, cx, cy + 10, 28);
  switch (color) {
    case 'W': { // white marble castle with gold spires
      const wall = '#e9e6dd', wallD = '#b9b5aa', gold = '#d9a62b', goldL = '#f2cf5c';
      px(ctx, cx - 13, cy - 2, 26, 12, wall); px(ctx, cx - 13, cy + 8, 26, 2, wallD);
      for (let i = 0; i < 7; i++) px(ctx, cx - 13 + i * 4, cy - 4, 2, 2, wall);
      px(ctx, cx - 11, cy - 14, 6, 14, wall); px(ctx, cx - 11, cy - 14, 1, 14, wallD);
      px(ctx, cx + 5, cy - 14, 6, 14, wall); px(ctx, cx + 5, cy - 14, 1, 14, wallD);
      px(ctx, cx - 3, cy - 20, 6, 20, wall); px(ctx, cx - 3, cy - 20, 1, 20, wallD);
      for (const [tx, ty, w] of [[cx - 8, cy - 14, 6], [cx + 8, cy - 14, 6], [cx, cy - 20, 6]]) { ctx.fillStyle = gold; ctx.beginPath(); ctx.moveTo(tx - w / 2 - 1, ty); ctx.lineTo(tx, ty - 9); ctx.lineTo(tx + w / 2 + 1, ty); ctx.closePath(); ctx.fill(); px(ctx, tx - 1, ty - 7, 1, 5, goldL); }
      px(ctx, cx - 2, cy + 4, 4, 6, '#3a3630'); px(ctx, cx - 9, cy - 8, 2, 3, '#4a5a80'); px(ctx, cx + 7, cy - 8, 2, 3, '#4a5a80'); px(ctx, cx - 1, cy - 12, 2, 3, '#4a5a80');
      break;
    }
    case 'U': { // teal-domed keep
      const wall = '#d8cfb0', wallD = '#a89f84', dome = '#3d7f9c', domeL = '#6fb4cf', domeD = '#2a5b70';
      px(ctx, cx - 14, cy - 1, 28, 11, wall); px(ctx, cx - 14, cy + 8, 28, 2, wallD);
      for (let i = 0; i < 8; i++) px(ctx, cx - 14 + i * 4, cy - 3, 2, 2, wall);
      px(ctx, cx - 6, cy - 12, 12, 12, wall); px(ctx, cx - 6, cy - 12, 1, 12, wallD);
      ctx.fillStyle = dome; ctx.beginPath(); ctx.arc(cx, cy - 12, 7, Math.PI, 0); ctx.fill();
      ctx.fillStyle = domeL; ctx.beginPath(); ctx.arc(cx - 2, cy - 13, 3, Math.PI, 0); ctx.fill();
      px(ctx, cx - 1, cy - 22, 2, 3, domeD); px(ctx, cx - 1, cy - 24, 2, 2, '#f2cf5c');
      px(ctx, cx - 12, cy - 8, 4, 7, wall); ctx.fillStyle = domeD; ctx.beginPath(); ctx.arc(cx - 10, cy - 8, 2.5, Math.PI, 0); ctx.fill();
      px(ctx, cx + 8, cy - 8, 4, 7, wall); ctx.fillStyle = domeD; ctx.beginPath(); ctx.arc(cx + 10, cy - 8, 2.5, Math.PI, 0); ctx.fill();
      px(ctx, cx - 2, cy + 4, 4, 6, '#3a3630');
      break;
    }
    case 'B': { // dark stone keep with purple banners
      const wall = '#4a4452', wallD = '#2e2a34', wallL = '#6a6374', purple = '#6d2f8a';
      px(ctx, cx - 13, cy - 2, 26, 12, wall); px(ctx, cx - 13, cy + 8, 26, 2, wallD); px(ctx, cx - 13, cy - 2, 26, 1, wallL);
      for (let i = 0; i < 7; i++) px(ctx, cx - 13 + i * 4, cy - 4, 2, 2, wall);
      px(ctx, cx - 11, cy - 16, 6, 16, wall); px(ctx, cx - 11, cy - 16, 1, 16, wallL); px(ctx, cx - 11, cy - 18, 6, 2, wallD);
      px(ctx, cx + 5, cy - 16, 6, 16, wall); px(ctx, cx + 5, cy - 16, 1, 16, wallL); px(ctx, cx + 5, cy - 18, 6, 2, wallD);
      px(ctx, cx - 3, cy - 12, 6, 12, wall); px(ctx, cx - 3, cy - 14, 6, 2, wallD);
      px(ctx, cx - 9, cy - 12, 2, 6, purple); px(ctx, cx + 7, cy - 12, 2, 6, purple);
      px(ctx, cx - 2, cy + 4, 4, 6, '#15120f'); px(ctx, cx - 1, cy - 9, 2, 2, '#e0a040');
      break;
    }
    case 'R': { // red-roofed village behind a wall
      const wall = '#c9b493', wallD = '#9c8a6b', roof = '#b8332a', roofL = '#d9584a', house = '#e6dcc2';
      for (const [dx, dy, w] of [[-9, -6, 9], [2, -9, 10], [8, -3, 8]]) {
        px(ctx, cx + dx - w / 2, cy + dy, w, 7, house); px(ctx, cx + dx - w / 2, cy + dy + 5, w, 2, wallD);
        ctx.fillStyle = roof; ctx.beginPath(); ctx.moveTo(cx + dx - w / 2 - 1, cy + dy); ctx.lineTo(cx + dx, cy + dy - 6); ctx.lineTo(cx + dx + w / 2 + 1, cy + dy); ctx.closePath(); ctx.fill();
        ctx.fillStyle = roofL; ctx.beginPath(); ctx.moveTo(cx + dx - w / 2 + 1, cy + dy - 1); ctx.lineTo(cx + dx - 1, cy + dy - 5); ctx.lineTo(cx + dx, cy + dy - 1); ctx.closePath(); ctx.fill();
        px(ctx, cx + dx - 1, cy + dy + 2, 2, 2, '#4a3a2a');
      }
      px(ctx, cx - 14, cy + 2, 28, 7, wall); px(ctx, cx - 14, cy + 7, 28, 2, wallD);
      for (let i = 0; i < 8; i++) px(ctx, cx - 14 + i * 4, cy, 2, 2, wall);
      px(ctx, cx - 2, cy + 4, 4, 5, '#3a3630');
      break;
    }
    case 'G': { // thatched huts inside a palisade
      const thatch = '#c8a45a', thatchD = '#9a7b3c', wood = '#7a5a34', woodD = '#5a4025';
      for (let i = 0; i < 14; i++) px(ctx, cx - 14 + i * 2, cy + 4, 1, 6, i % 2 ? wood : woodD);
      for (const [dx, dy, w] of [[-8, -4, 10], [4, -8, 12], [8, 0, 8]]) {
        px(ctx, cx + dx - w / 2, cy + dy, w, 6, wood); px(ctx, cx + dx - w / 2, cy + dy + 4, w, 2, woodD);
        ctx.fillStyle = thatch; ctx.beginPath(); ctx.moveTo(cx + dx - w / 2 - 2, cy + dy + 1); ctx.lineTo(cx + dx, cy + dy - 7); ctx.lineTo(cx + dx + w / 2 + 2, cy + dy + 1); ctx.closePath(); ctx.fill();
        ctx.fillStyle = thatchD; ctx.beginPath(); ctx.moveTo(cx + dx, cy + dy - 7); ctx.lineTo(cx + dx + w / 2 + 2, cy + dy + 1); ctx.lineTo(cx + dx + 1, cy + dy + 1); ctx.closePath(); ctx.fill();
        px(ctx, cx + dx - 1, cy + dy + 2, 2, 3, '#2a2015');
      }
      break;
    }
  }
  labels.push({ x: cx, y: cy + 17, text: name });
}
function drawFortress(ctx, cx, cy) {
  const glow = ctx.createRadialGradient(cx, cy, 3, cx, cy, 22);
  glow.addColorStop(0, 'rgba(160,30,50,.4)'); glow.addColorStop(1, 'rgba(160,30,50,0)');
  ctx.fillStyle = glow; ctx.fillRect(cx - 22, cy - 22, 44, 44);
  shade(ctx, cx, cy + 10, 30);
  const s = '#26222c', sl = '#3d3846', sd = '#15121a';
  px(ctx, cx - 15, cy - 4, 30, 14, s); px(ctx, cx - 15, cy + 8, 30, 2, sd); px(ctx, cx - 15, cy - 4, 30, 1, sl);
  px(ctx, cx - 14, cy - 18, 7, 16, s); px(ctx, cx - 14, cy - 18, 1, 16, sl); px(ctx, cx - 15, cy - 21, 9, 3, sd);
  px(ctx, cx + 7, cy - 18, 7, 16, s); px(ctx, cx + 7, cy - 18, 1, 16, sl); px(ctx, cx + 6, cy - 21, 9, 3, sd);
  px(ctx, cx - 4, cy - 26, 8, 24, s); px(ctx, cx - 4, cy - 26, 1, 24, sl);
  for (let i = 0; i < 3; i++) px(ctx, cx - 4 + i * 3, cy - 29, 2, 3, sd);
  px(ctx, cx - 1, cy - 20, 2, 3, '#ff8a3a'); px(ctx, cx - 11, cy - 10, 2, 3, '#ff8a3a'); px(ctx, cx + 10, cy - 10, 2, 3, '#ff8a3a');
  px(ctx, cx, cy - 36, 1, 8, sd); ctx.fillStyle = '#c8323a'; ctx.beginPath(); ctx.moveTo(cx + 1, cy - 36); ctx.lineTo(cx + 8, cy - 33); ctx.lineTo(cx + 1, cy - 30); ctx.closePath(); ctx.fill();
  px(ctx, cx - 2, cy + 4, 4, 6, sd);
}
function drawDungeon(ctx, cx, cy, cleared) {
  shade(ctx, cx, cy + 9, 26);
  const rock = '#6f6558', rockL = '#8c8172', rockD = '#4b433a';
  ctx.fillStyle = rock; ctx.beginPath(); ctx.moveTo(cx - 14, cy + 8); ctx.lineTo(cx - 10, cy - 6); ctx.lineTo(cx - 3, cy - 12); ctx.lineTo(cx + 5, cy - 11); ctx.lineTo(cx + 12, cy - 4); ctx.lineTo(cx + 14, cy + 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = rockL; ctx.beginPath(); ctx.moveTo(cx - 10, cy - 6); ctx.lineTo(cx - 3, cy - 12); ctx.lineTo(cx + 5, cy - 11); ctx.lineTo(cx + 2, cy - 7); ctx.lineTo(cx - 6, cy - 4); ctx.closePath(); ctx.fill();
  px(ctx, cx - 14, cy + 6, 28, 2, rockD);
  ctx.fillStyle = cleared ? '#2c2a30' : '#0b0a0d'; ctx.beginPath(); ctx.moveTo(cx - 5, cy + 8); ctx.lineTo(cx - 5, cy - 1); ctx.arc(cx, cy - 1, 5, Math.PI, 0); ctx.lineTo(cx + 5, cy + 8); ctx.closePath(); ctx.fill();
  if (!cleared) { px(ctx, cx - 1, cy + 1, 2, 2, '#ffb347'); px(ctx, cx + 7, cy - 2, 1, 6, '#5a4025'); px(ctx, cx + 8, cy - 3, 2, 3, '#ff8a3a'); }
  else { px(ctx, cx + 8, cy - 14, 1, 12, '#5a4025'); px(ctx, cx + 9, cy - 14, 5, 3, '#e8dcc2'); }
}
function drawCrystal(ctx, cx, cy, taken) {
  if (!taken) { const g = ctx.createRadialGradient(cx, cy - 2, 1, cx, cy - 2, 14); g.addColorStop(0, 'rgba(255,245,180,.7)'); g.addColorStop(1, 'rgba(255,245,180,0)'); ctx.fillStyle = g; ctx.fillRect(cx - 14, cy - 16, 28, 28); }
  shade(ctx, cx, cy + 4, 12);
  const a = taken ? '#8d8a80' : '#f6efc2', b = taken ? '#6b6860' : '#d4bd5c', c = taken ? '#55524a' : '#a88c3a';
  for (const [dx, hgt, w] of [[-5, 8, 3], [0, 13, 4], [5, 10, 3]]) {
    ctx.fillStyle = b; ctx.beginPath(); ctx.moveTo(cx + dx - w, cy + 3); ctx.lineTo(cx + dx, cy + 3 - hgt); ctx.lineTo(cx + dx + w, cy + 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = a; ctx.beginPath(); ctx.moveTo(cx + dx - w, cy + 3); ctx.lineTo(cx + dx, cy + 3 - hgt); ctx.lineTo(cx + dx, cy + 3); ctx.closePath(); ctx.fill();
    px(ctx, cx + dx - w, cy + 3, w * 2, 1, c);
  }
}
function drawFigure(ctx, cx, cy, robe, robeL, hat, opts = {}) {
  shade(ctx, cx, cy + 3, 8);
  if (opts.ring) { ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(cx, cy + 3, 6, 2.5, 0, 0, Math.PI * 2); ctx.stroke(); }
  px(ctx, cx - 3, cy - 6, 6, 9, robe); px(ctx, cx - 3, cy - 6, 2, 9, robeL);
  px(ctx, cx - 2, cy - 9, 4, 3, '#e9c39c'); // head
  if (opts.legs) { px(ctx, cx - 3, cy - 1, 6, 4, opts.legs); px(ctx, cx - 3, cy + 1, 2, 2, opts.legs); }
  if (hat) { px(ctx, cx - 4, cy - 10, 8, 1, hat); ctx.fillStyle = hat; ctx.beginPath(); ctx.moveTo(cx - 3, cy - 10); ctx.lineTo(cx + 1, cy - 16); ctx.lineTo(cx + 3, cy - 10); ctx.closePath(); ctx.fill(); }
  else px(ctx, cx - 2, cy - 11, 4, 2, '#4a2e1a'); // hair
  if (opts.staff) { px(ctx, cx + 4, cy - 12, 1, 15, '#6b4a2a'); px(ctx, cx + 3, cy - 14, 3, 2, '#9fe7ff'); }
  if (opts.tier) { px(ctx, cx + 3, cy, 7, 7, '#15120f'); labels.push({ x: cx + 6.5, y: cy + 3.5, text: String(opts.tier), size: 5.5, box: false, color: '#fff' }); }
}

// ---- presenting a low-res frame crisply ------------------------------------------------
// Chooses the largest scale that fits the container (2, 1.5 or 1 CSS px per frame px), sizes the
// canvas in real device pixels so nothing is resampled by CSS, and paints labels at full resolution.
export function present(canvas, frame, fw, fh, labels = [], opts = {}) {
  const avail = (canvas.parentElement?.clientWidth || fw * 2) - 8;
  const k = opts.scale || (avail >= fw * 2 ? 2 : avail >= fw * 1.5 ? 1.5 : 1);
  const dpr = window.devicePixelRatio || 1;
  const s = k * dpr;
  canvas.width = Math.round(fw * s); canvas.height = Math.round(fh * s);
  canvas.style.width = Math.round(fw * k) + 'px'; canvas.style.height = Math.round(fh * k) + 'px';
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
  for (const l of labels) {
    const size = Math.round((l.size || 9) * s);
    ctx.font = `${l.weight || 'bold'} ${size}px ${l.font || '"Segoe UI", system-ui, sans-serif'}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const x = l.x * s, y = l.y * s;
    if (l.box !== false) { const tw = ctx.measureText(l.text).width + size * 0.9; ctx.fillStyle = l.bg || 'rgba(20,18,16,.8)'; ctx.fillRect(Math.round(x - tw / 2), Math.round(y - size * 0.7), Math.round(tw), Math.round(size * 1.4)); }
    ctx.fillStyle = l.color || '#f3ecd8'; ctx.fillText(l.text, x, y);
  }
  return { k, s };
}
let frame = null, labels = [];
export function drawWorld(canvas, world, player, opts = {}) {
  let terrain = terrainCache.get(world);
  if (!terrain) { terrain = paintTerrain(world); terrainCache.set(world, terrain); }
  labels = [];
  const cam = cameraFor(world, player);
  const fw = VIEW.w * PX, fh = VIEW.h * PX;
  if (!frame) { frame = document.createElement('canvas'); }
  frame.width = fw; frame.height = fh;
  const f = frame.getContext('2d'); f.imageSmoothingEnabled = false;
  f.drawImage(terrain, cam.x * PX, cam.y * PX, fw, fh, 0, 0, fw, fh);
  const vis = (x, y) => x >= cam.x - 1 && y >= cam.y - 1 && x <= cam.x + VIEW.w && y <= cam.y + VIEW.h;
  const c = (x, y) => [(x - cam.x) * PX + PX / 2, (y - cam.y) * PX + PX / 2];
  if (opts.highlight) { f.strokeStyle = 'rgba(255,255,255,.5)'; f.lineWidth = 1; f.setLineDash([2, 2]); for (const [x, y] of opts.highlight) if (vis(x, y)) f.strokeRect((x - cam.x) * PX + 2.5, (y - cam.y) * PX + 2.5, PX - 5, PX - 5); f.setLineDash([]); }
  const objs = [];
  for (const l of world.links) if (vis(l.x, l.y)) { const [cx, cy] = c(l.x, l.y); objs.push({ y: cy, draw: () => drawCrystal(f, cx, cy, l.taken) }); }
  for (const d of world.dungeons || []) if (d.revealed && vis(d.x, d.y)) { const [cx, cy] = c(d.x, d.y); objs.push({ y: cy, draw: () => drawDungeon(f, cx, cy, d.cleared) }); }
  for (const ct of world.cities) if (vis(ct.x, ct.y)) { const [cx, cy] = c(ct.x, ct.y); objs.push({ y: cy, draw: () => drawCity(f, cx, cy, ct.color, ct.name) }); }
  if (vis(world.castle.x, world.castle.y)) { const [cx, cy] = c(world.castle.x, world.castle.y); objs.push({ y: cy, draw: () => drawFortress(f, cx, cy) }); }
  const robes = { W: ['#d9d2b8', '#f0ead6'], U: ['#2f5f9c', '#5e8cc9'], B: ['#3a2d4a', '#5e4d75'], R: ['#a33a2a', '#d0604a'], G: ['#3f6f2f', '#6a9a4a'] };
  for (const e of world.enemies) if (vis(e.x, e.y)) { const [cx, cy] = c(e.x, e.y); const [r, rl] = robes[e.color]; objs.push({ y: cy, draw: () => drawFigure(f, cx, cy, r, rl, r, { tier: e.tier }) }); }
  { const [cx, cy] = c(player.x, player.y); objs.push({ y: cy + 0.1, draw: () => drawFigure(f, cx, cy, '#c8322a', '#e0604a', null, { legs: '#2f4f9c', staff: true, ring: true }) }); }
  objs.sort((a, b) => a.y - b.y);
  for (const o of objs) o.draw();
  // vignette frame like the original's border
  const g = f.createRadialGradient(fw / 2, fh / 2, fh * 0.45, fw / 2, fh / 2, fw * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)'); f.fillStyle = g; f.fillRect(0, 0, fw, fh);

  present(canvas, frame, fw, fh, labels);
  return cam;
}
