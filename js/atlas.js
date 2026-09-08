// Sprite atlas over assets/tileset.png ("The Planeswalker's Complete Asset Bibliotheca").
// Every rectangle is [x, y, w, h] in sheet pixels, measured from the sheet's own grids:
// overworld tiles are 38px on a 39.5px pitch, dungeon tiles 37px, battle sprites 52px, figures 44x50.
export const SHEET = new URL('../assets/tileset.png', import.meta.url).href;
export const SHEET_W = 1187, SHEET_H = 896;

const OW = (c, r) => [Math.round(25 + 39.55 * c) + 2, Math.round(114 + 38.9 * r) + 2, 36, 35]; // inside the 3px grid seams
const DG = (c, r) => [Math.round(630 + 38.14 * c) + 2, Math.round(115 + 38.9 * r) + 2, 34, 35];
const EL = (c, r) => [Math.round(92 + 54.6 * c), 655 + 57 * r, 52, 52];   // left battle block: dragon, skeleton, serpent
const ER = (c, r) => [Math.round(447 + 54.5 * c), 655 + 57 * r, 50, 52];  // right battle block: golem, skeleton, spider, lizard
const PL = (c, r) => [676 + 47 * c, [655, 712, 770, 828][r], 44, 50];    // player and mage figures
const OB = (c, r) => [935 + 35 * c, [655, 691, 727, 763][r], 32, 32];    // objects
const NP = (c, r) => [935 + 40 * c, [797, 839][r], 40, 38];              // townsfolk
const CA = (c, r) => [[398, 465, 532][c], [113, 182, 250][r], 60, r === 2 ? 56 : 66]; // castles and towns

// Overworld ground by biome colour: common tiles and rarer accents.
export const TERRAIN = {
  G: { base: [OW(0, 0), OW(1, 0), OW(2, 0), OW(5, 0), OW(0, 1), OW(4, 1), OW(1, 2), OW(2, 2)], accent: [OW(3, 0), OW(4, 0), OW(1, 1), OW(2, 1), OW(3, 1), OW(0, 2)] },
  W: { base: [OW(7, 5), OW(8, 5), OW(2, 6), OW(3, 6), OW(4, 6), OW(5, 6), OW(0, 7), OW(1, 7), OW(2, 7)], accent: [OW(6, 6), OW(6, 5)] },
  U: { base: [OW(4, 8), OW(5, 8), OW(0, 8), OW(1, 8), OW(2, 8), OW(3, 8), OW(6, 7), OW(7, 7), OW(8, 7)], accent: [] },
  R: { base: [OW(2, 3), OW(3, 3), OW(4, 3), OW(5, 3), OW(6, 3), OW(7, 3), OW(0, 4), OW(1, 4)], accent: [OW(0, 3), OW(1, 3), OW(8, 3), OW(2, 4), OW(3, 4), OW(4, 4), OW(1, 5)] },
  B: { base: [OW(5, 4), OW(8, 4), OW(2, 5), OW(3, 5), OW(4, 5), OW(0, 6), OW(1, 6)], accent: [OW(6, 4), OW(7, 4), OW(0, 5), OW(5, 5)] },
  cobble: [OW(6, 10), OW(7, 10), OW(8, 10)],
  sand: [OW(5, 1), OW(6, 1), OW(3, 2)],
};

export const SPRITES = {
  city: { W: CA(0, 0), U: CA(0, 1), B: CA(1, 1), R: CA(2, 1), G: CA(0, 2), fortress: CA(1, 0), town: CA(1, 2), compass: CA(2, 2) },
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
let img = null, ready = false, failed = false, sheetUrl = SHEET;
const listeners = [];
// The sheet has no transparency: sprites sit in dark brown cells on a darker panel, both with slight
// gradients. Inside the sprite panels, every dark unsaturated pixel reachable from the panel edge is
// flood-filled to transparent; sprite outlines stop the fill, so dark pixels inside a sprite survive.
// The terrain and dungeon grids are left untouched.
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
    // sweep the speckles the fill left behind: dark pixels with almost no opaque neighbours
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
export function loadAtlas() {
  if (img || typeof Image === 'undefined') return;
  const raw = new Image();
  raw.onload = () => {
    try { img = keyOut(raw); sheetUrl = img.toDataURL('image/png'); } catch (e) { img = raw; }
    ready = true; for (const l of listeners) l();
  };
  raw.onerror = () => { failed = true; console.warn('Sprite sheet missing: ' + SHEET + ' (falling back to painted tiles)'); };
  img = raw; raw.src = SHEET;
}
export const atlasReady = () => ready;
export function onAtlas(fn) { listeners.push(fn); if (ready) fn(); }

// Draw a sprite rectangle into a canvas at dx,dy scaled to dw×dh (defaults to 1:1).
export function blit(ctx, rect, dx, dy, dw, dh) {
  if (!ready || !rect) return false;
  const [x, y, w, h] = rect;
  ctx.drawImage(img, x, y, w, h, Math.round(dx), Math.round(dy), Math.round(dw ?? w), Math.round(dh ?? h));
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
  const [x, y, w, h] = rect;
  return `width:${w * s}px;height:${h * s}px;background:url(${sheetUrl}) -${x * s}px -${y * s}px / ${SHEET_W * s}px ${SHEET_H * s}px no-repeat;image-rendering:pixelated;image-rendering:crisp-edges;`;
}
