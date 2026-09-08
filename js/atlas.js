// Sprite atlas over assets/tileset.png ("The Planeswalker's Complete Asset Bibliotheca").
// Every rectangle is [x, y, w, h] in sheet pixels, measured from the sheet's own grids:
// overworld tiles are 38px on a 39.5px pitch, dungeon tiles 37px, battle sprites 52px, figures 44x50.
export const SHEET = new URL('../assets/tileset.png', import.meta.url).href;
export const SHEET_W = 1187, SHEET_H = 896;

const OW = (c, r) => [Math.round(25 + 39.55 * c) + 4, Math.round(114 + 38.9 * r) + 4, 32, 31]; // inside the grid seams and the tiles' lighter rims
const DG = (c, r) => [Math.round(630 + 38.14 * c) + 2, Math.round(115 + 38.9 * r) + 2, 34, 35];
const EL = (c, r) => [Math.round(92 + 54.6 * c), 655 + 57 * r, 52, 52];   // left battle block: dragon, skeleton, serpent
const ER = (c, r) => [Math.round(447 + 54.5 * c), 655 + 57 * r, 50, 52];  // right battle block: golem, skeleton, spider, lizard
const PL = (c, r) => [676 + 47 * c, [655, 712, 770, 828][r], 44, 50];    // player and mage figures
const OB = (c, r) => [935 + 35 * c, [655, 691, 727, 763][r], 32, 32];    // objects
const NP = (c, r) => [935 + 40 * c, [797, 839][r], 40, 38];              // townsfolk
const CA = (c, r) => [[398, 465, 532][c], [113, 182, 250][r], 60, r === 2 ? 56 : 66]; // castles and towns

// Overworld ground by biome colour: common tiles and rarer accents.
// Share of cells that take an accent tile, per biome.
export const ACCENT_RATE = { G: 0.18, W: 0.07, U: 0, R: 0.16, B: 0.2 };
export const TERRAIN = {
  G: { base: [OW(0, 0), OW(1, 0), OW(2, 0), OW(5, 0), OW(0, 1), OW(4, 1), OW(1, 2), OW(2, 2)], accent: [OW(3, 0), OW(4, 0), OW(1, 1), OW(2, 1), OW(3, 1), OW(0, 2)] },
  W: { base: [OW(5, 1), OW(6, 1), OW(3, 2), OW(7, 0)], accent: [] },
  snow: { base: [OW(7, 5), OW(8, 5), OW(2, 6), OW(3, 6), OW(4, 6), OW(5, 6), OW(0, 7), OW(1, 7), OW(2, 7)], accent: [OW(6, 6), OW(6, 5)] },
  U: { base: [OW(0, 8), OW(1, 8), OW(2, 8), OW(3, 8), OW(4, 8), OW(5, 8)], accent: [] },
  // mountains: dark rock ground with volcanoes and lava as accents; the peaks themselves are scattered sprites
  R: { base: [OW(5, 4), OW(8, 4), OW(2, 5), OW(3, 5), OW(4, 5)], accent: [OW(2, 4), OW(3, 4), OW(4, 4), OW(1, 5), OW(0, 4), OW(1, 4), OW(8, 3)] },
  // wastes: cracked rock veined with lava
  B: { base: [OW(5, 4), OW(8, 4), OW(2, 5), OW(0, 6), OW(1, 6), OW(6, 4), OW(7, 4)], accent: [OW(0, 5), OW(5, 5), OW(3, 5)] },
  cobble: [OW(6, 10), OW(7, 10), OW(8, 10)],
  sand: [OW(5, 1), OW(6, 1), OW(3, 2)],
};

// Scenery cut out of terrain tiles at load time (flood-keyed against each tile's own background).
const OWS = (c, r) => [Math.round(25 + 39.55 * c) + 2, Math.round(114 + 38.9 * r) + 2, 36, 35]; // wider crop so the tile's own background rims the sprite
export const SCENERY = { peaks: [OWS(3, 3), OWS(4, 3)], rocks: [OWS(6, 5)], dunes: [OWS(7, 1), OWS(8, 1), OWS(4, 2), OWS(5, 2), OWS(6, 2)] };

