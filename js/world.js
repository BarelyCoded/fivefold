// Overworld generation and painted rendering. Geography is color: each biome is one of the five.
import { COLORS } from './cards.js';

export const W = 30, H = 20, TILE = 36;

export const PAL = {
  W: { name: 'Plains', base: '#d6c68a', light: '#e9dfa9', dark: '#b3a068', grass: '#8e9a4a', wheat: '#e0b040', rock: '#a89c86' },
  U: { name: 'Coast', base: '#4d87c9', light: '#8dbfe8', dark: '#2f5c9c', sand: '#e6d8a6', sandDark: '#c9b782', foam: '#dbeeff' },
  B: { name: 'Swamp', base: '#56505f', light: '#716b7c', dark: '#35303f', water: '#24313a', slime: '#66804c', wood: '#211c26' },
  R: { name: 'Mountains', base: '#b3775a', light: '#d29e80', dark: '#7b4936', shade: '#5f3628', snow: '#f4f0e8', rock: '#8f6a5a' },
  G: { name: 'Forest', base: '#5e923f', light: '#80b35a', dark: '#3f6c29', canopy: '#2c6428', canopyLight: '#4f9c3a', trunk: '#4a3220' },
};
// Legacy shape used by the map legend.
export const BIOME = Object.fromEntries(COLORS.map(c => [c, { name: PAL[c].name, fill: PAL[c].base, dark: PAL[c].dark }]));
export const CITY_NAME = { W: 'Alabaster', U: 'Tidewater', B: 'Mirehold', R: 'Cinderfall', G: 'Greenhollow' };

// ---- generation ------------------------------------------------------------------
function field(rng, w, h, passes = 2) {
  let f = Array.from({ length: h }, () => Array.from({ length: w }, () => rng()));
  for (let p = 0; p < passes; p++) {
    const g = f.map(r => r.slice());
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue; s += f[yy][xx]; n++;
      }
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
  const seeds = COLORS.map((c, i) => {
    const a = rot + i * Math.PI * 2 / 5 + (rng() - 0.5) * 0.4;
    return { c, x: Math.round(cx + Math.cos(a) * r * 1.25), y: Math.round(cy + Math.sin(a) * r) };
  });
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

  const randomTile = (pred, tries = 400) => {
    for (let i = 0; i < tries; i++) {
      const x = Math.floor(rng() * W), y = Math.floor(rng() * H);
      if (occupied.has(`${x},${y}`)) continue;
      if (pred(x, y)) return { x, y };
    }
    return null;
  };
  const links = [];
  for (const c of cities) {
    const t = randomTile((x, y) => at(x, y) === c.color && dist({ x, y }, c) >= 4 && dist({ x, y }, start) >= 3);
    if (t) { links.push({ ...t, color: c.color, taken: false }); occupied.add(`${t.x},${t.y}`); }
  }
  let castle = null, far = -1;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (occupied.has(`${x},${y}`)) continue; const d = dist({ x, y }, start); if (d > far) { far = d; castle = { x, y }; }
  }
  occupied.add(`${castle.x},${castle.y}`);

  const roam = [];
  let uid = 1;
  for (let i = 0; i < 16; i++) {
    const t = randomTile((x, y) => dist({ x, y }, start) >= 3);
    if (!t) continue;
    const color = at(t.x, t.y);
    const tier = dist(t, start) < 9 ? 1 : 2;
    const pool = enemies.filter(e => e.color === color && !e.boss);
    const tpl = pool.find(e => e.tier === tier) || pool[0];
    if (!tpl) continue;
    roam.push({ uid: uid++, x: t.x, y: t.y, template: tpl.id, tier: tpl.tier, color });
    occupied.add(`${t.x},${t.y}`);
  }
  return { w: W, h: H, tiles, cities, links, castle, enemies: roam, start: { x: start.x, y: start.y }, seed: Math.floor(rng() * 1e9) };
}

export const tileAt = (world, x, y) => world.tiles[y * world.w + x];
export const inBounds = (world, x, y) => x >= 0 && y >= 0 && x < world.w && y < world.h;
export const cityAt = (world, x, y) => world.cities.find(c => c.x === x && c.y === y);
export const linkAt = (world, x, y) => world.links.find(l => l.x === x && l.y === y);
export const enemyAt = (world, x, y) => world.enemies.find(e => e.x === x && e.y === y);

