// Where the rules engine loses the most Premodern cards, ranked so each fix covers the most cards.
// Compiles every Premodern-legal card and groups the sentences the compiler could not read
// (Ignored / Approximated notes) by a normalised phrase, newest-frequency first, with example cards.
//   node tools/premodern-gaps.mjs             # top ignored + approximated phrases, and unsupported reasons
//   node tools/premodern-gaps.mjs --phrase "untap up to"   # every card whose notes contain this text
//   node tools/premodern-gaps.mjs --unsupported            # only the unsupported-card reasons
//   node tools/premodern-gaps.mjs --csv > gaps.csv         # one row per (card, note) for a spreadsheet
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const { compile } = await import('../js/cards.js');
const args = process.argv.slice(2);
const flag = f => args.includes(f);
const phrase = (() => { const i = args.indexOf('--phrase'); return i >= 0 ? (args[i + 1] || '').toLowerCase() : null; })();

const fmt = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/premodern.json'), 'utf8'));
const legal = new Set(fmt.sets), banned = new Set(fmt.banned || []);
const setDir = path.join(here, '.sets');
const trim = c => { const f = c.card_faces?.[0] || c; return { name: c.name, id: c.id, set: c.set, mana_cost: f.mana_cost || c.mana_cost || '', cmc: c.cmc ?? 0, type_line: f.type_line || c.type_line || '', oracle_text: f.oracle_text ?? c.oracle_text ?? '', colors: f.colors || c.colors || [], keywords: c.keywords || [], power: f.power, toughness: f.toughness, rarity: c.rarity, image_uris: null }; };

// One entry per distinct card name across the legal sets.
const byName = new Map();
for (const f of fs.existsSync(setDir) ? fs.readdirSync(setDir) : []) {
  const code = f.replace(/\.json$/, ''); if (!legal.has(code)) continue;
  for (const raw of JSON.parse(fs.readFileSync(path.join(setDir, f), 'utf8'))) {
    if (raw.layout === 'token' || /Token|Conspiracy|Scheme|Plane —|Phenomenon|Vanguard/.test(raw.type_line || '')) continue;
    if (banned.has(raw.name) || byName.has(raw.name)) continue;
    byName.set(raw.name, raw);
  }
}

// Normalise a note to a phrase key so the same wording across cards collapses into one bucket.
const norm = s => s.replace(/^(Ignored|Approximated): /, '').replace(/\{[^}]+\}/g, '{M}').replace(/\b\d+\b/g, 'N').replace(/~/g, 'CARD').trim().slice(0, 70);
const kind = s => s.startsWith('Ignored') ? 'ignored' : s.startsWith('Approximated') ? 'approx' : 'other';

const buckets = { ignored: new Map(), approx: new Map() };   // phrase -> { n, cards:[] }
const unsupported = new Map();
const csv = [];
let full = 0, approxN = 0, unsup = 0, total = 0;
for (const [name, raw] of byName) {
  total++;
  let d; try { d = compile(trim(raw)); } catch (e) { unsupported.set('THREW: ' + e.message.slice(0, 50), (unsupported.get('THREW: ' + e.message.slice(0, 50)) || 0) + 1); continue; }
  if (d.status === 'full') full++; else if (d.status === 'approx') approxN++; else unsup++;
  if (d.status === 'unsupported') { const key = (d.notes[0] || 'no note').replace(/\d+/g, 'N').slice(0, 60); const e = unsupported.get(key) || { n: 0, cards: [] }; e.n++; if (e.cards.length < 6) e.cards.push(name); unsupported.set(key, e); }
  for (const note of d.notes || []) {
    const k = kind(note); if (k === 'other') continue;
    const key = norm(note); const b = buckets[k];
    const e = b.get(key) || { n: 0, cards: [] }; e.n++; if (e.cards.length < 6) e.cards.push(name); b.set(key, e);
    csv.push([name, k, note.replace(/"/g, "'")]);
  }
}

if (flag('--csv')) { console.log('card,kind,note'); for (const [n, k, note] of csv) console.log(`"${n}","${k}","${note}"`); process.exit(0); }
if (phrase) {
  const hits = []; for (const [name, raw] of byName) { const d = (() => { try { return compile(trim(raw)); } catch { return null; } })(); if (d && (d.notes || []).some(x => x.toLowerCase().includes(phrase))) hits.push([name, d.notes.filter(x => x.toLowerCase().includes(phrase))]); }
  console.log(`${hits.length} cards whose notes contain "${phrase}":\n`);
  for (const [n, notes] of hits.sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${n}\n      ${notes.join('\n      ')}`);
  process.exit(0);
}

const pct = n => (100 * n / total).toFixed(1) + '%';
console.log(`Premodern pool: ${total} distinct cards — full ${full} (${pct(full)}), approx ${approxN} (${pct(approxN)}), unsupported ${unsup} (${pct(unsup)})`);
const show = (title, map, limit) => {
  console.log(`\n${title} (each fix ~= this many cards):`);
  for (const [k, e] of [...map].sort((a, b) => b[1].n - a[1].n).slice(0, limit)) console.log(`  ${String(e.n).padStart(4)}  ${k}\n         e.g. ${e.cards.slice(0, 4).join(', ')}`);
};
if (!flag('--unsupported')) { show('Most cards with a DROPPED sentence (silently ignored text)', buckets.ignored, 40); show('Most cards only APPROXIMATED (parsed but simplified)', buckets.approx, 25); }
show('Most common UNSUPPORTED reasons (whole card cannot play)', unsupported, 30);
