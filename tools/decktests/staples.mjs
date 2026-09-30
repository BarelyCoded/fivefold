// Runtime checks for Premodern staples implemented in the card-coverage sweep (mana engines, tutors, riders, …).
//   node tools/decktests/staples.mjs
import fs from 'node:fs';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { compile } = await import(new URL('../../js/cards.js', import.meta.url).href);
const { Duel, power, toughness, isCreature, has } = await import(new URL('../../js/engine.js', import.meta.url).href);
const all = new Map();
const dir = new URL('../.sets', import.meta.url).pathname;
for (const f of fs.readdirSync(dir)) for (const c of JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8'))) if (!all.has(c.name)) all.set(c.name, c);
const D = name => { const c = all.get(name); if (!c) throw new Error('missing ' + name); const f = c.card_faces?.[0] || c; return compile({ name: c.name, id: c.id, set: c.set, mana_cost: f.mana_cost || '', cmc: c.cmc, type_line: f.type_line || c.type_line, oracle_text: f.oracle_text || c.oracle_text || '', power: f.power, toughness: f.toughness, colors: f.colors || c.colors || [], keywords: c.keywords || [] }); };

let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const section = n => console.log('-- ' + n);
function drive(gen, targets = [], chooser = null, numFn = null) {
  let r = gen.next();
  while (!r.done) {
    const y = r.value;
    if (y.kind === 'target') r = gen.next(targets.shift());
    else if (y.kind === 'yesno') r = gen.next(true);
    else if (y.kind === 'piles') r = gen.next(0);
    else if (y.kind === 'number') r = gen.next(numFn ? numFn(y) : (y.default ?? y.max ?? 0));
    else if (y.kind === 'choose') r = gen.next(chooser ? chooser(y) : y.options.slice(0, Math.max(y.min, 1)).map(o => o.id));
    else r = gen.next();
  }
}
function newDuel() { return new Duel({ player: { name: 'A', deck: [], life: 20 }, ai: { name: 'B', deck: [], life: 20, ai: true }, hooks: {}, rules: {} }); }
function place(d, def, ownerIdx) { const c = d.instance(def, ownerIdx); c.zone = 'battlefield'; c.sick = false; d.players[ownerIdx].battlefield.push(c); d.refresh(); return c; }
function gy(d, def, ownerIdx) { const c = d.instance(def, ownerIdx); c.zone = 'graveyard'; d.players[ownerIdx].graveyard.push(c); return c; }
function hand(d, def, ownerIdx) { const c = d.instance(def, ownerIdx); c.zone = 'hand'; d.players[ownerIdx].hand.push(c); return c; }
function lib(d, def, ownerIdx) { const c = d.instance(def, ownerIdx); c.zone = 'library'; d.players[ownerIdx].library.push(c); return c; }
const mainPhase = d => { d.active = 0; d.priority = 0; d.step = 'main1'; d.turn = 1; };
const pool = (d, i, o) => { d.players[i].pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...o }; };
const bears = () => D('Grizzly Bears'), pile = () => D('Goblin Piledriver');
const abIdx = (def, pred) => def.abilities.findIndex(pred);
const processAndResolve = (d, targets = [], chooser = null, numFn = null) => { for (let i = 0; i < 40; i++) { drive(d.processEvents(), targets, chooser, numFn); if (d.stack.length) { drive(d.resolveTop(), targets, chooser, numFn); continue; } if (!d.events.length) break; } };


section('Gaea\'s Cradle / Priest of Titania / Rofellos / Serra\'s Sanctum count their permanents');
{ const d = newDuel(); mainPhase(d); pool(d, 0, {});
  const cradle = place(d, D('Gaea\'s Cradle'), 0); place(d, bears(), 0); place(d, bears(), 0); place(d, bears(), 1);
  ok(d.activateMana(d.players[0], cradle, 0, 'G') && d.players[0].pool.G === 2, `Cradle adds G per creature I control (${d.players[0].pool.G})`);
  const d2 = newDuel(); mainPhase(d2); pool(d2, 0, {}); const pr = place(d2, D('Priest of Titania'), 0); place(d2, D('Llanowar Elves'), 1);
  ok(d2.activateMana(d2.players[0], pr, 0, 'G') && d2.players[0].pool.G === 2, `Priest counts every Elf on the battlefield (${d2.players[0].pool.G})`);
  const d3 = newDuel(); mainPhase(d3); pool(d3, 0, {}); const ro = place(d3, D('Rofellos, Llanowar Emissary'), 0); for (let k = 0; k < 3; k++) place(d3, D('Forest'), 0); place(d3, D('Forest'), 1);
  ok(d3.activateMana(d3.players[0], ro, 0, 'G') && d3.players[0].pool.G === 3, `Rofellos counts my Forests (${d3.players[0].pool.G})`);
  const d4 = newDuel(); mainPhase(d4); pool(d4, 0, {}); const ss = place(d4, D('Serra\'s Sanctum'), 0); place(d4, D('Opalescence'), 0); place(d4, D('Worship'), 0);
  ok(d4.manaSources(d4.players[0]).find(s => s.card === ss)?.amount === 2, 'Sanctum is planned as two W'); }

section('Cradle with no creatures produces nothing');
{ const d = newDuel(); mainPhase(d); pool(d, 0, {}); const cradle = place(d, D('Gaea\'s Cradle'), 0);
  ok(!d.manaSources(d.players[0]).some(s => s.card === cradle), 'not listed as a source with zero creatures'); }