export function stepEnemies(world, rng, player) {
  for (const e of world.enemies) {
    if (rng() > 0.45) continue;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const [dx, dy] = dirs[Math.floor(rng() * 4)];
    const nx = e.x + dx, ny = e.y + dy;
    if (!inBounds(world, nx, ny)) continue;
    if (cityAt(world, nx, ny) || linkAt(world, nx, ny) || enemyAt(world, nx, ny)) continue;
    if (world.castle.x === nx && world.castle.y === ny) continue;
    if (player.x === nx && player.y === ny) continue;
    if (tileAt(world, nx, ny) !== e.color && rng() < 0.7) continue;
    e.x = nx; e.y = ny;
  }
}

// ---- painting ---------------------------------------------------------------------
function hash(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 1103515245) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const T = TILE;
const terrainCache = new WeakMap();

function shadow(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2); ctx.fill();
}

function drawTree(ctx, px, py, s, pal, dead = false) {
  if (dead) {
    ctx.strokeStyle = pal.wood; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - s * 1.6);
    ctx.moveTo(px, py - s * 0.8); ctx.lineTo(px - s * 0.5, py - s * 1.3);
    ctx.moveTo(px, py - s * 1.1); ctx.lineTo(px + s * 0.55, py - s * 1.6); ctx.stroke();
    return;
  }
  shadow(ctx, px + 2, py + 1, s * 0.9, s * 0.35);
  ctx.fillStyle = pal.trunk; ctx.fillRect(px - 1.5, py - s * 0.6, 3, s * 0.7);
  ctx.fillStyle = pal.canopy; ctx.beginPath(); ctx.arc(px, py - s * 0.9, s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.canopyLight; ctx.beginPath(); ctx.arc(px - s * 0.3, py - s * 1.15, s * 0.6, 0, Math.PI * 2); ctx.fill();
}

function drawMountain(ctx, px, py, hgt, pal) {
  const w = hgt * 1.4;
  shadow(ctx, px, py + 1, w * 0.6, 4);
  ctx.fillStyle = pal.light; ctx.beginPath(); ctx.moveTo(px - w / 2, py); ctx.lineTo(px, py - hgt); ctx.lineTo(px + 2, py); ctx.closePath(); ctx.fill();
  ctx.fillStyle = pal.shade; ctx.beginPath(); ctx.moveTo(px, py - hgt); ctx.lineTo(px + w / 2, py); ctx.lineTo(px, py); ctx.closePath(); ctx.fill();
  if (hgt > 18) {
    ctx.fillStyle = pal.snow; ctx.beginPath(); ctx.moveTo(px, py - hgt); ctx.lineTo(px + w * 0.16, py - hgt * 0.68); ctx.lineTo(px + w * 0.05, py - hgt * 0.72);
    ctx.lineTo(px - w * 0.04, py - hgt * 0.64); ctx.lineTo(px - w * 0.15, py - hgt * 0.7); ctx.closePath(); ctx.fill();
  }
}

