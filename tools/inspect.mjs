// Print how the compiler understands specific cards (from the coverage set cache).
//   node tools/inspect.mjs "Holy Strength" "Counterspell" ...
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { compile } = await import('../js/cards.js');
const all = new Map();
for (const f of fs.readdirSync(path.join(here, '.sets'))) for (const c of JSON.parse(fs.readFileSync(path.join(here, '.sets', f), 'utf8'))) if (!all.has(c.name)) all.set(c.name, c);
for (const name of process.argv.slice(2)) {
  const c = all.get(name); if (!c) { console.log(`${name}: not in cache`); continue; }
  const face = c.card_faces?.[0] || c;
  const d = compile({ name: c.name, id: c.id, set: c.set, mana_cost: face.mana_cost || '', cmc: c.cmc, type_line: face.type_line || c.type_line, oracle_text: face.oracle_text || c.oracle_text || '', power: face.power, toughness: face.toughness, colors: face.colors || c.colors || [], keywords: c.keywords || [] });
  console.log(`\n== ${name} [${d.status}] ${c.type_line}\n${(c.oracle_text || '').replace(/\n/g, ' | ')}`);
  console.log(JSON.stringify({ kind: d.kind, keywords: d.keywords, mana: d.manaAbilities.length, abilities: d.abilities, spell: d.spell, notes: d.notes }, null, 1).replace(/\n\s*/g, ' '));
}
