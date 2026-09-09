// Overworld generation and pixel-painted rendering in the spirit of the 1997 original:
// oblique 3/4 view, dithered ground, winding dirt roads, palms on beaches, pines in forests,
// gnarled trees in swamps, stone castles and domed keeps. Rendered at half resolution and
// scaled 2x with smoothing off for chunky pixels. A camera follows the player.
import { COLORS } from './cards.js';
import { atlasReady, atlasState, blit, blitAt, pick, sheetPixels, TERRAIN, ACCENT_RATE, SPRITES, SCENERY, MONSTERS } from './atlas.js';

export const W = 56, H = 38;
export const PX = 38;          // internal pixels per tile (one sprite-sheet tile)
export const TILE = PX * 2;    // displayed pixels per tile
export const VIEW = { w: 28, h: 18 };

export const PAL = {
  W: { name: 'Plains', ground: ['#b9a56a', '#c9b678', '#a99459', '#d3c084'], grass: '#7e9a3c', grassL: '#a6c455', rock: '#8f8779', rockL: '#b5ad9e', wood: '#5a4530', leaf: '#6b8f3a', leafL: '#8fb452' },
  U: { name: 'Coast', ground: ['#1f8ea6', '#2199b3', '#1a7f96', '#24a3bd'], deep: '#156f86', ripple: '#5fc7d6', rippleD: '#136a80', sand: ['#dcc78a', '#cdb676', '#e6d39a'], palm: '#2f7a3a', palmL: '#5aa54a', trunk: '#8a6a3a' },
  B: { name: 'Wastes', ground: ['#6a6256', '#5b544a', '#77705f', '#4f4940'], pool: '#2c3c3b', poolL: '#3f5652', wood: '#2a2320', reed: '#6f7e3f', shroom: '#a86a8a' },
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
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) * (0.30 + rng() * 0.09);
  const stretch = 1.15 + rng() * 0.25, nStr = 8 + rng() * 7;   // per-game biome spread and border wobble
  const rot = rng() * Math.PI * 2;
  const seeds = COLORS.map((c, i) => { const a = rot + i * Math.PI * 2 / 5 + (rng() - 0.5) * 0.5; return { c, x: Math.round(cx + Math.cos(a) * r * stretch), y: Math.round(cy + Math.sin(a) * r) }; });
  const noise = COLORS.map(() => field(rng, W, H));
  const tiles = new Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let best = 0, bd = Infinity;
    seeds.forEach((s, i) => { const d = dist({ x, y }, s) + (noise[i][y][x] - 0.5) * nStr; if (d < bd) { bd = d; best = i; } });
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
  const enemyCount = Math.round(W * H / 38);
  const tierCut = Math.min(W, H) * 0.42;
  for (let i = 0; i < enemyCount; i++) {
    const t = randomTile((x, y) => dist({ x, y }, start) >= 3); if (!t) continue;
    const color = at(t.x, t.y); const tier = dist(t, start) < tierCut ? 1 : 2;
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

// Landmarks: a dozen scenery features that hold a riddle. Each sits alone on its tile; the kind fits the biome.
const LANDMARK_KINDS = { G: ['well', 'standingStone', 'signpost', 'tower'], W: ['pond', 'well', 'standingStone'], R: ['volcano', 'cave', 'lavaVent'], B: ['skull', 'cave', 'bones', 'standingStone'], U: ['wreck', 'seaRock'] };
export const landmarkAt = (world, x, y) => (world.landmarks || []).find(l => l.x === x && l.y === y);
export function placeLandmarks(world, rng, count = Math.max(12, Math.round(world.w * world.h / 55))) {
  if (world.landmarks) return world.landmarks;
  const taken = new Set([...world.cities.map(c => `${c.x},${c.y}`), ...world.links.map(l => `${l.x},${l.y}`), `${world.castle.x},${world.castle.y}`, ...world.enemies.map(e => `${e.x},${e.y}`), ...(world.dungeons || []).map(d => `${d.x},${d.y}`)]);
  const out = [];
  const isCoast = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inBounds(world, x + dx, y + dy) && tileAt(world, x + dx, y + dy) !== 'U');
  for (let i = 0; i < 600 && out.length < count; i++) {
    const x = Math.floor(rng() * world.w), y = Math.floor(rng() * world.h);
    if (taken.has(`${x},${y}`) || dist({ x, y }, world.start) < 3) continue;
    if (world.cities.some(c => dist(c, { x, y }) < 2.5) || out.some(l => dist(l, { x, y }) < 3.5)) continue;
    const b = tileAt(world, x, y);
    if (b === 'U' && !isCoast(x, y)) continue;
    const kinds = LANDMARK_KINDS[b]; const kind = kinds[Math.floor(rng() * kinds.length)];
    out.push({ x, y, kind, color: b, used: false }); taken.add(`${x},${y}`);
  }
  world.landmarks = out;
  return out;
}
// Special amulet lairs: a Gem Cutter Guild, the Lost City of El'Arkan, and a couple of Diamond Mines.
export const specialAt = (world, x, y) => (world.specials || []).find(l => l.x === x && l.y === y);
export function placeSpecials(world, rng) {
  if (world.specials) return world.specials;
  const taken = new Set([...world.cities.map(c => `${c.x},${c.y}`), ...world.links.map(l => `${l.x},${l.y}`), `${world.castle.x},${world.castle.y}`, ...world.enemies.map(e => `${e.x},${e.y}`), ...(world.dungeons || []).map(d => `${d.x},${d.y}`), ...(world.landmarks || []).map(l => `${l.x},${l.y}`)]);
  const out = [];
  const want = [{ kind: 'gemcutter' }, { kind: 'lostcity' }, { kind: 'diamondmine' }, { kind: 'diamondmine' }, { kind: 'diamondmine' }];
  for (const spec of want) {
    for (let i = 0; i < 800; i++) {
      const x = Math.floor(rng() * world.w), y = Math.floor(rng() * world.h);
      if (taken.has(`${x},${y}`) || tileAt(world, x, y) === 'U') continue;
      if (dist({ x, y }, world.start) < 4) continue;
      if (world.cities.some(c => dist(c, { x, y }) < 2.5) || out.some(l => dist(l, { x, y }) < 4)) continue;
      out.push({ x, y, kind: spec.kind, color: tileAt(world, x, y), used: false }); taken.add(`${x},${y}`);
      break;
    }
  }
  world.specials = out;
  return out;
}
function drawSpecial(ctx, cx, cy, sp) {
  const col = { gemcutter: '#7fe0ff', lostcity: '#ffd76a', diamondmine: '#e6b3ff' }[sp.kind] || '#ffffff';
  ctx.save();
  ctx.translate(cx, cy);
  if (sp.used && sp.kind !== 'gemcutter') ctx.globalAlpha = 0.5;
  // a faceted gem
  ctx.fillStyle = col; ctx.strokeStyle = 'rgba(20,20,30,.8)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, -2); ctx.lineTo(0, 10); ctx.lineTo(-7, -2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(3, -2); ctx.lineTo(0, 2); ctx.lineTo(-3, -2); ctx.closePath(); ctx.fill();
  ctx.restore();
  const tag = { gemcutter: 'Gem', lostcity: 'El\u2019Arkan', diamondmine: 'Mine' }[sp.kind] || '';
  labels.push({ x: cx, y: cy - 15, text: tag, size: 7, color: '#fff', bg: 'rgba(30,20,40,.85)' });
}
function drawLandmark(ctx, cx, cy, lm) {
  const rect = SPRITES[lm.kind];
  if (atlasReady() && rect) { if (lm.used) ctx.globalAlpha = 0.6; blitAt(ctx, rect, cx, cy + PX / 2 - 1, tileFit(rect, { volcano: 1.15, skull: 0.5, bones: 0.5, seaRock: 0.6, lavaVent: 0.6, pond: 0.6 }[lm.kind] || 0.95)); ctx.globalAlpha = 1; }
  else { px(ctx, cx - 6, cy - 4, 12, 12, lm.used ? '#5a5a5a' : '#c9a367'); }
  if (!lm.used) labels.push({ x: cx + 12, y: cy - 12, text: '?', size: 8, color: '#ffe9a8', bg: 'rgba(40,30,10,.85)' });
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
// Sprite-sheet ground with organic borders: each pixel takes its biome from the nearest tile centre
// (jittered by noise, like the painted fallback) and samples that biome's sheet tiles as a texture,
// so regions meet along wobbly edges instead of a checkerboard. Sand beaches ring the water, roads
// link the cities, and trees, ponds and hamlets are scattered as sprites.
function paintTiles(world) {
  const Wp = world.w * PX, Hp = world.h * PX;
  const c = document.createElement('canvas'); c.width = Wp; c.height = Hp;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const seed = world.seed || 0;
  const h = (x, y, s) => hash(x, y, s + seed);
  const at = (x, y) => inBounds(world, x, y) ? tileAt(world, x, y) : null;
  const sheetOf = rect => sheetPixels(rect);
  // Per-cell tables: whether all neighbours share the cell's biome (then no border noise is needed),
  // and whether a sea cell touches land (then it may get a beach).
  const W_ = world.w, H_ = world.h;
  const uniform = new Uint8Array(W_ * H_), coast = new Uint8Array(W_ * H_);
  for (let ty = 0; ty < H_; ty++) for (let tx = 0; tx < W_; tx++) {
    const b = at(tx, ty); let same = true, land = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const t = at(tx + dx, ty + dy); if (t && t !== b) { same = false; if (b === 'U') land = true; } }
    uniform[ty * W_ + tx] = same ? 1 : 0; coast[ty * W_ + tx] = land ? 1 : 0;
  }
  const owner = (x, y) => {
    const tx = Math.floor(x / PX), ty = Math.floor(y / PX);
    const b = at(tx, ty);
    if (uniform[ty * W_ + tx]) return b;
    // jittered distance to a neighbouring cell centre
    const dist2 = (dx, dy) => {
      const cx = (tx + dx) * PX + PX / 2 + (vnoise(x / 11, y / 11, seed + dx * 3 + dy * 7) - 0.5) * 26;
      const cy = (ty + dy) * PX + PX / 2 + (vnoise(x / 13, y / 13, seed + dx * 5 + dy * 11) - 0.5) * 26;
      return (x - cx) * (x - cx) + (y - cy) * (y - cy);
    };
    // Only a neighbour of another biome can change the answer, so measure those first and the
    // same-biome neighbours only when one of them actually beats the cell's own centre.
    let best = b, bd = dist2(0, 0), foreign = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const t = at(tx + dx, ty + dy); if (!t || t === b) continue;
      const d = dist2(dx, dy); if (d < bd) { bd = d; best = t; foreign = true; }
    }
    if (!foreign) return b;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const t = at(tx + dx, ty + dy); if (t !== b) continue;
      if (dist2(dx, dy) < bd) return b;
    }
    return best;
  };
  const rectTable = {};
  // Ground per cell; accent cells (lava pools, volcano tiles) get an organic noise mask so they do not read as squares.
  const tileFor = (b, tx, ty, x, y) => {
    const tab = rectTable[b] || (rectTable[b] = new Array(W_ * H_)); let r = tab[ty * W_ + tx];
    if (!r) { const t = TERRAIN[b] || TERRAIN.G; const a = h(tx, ty, 5), pk = h(tx, ty, 6); r = { base: pick(t.base, pk), accent: a < (ACCENT_RATE[b] ?? 0.15) && t.accent.length ? pick(t.accent, pk) : null }; tab[ty * W_ + tx] = r; }
    if (r.accent && x !== undefined) {
      // pools: noise inside a soft disc around the cell centre, so no pool follows a cell edge
      const nx = x - (tx * PX + PX / 2), ny = y - (ty * PX + PX / 2);
      const nz = vnoise(x / 9, y / 9, seed + 21);
      if (nz > 0.4 && Math.hypot(nx, ny) < PX * (0.28 + (nz - 0.4) * 0.9)) return r.accent;
    }
    return r.base;
  };
  const image = ctx.createImageData(Wp, Hp); const img = image.data;
  for (let y = 0; y < Hp; y++) for (let x = 0; x < Wp; x++) {
    const b = owner(x, y);
    const tx = Math.floor(x / PX), ty = Math.floor(y / PX);
    let rect;
    if (b === 'U' && coast[ty * W_ + tx]) {
      let dl = 99;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const t = at(tx + dx, ty + dy); if (t && t !== 'U') dl = Math.min(dl, Math.hypot(x - ((tx + dx) * PX + PX / 2), y - ((ty + dy) * PX + PX / 2))); }
      const sandy = dl < PX * 0.9 + (vnoise(x / 7, y / 7, seed + 77) - 0.5) * 16;
      rect = sandy ? pick(TERRAIN.sand, h(tx, ty, 7)) : tileFor(b, tx, ty, x, y);
    } else rect = tileFor(b, tx, ty, x, y);
    // mirror tiles per cell so repeats are less obvious
    const fx = (tx & 1) === 1, fy = (ty & 1) === 1;
    const u = Math.floor((x % PX) * rect[2] / PX), v = Math.floor((y % PX) * rect[3] / PX);
    const sx = rect[0] + (fx ? rect[2] - 1 - u : u), sy = rect[1] + (fy ? rect[3] - 1 - v : v);
    const sheet = sheetOf(rect); if (!sheet) continue;
    const si = (sy * sheet.w + sx) * 4, di = (y * Wp + x) * 4;
    img[di] = sheet.data[si]; img[di + 1] = sheet.data[si + 1]; img[di + 2] = sheet.data[si + 2]; img[di + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  paintRoads(ctx, world, seed);
  // scenery, back to front
  const reserved = new Set([...world.cities.map(ct => `${ct.x},${ct.y}`), `${world.castle.x},${world.castle.y}`, ...world.links.map(l => `${l.x},${l.y}`), ...(world.dungeons || []).map(d => `${d.x},${d.y}`), ...(world.landmarks || []).map(l => `${l.x},${l.y}`)]);
  const feats = [];
  const nearCity = (x, y) => world.cities.some(ct => Math.abs(ct.x - x) <= 3 && Math.abs(ct.y - y) <= 3 && (Math.abs(ct.x - x) + Math.abs(ct.y - y)) >= 2);
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    const b = at(x, y), X = x * PX, Y = y * PX;
    if (reserved.has(`${x},${y}`)) continue;
    // objects sit on their tile: feet near the tile's bottom edge, a little jitter, sized to the tile by `frac`
    const spot = (i) => [X + PX / 2 + Math.round((h(x, y, 400 + i) - 0.5) * 10) + (i === 1 ? 9 : i === 0 ? -3 : 0), Y + PX - 2 + Math.round((h(x, y, 420 + i) - 0.5) * 4)];
    const add = (rect, fx, fy, frac) => feats.push({ y: fy, draw: () => blitAt(ctx, rect, fx, fy, tileFit(rect, frac)) });
    const S = SPRITES, sc = 0.95;
    const any = (...names) => names.map(n => S[n]).filter(Boolean);
    const from = (list, t) => list.length ? pick(list, t) : null;
    if ((b === 'G' || b === 'W') && nearCity(x, y) && h(x, y, 390) < 0.05) { const [fx, fy] = spot(9); const r = h(x, y, 391); const hamlet = from(any('hut', 'huts', 'watchtower', 'well', 'signpost'), r) || S.city.town; add(hamlet, fx, fy, hamlet === S.city.town ? 0.8 : 0.85); continue; }
    if (b === 'G') {
      const d = h(x, y, 440); const n = d < 0.55 ? 0 : d < 0.92 ? 1 : 2;
      const trees = any('pines', 'pines-2', 'oak', 'pine', 'roundTree', 'sapling', 'bush', 'bush-2', 'shrub', 'bushSmall');
      for (let i = 0; i < n; i++) { const [fx, fy] = spot(i); const r = h(x, y, 460 + i); const t = from(trees, r * 0.999); if (t) add(t, fx, fy, t === S.pines || t === S['pines-2'] ? 1 : t === S.bush || t === S['bush-2'] || t === S.shrub ? 0.55 : t === S.bushSmall || t === S.sapling ? 0.45 : sc); }
      if (h(x, y, 470) < 0.01 && S.pond) { const [fx, fy] = spot(3); add(S.pond, fx, fy, 0.6); }
      if (h(x, y, 471) < 0.006 && S.tower) { const [fx, fy] = spot(4); add(S.tower, fx, fy, 1); }
    } else if (b === 'W') {
      const r = h(x, y, 500);
      if (r < 0.07 && SCENERY.dunes.length) { const [fx, fy] = spot(0); add(pick(SCENERY.dunes, h(x, y, 502)), fx, fy, 0.55); }
      else if (r < 0.1) { const [fx, fy] = spot(1); const t = from(any('cactus', 'palm', 'bush', 'tuft'), h(x, y, 501)); if (t) add(t, fx, fy, t === S.bush ? 0.5 : t === S.tuft ? 0.3 : sc); }
      else if (r < 0.11 && S.pond) { const [fx, fy] = spot(2); add(S.pond, fx, fy, 0.6); }
    } else if (b === 'R') {
      const d = h(x, y, 540); const n = d < 0.5 ? 0 : d < 0.92 ? 1 : 2;
      for (let i = 0; i < n; i++) { const [fx, fy] = spot(i); add(pick(SCENERY.peaks, h(x, y, 550 + i)), fx, fy, n === 2 ? 0.75 : 0.85 + h(x, y, 560 + i) * 0.15); }
      const r = h(x, y, 570);
      if (r < 0.03 && S.volcanoSmall) { const [fx, fy] = spot(2); add(S.volcanoSmall, fx, fy, 0.9); }
      else if (r < 0.05 && S.lavaVent) { const [fx, fy] = spot(3); add(S.lavaVent, fx, fy, 0.6); }
    } else if (b === 'B') {
      const r = h(x, y, 600);
      if (r < 0.09 && SCENERY.rocks.length) { const [fx, fy] = spot(0); add(pick(SCENERY.rocks, r * 11), fx, fy, 0.6 + h(x, y, 601) * 0.2); }
      else if (r < 0.13) { const [fx, fy] = spot(1); const t = from(any('deadtree', 'deadtree-2', 'skull', 'bones', 'standingStone'), h(x, y, 602)); if (t) add(t, fx, fy, t === S.skull ? 0.4 : t === S.bones ? 0.45 : t === S.standingStone ? 0.8 : sc); }
      else if (r < 0.135 && S.cave) { const [fx, fy] = spot(2); add(S.cave, fx, fy, 0.9); }
    } else if (b === 'U') {
      const coast = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy) && at(x + dx, y + dy) !== 'U');
      const r = h(x, y, 590);
      if (coast && r < 0.035) { const [fx, fy] = spot(0); const t = from(any('reeds', 'reeds-2', 'lilypads', 'tuft'), h(x, y, 591)); if (t) add(t, fx, fy, 0.5); }
      else if (!coast && r < 0.008) { const [fx, fy] = spot(1); const t = from(any('seaRock', 'wreck', 'serpentCoil'), h(x, y, 592)); if (t) add(t, fx, fy, 0.7); }
    }
  }
  feats.sort((a, b) => a.y - b.y);
  for (const f of feats) f.draw();
  c.atlas = true;
  return c;
}
// Scale so a sprite is `frac` of a tile tall and never wider than a tile.
function tileFit(rect, frac) { return Math.min(PX * frac / rect[3], PX * 0.98 / rect[2]); }
function paintRoads(ctx, world, seed) {
  const roads = [];
  for (const a of world.cities) {
    const near = world.cities.filter(b => b !== a).sort((p1, p2) => dist(a, p1) - dist(a, p2)).slice(0, 2);
    for (const b of near) if (!roads.some(r => (r[0] === b && r[1] === a))) roads.push([a, b]);
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  roads.forEach(([a, b], ri) => {
    const pts = []; const n = Math.ceil(dist(a, b) * 3);
    for (let i = 0; i <= n; i++) {
      const t = i / n; const bx = a.x + (b.x - a.x) * t, by = a.y + (b.y - a.y) * t;
      const perp = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
      const wob = (vnoise(t * 6, ri + 1, seed + 500 + a.x) - 0.5) * 1.6 * Math.sin(t * Math.PI);
      pts.push([bx * PX + PX / 2 + Math.cos(perp) * wob * PX, by * PX + PX / 2 + Math.sin(perp) * wob * PX]);
    }
    const stroke = (col, w, dash) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath(); pts.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]))); ctx.stroke(); ctx.setLineDash([]); };
    stroke('rgba(70,48,28,.75)', 7); stroke('#a5804e', 4); stroke('#c9a367', 1.5, [3, 4]);
  });
}
function paintTerrain(world) {
  if (atlasReady()) return paintTiles(world);
  if (atlasState() === 'loading') { // the sheet arrives in a moment; a flat placeholder avoids painting twice
    const c = document.createElement('canvas'); c.width = world.w * PX; c.height = world.h * PX;
    const ctx = c.getContext('2d'); for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) { ctx.fillStyle = PAL[tileAt(world, x, y)].ground[0]; ctx.fillRect(x * PX, y * PX, PX, PX); }
    return c;
  }
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
  if (atlasReady()) { blitAt(ctx, SPRITES.city[color] || SPRITES.city.town, cx, cy + PX / 2 + 2); labels.push({ x: cx, y: cy + PX / 2 + 8, text: name }); return; }
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
  const glow = ctx.createRadialGradient(cx, cy, 3, cx, cy, 30);
  glow.addColorStop(0, 'rgba(160,30,50,.45)'); glow.addColorStop(1, 'rgba(160,30,50,0)');
  ctx.fillStyle = glow; ctx.fillRect(cx - 30, cy - 30, 60, 60);
  if (atlasReady()) { blitAt(ctx, SPRITES.city.fortress, cx, cy + PX / 2 + 2); const dr = MONSTERS.dragon.idle[0]; blitAt(ctx, dr, cx + 34, cy + PX / 2 + 6, Math.min(0.9, 50 / dr[3])); labels.push({ x: cx, y: cy + PX / 2 + 8, text: 'The Usurper' }); return; }
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
  if (atlasReady()) { const k = 42 / SPRITES.pit[3]; if (cleared && SPRITES.pitCleared) { blitAt(ctx, SPRITES.pitCleared, cx, cy + PX / 2 + 2, k); return; } if (cleared) ctx.globalAlpha = 0.55; blitAt(ctx, SPRITES.pit, cx, cy + PX / 2 + 2, k); ctx.globalAlpha = 1; if (!cleared && SPRITES.pit[3] < 60) blitAt(ctx, SPRITES.torch, cx + 14, cy + 6, 0.6); return; }
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
  const ck = 30 / SPRITES.crystal[3];
  if (atlasReady() && taken && SPRITES.crystalTaken) { blitAt(ctx, SPRITES.crystalTaken, cx, cy + 15, ck); return; }
  if (atlasReady()) { if (!taken) { const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 16); g.addColorStop(0, 'rgba(160,220,255,.6)'); g.addColorStop(1, 'rgba(160,220,255,0)'); ctx.fillStyle = g; ctx.fillRect(cx - 16, cy - 16, 32, 32); } else ctx.globalAlpha = 0.4; blitAt(ctx, SPRITES.crystal, cx, cy + 15, ck); ctx.globalAlpha = 1; return; }
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
  if (atlasReady() && opts.sprite) {
    if (opts.ring) { ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(cx, cy + PX / 2 - 3, 12, 4, 0, 0, Math.PI * 2); ctx.stroke(); }
    blitAt(ctx, opts.sprite, cx, cy + PX / 2 - 1, Math.min(0.8, 38 / opts.sprite[3]));
    if (opts.tier) labels.push({ x: cx + 13, y: cy + 12, text: String(opts.tier), size: 6, color: '#fff', bg: 'rgba(20,18,16,.85)' });
    return;
  }
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
  const cw = Math.round(fw * s), ch = Math.round(fh * s);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; canvas.style.width = Math.round(fw * k) + 'px'; canvas.style.height = Math.round(fh * k) + 'px'; }
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, cw, ch);
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
// Whole-world overview for the side panel: the painted terrain scaled down, with markers.
export function drawMinimap(canvas, world, player, cam) {
  let terrain = terrainCache.get(world);
  if (!terrain || !!terrain.atlas !== atlasReady()) { terrain = paintTerrain(world); terrainCache.set(world, terrain); }
  const k = Math.max(1, Math.floor(240 / world.w));
  canvas.width = world.w * k; canvas.height = world.h * k;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(terrain, 0, 0, canvas.width, canvas.height);
  const dot = (x, y, col, r = 2) => { ctx.fillStyle = col; ctx.fillRect(x * k + k / 2 - r, y * k + k / 2 - r, r * 2, r * 2); };
  for (const ct of world.cities) dot(ct.x, ct.y, '#f3ecd8', 2.5);
  for (const d of world.dungeons || []) if (d.revealed) dot(d.x, d.y, '#ffb347', 2);
  for (const l of world.links) if (!l.taken) dot(l.x, l.y, '#9fe7ff', 1.5);
  for (const e of world.enemies) if (e.bounty) dot(e.x, e.y, '#ffd54a', 2);
  for (const lm of world.landmarks || []) if (!lm.used) dot(lm.x, lm.y, '#ffe9a8', 1.5);
  for (const sp of world.specials || []) dot(sp.x, sp.y, { gemcutter: '#7fe0ff', lostcity: '#ffd76a', diamondmine: '#e6b3ff' }[sp.kind] || '#fff', 2);
  dot(world.castle.x, world.castle.y, '#ff3b3b', 3);
  dot(player.x, player.y, '#ffffff', 2.5);
  if (cam) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.strokeRect(cam.x * k + 0.5, cam.y * k + 0.5, VIEW.w * k - 1, VIEW.h * k - 1); }
}
let frame = null, labels = [];
export function drawWorld(canvas, world, player, opts = {}) {
  let terrain = terrainCache.get(world);
  if (!terrain || !!terrain.atlas !== atlasReady()) { terrain = paintTerrain(world); terrainCache.set(world, terrain); }
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
  for (const lm of world.landmarks || []) if (vis(lm.x, lm.y)) { const [cx, cy] = c(lm.x, lm.y); objs.push({ y: cy - 1, draw: () => drawLandmark(f, cx, cy, lm) }); }
  for (const sp of world.specials || []) if (vis(sp.x, sp.y)) { const [cx, cy] = c(sp.x, sp.y); objs.push({ y: cy - 1, draw: () => drawSpecial(f, cx, cy, sp) }); }
  for (const ct of world.cities) if (vis(ct.x, ct.y)) { const [cx, cy] = c(ct.x, ct.y); objs.push({ y: cy, draw: () => drawCity(f, cx, cy, ct.color, ct.name) }); }
  if (vis(world.castle.x, world.castle.y)) { const [cx, cy] = c(world.castle.x, world.castle.y); objs.push({ y: cy, draw: () => drawFortress(f, cx, cy) }); }
  const robes = { W: ['#d9d2b8', '#f0ead6'], U: ['#2f5f9c', '#5e8cc9'], B: ['#3a2d4a', '#5e4d75'], R: ['#a33a2a', '#d0604a'], G: ['#3f6f2f', '#6a9a4a'] };
  for (const e of world.enemies) if (vis(e.x, e.y)) { const [cx, cy] = c(e.x, e.y); const [r, rl] = robes[e.color] || robes.B; const sp = (SPRITES.mage[e.color] || SPRITES.mage.M)[e.tier >= 2 ? 1 : 0]; objs.push({ y: cy, draw: () => { drawFigure(f, cx, cy, r, rl, r, { tier: e.tier, sprite: sp }); if (e.bounty) labels.push({ x: cx, y: cy - PX / 2 - 10, text: '\u2605', size: 10, color: '#ffd54a', bg: 'rgba(60,40,10,.9)' }); } }); }
  { const [cx, cy] = c(player.x, player.y); objs.push({ y: cy + 0.1, draw: () => drawFigure(f, cx, cy, '#c8322a', '#e0604a', null, { legs: '#2f4f9c', staff: true, ring: true, sprite: SPRITES.hero }) }); }
  objs.sort((a, b) => a.y - b.y);
  for (const o of objs) o.draw();
  // vignette frame like the original's border
  const g = f.createRadialGradient(fw / 2, fh / 2, fh * 0.45, fw / 2, fh / 2, fw * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)'); f.fillStyle = g; f.fillRect(0, 0, fw, fh);

  present(canvas, frame, fw, fh, labels);
  return cam;
}
