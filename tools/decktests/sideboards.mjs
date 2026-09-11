// Runtime checks for the sideboard cards of the bundled Premodern decks (batch 4).
import fs from 'node:fs';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { compile } = await import(new URL('../../js/cards.js', import.meta.url).href);
const { Duel, power, toughness, isCreature, isLand } = await import(new URL('../../js/engine.js', import.meta.url).href);
const all = new Map();
const dir = new URL('../.sets', import.meta.url).pathname;
for (const f of fs.readdirSync(dir)) for (const c of JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8'))) if (!all.has(c.name)) all.set(c.name, c);
const D = name => { const c = all.get(name); if (!c) throw new Error('missing ' + name); const f = c.card_faces?.[0] || c; return compile({ name: c.name, id: c.id, set: c.set, mana_cost: f.mana_cost || '', cmc: c.cmc, type_line: f.type_line || c.type_line, oracle_text: f.oracle_text || c.oracle_text || '', power: f.power, toughness: f.toughness, colors: f.colors || c.colors || [], keywords: c.keywords || [] }); };

let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const section = n => console.log('-- ' + n);
function drive(gen, targets = [], chooser = null) {
  let r = gen.next();
  while (!r.done) {
    const y = r.value;
    if (y.kind === 'target') r = gen.next(targets.shift());
    else if (y.kind === 'yesno') r = gen.next(true);
    else if (y.kind === 'number') r = gen.next(y.default ?? y.min);
    else if (y.kind === 'choose') r = gen.next(chooser ? chooser(y) : y.options.slice(0, Math.max(y.min, 1)).map(o => o.id));
    else r = gen.next();
  }
}
function newDuel() { return new Duel({ player: { name: 'A', deck: [], life: 20 }, ai: { name: 'B', deck: [], life: 20, ai: true }, hooks: {}, rules: {} }); }
function place(d, def, ownerIdx) { const c = d.instance(def, ownerIdx); c.zone = 'battlefield'; c.sick = false; d.players[ownerIdx].battlefield.push(c); d.refresh(); return c; }
function hand(d, def, ownerIdx) { const c = d.instance(def, ownerIdx); c.zone = 'hand'; d.players[ownerIdx].hand.push(c); return c; }
function lib(d, def, ownerIdx) { const c = d.instance(def, ownerIdx); c.zone = 'library'; d.players[ownerIdx].library.push(c); return c; }
const mainPhase = (d, who = 0) => { d.active = who; d.priority = who; d.step = 'main1'; d.turn = 1; };
const pool = (d, i, o) => { d.players[i].pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...o }; };
const bears = () => D('Grizzly Bears'), pile = () => D('Goblin Piledriver');
const abIdx = (def, pred) => def.abilities.findIndex(pred);
const processAndResolve = (d, targets = [], chooser = null) => { drive(d.processEvents(), targets, chooser); while (d.stack.length) drive(d.resolveTop(), targets, chooser); };
const resolveAll = (d, targets = [], chooser = null) => { while (d.stack.length) drive(d.resolveTop(), targets, chooser); };
const P = (d, i) => d.players[i];

section("Aura of Silence taxes the opponent's artifacts");
{ const d = newDuel(); place(d, D('Aura of Silence'), 0); mainPhase(d, 1); const ms = hand(d, D('Mind Stone'), 1);
  pool(d, 1, { R: 2 }); ok(!d.canCast(P(d, 1), ms), 'two mana is not enough for a {2} artifact under the Aura');
  pool(d, 1, { R: 4 }); ok(d.canCast(P(d, 1), ms), 'four mana pays the taxed cost');
  const d2 = newDuel(); place(d2, D('Aura of Silence'), 0); mainPhase(d2, 0); const ms2 = hand(d2, D('Mind Stone'), 0); pool(d2, 0, { R: 2 }); ok(d2.canCast(P(d2, 0), ms2), 'its controller is not taxed'); }

section('Defense Grid taxes off-turn spells only');
{ const d = newDuel(); place(d, D('Defense Grid'), 0); const bolt = hand(d, D('Lightning Bolt'), 1);
  mainPhase(d, 0); d.priority = 1; pool(d, 1, { R: 1 }); ok(!d.canCast(P(d, 1), bolt, { targets: [{ type: 'player', idx: 0 }] }), 'Bolt on my turn costs {3} more');
  pool(d, 1, { R: 4 }); ok(d.canCast(P(d, 1), bolt, { targets: [{ type: 'player', idx: 0 }] }), 'affordable with four');
  mainPhase(d, 1); pool(d, 1, { R: 1 }); ok(d.canCast(P(d, 1), bolt, { targets: [{ type: 'player', idx: 0 }] }), 'no tax on their own turn'); }