function paintTerrain(world) {
  const c = document.createElement('canvas'); c.width = world.w * T; c.height = world.h * T;
  const ctx = c.getContext('2d');
  const at = (x, y) => inBounds(world, x, y) ? tileAt(world, x, y) : null;
  const seed = world.seed || 0;
  const h = (x, y, s) => hash(x, y, s + seed);

  // 1. base fill
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) { ctx.fillStyle = PAL[at(x, y)].base; ctx.fillRect(x * T, y * T, T, T); }
  // 2. organic edges: blobs of own colour across borders
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    const p = PAL[at(x, y)];
    for (let i = 0; i < 7; i++) {
      const a = h(x, y, i) * Math.PI * 2, rr = T * (0.35 + h(x, y, i + 20) * 0.3);
      ctx.fillStyle = p.base; ctx.beginPath();
      ctx.arc(x * T + T / 2 + Math.cos(a) * rr, y * T + T / 2 + Math.sin(a) * rr, 4 + h(x, y, i + 40) * 8, 0, Math.PI * 2); ctx.fill();
    }
  }
  // 3. sandy shore around coast tiles and deep-water look
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    if (at(x, y) !== 'U') continue;
    const p = PAL.U;
    const edges = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => at(x + dx, y + dy) && at(x + dx, y + dy) !== 'U');
    for (const [dx, dy] of edges) {
      for (let i = 0; i < 6; i++) {
        const t = (i + 0.5) / 6, wob = (h(x, y, 60 + i + dx * 3 + dy * 5) - 0.5) * 5;
        const bx = dx ? x * T + (dx > 0 ? T - 3 : 3) + wob : x * T + t * T;
        const by = dy ? y * T + (dy > 0 ? T - 3 : 3) + wob : y * T + t * T;
        ctx.fillStyle = p.sand; ctx.beginPath(); ctx.arc(bx, by, 6 + h(x, y, 80 + i) * 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    // foam line just inside the sand
    for (const [dx, dy] of edges) {
      ctx.strokeStyle = p.foam; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.7; ctx.beginPath();
      const off = 9;
      if (dx) { const lx = x * T + (dx > 0 ? T - off : off); ctx.moveTo(lx, y * T + 3); ctx.quadraticCurveTo(lx + (dx > 0 ? -3 : 3), y * T + T / 2, lx, y * T + T - 3); }
      else { const ly = y * T + (dy > 0 ? T - off : off); ctx.moveTo(x * T + 3, ly); ctx.quadraticCurveTo(x * T + T / 2, ly + (dy > 0 ? -3 : 3), x * T + T - 3, ly); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  // 4. texture and small features (no tall objects yet)
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    const b = at(x, y), p = PAL[b];
    const X = x * T, Y = y * T;
    if (b === 'U') {
      ctx.strokeStyle = p.light; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const wx = X + 4 + h(x, y, 100 + i) * (T - 14), wy = Y + 5 + h(x, y, 110 + i) * (T - 10);
        ctx.beginPath(); ctx.moveTo(wx, wy); ctx.quadraticCurveTo(wx + 3, wy - 2.5, wx + 6, wy); ctx.quadraticCurveTo(wx + 9, wy + 2.5, wx + 12, wy); ctx.stroke();
      }
    } else if (b === 'W') {
      ctx.strokeStyle = p.grass; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const gx = X + 3 + h(x, y, 120 + i) * (T - 6), gy = Y + 4 + h(x, y, 130 + i) * (T - 6);
        ctx.beginPath(); ctx.moveTo(gx - 2, gy + 2); ctx.lineTo(gx, gy - 2); ctx.lineTo(gx + 2, gy + 2); ctx.stroke();
      }
      if (h(x, y, 140) < 0.3) { // wheat field
        ctx.strokeStyle = p.wheat; ctx.lineWidth = 1.5;
        for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) {
          const gx = X + 5 + i * 8 + (r % 2) * 4, gy = Y + 6 + r * 7;
          ctx.beginPath(); ctx.moveTo(gx, gy + 4); ctx.lineTo(gx, gy - 1); ctx.stroke();
        }
      }
      if (h(x, y, 150) < 0.12) { ctx.fillStyle = p.rock; ctx.beginPath(); ctx.ellipse(X + T * 0.6, Y + T * 0.6, 5, 3.5, 0.3, 0, Math.PI * 2); ctx.fill(); }
    } else if (b === 'B') {
      const n = 1 + (h(x, y, 160) < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const px = X + 8 + h(x, y, 170 + i) * (T - 16), py = Y + 8 + h(x, y, 180 + i) * (T - 16);
        ctx.fillStyle = p.water; ctx.beginPath(); ctx.ellipse(px, py, 8 + h(x, y, 190 + i) * 5, 4 + h(x, y, 200 + i) * 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = p.slime; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px - 2, py - 1, 4, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      }
      ctx.strokeStyle = p.slime; ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) { const rx = X + 3 + h(x, y, 210 + i) * (T - 6), ry = Y + 6 + h(x, y, 220 + i) * (T - 8); ctx.beginPath(); ctx.moveTo(rx, ry + 5); ctx.lineTo(rx + 1, ry - 3); ctx.stroke(); }
    } else if (b === 'R') {
      ctx.fillStyle = p.rock;
      for (let i = 0; i < 4; i++) { const rx = X + 4 + h(x, y, 230 + i) * (T - 8), ry = Y + 4 + h(x, y, 240 + i) * (T - 8); ctx.beginPath(); ctx.ellipse(rx, ry, 2.5 + h(x, y, 250 + i) * 3, 1.8 + h(x, y, 260 + i) * 2, h(x, y, 270 + i), 0, Math.PI * 2); ctx.fill(); }
    } else if (b === 'G') {
      ctx.strokeStyle = p.dark; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
      for (let i = 0; i < 5; i++) { const gx = X + 3 + h(x, y, 280 + i) * (T - 6), gy = Y + 3 + h(x, y, 290 + i) * (T - 6); ctx.beginPath(); ctx.moveTo(gx - 2, gy + 2); ctx.lineTo(gx, gy - 2); ctx.lineTo(gx + 2, gy + 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }
  // 5. tall features, collected and drawn back-to-front
  const feats = [];
  const reserved = new Set([...world.cities.map(c => `${c.x},${c.y}`), `${world.castle.x},${world.castle.y}`, ...world.links.map(l => `${l.x},${l.y}`)]);
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    const b = at(x, y), X = x * T, Y = y * T;
    const busy = reserved.has(`${x},${y}`);
    if (b === 'G') {
      const n = busy ? 1 : 3 + Math.floor(h(x, y, 300) * 3);
      for (let i = 0; i < n; i++) {
        const px = X + 5 + h(x, y, 310 + i) * (T - 10), py = Y + 10 + h(x, y, 320 + i) * (T - 10);
        if (busy && Math.abs(px - X - T / 2) < 14 && Math.abs(py - Y - T / 2) < 14) continue;
        feats.push({ y: py, draw: ctx => drawTree(ctx, px, py, 5 + h(x, y, 330 + i) * 4, PAL.G) });
      }
    } else if (b === 'R' && !busy) {
      const n = h(x, y, 340) < 0.25 ? 0 : 1 + (h(x, y, 341) < 0.45 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const px = X + 8 + h(x, y, 350 + i) * (T - 16), py = Y + 14 + h(x, y, 360 + i) * (T - 14);
        feats.push({ y: py, draw: ctx => drawMountain(ctx, px, py, 12 + h(x, y, 370 + i) * 16, PAL.R) });
      }
    } else if (b === 'B' && !busy) {
      const n = h(x, y, 380) < 0.55 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const px = X + 6 + h(x, y, 390 + i) * (T - 12), py = Y + 12 + h(x, y, 400 + i) * (T - 12);
        feats.push({ y: py, draw: ctx => drawTree(ctx, px, py, 6 + h(x, y, 410 + i) * 4, PAL.B, true) });
      }
    } else if (b === 'W' && !busy && h(x, y, 420) < 0.18) {
      const px = X + 8 + h(x, y, 430) * (T - 16), py = Y + 12 + h(x, y, 440) * (T - 12);
      feats.push({ y: py, draw: ctx => drawTree(ctx, px, py, 4 + h(x, y, 450) * 2, { trunk: PAL.G.trunk, canopy: '#6b8a3a', canopyLight: '#94b25a' }) });
    } else if (b === 'U' && !busy && h(x, y, 460) < 0.1) {
      const px = X + T / 2, py = Y + T / 2 + 4;
      feats.push({ y: py, draw: ctx => { ctx.fillStyle = PAL.U.sand; ctx.beginPath(); ctx.ellipse(px, py, 9, 6, 0, 0, Math.PI * 2); ctx.fill(); drawTree(ctx, px + 1, py + 1, 4, { trunk: PAL.G.trunk, canopy: '#3f8a3a', canopyLight: '#63b04a' }); } });
    }
  }
  feats.sort((a, b) => a.y - b.y);
  for (const f of feats) f.draw(ctx);
  // 6. gentle vignette / border
  const grd = ctx.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.5, c.width / 2, c.height / 2, c.width * 0.75);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,.28)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

