// Build the Premodern card pool (content/premodern-pool.json) from the offline set dumps in tools/.sets/.
// Only the format's legal sets are read (content/premodern.json), so old-school sets present in .sets
// (Arabian Nights, Legends, …) are excluded. Every legal card is compiled by the rules engine and grouped
// by colour, each tagged with whether the engine can actually play it (supported) or only approximates it.
//
//   node tools/build-catalog.mjs            # write content/premodern-pool.json
//   node tools/build-catalog.mjs --report   # just print the summary, write nothing
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const { compile } = await import('../js/cards.js');

const trim = c => { const f = c.card_faces?.[0] || c; return { name: c.name, id: c.id, set: c.set, mana_cost: f.mana_cost || c.mana_cost || '', cmc: c.cmc ?? 0, type_line: f.type_line || c.type_line || '', oracle_text: f.oracle_text || c.oracle_text || '', power: f.power, toughness: f.toughness, colors: f.colors || c.colors || [], keywords: c.keywords || [], rarity: c.rarity }; };
const bucketOf = d => d.kind === 'land' ? 'L' : d.colors.length === 0 ? 'C' : d.colors.length > 1 ? 'M' : d.colors[0];

// Build the pool from whichever legal sets are present in tools/.sets/. Returns { pool, present, missing }.
export function buildPool() {
  const fmt = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/premodern.json'), 'utf8'));
  const legal = new Set(fmt.sets);
  const banned = new Set(fmt.banned || []);
  const setDir = path.join(here, '.sets');
  const files = fs.existsSync(setDir) ? fs.readdirSync(setDir).filter(f => f.endsWith('.json')) : [];
  const present = new Set(), byName = new Map();
  for (const f of files) {
    const code = f.replace(/\.json$/, '');
    if (!legal.has(code)) continue;                       // skip non-Premodern sets in .sets
    present.add(code);
    for (const raw of JSON.parse(fs.readFileSync(path.join(setDir, f), 'utf8'))) {
      if (raw.layout === 'token' || /Token|Conspiracy|Scheme|Plane —|Phenomenon|Vanguard/.test(raw.type_line || '')) continue;
      if (byName.has(raw.name) || banned.has(raw.name)) continue;
      byName.set(raw.name, raw);
    }
  }
  const pool = { W: [], U: [], B: [], R: [], G: [], M: [], C: [], L: [] };
  for (const raw of byName.values()) {
    const d = compile(trim(raw));
    const supported = d.kind !== 'unsupported';
    const approx = supported && (d.notes || []).some(n => n.startsWith('Ignored: '));
    const TYPES = ['Creature', 'Land', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker'];
    const t = (TYPES.find(x => d.types.includes(x)) || d.types[0] || 'Other').toLowerCase();
    pool[bucketOf(d)].push({ name: raw.name, cmc: d.cmc ?? 0, t, supported, approx });
  }
  for (const k of Object.keys(pool)) pool[k].sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name));
  const missing = fmt.sets.filter(c => !present.has(c));
  return { pool, present: [...present], missing, banned: [...banned] };
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { pool, present, missing } = buildPool();
const total = Object.values(pool).reduce((a, l) => a + l.length, 0);
const supp = Object.values(pool).flat().filter(c => c.supported).length;
console.log(`Premodern pool: ${total} cards across ${present.length} of 29 legal sets — ${supp} playable (${Math.round(100 * supp / total)}%).`);
console.log('present:', present.join(' ') || '(none)');
if (missing.length) console.log(`missing ${missing.length} sets (run tools/fetch-sets.mjs premodern): ${missing.join(' ')}`);
for (const [k, label] of [['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green'], ['M', 'Multicolor'], ['C', 'Colorless'], ['L', 'Lands']]) console.log(`  ${label.padEnd(10)} ${pool[k].length}`);
if (!process.argv.includes('--report')) {
  fs.writeFileSync(path.join(ROOT, 'content/premodern-pool.json'), JSON.stringify({ generated: present.length, pool }));
  console.log('wrote content/premodern-pool.json');
}
}