section('Chain of Vapor bounces');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { U: 1 }); const cv = hand(d, D('Chain of Vapor'), 0); const gb = place(d, bears(), 1);
  ok(d.cast(P(d, 0), cv, { targets: [{ type: 'perm', id: gb.id }] }), 'cast'); resolveAll(d); ok(gb.zone === 'hand', `Bears bounced (zone=${gb.zone})`); }

section('Phantom Nishoba shrugs off damage for a counter');
{ const d = newDuel(); mainPhase(d); const pn = d.instance(D('Phantom Nishoba'), 0); d.moveTo(pn, 'battlefield'); drive(d.processEvents());
  ok(pn.counters['+1/+1'] === 7, `enters with seven counters (${pn.counters['+1/+1']})`);
  const gb = place(d, bears(), 1); d.dealDamage(gb, pn, 3);
  ok(pn.damage === 0 && pn.counters['+1/+1'] === 6, `no damage marked, one counter gone (dmg=${pn.damage}, counters=${pn.counters['+1/+1']})`); }

section('Slice and Dice cycled pings every creature');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { R: 3 }); const sd = hand(d, D('Slice and Dice'), 0); lib(d, D('Island'), 0); const gb = place(d, bears(), 1), mine = place(d, D('Masticore'), 0);
  ok(d.cast(P(d, 0), sd, { cycling: true }), 'cycled'); processAndResolve(d);
  ok(gb.damage === 1 && mine.damage === 1, `1 damage to each creature (${gb.damage}/${mine.damage})`); }

section('Smokestack makes the opponent sacrifice per soot counter');
{ const d = newDuel(); mainPhase(d); const ss = place(d, D('Smokestack'), 0); ss.counters.soot = 1; place(d, D('Island'), 1); place(d, D('Island'), 1);
  d.fireEvent({ type: 'upkeep', player: 1 }); processAndResolve(d);
  ok(P(d, 1).battlefield.length === 1, `B sacrificed one permanent (${P(d, 1).battlefield.length} left)`); }

section('Sulfuric Vortex stops life gain');
{ const d = newDuel(); mainPhase(d); place(d, D('Sulfuric Vortex'), 0); const gb = place(d, bears(), 0);
  drive(d.applyEffect({ type: 'gain', amount: 3, sel: 'you' }, { p: P(d, 0), source: gb, targets: [], ti: 0, item: {} }));
  ok(P(d, 0).life === 20, `no life gained (life=${P(d, 0).life})`); }

section("Teferi's Response counters and draws two");
{ const d = newDuel(); mainPhase(d, 1); pool(d, 1, { R: 1 }); const bolt = hand(d, D('Lightning Bolt'), 1);
  ok(d.cast(P(d, 1), bolt, { targets: [{ type: 'player', idx: 0 }] }), 'B casts Bolt'); const item = d.stack[d.stack.length - 1];
  d.priority = 0; pool(d, 0, { U: 2 }); const tr = hand(d, D("Teferi's Response"), 0); lib(d, D('Island'), 0); lib(d, D('Island'), 0);
  ok(d.canCast(P(d, 0), tr, { targets: [{ type: 'spell', id: item.id }] }), 'Response can target the Bolt');
  ok(d.cast(P(d, 0), tr, { targets: [{ type: 'spell', id: item.id }] }), 'cast'); resolveAll(d);
  ok(bolt.zone === 'graveyard' && P(d, 0).life === 20 && P(d, 0).hand.length === 2, `Bolt countered, two cards drawn (hand=${P(d, 0).hand.length}, life=${P(d, 0).life})`); }