// ---- objects --------------------------------------------------------------------
function drawCity(ctx, cx, cy, color, name) {
  const p = PAL[color];
  shadow(ctx, cx, cy + 9, 17, 5);
  // buildings behind the wall
  const houses = [[-9, -6, '#c9a24a'], [1, -9, '#8a3f2f'], [8, -5, '#7a6b8f']];
  for (const [dx, dy, roof] of houses) {
    ctx.fillStyle = '#e8dcc2'; ctx.fillRect(cx + dx - 4, cy + dy, 8, 7);
    ctx.fillStyle = roof; ctx.beginPath(); ctx.moveTo(cx + dx - 5, cy + dy); ctx.lineTo(cx + dx, cy + dy - 5); ctx.lineTo(cx + dx + 5, cy + dy); ctx.closePath(); ctx.fill();
  }
  // tower
  ctx.fillStyle = '#c8c2b4'; ctx.fillRect(cx + 9, cy - 16, 6, 18);
  ctx.fillStyle = '#5b4a6a'; ctx.beginPath(); ctx.moveTo(cx + 8, cy - 16); ctx.lineTo(cx + 12, cy - 22); ctx.lineTo(cx + 16, cy - 16); ctx.closePath(); ctx.fill();
  ctx.fillStyle = p.dark; ctx.fillRect(cx + 12, cy - 27, 1, 6); ctx.beginPath(); ctx.moveTo(cx + 13, cy - 27); ctx.lineTo(cx + 18, cy - 25); ctx.lineTo(cx + 13, cy - 23); ctx.closePath(); ctx.fill();
  // wall
  ctx.fillStyle = '#b6b0a2'; ctx.fillRect(cx - 15, cy, 30, 9);
  ctx.fillStyle = '#8f887a'; ctx.fillRect(cx - 15, cy + 7, 30, 2);
  ctx.strokeStyle = '#3b3730'; ctx.lineWidth = 1; ctx.strokeRect(cx - 15, cy, 30, 9);
  ctx.fillStyle = '#b6b0a2'; for (let i = 0; i < 6; i++) ctx.fillRect(cx - 15 + i * 5.5, cy - 3, 3, 3);
  ctx.fillStyle = '#3b3730'; ctx.fillRect(cx - 3, cy + 3, 6, 6); // gate
  // nameplate
  ctx.font = 'bold 9px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(name).width + 8;
  ctx.fillStyle = 'rgba(20,18,16,.75)'; ctx.fillRect(cx - tw / 2, cy + 12, tw, 11);
  ctx.fillStyle = '#f3ecd8'; ctx.fillText(name, cx, cy + 17.5);
}

