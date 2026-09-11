// Compile audit of every card in the bundled Premodern decks (content/ai-decks.json).
//   node tools/deck-audit.mjs        main decks only
//   node tools/deck-audit.mjs all    main decks and sideboards
import fs from 'node:fs';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { compile } = await import(new URL('../js/cards.js', import.meta.url).href);
const all = new Map();
const dir = new URL('.sets', import.meta.url).pathname;
for (const f of fs.readdirSync(dir)) for (const c of JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8'))) if (!all.has(c.name)) all.set(c.name, c);
const D = name => { const c = all.get(name); if (!c) return null; const f = c.card_faces?.[0] || c; return compile({ name: c.name, id: c.id, set: c.set, mana_cost: f.mana_cost || '', cmc: c.cmc, type_line: f.type_line || c.type_line, oracle_text: f.oracle_text || c.oracle_text || '', power: f.power, toughness: f.toughness, colors: f.colors || c.colors || [], keywords: c.keywords || [] }); };
const BASICS = new Set(['Plains','Island','Swamp','Mountain','Forest']);
const decks = JSON.parse(fs.readFileSync(new URL('../content/ai-decks.json', import.meta.url).pathname,'utf8')).decks;
const which = process.argv[2] || 'main'; // main | all
const names = new Map(); // name -> [decks]
for (const d of decks) { const src = which==='all' ? {...d.deck, ...d.side} : d.deck; for (const n of Object.keys(src)) { if (BASICS.has(n)) continue; (names.get(n) || names.set(n, []).get(n)).push(d.name); } }
const rows = [];
for (const [n, ds] of [...names].sort((a,b)=>a[0].localeCompare(b[0]))) {
  const c = all.get(n);
  if (!c) { rows.push({ n, st: 'MISSING', note: 'not in set data', ds }); continue; }
  const d = D(n);
  const ignored = (d.notes||[]).filter(x => /^Ignored/.test(x));
  const other = (d.notes||[]).filter(x => !/^Ignored/.test(x));
  const st = d.kind === 'unsupported' ? 'UNSUP' : ignored.length ? 'PARTIAL' : d.status === 'approx' ? 'approx' : 'ok';
  rows.push({ n, st, note: [...ignored, ...other].join(' | '), ds, oracle: (c.card_faces?.[0]||c).oracle_text || '' });
}
const counts = {}; for (const r of rows) counts[r.st] = (counts[r.st]||0)+1;
console.log('TOTAL', rows.length, JSON.stringify(counts));
for (const st of ['MISSING','UNSUP','PARTIAL','approx']) {
  const rs = rows.filter(r => r.st === st); if (!rs.length) continue;
  console.log(`\n==== ${st} (${rs.length}) ====`);
  for (const r of rs) console.log(`- ${r.n}  [${r.ds.length} deck${r.ds.length>1?'s':''}]\n    ${(r.note||'').slice(0,300)}`);
}
