// Fetch Scryfall card data for a group of sets and cache it under tools/.sets/<code>.json — the offline
// card database the node tests, coverage report and power-tiers builder all read.
//
//   node tools/fetch-sets.mjs premodern      # every Premodern-legal set (default)
//   node tools/fetch-sets.mjs mir vis tmp    # specific set codes
//   node tools/fetch-sets.mjs premodern --force   # refetch even sets already on disk
//
// Requires outbound access to api.scryfall.com. Run it wherever Scryfall is reachable, then commit the
// resulting tools/.sets/*.json so downstream tools and tests can run offline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSets, PREMODERN } from './sets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const setDir = path.join(here, '.sets');
fs.mkdirSync(setDir, { recursive: true });

const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const sets = resolveSets(args, PREMODERN);
const force = flags.has('--force');
const UA = 'Fivefold/0.1 (open-source card game; set-fetch tool)';

async function fetchSet(code) {
  const file = path.join(setDir, code + '.json');
  if (fs.existsSync(file) && !force) return { code, cached: true, n: JSON.parse(fs.readFileSync(file, 'utf8')).length };
  const out = [];
  let url = `https://api.scryfall.com/cards/search?q=set%3A${encodeURIComponent(code)}+unique%3Aprints&unique=cards&order=set`;
  while (url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 404) return { code, empty: true };   // no such set / no cards
    if (!res.ok) throw new Error(`Scryfall ${res.status} for ${code}`);
    const data = await res.json();
    out.push(...data.data);
    url = data.has_more ? data.next_page : null;
    await new Promise(r => setTimeout(r, 120));              // be polite to the API
  }
  fs.writeFileSync(file, JSON.stringify(out));
  return { code, n: out.length };
}

let ok = 0, failed = 0;
for (const code of sets) {
  try {
    const r = await fetchSet(code);
    if (r.empty) { console.log(`${code}: no cards found`); failed++; }
    else { console.log(`${code}: ${r.n} cards${r.cached ? ' (cached)' : ''}`); ok++; }
  } catch (e) { console.log(`${code}: ${e.message}`); failed++; }
}
console.log(`\n${ok} sets ready, ${failed} failed. Cached in tools/.sets/`);
process.exit(failed ? 1 : 0);
