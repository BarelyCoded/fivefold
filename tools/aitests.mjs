// AI deck-plan behaviour: the archetype playbooks in js/ai-plans.js drive the right engine plays.
//   node tools/aitests.mjs
import fs from 'node:fs';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { compile } = await import(new URL('../js/cards.js', import.meta.url).href);
const { Duel, isCreature } = await import(new URL('../js/engine.js', import.meta.url).href);
const { aiHooks } = await import(new URL('../js/ai.js', import.meta.url).href);
const { planFor } = await import(new URL('../js/ai-plans.js', import.meta.url).href);
const all = new Map();
for (const f of fs.readdirSync(new URL('.sets', import.meta.url).pathname)) for (const c of JSON.parse(fs.readFileSync(new URL('.sets/' + f, import.meta.url).pathname, 'utf8'))) if (!all.has(c.name)) all.set(c.name, c);
const D = n => { const c = all.get(n); if (!c) throw new Error('missing ' + n); const f = c.card_faces?.[0] || c; return compile({ name: c.name, id: c.id, set: c.set, mana_cost: f.mana_cost || '', cmc: c.cmc, type_line: f.type_line, oracle_text: f.oracle_text, colors: f.colors, keywords: c.keywords || [], rarity: c.rarity, power: f.power, toughness: f.toughness, image_uris: null }); };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const section = n => console.log('-- ' + n);
function duel(deckName = 'Recurring Survival') { const d = new Duel({ player: { name: 'You', deck: [], life: 20 }, ai: { name: deckName, deck: [], life: 20, ai: true }, hooks: aiHooks, rules: {} }); d.active = 1; d.priority = 1; d.step = 'main1'; d.turn = 5; return d; }
const put = (d, name, idx, zone) => { const c = d.instance(D(name), idx); c.zone = zone; if (zone === 'battlefield') { c.sick = false; d.players[idx].battlefield.push(c); } else d.players[idx][zone].push(c); return c; };

section('Recurring Nightmare loops: sacrifice fodder, reanimate the best creature');
{ const d = duel(); const P = d.players[1];
  put(d, 'Recurring Nightmare', 1, 'battlefield'); const wall = put(d, 'Wall of Roots', 1, 'battlefield'); const vf = put(d, 'Verdant Force', 1, 'graveyard');
  P.pool = { G: 2 }; d.refresh();
  const act = aiHooks.decide(d, P);
  ok(act.type === 'activate' && act.card.def.name === 'Recurring Nightmare', `AI activates Recurring Nightmare (${act.type} ${act.card?.def.name})`);
  ok(d.card(act.opts.sacrifice)?.def.name === 'Wall of Roots', `sacrifices the fodder Wall (${d.card(act.opts?.sacrifice)?.def.name})`);
  ok(act.opts.targets?.[0] && d.card(act.opts.targets[0].id)?.def.name === 'Verdant Force', `reanimates Verdant Force (${d.card(act.opts?.targets?.[0]?.id)?.def.name})`); }

section("Recurring Nightmare holds when it isn't an upgrade");
{ const d = duel(); const P = d.players[1];
  put(d, 'Recurring Nightmare', 1, 'battlefield'); put(d, 'Verdant Force', 1, 'battlefield'); put(d, 'Wall of Roots', 1, 'graveyard');
  P.pool = { G: 2 }; d.refresh();
  const act = aiHooks.decide(d, P);
  ok(!(act.type === 'activate' && act.card.def.name === 'Recurring Nightmare'), 'AI does not sac a big creature to return a small one'); }

section('Survival digs for removal against a threat, a beater otherwise');
{ const d = duel(); const P = d.players[1];
  const opts = ['Bone Shredder', 'Verdant Force', 'Withered Wretch'].map(n => put(d, n, 1, 'library'));
  const req = { kind: 'choose', player: 1, text: 'Search your library for a creature', options: opts.map(c => ({ id: c.id, label: c.def.name })), min: 1, max: 1 };
  put(d, 'Verdant Force', 0, 'battlefield'); d.refresh();
  ok(aiHooks.choose(d, req).map(id => d.card(id).def.name)[0] === 'Bone Shredder', 'fetches removal when the opponent has a big threat');
  d.players[0].battlefield.length = 0; d.refresh();
  ok(aiHooks.choose(d, req).map(id => d.card(id).def.name)[0] === 'Verdant Force', 'fetches the biggest threat when nothing is pressing'); }

section('Every preset plan names cards that exist in the sets');
{ for (const name of ['Recurring Survival']) { const plan = planFor(name); const names = [...(plan.priority||[]), ...(plan.ramp||[]), ...(plan.disruption||[]), ...(plan.fodder||[]), ...(plan.engines||[]), ...(plan.toolbox||[]).flatMap(t => t.cards)];
  const missing = names.filter(n => !all.has(n));
  ok(!missing.length, `${name}: all named cards exist (${missing.join(', ') || 'ok'})`); } }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
