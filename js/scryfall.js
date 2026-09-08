// Scryfall card lookup with a localStorage cache.
// Nothing is bundled: card data is fetched at runtime under Scryfall's API guidelines.
//
// Rules text comes from the current Oracle wording (the collection endpoint's default printing).
// Art comes from the card's EARLIEST paper printing, so Alpha cards show Alpha art and
// Ice Age cards show Ice Age art rather than a modern reprint.

const KEY = 'ff.cardcache.v2';
const HEADERS = { 'Accept': 'application/json', 'User-Agent': 'Fivefold/0.1 (open-source card adventure demo)' };
const pause = ms => new Promise(r => setTimeout(r, ms));
let cache = null;

function load() {
  if (!cache) {
    try { cache = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { cache = {}; }
  }
  return cache;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { console.warn('cache save failed', e); }
}

export function norm(n) {
  return String(n).trim().toLowerCase().replace(/\s+/g, ' ');
}
const imageOf = c => ((c.card_faces && !c.image_uris && c.card_faces[0]?.image_uris) || c.image_uris || {}).normal || null;

// Keep only what the engine and UI need.
function trim(c) {
  const face = (c.card_faces && !c.mana_cost && c.card_faces[0]) || c;
  return {
    name: c.name, id: c.id, set: c.set, set_name: c.set_name, released: c.released_at,
    mana_cost: face.mana_cost || c.mana_cost || '',
    cmc: c.cmc || 0,
    type_line: face.type_line || c.type_line || '',
    oracle_text: face.oracle_text || c.oracle_text || '',
    power: face.power, toughness: face.toughness,
    colors: face.colors || c.colors || [],
    keywords: c.keywords || [],
    image: imageOf(c),
    art_set: c.set, art_year: (c.released_at || '').slice(0, 4),
    scryfall_uri: c.scryfall_uri,
  };
}

async function getJson(url, init) {
  const res = await fetch(url, { ...init, headers: { ...HEADERS, ...(init?.headers || {}) } });
  if (!res.ok) {
    if (res.status === 404) return null;
    let detail = ''; try { detail = (await res.json()).details || ''; } catch { /* ignore */ }
    throw new Error(`Scryfall returned ${res.status}${detail ? ': ' + detail : ''}`);
  }
  return res.json();
}

// Find the earliest paper printing for a set of names. Returns Map(norm(name) -> card json).
async function earliestPrintings(names, onProgress) {
  const out = new Map();
  const todo = names.slice();
  let done = 0;
  // Batched: several names per search, sorted oldest first, first page only.
  while (todo.length) {
    const batch = todo.splice(0, 8);
    onProgress?.(done, names.length, 'art'); done += batch.length;
    const q = `(${batch.map(n => `!"${n.replace(/"/g, '')}"`).join(' or ')}) game:paper -is:funny`;
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released&dir=asc`;
    let data = null;
    try { data = await getJson(url); } catch (e) { console.warn('art search failed', e); }
    for (const c of data?.data || []) { const k = norm(c.name); if (!out.has(k) && imageOf(c)) out.set(k, c); }
    await pause(120);
  }
  // Anything with many printings may have been pushed off the first page: look it up alone.
  for (const n of names) {
    if (out.has(n)) continue;
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`!"${n.replace(/"/g, '')}" game:paper`)}&unique=prints&order=released&dir=asc`;
    let data = null;
    try { data = await getJson(url); } catch (e) { console.warn('art search failed', e); }
    const c = (data?.data || []).find(x => imageOf(x));
    if (c) out.set(n, c);
    await pause(120);
  }
  return out;
}

// names: array of card names. Returns Map(norm(name) -> trimmed card | null)
export async function fetchCards(names, onProgress) {
  load();
  const wanted = [...new Set(names.map(norm))];
  const missing = wanted.filter(n => !(n in cache));
  for (let i = 0; i < missing.length; i += 75) {
    const batch = missing.slice(i, i + 75);
    const data = await getJson('https://api.scryfall.com/cards/collection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch.map(name => ({ name })) }),
    });
    for (const c of data.data || []) cache[norm(c.name)] = trim(c);
    for (const n of batch) {
      if (n in cache) continue;
      const hit = (data.data || []).find(c => norm(c.name).split(' // ').includes(n));
      cache[n] = hit ? trim(hit) : null;
    }
    save();
    onProgress?.(Math.min(i + 75, missing.length), missing.length, 'cards');
    if (i + 75 < missing.length) await pause(120);
  }
  // Era-appropriate art: swap in the earliest printing's image for anything not yet checked.
  const needArt = wanted.filter(n => cache[n] && !cache[n].artChecked);
  if (needArt.length) {
    onProgress?.(0, needArt.length, 'art');
    const found = await earliestPrintings(needArt, onProgress);
    for (const n of needArt) {
      const c = cache[n]; const e = found.get(n) || found.get(norm(c.name));
      if (e) { c.image = imageOf(e); c.art_set = e.set; c.art_year = (e.released_at || '').slice(0, 4); }
      c.artChecked = true;
    }
    save();
    onProgress?.(needArt.length, needArt.length, 'art');
  }
  const out = new Map();
  for (const n of wanted) out.set(n, cache[n] ?? null);
  return out;
}

export function cached(name) {
  load();
  return cache[norm(name)] ?? null;
}

export function cacheSize() { return Object.keys(load()).length; }
export function clearCache() { cache = {}; save(); }

// ---- token art ----------------------------------------------------------------------
// Tokens are made by the engine, not fetched, so their pictures are looked up separately by
// type line, colour and size: the oldest paper token that matches. Cached in localStorage.
const TOKEN_KEY = 'ff.tokens.v1';
let tokenCache = null;
const tokenPending = new Set();
const tokenListeners = [];
function loadTokens() { if (!tokenCache) { try { tokenCache = JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}'); } catch { tokenCache = {}; } } return tokenCache; }
export const tokenKey = def => `${(def.subtypes || []).join(' ')}|${(def.colors || []).join('')}|${def.power}/${def.toughness}`;
export function onTokenArt(fn) { tokenListeners.push(fn); }
// Synchronous: the cached image URL, or null while a lookup runs in the background.
export function tokenArt(def) {
  const cache = loadTokens(); const key = tokenKey(def);
  if (key in cache) return cache[key];
  if (!tokenPending.has(key)) { tokenPending.add(key); fetchTokenArt(def, key); }
  return null;
}
async function fetchTokenArt(def, key) {
  const cache = loadTokens();
  const subs = (def.subtypes || []).filter(Boolean);
  const colors = def.colors || [];
  const parts = ['t:token', 't:creature', 'game:paper', ...subs.map(s => `t:"${s}"`), colors.length ? `c=${colors.join('').toLowerCase()}` : 'c=c'];
  if (Number.isFinite(def.power)) parts.push(`pow=${def.power}`);
  if (Number.isFinite(def.toughness)) parts.push(`tou=${def.toughness}`);
  let url = null;
  try {
    for (const q of [parts.join(' '), parts.filter(x => !x.startsWith('pow') && !x.startsWith('tou')).join(' ')]) {
      const data = await getJson(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=art&order=released&dir=asc`);
      const hit = (data?.data || []).find(c => imageOf(c));
      if (hit) { url = imageOf(hit); break; }
    }
  } catch (e) { console.warn('token art lookup failed', e); }
  cache[key] = url;
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  tokenPending.delete(key);
  for (const l of tokenListeners) l(key, url);
}
