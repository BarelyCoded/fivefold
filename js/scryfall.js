// Scryfall card lookup with a localStorage cache.
// Nothing is bundled: card data is fetched at runtime under Scryfall's API guidelines.

const KEY = 'ff.cardcache.v1';
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

// Keep only what the engine and UI need.
function trim(c) {
  const face = (c.card_faces && !c.mana_cost && c.card_faces[0]) || c;
  return {
    name: c.name, id: c.id, set: c.set, set_name: c.set_name,
    mana_cost: face.mana_cost || c.mana_cost || '',
    cmc: c.cmc || 0,
    type_line: face.type_line || c.type_line || '',
    oracle_text: face.oracle_text || c.oracle_text || '',
    power: face.power, toughness: face.toughness,
    colors: face.colors || c.colors || [],
    keywords: c.keywords || [],
    image: (face.image_uris || c.image_uris || {}).normal || null,
    scryfall_uri: c.scryfall_uri,
  };
}

// names: array of card names. Returns Map(norm(name) -> trimmed card | null)
export async function fetchCards(names, onProgress) {
  load();
  const wanted = [...new Set(names.map(norm))];
  const missing = wanted.filter(n => !(n in cache));
  for (let i = 0; i < missing.length; i += 75) {
    const batch = missing.slice(i, i + 75);
    // Scryfall requires an identifying User-Agent. Browsers ignore this header
    // (they send their own), Node honours it.
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Fivefold/0.1 (open-source card adventure demo)' },
      body: JSON.stringify({ identifiers: batch.map(name => ({ name })) }),
    });
    if (!res.ok) {
      let detail = ''; try { detail = (await res.json()).details || ''; } catch { /* ignore */ }
      throw new Error(`Scryfall returned ${res.status}${detail ? ': ' + detail : ''}`);
    }
    const data = await res.json();
    for (const c of data.data || []) cache[norm(c.name)] = trim(c);
    for (const n of batch) {
      if (n in cache) continue;
      // Requested a face name of a double-faced / split card, or a near-miss.
      const hit = (data.data || []).find(c => norm(c.name).split(' // ').includes(n));
      cache[n] = hit ? trim(hit) : null;
    }
    save();
    onProgress?.(Math.min(i + 75, missing.length), missing.length);
    if (i + 75 < missing.length) await new Promise(r => setTimeout(r, 120));
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
