// Headless balance simulator: compiles every enemy deck and plays AI vs AI matches on the rules core.
//   node tools/simulate.mjs            -> support report + round robin, 10 games per pairing
//   node tools/simulate.mjs 30         -> 30 games per pairing
//   node tools/simulate.mjs 5 --verbose   -> print logs of games that error

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cacheFile = path.join(here, '.cardcache.json');
const store = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = v; fs.writeFileSync(cacheFile, JSON.stringify(store)); },
  removeItem: k => { delete store[k]; },
};

const { fetchCards, cached } = await import('../js/scryfall.js');
const { compile } = await import('../js/cards.js');
const { Duel } = await import('../js/engine.js');
const { aiHooks } = await import('../js/ai.js');

const games = Number(process.argv[2]) || 10;
const verbose = process.argv.includes('--verbose');
const content = JSON.parse(fs.readFileSync(path.join(here, '..', 'content', 'enemies.json'), 'utf8'));
const names = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);
for (const e of content.enemies) for (const n of Object.keys(e.deck)) names.add(n);

console.log(`Fetching ${names.size} card names…`);
await fetchCards([...names]);

const defs = new Map();
let bad = 0;
for (const n of names) {
  const raw = cached(n);
  const d = raw ? compile(raw) : null;
  defs.set(n, d);
  if (!d) { console.log(`  MISSING     ${n}`); bad++; }
  else if (d.status === 'unsupported') { console.log(`  UNSUPPORTED ${n}: ${d.notes.join('; ')}`); bad++; }
  else if (d.status === 'approx') console.log(`  approx      ${n}: ${d.notes.join('; ')}`);
}
console.log(bad ? `${bad} problem cards.` : 'All enemy deck cards compile.');

function expand(deck) { const out = []; for (const [n, c] of Object.entries(deck)) for (let i = 0; i < c; i++) out.push(defs.get(n)); return out.filter(d => d && d.kind !== 'unsupported'); }

export function play(a, b) {
  const duel = new Duel({ player: { name: a.name, deck: expand(a.deck), life: a.life, ai: true }, ai: { name: b.name, deck: expand(b.deck), life: b.life, ai: true }, hooks: aiHooks });
  duel.start();
  let guard = 0;
  while (duel.winner === null && guard++ < 20000) {
    const r = duel.tick();
    if (r === 'wait') throw new Error('engine waited for a human in an AI-only game: ' + JSON.stringify(duel.pending?.req?.kind));
  }
  if (duel.winner === null) { if (verbose) console.log(duel.log.slice(-30).join('\n')); return { winner: null, turns: duel.turn, log: duel.log }; }
  return { winner: duel.winner, turns: duel.turn, log: duel.log };
}

const roster = content.enemies;
const table = {};
let errors = 0, stalls = 0;
for (const a of roster) for (const b of roster) {
  if (a.id >= b.id) continue;
  let wa = 0, wb = 0, draws = 0, turns = 0;
  for (let g = 0; g < games; g++) {
    try {
      const r = g % 2 ? play(b, a) : play(a, b);
      const winnerIsA = g % 2 ? r.winner === 1 : r.winner === 0;
      if (r.winner === null) { draws++; stalls++; } else if (winnerIsA) wa++; else wb++;
      turns += r.turns;
    } catch (e) { errors++; if (errors < 6) console.error('ERROR', a.id, 'vs', b.id, e.stack.split('\n').slice(0, 4).join('\n')); }
  }
  table[a.id] ??= {}; table[b.id] ??= {};
  table[a.id][b.id] = wa; table[b.id][a.id] = wb;
  console.log(`${a.name.padEnd(20)} ${wa.toString().padStart(3)} – ${wb.toString().padStart(3)} ${b.name.padEnd(20)} draws ${draws}  avg turns ${(turns / games).toFixed(1)}`);
}
console.log('\nOverall win rate:');
for (const e of roster) {
  const row = table[e.id] || {}; const wins = Object.values(row).reduce((s, v) => s + v, 0); const n = Object.keys(row).length * games;
  console.log(`  ${e.name.padEnd(20)} tier ${e.tier}  ${(100 * wins / n).toFixed(0).padStart(3)}%`);
}
if (errors || stalls) { console.log(`${errors} games threw errors, ${stalls} stalled.`); process.exit(1); }