section('Enlightened / Worldly Tutor put the card on top');
{ const d = newDuel(); mainPhase(d); for (let k = 0; k < 5; k++) lib(d, bears(), 0); const ench = lib(d, D('Opalescence'), 0); for (let k = 0; k < 5; k++) lib(d, D('Island'), 0);
  const et = hand(d, D('Enlightened Tutor'), 0); pool(d, 0, { W: 1 });
  ok(d.cast(d.players[0], et, {}), 'cast Enlightened Tutor'); processAndResolve(d, [], y => [ench.id]);
  const top = d.players[0].library[d.players[0].library.length - 1];
  ok(top === ench, `Opalescence is on top (${top?.def.name})`); ok(ench.zone === 'library', 'still in library'); }

section('Undermine: counter, the spell\'s controller loses 3');
{ const d = newDuel(); mainPhase(d); d.active = 1; d.priority = 1; const bolt = hand(d, D('Lightning Bolt'), 1); pool(d, 1, { R: 1 });
  d.cast(d.players[1], bolt, { targets: [{ type: 'player', idx: 0 }] }); const item = d.stack[d.stack.length - 1];
  d.priority = 0; const um = hand(d, D('Undermine'), 0); pool(d, 0, { U: 2, B: 1 });
  ok(d.cast(d.players[0], um, { targets: [{ type: 'spell', id: item.id }] }), 'cast Undermine'); processAndResolve(d);
  ok(d.players[0].life === 20 && d.players[1].life === 17, `Bolt countered, its controller lost 3 (me ${d.players[0].life}, them ${d.players[1].life})`); }

section('Path of Peace: destroy, its owner gains 4');
{ const d = newDuel(); mainPhase(d); const b = place(d, bears(), 1); const pp = hand(d, D('Path of Peace'), 0); pool(d, 0, { W: 1, C: 3 });
  ok(d.cast(d.players[0], pp, { targets: [{ type: 'perm', id: b.id }] }), 'cast Path of Peace'); processAndResolve(d);
  ok(b.zone === 'graveyard' && d.players[1].life === 24 && d.players[0].life === 20, `destroyed, owner gained 4 (${b.zone}, ${d.players[1].life})`); }

section('Terravore counts land cards in all graveyards');
{ const d = newDuel(); mainPhase(d); const t = place(d, D('Terravore'), 0); gy(d, D('Forest'), 0); gy(d, D('Island'), 1); gy(d, D('Wasteland'), 1); gy(d, bears(), 1); d.refresh();
  ok(power(t) === 3 && toughness(t) === 3, `Terravore is 3/3 (${power(t)}/${toughness(t)})`); ok(has(t, 'Trample'), 'has trample'); }

section('Attunement: return to hand, draw three, discard four');
{ const d = newDuel(); mainPhase(d); const at = place(d, D('Attunement'), 0); for (let k = 0; k < 5; k++) lib(d, bears(), 0); for (let k = 0; k < 2; k++) hand(d, D('Island'), 0);
  const i = abIdx(at.def, a => a.type === 'activated');
  ok(d.activate(d.players[0], at, i, {}), 'activate Attunement'); ok(at.zone === 'hand', `Attunement returned as a cost (${at.zone})`);
  processAndResolve(d); ok(d.players[0].graveyard.length === 4, `discarded four (${d.players[0].graveyard.length})`); }

section('Quirion Ranger: return a Forest to untap a creature, once per turn');
{ const d = newDuel(); mainPhase(d); const qr = place(d, D('Quirion Ranger'), 0); const f = place(d, D('Forest'), 0); f.tapped = true; const b = place(d, bears(), 0); b.tapped = true;
  const i = abIdx(qr.def, a => a.type === 'activated');
  ok(d.activate(d.players[0], qr, i, { targets: [{ type: 'perm', id: b.id }] }), 'activate Ranger'); ok(f.zone === 'hand', `Forest returned (${f.zone})`);
  processAndResolve(d); ok(!b.tapped, 'creature untapped');
  place(d, D('Forest'), 0); ok(!d.canActivate(d.players[0], qr, i, {}), 'only once each turn'); }

section('Wirewood Symbiote needs an Elf to return');
{ const d = newDuel(); mainPhase(d); const ws = place(d, D('Wirewood Symbiote'), 0); const b = place(d, bears(), 0); b.tapped = true;
  const i = abIdx(ws.def, a => a.type === 'activated'); ok(!d.canActivate(d.players[0], ws, i, {}), 'no Elf, no activation');
  const el = place(d, D('Llanowar Elves'), 0); ok(d.activate(d.players[0], ws, i, { targets: [{ type: 'perm', id: b.id }] }), 'activate with an Elf'); ok(el.zone === 'hand', 'Elf returned'); }

section('Soulless One counts Zombies on the battlefield and Zombie cards in graveyards');
{ const d = newDuel(); mainPhase(d); const so = place(d, D('Soulless One'), 0); place(d, D('Gravedigger'), 1); gy(d, D('Gravedigger'), 0); gy(d, bears(), 1); d.refresh();
  ok(power(so) === 3, `Soulless One is ${power(so)}/${toughness(so)} (itself + Gravedigger + one in the yard)`); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