function drawCastle(ctx, cx, cy) {
  const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, 30);
  glow.addColorStop(0, 'rgba(120,20,40,.35)'); glow.addColorStop(1, 'rgba(120,20,40,0)');
  ctx.fillStyle = glow; ctx.fillRect(cx - 30, cy - 30, 60, 60);
  shadow(ctx, cx, cy + 11, 18, 5);
  const stone = '#2a2530', stoneL = '#3d3646';
  ctx.fillStyle = stone;
  ctx.fillRect(cx - 14, cy - 10, 8, 20); ctx.fillRect(cx + 6, cy - 10, 8, 20); // side towers
  ctx.fillRect(cx - 6, cy - 4, 12, 14); // curtain wall
  ctx.fillRect(cx - 4, cy - 22, 8, 20); // keep
  ctx.fillStyle = stoneL; ctx.fillRect(cx - 14, cy - 10, 3, 20); ctx.fillRect(cx + 6, cy - 10, 3, 20); ctx.fillRect(cx - 4, cy - 22, 3, 20);
  ctx.fillStyle = stone;
  for (const tx of [-14, 6]) for (let i = 0; i < 3; i++) ctx.fillRect(cx + tx + i * 3, cy - 13, 2, 3);
  for (let i = 0; i < 3; i++) ctx.fillRect(cx - 4 + i * 3, cy - 25, 2, 3);
  ctx.fillStyle = '#ff9a3a'; ctx.fillRect(cx - 1, cy - 16, 2, 3); ctx.fillRect(cx - 11, cy - 4, 2, 3); ctx.fillRect(cx + 9, cy - 4, 2, 3); // lit windows
  ctx.fillStyle = '#c8323a'; ctx.beginPath(); ctx.moveTo(cx, cy - 30); ctx.lineTo(cx + 8, cy - 27); ctx.lineTo(cx, cy - 24); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#111'; ctx.fillRect(cx - 0.5, cy - 30, 1, 8);
  ctx.fillStyle = '#111'; ctx.fillRect(cx - 2, cy + 5, 4, 5); // gate
}

function drawCrystal(ctx, cx, cy, taken) {
  if (!taken) {
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 20);
    glow.addColorStop(0, 'rgba(255,245,190,.75)'); glow.addColorStop(1, 'rgba(255,245,190,0)');
    ctx.fillStyle = glow; ctx.fillRect(cx - 20, cy - 20, 40, 40);
  }
  shadow(ctx, cx, cy + 8, 7, 2.5);
  ctx.fillStyle = taken ? '#8d8a80' : '#f7f1c8'; ctx.beginPath(); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx + 6, cy); ctx.lineTo(cx, cy + 7); ctx.lineTo(cx - 6, cy); ctx.closePath(); ctx.fill();
  ctx.fillStyle = taken ? '#6f6c64' : '#d9c46a'; ctx.beginPath(); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx + 6, cy); ctx.lineTo(cx, cy + 7); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#4a4330'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx + 6, cy); ctx.lineTo(cx, cy + 7); ctx.lineTo(cx - 6, cy); ctx.closePath(); ctx.stroke();
}

