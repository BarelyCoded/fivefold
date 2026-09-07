// Overworld generation and rendering. Geography is color: each biome is one of the five.
import { COLORS } from './cards.js';

export const W = 30, H = 20, TILE = 26;
export const BIOME = {
  W: { name: 'Plains', fill: '#e6dcae', dark: '#c9bd86' },
  U: { name: 'Coast', fill: '#6f9be0', dark: '#4d78bf' },
  B: { name: 'Swamp', fill: '#6e6180', dark: '#4e4360' },
  R: { name: 'Mountains', fill: '#d5654a', dark: '#a94a33' },
  G: { name: 'Forest', fill: '#5f9c4a', dark: '#3f7530' },
};
export const CITY_NAME = { W: 'Alabaster', U: 'Tidewater', B: 'Mirehold', R: 'Cinderfall', G: 'Greenhollow' };

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
  // Castle: far from the start.
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
  return { w: W, h: H, tiles, cities, links, castle, enemies: roam, start: { x: start.x, y: start.y } };
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
    if (player.x === nx && player.y === ny) continue; // never step onto the player; the player chooses to engage
    if (tileAt(world, nx, ny) !== e.color && rng() < 0.7) continue; // enemies mostly stay in their biome
    e.x = nx; e.y = ny;
  }
}

function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; }

export function drawWorld(canvas, world, player, opts = {}) {
  const ctx = canvas.getContext('2d');
  canvas.width = world.w * TILE; canvas.height = world.h * TILE;
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    const b = BIOME[tileAt(world, x, y)];
    ctx.fillStyle = b.fill; ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    // texture: a few darker specks per tile, deterministic
    ctx.fillStyle = b.dark;
    for (let i = 0; i < 3; i++) {
      const hx = hash(x * 3 + i, y), hy = hash(x, y * 3 + i);
      ctx.globalAlpha = 0.35; ctx.fillRect(x * TILE + hx * (TILE - 4), y * TILE + hy * (TILE - 4), 3, 3);
    }
    ctx.globalAlpha = 1;
  }
  // biome borders
  ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1;
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    const t = tileAt(world, x, y);
    if (x + 1 < world.w && tileAt(world, x + 1, y) !== t) { ctx.beginPath(); ctx.moveTo((x + 1) * TILE, y * TILE); ctx.lineTo((x + 1) * TILE, (y + 1) * TILE); ctx.stroke(); }
    if (y + 1 < world.h && tileAt(world, x, y + 1) !== t) { ctx.beginPath(); ctx.moveTo(x * TILE, (y + 1) * TILE); ctx.lineTo((x + 1) * TILE, (y + 1) * TILE); ctx.stroke(); }
  }
  const cxy = (x, y) => [x * TILE + TILE / 2, y * TILE + TILE / 2];
  // links
  for (const l of world.links) {
    const [cx, cy] = cxy(l.x, l.y);
    ctx.fillStyle = l.taken ? 'rgba(255,255,255,.35)' : '#fff7c2';
    ctx.strokeStyle = '#3a3a3a';
    ctx.beginPath(); ctx.moveTo(cx, cy - 9); ctx.lineTo(cx + 8, cy); ctx.lineTo(cx, cy + 9); ctx.lineTo(cx - 8, cy); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // cities
  for (const c of world.cities) {
    const [cx, cy] = cxy(c.x, c.y);
    ctx.fillStyle = '#fdfdf8'; ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.rect(cx - 8, cy - 2, 16, 10); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 10, cy - 2); ctx.lineTo(cx, cy - 10); ctx.lineTo(cx + 10, cy - 2); ctx.closePath(); ctx.fillStyle = BIOME[c.color].dark; ctx.fill(); ctx.stroke();
  }
  // castle
  { const [cx, cy] = cxy(world.castle.x, world.castle.y);
    ctx.fillStyle = '#1a1520'; ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.rect(cx - 9, cy - 6, 18, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1a1520'; for (const dx of [-9, -3, 3]) ctx.fillRect(cx + dx, cy - 11, 4, 6);
    ctx.fillStyle = '#e04a3a'; ctx.fillRect(cx - 2, cy - 1, 4, 5);
  }
  // enemies
  for (const e of world.enemies) {
    const [cx, cy] = cxy(e.x, e.y);
    ctx.fillStyle = BIOME[e.color].dark; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(e.tier), cx, cy + 0.5);
  }
  // player
  { const [cx, cy] = cxy(player.x, player.y);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  if (opts.highlight) {
    for (const [x, y] of opts.highlight) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.strokeRect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4); }
  }
}
