// Regression tests for specific cards the rules engine should understand. Each entry asserts the card
// compiles to a playable form (not "unsupported") with the expected top-level effect/ability, so fixes
// made while filling out Premodern coverage don't silently regress. Extend CASES as cards are fixed.
//   node tools/cardtests.mjs
import fs from 'node:fs';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { compile } = await import('../js/cards.js');
const all = new Map();
for (const f of fs.readdirSync(new URL('.sets', import.meta.url))) for (const c of JSON.parse(fs.readFileSync(new URL('.sets/' + f, import.meta.url), 'utf8'))) if (!all.has(c.name)) all.set(c.name, c);
const D = name => { const c = all.get(name); if (!c) return null; const f = c.card_faces?.[0] || c; return compile({ name: c.name, id: c.id, set: c.set, mana_cost: f.mana_cost || '', cmc: c.cmc, type_line: f.type_line || c.type_line, oracle_text: f.oracle_text || c.oracle_text || '', power: f.power, toughness: f.toughness, colors: f.colors || c.colors || [], keywords: c.keywords || [] }); };

const spellEffectTypes = d => (d.spell?.effects || []).map(e => e.type);
const abilityEffectTypes = d => (d.abilities || []).flatMap(a => (a.effects || []).map(e => e.type));
const hasType = (d, t) => spellEffectTypes(d).includes(t) || abilityEffectTypes(d).includes(t);

// [name, predicate(def) -> bool, description]
const CASES = [
  ['Merchant Scroll', d => hasType(d, 'tutor') && d.spell.effects[0].what === 'blue instant', 'tutors for a blue instant'],
  ['Meditate', d => hasType(d, 'draw') && hasType(d, 'skipTurn'), 'draws four and skips a turn'],
  ['Sleight of Hand', d => hasType(d, 'peek') && d.spell.effects[0].mode === 'handBottom', 'dig one to hand, rest to bottom'],
  ['Impulse', d => hasType(d, 'peek') && d.spell.effects[0].mode === 'handBottom', 'dig one of four to hand'],
  ['Arcane Denial', d => hasType(d, 'counter') && d.spell.effects.find(e => e.type === 'counter').drawController === 2, 'counter; controller draws two'],
  ['Cephalid Looter', d => hasType(d, 'draw') && hasType(d, 'discard'), 'loots (draw then discard)'],
  ['Cephalid Broker', d => abilityEffectTypes(d).filter(t => t === 'draw').length && abilityEffectTypes(d).includes('discard'), 'loots two'],
  ['Keep Watch', d => hasType(d, 'draw') && d.spell.effects[0].amount?.calc === 'attackers', 'draw per attacker'],
  ['Tolarian Winds', d => hasType(d, 'discardDraw'), 'discard hand, draw that many'],
  ['Dream Cache', d => hasType(d, 'draw') && hasType(d, 'putBack'), 'draw three, put two back'],
  ['Curiosity', d => (d.abilities||[]).some(a => a.type === 'triggered' && (a.effects||[]).some(e => e.type === 'draw')), 'aura: draw on combat damage'],
  ['Airborne Aid', d => hasType(d, 'draw') && d.spell.effects[0].amount?.calc === 'count', 'draw per Bird'],
  ['Rush of Knowledge', d => hasType(d, 'draw') && d.spell.effects[0].amount?.calc === 'maxCmc', 'draw = greatest mana value'],
  ['Windfall', d => hasType(d, 'windfall'), 'windfall wheel'],
  ['Urza\'s Guilt', d => hasType(d, 'draw') && hasType(d, 'discard') && hasType(d, 'lose'), 'each draws/discards/loses'],
  ['Whirlpool Rider', d => (d.abilities||[]).some(a => (a.effects||[]).some(e => e.type === 'shuffleHandDraw')), 'shuffle hand, draw that many'],
  ['Trade Routes', d => (d.abilities||[]).some(a => a.cost?.discard && (a.effects||[]).some(e => e.type === 'draw')), 'discard-cost draw'],
  ['Fatigue', d => hasType(d, 'skipDrawStep'), 'skip a draw step'],
  ['Coastal Piracy', d => (d.abilities||[]).some(a => a.event === 'anyCombatToPlayer'), 'draw on any creature combat damage'],
  ['Insight', d => (d.abilities||[]).some(a => a.event === 'anyCast' && a.color === 'G'), 'draw on opponent green spell'],
  ['Allied Strategies', d => hasType(d, 'draw') && d.spell.effects[0].amount?.calc === 'domain', 'domain draw'],
  ['Accumulated Knowledge', d => spellEffectTypes(d).filter(t => t === 'draw').length === 2, 'draw + graveyard-count draw'],
  ['Goblin Piledriver', d => (d.abilities||[]).some(a => a.event === 'attacks' && (a.effects||[]).some(e => e.type === 'pump' && e.p?.calc === 'count' && e.p.mult === 2 && e.p.restrict?.other)), 'attack pump per other attacking Goblin'],
  ['Gempalm Incinerator', d => (d.abilities||[]).some(a => a.event === 'cycle' && (a.effects||[]).some(e => e.type === 'damage' && e.amount?.calc === 'count')), 'cycling deals damage per Goblin'],
];

let pass = 0, fail = 0;
for (const [name, pred, desc] of CASES) {
  const d = D(name);
  if (!d) { console.log(`  SKIP ${name} (not in card data)`); continue; }
  let ok = false; try { ok = d.kind !== 'unsupported' && pred(d); } catch { ok = false; }
  if (ok) pass++; else { fail++; console.log(`  FAIL ${name} — expected: ${desc} — got kind=${d.kind} spell=${JSON.stringify(spellEffectTypes(d))} abil=${JSON.stringify(abilityEffectTypes(d))} notes=${JSON.stringify(d.notes)}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