export const SPRITES = {
  city: { W: [410, 116, 38, 61], U: [401, 184, 57, 60], B: [466, 184, 62, 62], R: [536, 192, 53, 46], G: [401, 254, 57, 48], fortress: [471, 121, 49, 59], grand: [533, 114, 59, 75], town: [469, 253, 55, 49], compass: [532, 254, 61, 49] },
  // scenery for the overworld
  pines: [390, 388, 76, 64], oak: [538, 386, 51, 61], sapling: [474, 419, 30, 31], bush: [506, 426, 35, 30], pine: [392, 464, 42, 70], bushSmall: [439, 476, 29, 22], roundTree: [474, 464, 31, 35], shrub: [434, 505, 38, 33], tuft: [480, 520, 18, 12],
  pond: [465, 348, 62, 35], riverBend: [538, 310, 47, 70],
  pit: [979, 270, 61, 63], lavaPool: [1052, 270, 60, 63],
  gate: [979, 118, 61, 68], door: [979, 196, 61, 66], doorArch: [1052, 117, 60, 69], portal: [1052, 194, 60, 68],
  torch: [984, 469, 12, 33], keyGold: [1011, 464, 26, 48], keySilver: [1085, 464, 27, 50],
  hero: PL(0, 0), heroBack: PL(3, 0),
  mage: { W: [PL(0, 1), PL(0, 2)], U: [PL(3, 2), PL(2, 3)], B: [PL(1, 1), PL(1, 3)], R: [PL(3, 3), PL(0, 3)], G: [PL(2, 1), PL(4, 1)], M: [PL(4, 2), PL(4, 2)] },
  chest: OB(0, 0), chestOpen: OB(3, 0), chestSmall: OB(1, 1), crystal: OB(4, 2), scroll: OB(5, 2), skull: OB(1, 2), potion: OB(0, 3), amulet: OB(3, 1), shield: OB(4, 3),
  folk: [NP(0, 0), NP(1, 0), NP(2, 0), NP(3, 0), NP(4, 0), NP(5, 0), NP(0, 1), NP(1, 1), NP(2, 1), NP(3, 1), NP(4, 1)],
};

// Battle sprites: idle frames cycle; attack frames play when the creature strikes.
export const MONSTERS = {
  dragon: { idle: [EL(0, 0), EL(1, 0)], attack: [EL(2, 0)], breath: EL(3, 0), scale: 1 },
  golem: { idle: [ER(0, 0), ER(1, 0)], attack: [ER(2, 0), ER(3, 0)] },
  skeleton: { idle: [EL(0, 2), EL(1, 2)], attack: [EL(2, 2), EL(3, 2)], dead: ER(3, 1) },
  serpent: { idle: [EL(0, 3), EL(1, 3)], attack: [EL(2, 3)], dead: EL(3, 3) },
  spider: { idle: [ER(0, 2), ER(1, 2)], attack: [ER(2, 2)] },
  lizard: { idle: [ER(0, 3), ER(1, 3)], attack: [ER(2, 3)] },
};
// Which monster guards each dungeon colour.
export const DUNGEON_MONSTER = { W: 'golem', U: 'serpent', B: 'skeleton', R: 'lizard', G: 'spider' };

export const DUNGEON_TILES = {
  floor: [DG(0, 7), DG(1, 7), DG(2, 7), DG(3, 7), DG(0, 9), DG(1, 9), DG(2, 9), DG(3, 9)],
  rock: [DG(0, 6), DG(5, 7), DG(6, 7), DG(5, 9), DG(5, 10), DG(6, 10)],
  rockCrack: [DG(1, 6), DG(2, 6), DG(3, 6)],
  lava: [DG(0, 8), DG(1, 8), DG(2, 8)],
  wallTop: [DG(0, 0), DG(1, 0), DG(2, 0), DG(3, 0), DG(4, 0)],
  wallFace: [DG(0, 4), DG(1, 4), DG(2, 4)],
  grate: DG(1, 5),
};