section("Volrath's Dungeon puts a card back on top");
{ const d = newDuel(); mainPhase(d); const vd = place(d, D("Volrath's Dungeon"), 0); const is = hand(d, D('Island'), 0); const gb = hand(d, bears(), 1), is2 = hand(d, D('Island'), 1);
  const i = abIdx(vd.def, a => a.type === 'activated' && a.cost.discard); ok(i >= 0, 'discard ability parsed');
  ok(d.activate(P(d, 0), vd, i, { targets: [{ type: 'player', idx: 1 }], discard: [is.id] }), 'activated'); resolveAll(d);
  ok(is.zone === 'graveyard' && P(d, 1).library[P(d, 1).library.length - 1] === is2 && gb.zone === 'hand', `I discarded, B topped their Island (${is.zone}/${is2.zone}/${gb.zone})`); }

section('Dwarven Blastminer works face up (Morph ignored)');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { R: 3 }); const db = place(d, D('Dwarven Blastminer'), 0); const port = place(d, D('Rishadan Port'), 1);
  ok(db.def.kind === 'creature' && db.def.status !== 'unsupported', 'compiles as a creature');
  const i = abIdx(db.def, a => a.type === 'activated'); ok(d.activate(P(d, 0), db, i, { targets: [{ type: 'perm', id: port.id }] }), 'activated'); resolveAll(d);
  ok(port.zone === 'graveyard', `Port destroyed (zone=${port.zone})`); }

section('Engineered Plague picks Goblins and shrinks them');
{ const d = newDuel(); mainPhase(d); const g1 = place(d, pile(), 1), g2 = place(d, pile(), 1), gb = place(d, bears(), 1);
  const ep = d.instance(D('Engineered Plague'), 0); d.moveTo(ep, 'battlefield'); processAndResolve(d);
  ok(ep.chosenType === 'Goblin', `chose Goblin (${ep.chosenType})`);
  ok(power(g1) === 0 && toughness(g1) === 1 && power(g2) === 0 && power(gb) === 2, `1/2 Piledrivers become 0/1, Bears untouched (${power(g1)}/${toughness(g1)}, ${power(gb)})`); }

section('Ensnaring Bridge holds back big creatures');
{ const d = newDuel(); mainPhase(d, 1); place(d, D('Ensnaring Bridge'), 0); hand(d, D('Island'), 0); const mc = place(d, D('Masticore'), 1), gb = place(d, bears(), 1);
  ok(!d.canAttack(mc) && !d.canAttack(gb), 'with one card in my hand nothing with power >1 attacks');
  hand(d, D('Island'), 0); ok(d.canAttack(gb) && !d.canAttack(mc), 'with two cards the 2/2 may attack, the 4/4 may not'); }

section('Evacuation and Hibernation bounce');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { U: 5 }); const ev = hand(d, D('Evacuation'), 0); const a = place(d, bears(), 0), b = place(d, pile(), 1);
  ok(d.cast(P(d, 0), ev, { targets: [] }), 'Evacuation cast'); resolveAll(d); ok(a.zone === 'hand' && b.zone === 'hand', `every creature returned (${a.zone}/${b.zone})`);
  const d2 = newDuel(); mainPhase(d2); pool(d2, 0, { U: 3 }); const hb = hand(d2, D('Hibernation'), 0); const g = place(d2, bears(), 1), r = place(d2, pile(), 1);
  ok(d2.cast(P(d2, 0), hb, { targets: [] }), 'Hibernation cast'); resolveAll(d2); ok(g.zone === 'hand' && r.zone === 'battlefield', `green Bears bounced, red Piledriver stays (${g.zone}/${r.zone})`); }

section('Flaring Pain switches prevention off');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { R: 2 }); const fp = hand(d, D('Flaring Pain'), 0); const gb = place(d, bears(), 1); gb.shield = 5; const mc = place(d, D('Masticore'), 0);
  ok(d.cast(P(d, 0), fp, { targets: [] }), 'cast'); resolveAll(d); ok(d.noPrevention, 'prevention is off this turn');
  d.dealDamage(mc, gb, 2); ok(gb.damage === 2, `shield ignored, 2 damage marked (${gb.damage})`);
  d.endOfTurnCleanup(); ok(!d.noPrevention, 'resets at end of turn'); }

section("Gerrard's Wisdom gains two per card");
{ const d = newDuel(); mainPhase(d); pool(d, 0, { W: 4 }); const gw = hand(d, D("Gerrard's Wisdom"), 0); for (let i = 0; i < 3; i++) hand(d, D('Island'), 0);
  ok(d.cast(P(d, 0), gw, { targets: [] }), 'cast'); resolveAll(d); ok(P(d, 0).life === 26, `three cards in hand: +6 (life=${P(d, 0).life})`); }

