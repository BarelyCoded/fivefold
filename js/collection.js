// Collection import: parse card lists, fetch and compile definitions, index your own art.
import { fetchCards, cached, norm, tokenArt } from './scryfall.js';
import { compile, slug } from './cards.js';

// Accepts decklist-style text. Lines like:
//   4 Lightning Bolt      4x Lightning Bolt (M10)      Lightning Bolt,4      Lightning Bolt
export function parseList(text) {
  const out = new Map();
  for (let raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    if (/^(deck|sideboard|commander|maindeck)\b/i.test(line)) continue;
    let count = 1, name = line;
    let m;
    if ((m = line.match(/^(\d+)\s*x?\s+(.+)$/i))) { count = Number(m[1]); name = m[2]; }
    else if ((m = line.match(/^(.+?)\s*[,;\t]\s*(\d+)\s*$/))) { name = m[1]; count = Number(m[2]); }
    else if ((m = line.match(/^(\d+)\s*[,;\t]\s*(.+)$/))) { count = Number(m[1]); name = m[2]; }
    name = name.replace(/\s*\([^)]*\)\s*\S*\s*$/, '').replace(/\s+\*.*$/, '').replace(/"/g, '').trim();
    if (!name || /^(name|card|count|qty|quantity)$/i.test(name)) continue;
    out.set(name, (out.get(name) || 0) + count);
  }
  return [...out].map(([name, count]) => ({ name, count }));
}

const defCache = new Map();
export function defOf(name) {
  const n = norm(name);
  if (defCache.has(n)) return defCache.get(n);
  const raw = cached(name);
  const def = raw ? compile(raw) : null;
  defCache.set(n, def);
  return def;
}
export function forgetDefs() { defCache.clear(); }

// Fetch (if needed) and compile. Returns [{name, count, def, canonical}]
export async function importNames(entries, onProgress) {
  const names = entries.map(e => e.name);
  const cards = await fetchCards(names, onProgress);
  forgetDefs();
  return entries.map(e => {
    const raw = cards.get(norm(e.name));
    const def = raw ? compile(raw) : null;
    if (def) defCache.set(norm(raw.name), def);
    return { name: e.name, count: e.count, def, canonical: raw ? raw.name : null };
  });
}

// ---- art -----------------------------------------------------------------------
let artIndex = new Map(); // slug or scryfall id -> url
let serverSeen = false;   // true when server.js answered: the art folder and collection.csv exist only there
export const hasServer = () => serverSeen;
export async function loadArtIndex() {
  artIndex = new Map();
  try {
    const res = await fetch('api/art');   // relative: the site may live under a sub-path (GitHub Pages)
    if (!res.ok) return artIndex;
    const files = await res.json();
    serverSeen = true;
    for (const f of files) {
      const key = f.replace(/\.[^.]+$/, '').toLowerCase();
      artIndex.set(key, 'art/' + encodeURIComponent(f));
      artIndex.set(slug(key), 'art/' + encodeURIComponent(f));
    }
  } catch (e) { console.warn('art index failed', e); }
  return artIndex;
}
export function artFor(def) {
  if (!def) return null;
  if (def.token) return artIndex.get(slug(def.name)) || tokenArt(def);
  return artIndex.get(slug(def.name)) || (def.id && artIndex.get(def.id)) || def.image || null;
}
export function hasOwnArt(def) { return !!(artIndex.get(slug(def.name)) || (def.id && artIndex.get(def.id))); }
export function artCount() { return new Set(artIndex.values()).size; }