function drawMage(ctx, cx, cy, robe, robeLight, hat, opts = {}) {
  shadow(ctx, cx, cy + 9, 7, 2.5);
  if (opts.ring) { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(cx, cy + 9, 9, 3.5, 0, 0, Math.PI * 2); ctx.stroke(); }
  // robe
  ctx.fillStyle = robe; ctx.beginPath(); ctx.moveTo(cx - 7, cy + 9); ctx.quadraticCurveTo(cx - 4, cy - 2, cx, cy - 5); ctx.quadraticCurveTo(cx + 4, cy - 2, cx + 7, cy + 9); ctx.closePath(); ctx.fill();
  ctx.fillStyle = robeLight; ctx.beginPath(); ctx.moveTo(cx - 2, cy + 9); ctx.lineTo(cx - 1, cy - 2); ctx.lineTo(cx + 1, cy - 2); ctx.lineTo(cx + 2, cy + 9); ctx.closePath(); ctx.fill();
  // staff
  if (opts.staff) { ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx + 7, cy + 8); ctx.lineTo(cx + 8, cy - 10); ctx.stroke(); ctx.fillStyle = '#9fe7ff'; ctx.beginPath(); ctx.arc(cx + 8, cy - 11, 2.2, 0, Math.PI * 2); ctx.fill(); }
  // head
  ctx.fillStyle = '#e9c39c'; ctx.beginPath(); ctx.arc(cx, cy - 7, 3.6, 0, Math.PI * 2); ctx.fill();
  // hat
  ctx.fillStyle = hat; ctx.beginPath(); ctx.moveTo(cx - 6, cy - 9); ctx.lineTo(cx + 6, cy - 9); ctx.lineTo(cx + 1, cy - 19); ctx.closePath(); ctx.fill();
  ctx.fillRect(cx - 6, cy - 10, 12, 1.5);
  ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - 7, cy + 9); ctx.quadraticCurveTo(cx - 4, cy - 2, cx, cy - 5); ctx.quadraticCurveTo(cx + 4, cy - 2, cx + 7, cy + 9); ctx.stroke();
  if (opts.tier) {
    ctx.fillStyle = '#15120f'; ctx.beginPath(); ctx.arc(cx + 8, cy + 6, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#e8dcc2'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(opts.tier), cx + 8, cy + 6.5);
  }
}

export function drawWorld(canvas, world, player, opts = {}) {
  const ctx = canvas.getContext('2d');
  canvas.width = world.w * T; canvas.height = world.h * T;
  let terrain = terrainCache.get(world);
  if (!terrain) { terrain = paintTerrain(world); terrainCache.set(world, terrain); }
  ctx.drawImage(terrain, 0, 0);

  if (opts.highlight) {
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    for (const [x, y] of opts.highlight) ctx.strokeRect(x * T + 3, y * T + 3, T - 6, T - 6);
    ctx.setLineDash([]);
  }
  // objects back-to-front by y
  const objs = [];
  const c = (x, y) => [x * T + T / 2, y * T + T / 2];
  for (const l of world.links) { const [cx, cy] = c(l.x, l.y); objs.push({ y: cy, draw: () => drawCrystal(ctx, cx, cy, l.taken) }); }
  for (const ct of world.cities) { const [cx, cy] = c(ct.x, ct.y); objs.push({ y: cy, draw: () => drawCity(ctx, cx, cy, ct.color, ct.name) }); }
  { const [cx, cy] = c(world.castle.x, world.castle.y); objs.push({ y: cy, draw: () => drawCastle(ctx, cx, cy) }); }
  for (const e of world.enemies) {
    const [cx, cy] = c(e.x, e.y); const p = PAL[e.color];
    objs.push({ y: cy, draw: () => drawMage(ctx, cx, cy, p.dark, p.base, p.dark, { tier: e.tier }) });
  }
  { const [cx, cy] = c(player.x, player.y); objs.push({ y: cy + 0.5, draw: () => drawMage(ctx, cx, cy, '#3b5fb0', '#8fb0ee', '#27407e', { staff: true, ring: true }) }); }
  objs.sort((a, b) => a.y - b.y);
  for (const o of objs) o.draw();
}
