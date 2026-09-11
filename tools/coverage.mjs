// Rules coverage report: compiles every card in the given sets and reports what the engine understands.
//   node tools/coverage.mjs era              -> Alpha through Alliances
//   node tools/coverage.mjs lea arn          -> specific set codes
//   node tools/coverage.mjs lea --list       -> also list unsupported / approximated cards with reasons
//   node tools/coverage.mjs era --patterns   -> most common ignored sentences (what to teach the parser next)
// Set data is cached in tools/.sets/ so repeated runs are offline.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const setDir = path.join(here, '.sets');
fs.mkdirSync(setDir, { recursive: true });
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { compile } = await import('../js/cards.js');

import { ERA, resolveSets } from './sets.mjs';
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const sets = resolveSets(args.filter(a => a !== 'era'), ERA);

async function fetchSet(code) {
  const file = path.join(setDir, code + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  let url = `https://api.scryfall.com/cards/search?q=set%3A${code}&unique=cards&order=name`;
  while (url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Fivefold/0.1 coverage tool', Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Scryfall ${res.status} for ${code}`);
    const data = await res.json();
    out.push(...data.data);
    url = data.has_more ? data.next_page : null;
    await new Promise(r => setTimeout(r, 120));
  }
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}
function trim(c) {
  const face = (c.card_faces && !c.mana_cost && c.card_faces[0]) || c;
  return { name: c.name, id: c.id, set: c.set, mana_cost: face.mana_cost || c.mana_cost || '', cmc: c.cmc || 0, type_line: face.type_line || c.type_line || '', oracle_text: face.oracle_text || c.oracle_text || '', power: face.power, toughness: face.toughness, colors: face.colors || c.colors || [], keywords: c.keywords || [], image: null };
}

const seen = new Set();
const totals = { total: 0, full: 0, approx: 0, unsupported: 0 };
const patterns = new Map();
const unsupportedReasons = new Map();
for (const code of sets) {
  let cards;
  try { cards = await fetchSet(code); } catch (e) { console.log(`${code}: ${e.message}`); continue; }
  const rows = [];
  for (const raw of cards) {
    if (raw.layout === 'token' || raw.type_line?.startsWith('Token') || /Conspiracy|Scheme|Plane —|Phenomenon|Vanguard/.test(raw.type_line || '')) continue;
    if (seen.has(raw.name)) continue;
    seen.add(raw.name);
    const d = compile(trim(raw));
    rows.push({ name: raw.name, d });
    for (const n of d.notes) {
      if (n.startsWith('Ignored: ')) { const key = n.slice(9).replace(/\d+/g, 'N').replace(/~/g, 'CARD').slice(0, 60); patterns.set(key, (patterns.get(key) || 0) + 1); }
    }
    if (d.status === 'unsupported') { const key = d.notes[0].replace(/\d+/g, 'N').slice(0, 60); unsupportedReasons.set(key, (unsupportedReasons.get(key) || 0) + 1); }
  }
  const c = { total: rows.length, full: rows.filter(r => r.d.status === 'full').length, approx: rows.filter(r => r.d.status === 'approx').length, unsupported: rows.filter(r => r.d.status === 'unsupported').length };
  for (const k of Object.keys(totals)) totals[k] += c[k];
  const playable = c.full + c.approx;
  console.log(`${code.toUpperCase().padEnd(4)} ${String(c.total).padStart(4)} cards  ready ${String(c.full).padStart(4)}  approx ${String(c.approx).padStart(4)}  unsupported ${String(c.unsupported).padStart(4)}   playable ${(100 * playable / c.total).toFixed(0).padStart(3)}%  exact ${(100 * c.full / c.total).toFixed(0).padStart(3)}%`);
  if (flags.has('--list')) {
    for (const r of rows.filter(r => r.d.status !== 'full').sort((a, b) => a.d.status.localeCompare(b.d.status) || a.name.localeCompare(b.name))) console.log(`   ${r.d.status === 'unsupported' ? 'X' : '~'} ${r.name.padEnd(32)} ${r.d.notes.join('; ').slice(0, 110)}`);
  }
}
if (sets.length > 1) {
  const playable = totals.full + totals.approx;
  console.log(`\nALL  ${String(totals.total).padStart(4)} distinct cards  ready ${totals.full}  approx ${totals.approx}  unsupported ${totals.unsupported}   playable ${(100 * playable / totals.total).toFixed(0)}%  exact ${(100 * totals.full / totals.total).toFixed(0)}%`);
}
if (flags.has('--patterns')) {
  console.log('\nMost common ignored sentences:');
  for (const [k, n] of [...patterns].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log('\nUnsupported reasons:');
  for (const [k, n] of [...unsupportedReasons].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(4)}  ${k}`);
}