section('Null Rod switches artifacts off');
{ const d = newDuel(); mainPhase(d, 1); pool(d, 1, { R: 3 }); place(d, D('Null Rod'), 0); const cs = place(d, D('Cursed Scroll'), 1); hand(d, D('Lightning Bolt'), 1); const ms = place(d, D('Mind Stone'), 1);
  const i = abIdx(cs.def, a => a.type === 'activated'); ok(!d.canActivate(P(d, 1), cs, i), 'Cursed Scroll cannot be activated');
  ok(!d.manaSources(P(d, 1)).some(s => s.card === ms), 'Mind Stone offers no mana'); }

section('City of Solitude: nothing off-turn');
{ const d = newDuel(); place(d, D('City of Solitude'), 0); const bolt = hand(d, D('Lightning Bolt'), 1); pool(d, 1, { R: 3 }); const cs = place(d, D('Cursed Scroll'), 1); hand(d, D('Island'), 1);
  mainPhase(d, 0); d.priority = 1; ok(!d.canCast(P(d, 1), bolt, { targets: [{ type: 'player', idx: 0 }] }), 'B cannot Bolt on my turn');
  const i = abIdx(cs.def, a => a.type === 'activated'); ok(!d.canActivate(P(d, 1), cs, i), 'B cannot activate the Scroll on my turn');
  mainPhase(d, 1); ok(d.canCast(P(d, 1), bolt, { targets: [{ type: 'player', idx: 0 }] }) && d.canActivate(P(d, 1), cs, i), 'both fine on their own turn'); }

section('Humility makes vanilla 1/1s');
{ const d = newDuel(); mainPhase(d); place(d, D('Humility'), 0); const mc = place(d, D('Masticore'), 1), gp = place(d, pile(), 1); gp.counters['+1/+1'] = 1; const bop = place(d, D('Birds of Paradise'), 1); d.refresh();
  ok(power(mc) === 1 && toughness(mc) === 1, `Masticore is 1/1 (${power(mc)}/${toughness(mc)})`);
  ok(power(gp) === 2 && toughness(gp) === 2, `countered Piledriver is 2/2 (${power(gp)}/${toughness(gp)})`);
  const { abilitiesOf } = await import(new URL('../../js/engine.js', import.meta.url).href);
  ok(abilitiesOf(mc).length === 0 && !d.manaSources(P(d, 1)).some(s => s.card === bop), 'no abilities: Masticore has none, Birds make no mana'); }

section('Multani counts every hand');
{ const d = newDuel(); mainPhase(d); const mu = place(d, D('Multani, Maro-Sorcerer'), 0); hand(d, D('Island'), 0); hand(d, D('Island'), 0); hand(d, D('Island'), 1); hand(d, D('Island'), 1); hand(d, D('Island'), 1); d.refresh();
  ok(mu.def.status !== 'unsupported' && power(mu) === 5 && toughness(mu) === 5, `5/5 with five cards across hands (${power(mu)}/${toughness(mu)}, ${mu.def.status})`); }

section('Stronghold Gambit: only the cheapest creature comes in');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { R: 3 }); const sg = hand(d, D('Stronghold Gambit'), 0); const gb = hand(d, bears(), 0); const mc = hand(d, D('Masticore'), 1); hand(d, D('Island'), 1);
  ok(d.cast(P(d, 0), sg, { targets: [] }), 'cast'); resolveAll(d);
  ok(gb.zone === 'battlefield' && mc.zone === 'hand', `Bears (2) enter, Masticore (4) stays in hand (${gb.zone}/${mc.zone})`); }

section('Worship keeps you at 1 while you have a creature');
{ const d = newDuel(); mainPhase(d); place(d, D('Worship'), 0); const gb = place(d, bears(), 0); const mc = place(d, D('Masticore'), 1); d.refresh();
  d.dealDamage(mc, P(d, 0), 25); ok(P(d, 0).life === 1, `survives at 1 (life=${P(d, 0).life})`);
  d.moveTo(gb, 'graveyard'); d.refresh(); d.dealDamage(mc, P(d, 0), 5); ok(P(d, 0).life === -4, `no creature, no floor (life=${P(d, 0).life})`); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