// ---- loading ----------------------------------------------------------------------
// images[0] is the Bibliotheca sheet (keyed at load). Extra sheets come from assets/atlas.json,
// written by tools/pack.py from one-image-per-sprite sources; their entries replace the slots above.
// A rectangle's optional fifth element is the index of the image it lives in.
const images = [];   // { url, img, pixels }
let ready = false, failed = false;
const listeners = [];
const KEY_REGIONS = [[388, 112, 600, 548], [975, 112, 1175, 548], [0, 645, 1187, 896]];
// Background pixels are warm brown: red a little above green, green a little above blue.
const bgLike = (r, g, b) => r >= 18 && r <= 84 && r - g >= 1 && r - g <= 12 && r - b >= 6 && r - b <= 22 && g - b >= 0 && g - b <= 12;
function keyOut(image) {
  const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
  for (const [x0, y0, x1, y1] of KEY_REGIONS) {
    const w = x1 - x0, h = y1 - y0;
    const id = ctx.getImageData(x0, y0, w, h); const d = id.data;
    const seen = new Uint8Array(w * h); const stack = [];
    const push = (x, y) => { const i = y * w + x; if (seen[i]) return; seen[i] = 1; if (bgLike(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) stack.push(i); };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (stack.length) {
      const i = stack.pop(); d[i * 4 + 3] = 0;
      const x = i % w, y = (i - x) / w;
      if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
    }
    const alpha = i => d[i * 4 + 3];
    for (let pass = 0; pass < 2; pass++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!alpha(i) || Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) > 96) continue;
      let clear = 0; if (x === 0 || !alpha(i - 1)) clear++; if (x === w - 1 || !alpha(i + 1)) clear++; if (y === 0 || !alpha(i - w)) clear++; if (y === h - 1 || !alpha(i + w)) clear++;
      if (clear >= 3) d[i * 4 + 3] = 0;
    }
    ctx.putImageData(id, x0, y0);
  }
  return c;
}
// Key one tile against its own border colour (for peaks and rocks that sit on flat tile backgrounds).
function keyTile(ctx, [x0, y0, w, h], tol) {
  const id = ctx.getImageData(x0, y0, w, h); const d = id.data;
  const border = [];
  for (let x = 0; x < w; x++) border.push(0 + x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const med = ch => { const v = border.map(i => d[i * 4 + ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg = [med(0), med(1), med(2)];
  const seen = new Uint8Array(w * h); const stack = [];
  const push = (x, y) => { const i = y * w + x; if (seen[i]) return; seen[i] = 1; if (Math.abs(d[i * 4] - bg[0]) <= tol && Math.abs(d[i * 4 + 1] - bg[1]) <= tol && Math.abs(d[i * 4 + 2] - bg[2]) <= tol) stack.push(i); };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) { const i = stack.pop(); d[i * 4 + 3] = 0; const x = i % w, y = (i - x) / w; if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1); }
  ctx.putImageData(id, x0, y0);
}
const loadImage = url => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('missing ' + url)); im.src = url; });

export function loadAtlas() {
  if (images.length || typeof Image === 'undefined') return;
  images.push({ url: SHEET, img: null, pixels: null });
  const main = loadImage(SHEET).then(raw => {
    try {
      const c = keyOut(raw);
      const kctx = c.getContext('2d', { willReadFrequently: true });
      for (const list of Object.values(SCENERY)) for (const rect of list) keyTile(kctx, rect, 30);
      images[0].img = c; images[0].url = c.toDataURL('image/png');
    } catch (e) { images[0].img = raw; }
  }).catch(e => { failed = true; console.warn('Sprite sheet missing: ' + SHEET + ' (falling back to painted tiles)'); });
  const extra = fetch(new URL('../assets/atlas.json', import.meta.url)).then(r => r.ok ? r.json() : null).catch(() => null).then(async index => {
    if (!index) return;
    const files = new Map();
    for (const [key, e] of Object.entries(index)) {
      if (!files.has(e.file)) { const url = new URL('../assets/' + e.file, import.meta.url).href; files.set(e.file, { url, idx: images.length }); images.push({ url, img: null, pixels: null }); }
    }
    await Promise.all([...files.values()].map(f => loadImage(f.url).then(im => { images[f.idx].img = im; }).catch(() => {})));
    const lists = new Map();
    for (const [key, e] of Object.entries(index)) { const f = files.get(e.file); if (images[f.idx].img) applyEntry(key, [...e.rect, f.idx], lists); }
    for (const [target, list] of lists) { const [obj, prop] = target; obj[prop] = list.sort((a, b) => a.n - b.n).map(x => x.rect); }
  });
  Promise.all([main, extra]).then(() => { ready = !failed || images.length > 1; for (const l of listeners) l(); });
}
// Route a packed sprite (key from tools/pack.py) into the slot the renderers read.
const TERRAIN_SLOT = { grass: ['G', 'base'], sand: ['W', 'base'], sea: ['U', 'base'], shallow: [null, 'sand'], darkrock: ['B', 'base'], lava: ['B', 'accent'], greyrock: ['R', 'base'], snow: ['snow', 'base'], cobbles: [null, 'cobble'] };
function applyEntry(key, rect, lists) {
  const [cat, rest] = key.split('.', 2); if (!rest) return;
  const parts = rest.split('-'); const last = parts[parts.length - 1]; const n = /^\d+$/.test(last) ? Number(last) : 0; const name = n ? parts.slice(0, -1).join('-') : rest;
  const push = (obj, prop) => { const k = [obj, prop]; let found = null; for (const kk of lists.keys()) if (kk[0] === obj && kk[1] === prop) found = kk; if (!found) lists.set(k, []); (lists.get(found || k)).push({ n, rect }); };
  switch (cat) {
    case 'terrain': { const slot = TERRAIN_SLOT[name]; if (!slot) return; if (slot[0]) push(TERRAIN[slot[0]], slot[1]); else push(TERRAIN, slot[1]); if (name === 'lava') push(TERRAIN.R, 'accent'); return; }
    case 'scenery': { if (/^peak/.test(name)) push(SCENERY, 'peaks'); else if (/^(rock|boulder)/.test(name)) push(SCENERY, 'rocks'); else if (/^dune/.test(name)) push(SCENERY, 'dunes'); else SPRITES[name] = rect; return; }
    case 'locations': { const m = name.match(/^city-([WUBRG])$/); if (m) SPRITES.city[m[1]] = rect; else if (['fortress', 'town', 'compass', 'grand'].includes(name)) SPRITES.city[name] = rect; else if (name === 'pit-cleared') SPRITES.pitCleared = rect; else if (name === 'crystal-taken') SPRITES.crystalTaken = rect; else SPRITES[name] = rect; return; }
    case 'figures': { const m = rest.match(/^mage-([WUBRG])-(\d)$/); if (m) SPRITES.mage[m[1]][Number(m[2]) - 1] = rect; else if (rest === 'usurper') SPRITES.mage.M = [rect, rect]; else SPRITES[name] = rect; return; }
    case 'townsfolk': push(SPRITES, 'folk'); return;
    case 'monsters': { const m = rest.match(/^([a-z]+)-(idle|attack|hurt|dead|effect)(?:-(\d+))?$/); if (!m) return; const mo = (MONSTERS[m[1]] ||= { idle: [], attack: [] }); if (m[2] === 'effect') mo.breath = rect; else if (m[2] === 'hurt' || m[2] === 'dead') mo[m[2]] = rect; else push(mo, m[2]); return; }
    case 'dungeon': { const lname = name.toLowerCase(); const slot = { floor: 'floor', rock: 'rock', rockcrack: 'rockCrack', lava: 'lava', walltop: 'wallTop', wallface: 'wallFace' }[lname]; if (slot) push(DUNGEON_TILES, slot); else if (lname === 'grate') DUNGEON_TILES.grate = rect; else SPRITES[name] = rect; return; }
    case 'ui': (SPRITES.ui ||= {})[name] = rect; return;
  }
}
export const atlasReady = () => ready;
export function onAtlas(fn) { listeners.push(fn); if (ready) fn(); }

