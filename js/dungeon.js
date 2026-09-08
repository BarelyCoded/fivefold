// Dungeon crawls: a small isometric stone maze on black rock. Stationary monsters block corridors,
// treasure piles hold life, gold and cards, scrolls hold riddles, and an exit arch leads out.
// Layouts are plain data so they persist in the save.

const GW = 9, GH = 7;          // grid cells
const TW = 48, TH = 24;        // internal iso tile size (drawn at 1x, scaled 2x)
const WALL_H = 16, PARAPET_H = 6;
const key = (x, y) => `${x},${y}`;

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
export function makeRiddle(rng, defs) {
  const pool = defs.filter(d => d && d.kind !== 'unsupported');
  if (!pool.length) return null;
  const d = pool[Math.floor(rng() * pool.length)];
  const kinds = [];
  if (d.kind === 'creature') kinds.push('power', 'toughness');
  if (d.colors.length === 1) kinds.push('color');
  if (d.cmc > 0) kinds.push('cmc');
  if (d.kwNames?.length) kinds.push('keyword');
  if (!kinds.length) return makeRiddle(rng, pool.filter(x => x !== d));
  const kind = kinds[Math.floor(rng() * kinds.length)];
  let q, answer, options;
  const nums = n => [...new Set([n, n + 1, Math.max(0, n - 1), n + 2, n + 3, Math.max(0, n - 2)])].slice(0, 4);
  switch (kind) {
    case 'power': q = `What is the power of ${d.name}?`; answer = String(d.power); options = nums(d.power).map(String); break;
    case 'toughness': q = `What is the toughness of ${d.name}?`; answer = String(d.toughness); options = nums(d.toughness).map(String); break;
    case 'color': q = `What color is ${d.name}?`; answer = COLOR_WORDS[d.colors[0]]; options = Object.values(COLOR_WORDS); break;
    case 'cmc': q = `What is the mana value of ${d.name}?`; answer = String(d.cmc); options = nums(d.cmc).map(String); break;
    case 'keyword': { const all = ['Flying', 'First strike', 'Trample', 'Banding', 'Regeneration', 'Swampwalk', 'Islandwalk', 'Forestwalk', 'Mountainwalk', 'Plainswalk', 'Protection from red', 'Vigilance', 'Haste']; answer = d.kwNames[0]; options = [answer, ...all.filter(k => !d.kwNames.includes(k)).sort(() => rng() - 0.5).slice(0, 5)]; q = `What special ability does ${d.name} have?`; break; }
  }
  options = [...new Set(options)].sort(() => rng() - 0.5);
  return { q, answer, options, card: d.name };
}