// Raw pixels of the sheet a rectangle lives in, for painters that sample textures per pixel.
export function sheetPixels(rect) {
  const im = images[rect?.[4] || 0]; if (!ready || !im?.img) return null;
  if (!im.pixels) {
    let src = im.img;
    if (!(src instanceof HTMLCanvasElement)) { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); src = c; }
    im.pixels = { data: src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height).data, w: src.width };
  }
  return im.pixels;
}

// Draw a sprite rectangle into a canvas at dx,dy scaled to dw×dh (defaults to 1:1).
export function blit(ctx, rect, dx, dy, dw, dh) {
  if (!ready || !rect) return false;
  const im = images[rect[4] || 0]?.img; if (!im) return false;
  const [x, y, w, h] = rect;
  ctx.drawImage(im, x, y, w, h, Math.round(dx), Math.round(dy), Math.round(dw ?? w), Math.round(dh ?? h));
  return true;
}
// Draw a sprite centred on (cx, cy) with its feet at `bottom` (a y coordinate), scaled by `s`.
export function blitAt(ctx, rect, cx, bottom, s = 1) {
  if (!rect) return false;
  const [, , w, h] = rect;
  return blit(ctx, rect, cx - w * s / 2, bottom - h * s, w * s, h * s);
}
// Pick one rectangle from a list deterministically.
export const pick = (list, t) => list[Math.floor(Math.min(0.999999, Math.max(0, t)) * list.length)];

// Inline style for showing a sprite in the DOM as a CSS background (used by the duel screen).
export function spriteStyle(rect, s = 2) {
  const [x, y, w, h] = rect; const im = images[rect[4] || 0] || { url: SHEET, img: null };
  const sw = im.img?.width || SHEET_W, sh = im.img?.height || SHEET_H;
  return `width:${w * s}px;height:${h * s}px;background:url(${im.url}) -${x * s}px -${y * s}px / ${sw * s}px ${sh * s}px no-repeat;image-rendering:pixelated;image-rendering:crisp-edges;`;
}