// ---- rendering ---------------------------------------------------------------------
function hash(x, y, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 1103515245) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
const px = (ctx, x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const ORIGIN = { x: (GH) * TW / 2 + 24, y: 40 };
export const CANVAS = { w: (GW + GH) * TW / 2 + 48, h: (GW + GH) * TH / 2 + 80 };
export function isoPos(x, y) { return [ORIGIN.x + (x - y) * TW / 2, ORIGIN.y + (x + y) * TH / 2]; }
// Inverse: canvas (internal) pixel -> grid cell
export function cellAtPixel(layout, cx, cy) {
  const fx = (cx - ORIGIN.x) / (TW / 2), fy = (cy - ORIGIN.y) / (TH / 2);
  const x = Math.round((fx + fy) / 2), y = Math.round((fy - fx) / 2);
  return cellOf(layout, x, y);
}

function diamond(ctx, cx, cy, col, w = TW, h = TH) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx, cy - h / 2); ctx.lineTo(cx + w / 2, cy); ctx.lineTo(cx, cy + h / 2); ctx.lineTo(cx - w / 2, cy); ctx.closePath(); ctx.fill(); }
function floor(ctx, cx, cy, seed) {
  diamond(ctx, cx, cy, '#7d7f84');
  // brick joints following the two iso directions
  ctx.save(); ctx.beginPath(); ctx.moveTo(cx, cy - TH / 2); ctx.lineTo(cx + TW / 2, cy); ctx.lineTo(cx, cy + TH / 2); ctx.lineTo(cx - TW / 2, cy); ctx.closePath(); ctx.clip();
  for (let i = -3; i <= 3; i++) {
    ctx.strokeStyle = 'rgba(30,30,36,.75)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - TW / 2 + i * 8, cy + i * 4 - TH / 2); ctx.lineTo(cx + i * 8, cy + i * 4 + TH / 2 - TH / 2 + TH / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + TW / 2 - i * 8, cy + i * 4 - TH / 2); ctx.lineTo(cx - i * 8, cy + i * 4 + TH / 2); ctx.stroke();
  }
  for (let i = 0; i < 6; i++) { const rx = cx - 16 + hash(cx + i, cy, seed) * 32, ry = cy - 6 + hash(cx, cy + i, seed) * 12; px(ctx, rx, ry, 2, 1, hash(rx, ry, seed) < 0.5 ? '#9a9ca2' : '#5e6066'); }
  ctx.restore();
}
// Wall along one edge of the diamond. side: 'nw' (x-1), 'ne' (y-1), 'sw' (y+1), 'se' (x+1)
function wall(ctx, cx, cy, side, tall, seed) {
  const h = tall ? WALL_H : PARAPET_H;
  const top = cy - TH / 2, right = cx + TW / 2, bottom = cy + TH / 2, left = cx - TW / 2;
  let a, b; // edge endpoints (base)
  if (side === 'nw') { a = [left, cy]; b = [cx, top]; } else if (side === 'ne') { a = [cx, top]; b = [right, cy]; } else if (side === 'sw') { a = [left, cy]; b = [cx, bottom]; } else { a = [cx, bottom]; b = [right, cy]; }
  const face = side === 'nw' || side === 'sw' ? '#5c5f66' : '#8a8d94';
  const dark = side === 'nw' || side === 'sw' ? '#3f4147' : '#6b6e75';
  ctx.fillStyle = face; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b[0], b[1] - h); ctx.lineTo(a[0], a[1] - h); ctx.closePath(); ctx.fill();
  // brick courses
  ctx.strokeStyle = 'rgba(20,20,26,.6)'; ctx.lineWidth = 1;
  for (let yy = 4; yy < h; yy += 4) { ctx.beginPath(); ctx.moveTo(a[0], a[1] - yy); ctx.lineTo(b[0], b[1] - yy); ctx.stroke(); }
  for (let t = 0.15; t < 1; t += 0.3) { const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t; ctx.beginPath(); ctx.moveTo(x, y - 1); ctx.lineTo(x, y - h + 1); ctx.stroke(); }
  // cap
  ctx.fillStyle = '#a3a6ad'; ctx.beginPath(); ctx.moveTo(a[0], a[1] - h); ctx.lineTo(b[0], b[1] - h); ctx.lineTo(b[0], b[1] - h - 3); ctx.lineTo(a[0], a[1] - h - 3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = dark; ctx.fillRect(Math.round(a[0]), Math.round(a[1] - h - 3), 1, h + 3);
  // torch on some tall back walls
  if (tall && hash(cx, cy, seed + (side === 'nw' ? 1 : 2)) < 0.28) {
    const tx = (a[0] + b[0]) / 2, ty = (a[1] + b[1]) / 2 - h / 2;
    px(ctx, tx - 1, ty, 2, 5, '#4a3020'); px(ctx, tx - 2, ty - 4, 4, 4, '#ff9a2a'); px(ctx, tx - 1, ty - 6, 2, 3, '#ffe27a');
    const g = ctx.createRadialGradient(tx, ty - 3, 1, tx, ty - 3, 14); g.addColorStop(0, 'rgba(255,170,60,.35)'); g.addColorStop(1, 'rgba(255,170,60,0)'); ctx.fillStyle = g; ctx.fillRect(tx - 14, ty - 17, 28, 28);
  }
}
function figure(ctx, cx, cy, robe, robeL, hat, opts = {}) {
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(cx, cy + 2, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
  px(ctx, cx - 3, cy - 9, 6, 10, robe); px(ctx, cx - 3, cy - 9, 2, 10, robeL);
  px(ctx, cx - 2, cy - 12, 4, 3, '#e9c39c');
  if (hat) { px(ctx, cx - 4, cy - 13, 8, 1, hat); ctx.fillStyle = hat; ctx.beginPath(); ctx.moveTo(cx - 3, cy - 13); ctx.lineTo(cx + 1, cy - 19); ctx.lineTo(cx + 3, cy - 13); ctx.closePath(); ctx.fill(); }
  else px(ctx, cx - 2, cy - 14, 4, 2, '#4a2e1a');
  if (opts.legs) px(ctx, cx - 3, cy - 2, 6, 3, opts.legs);
  if (opts.staff) { px(ctx, cx + 4, cy - 15, 1, 16, '#6b4a2a'); px(ctx, cx + 3, cy - 17, 3, 2, '#9fe7ff'); }
  if (opts.guardian) { px(ctx, cx - 5, cy - 16, 2, 4, '#e8dcc2'); px(ctx, cx + 3, cy - 16, 2, 4, '#e8dcc2'); }
  if (opts.badge) { px(ctx, cx + 4, cy - 4, 7, 7, '#15120f'); ctx.fillStyle = '#fff'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(opts.badge), cx + 7.5, cy - 0.5); }
}
function treasure(ctx, cx, cy, kind, seed) {
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(cx, cy + 2, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
  if (kind === 'gold') { ctx.fillStyle = '#d9a62b'; ctx.beginPath(); ctx.ellipse(cx, cy - 2, 8, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#f2cf5c'; ctx.beginPath(); ctx.ellipse(cx - 1, cy - 4, 5, 3, 0, 0, Math.PI * 2); ctx.fill(); for (let i = 0; i < 4; i++) px(ctx, cx - 6 + hash(i, cx, seed) * 12, cy - 5 + hash(cx, i, seed) * 5, 2, 1, '#fff2b0'); }
  else if (kind === 'card') { px(ctx, cx - 5, cy - 9, 8, 11, '#e8dcc2'); px(ctx, cx - 4, cy - 8, 6, 5, '#3b5fb0'); px(ctx, cx - 3, cy - 2, 4, 1, '#333'); px(ctx, cx - 2, cy - 11, 8, 11, 'rgba(232,220,194,.6)'); }
  else if (kind === 'life') { px(ctx, cx - 3, cy - 7, 6, 8, '#c8322a'); px(ctx, cx - 2, cy - 10, 4, 3, '#8fb0ee'); px(ctx, cx - 3, cy - 11, 6, 1, '#6b4a2a'); px(ctx, cx - 2, cy - 5, 2, 3, '#ff8a7a'); }
  else if (kind === 'amulet') { ctx.fillStyle = '#f2cf5c'; ctx.beginPath(); ctx.arc(cx, cy - 5, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#d060ff'; ctx.beginPath(); ctx.arc(cx, cy - 5, 2.5, 0, Math.PI * 2); ctx.fill(); px(ctx, cx - 1, cy - 12, 2, 3, '#a07c48'); }
  else { px(ctx, cx - 7, cy - 6, 14, 8, '#7a5a34'); px(ctx, cx - 7, cy - 9, 14, 3, '#a07c48'); px(ctx, cx - 1, cy - 6, 2, 2, '#f2cf5c'); }
}
function scroll(ctx, cx, cy) {
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(cx, cy + 2, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
  px(ctx, cx - 7, cy - 8, 14, 9, '#efe3c2'); px(ctx, cx - 8, cy - 9, 3, 11, '#c9b686'); px(ctx, cx + 5, cy - 9, 3, 11, '#c9b686');
  for (let i = 0; i < 3; i++) px(ctx, cx - 4, cy - 6 + i * 2.5, 7, 1, '#6b5a3a');
}
function exitArch(ctx, cx, cy) {
  px(ctx, cx - 9, cy - 20, 18, 22, '#3a3c42'); px(ctx, cx - 6, cy - 16, 12, 18, '#08080a');
  ctx.fillStyle = '#3a3c42'; ctx.beginPath(); ctx.arc(cx, cy - 20, 9, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#08080a'; ctx.beginPath(); ctx.arc(cx, cy - 16, 6, Math.PI, 0); ctx.fill();
  px(ctx, cx - 2, cy - 4, 4, 1, '#9fe7ff');
}
function label(ctx, cx, cy, text) {
  ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,.7)'; const w = ctx.measureText(text).width + 6; ctx.fillRect(cx - w / 2, cy - 5, w, 10);
  ctx.fillStyle = '#f3ecd8'; ctx.fillText(text, cx, cy);
}

let frame = null, bgCache = null;
export function drawDungeon(canvas, layout, tpl, opts = {}) {
  const W = CANVAS.w, H = CANVAS.h;
  if (!frame) frame = document.createElement('canvas');
  frame.width = W; frame.height = H;
  const ctx = frame.getContext('2d'); ctx.imageSmoothingEnabled = false;
  // cavern background
  if (!bgCache || bgCache.width !== W) {
    bgCache = document.createElement('canvas'); bgCache.width = W; bgCache.height = H;
    const b = bgCache.getContext('2d'); const img = b.createImageData(W, H); const d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const n = hash(x >> 2, y >> 2, 7) * 0.6 + hash(x, y, 3) * 0.4; const v = 14 + Math.floor(n * 26); const o = (y * W + x) * 4; d[o] = v; d[o + 1] = v; d[o + 2] = v + 4; d[o + 3] = 255; }
    b.putImageData(img, 0, 0);
    // crack lines
    b.strokeStyle = 'rgba(0,0,0,.6)'; b.lineWidth = 1;
    for (let i = 0; i < 40; i++) { let x = hash(i, 1, 9) * W, y = hash(1, i, 9) * H; b.beginPath(); b.moveTo(x, y); for (let s = 0; s < 6; s++) { x += (hash(i, s, 11) - 0.5) * 30; y += (hash(s, i, 13) - 0.5) * 30; b.lineTo(x, y); } b.stroke(); }
  }
  ctx.drawImage(bgCache, 0, 0);
  const links = new Set(layout.links);
  const has = (x, y) => !!layout.cells[key(x, y)];
  const open = (c, dx, dy) => links.has(key(c.x, c.y) + '|' + key(c.x + dx, c.y + dy));
  const cells = Object.values(layout.cells).sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x);
  const seed = layout.seed || 0;
  const reach = new Set(neighbours(layout.cells, links, playerCell(layout)).map(c => key(c.x, c.y)));
  // floors first, then walls and objects in depth order
  for (const c of cells) { const [cx, cy] = isoPos(c.x, c.y); floor(ctx, cx, cy, seed); if (reach.has(key(c.x, c.y)) && opts.showReach !== false) { ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(cx, cy - TH / 2 + 2); ctx.lineTo(cx + TW / 2 - 4, cy); ctx.lineTo(cx, cy + TH / 2 - 2); ctx.lineTo(cx - TW / 2 + 4, cy); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); } }
  for (const c of cells) {
    const [cx, cy] = isoPos(c.x, c.y);
    if (!open(c, -1, 0)) wall(ctx, cx, cy, 'nw', true, seed);
    if (!open(c, 0, -1)) wall(ctx, cx, cy, 'ne', true, seed);
    // objects
    const p = tpl?.color || 'B';
    const robes = { W: ['#d9d2b8', '#f0ead6'], U: ['#2f5f9c', '#5e8cc9'], B: ['#3a2d4a', '#5e4d75'], R: ['#a33a2a', '#d0604a'], G: ['#3f6f2f', '#6a9a4a'] }[p];
    if (c.type === 'monster' && !c.done) figure(ctx, cx, cy, robes[0], robes[1], robes[0], { badge: c.payload.guardian ? 'G' : c.payload.tier, guardian: c.payload.guardian });
    else if (c.type === 'treasure' && !c.done) treasure(ctx, cx, cy, c.payload.kind, seed);
    else if (c.type === 'riddle' && !c.done) scroll(ctx, cx, cy);
    else if (c.type === 'exit') { exitArch(ctx, cx, cy); label(ctx, cx, cy + 12, 'Exit'); }
    else if (c.type === 'entrance') label(ctx, cx, cy + 10, 'Entrance');
    if (c.x === layout.px && c.y === layout.py) figure(ctx, cx, cy, '#c8322a', '#e0604a', null, { legs: '#2f4f9c', staff: true });
    if (!open(c, 0, 1)) wall(ctx, cx, cy, 'sw', false, seed);
    if (!open(c, 1, 0)) wall(ctx, cx, cy, 'se', false, seed);
  }
  // banner
  ctx.font = 'bold 11px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const title = tpl?.name || 'Dungeon'; const sub = layout.status || '';
  const bw = Math.max(ctx.measureText(title).width, 90) + 24;
  px(ctx, W / 2 - bw / 2, 4, bw, 28, '#1d2a1b'); ctx.strokeStyle = '#6fa04a'; ctx.lineWidth = 1; ctx.strokeRect(W / 2 - bw / 2 + 0.5, 4.5, bw - 1, 27);
  ctx.fillStyle = '#e8ffd0'; ctx.fillText(title, W / 2, 13);
  ctx.font = '8px sans-serif'; ctx.fillStyle = '#9fe08a'; ctx.fillText(sub, W / 2, 25);
  canvas.width = W * 2; canvas.height = H * 2;
  const out = canvas.getContext('2d'); out.imageSmoothingEnabled = false; out.drawImage(frame, 0, 0, W * 2, H * 2);
}
