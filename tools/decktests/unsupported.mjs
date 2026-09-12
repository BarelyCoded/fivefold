// Runtime checks for the formerly-unsupported deck cards (batch 3), driven in a live Duel.
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
    else if (y.kind === 'piles') r = gen.next(0);
    else if (y.kind === 'number') r = gen.next(y.default ?? y.min);
    else if (y.kind === 'choose') r = gen.next(chooser ? chooser(y) : y.options.slice(0, Math.max(y.min, 1)).map(o => o.id));
    else r = gen.next();
  }
}
function newDuel(extra = {}) { return new Duel({ player: { name: 'A', deck: [], life: 20, ...(extra.player || {}) }, ai: { name: 'B', deck: [], life: 20, ai: true, ...(extra.ai || {}) }, hooks: {}, rules: {} }); }
function place(d, def, ownerIdx) { const c = d.instance(def, ownerIdx); c.zone = 'battlefield'; c.sick = false; d.players[ownerIdx].battlefield.push(c); d.refresh(); return c; }
function gy(d, def, ownerIdx) { const c = d.instance(def, ownerIdx); c.zone = 'graveyard'; d.players[ownerIdx].graveyard.push(c); return c; }
function hand(d, def, ownerIdx) { const c = d.instance(def, ownerIdx); c.zone = 'hand'; d.players[ownerIdx].hand.push(c); return c; }
function lib(d, def, ownerIdx) { const c = d.instance(def, ownerIdx); c.zone = 'library'; d.players[ownerIdx].library.push(c); return c; }
const mainPhase = d => { d.active = 0; d.priority = 0; d.step = 'main1'; d.turn = 1; };
const pool = (d, i, o) => { d.players[i].pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...o }; };
const bears = () => D('Grizzly Bears'), pile = () => D('Goblin Piledriver');
const abIdx = (def, pred) => def.abilities.findIndex(pred);
const processAndResolve = (d, targets = [], chooser = null) => { drive(d.processEvents(), targets, chooser); while (d.stack.length) drive(d.resolveTop(), targets, chooser); };
const resolveAll = (d, targets = [], chooser = null) => { while (d.stack.length) drive(d.resolveTop(), targets, chooser); };

section('Fading: Blastoderm counts down and dies');
{ const d = newDuel(); mainPhase(d); const bd = d.instance(D('Blastoderm'), 0); d.moveTo(bd, 'battlefield');
  ok(bd.def.status !== 'approx' && bd.counters.fade === 3, `enters with 3 fade counters (${bd.counters.fade}, status ${bd.def.status})`);
  for (let i = 0; i < 3; i++) drive(d.upkeepCosts(d.players[0]));
  ok(bd.zone === 'battlefield' && bd.counters.fade === 0, 'still here at zero counters');
  drive(d.upkeepCosts(d.players[0])); ok(bd.zone === 'graveyard', `sacrificed on the fourth upkeep (zone=${bd.zone})`); }

section('Tangle Wire taps the opponent down');
{ const d = newDuel(); mainPhase(d); const tw = d.instance(D('Tangle Wire'), 0); d.moveTo(tw, 'battlefield'); drive(d.processEvents());
  ok(tw.counters.fade === 4, `Tangle Wire has 4 fade counters (${tw.counters.fade})`);
  const l1 = place(d, D('Island'), 1), l2 = place(d, D('Island'), 1), c1 = place(d, bears(), 1);
  d.fireEvent({ type: 'upkeep', player: 1 }); processAndResolve(d);
  ok(l1.tapped && l2.tapped && c1.tapped, `all three of B's permanents tapped (${[l1, l2, c1].map(c => c.tapped).join(',')})`); }

section('Cabal Therapy, then flashback by sacrificing a creature');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { B: 1 }); const ct = hand(d, D('Cabal Therapy'), 0); const gb = place(d, bears(), 0);
  const c1 = hand(d, D('Counterspell'), 1), c2 = hand(d, D('Counterspell'), 1), is = hand(d, D('Island'), 1);
  gy(d, D('Counterspell'), 1);   // a Counterspell in the opponent's graveyard: public info the caster may name (naming is now blind)
  const nameCounter = y => (y.options.find(o => /Counterspell/.test(o.label))?.id ? [y.options.find(o => /Counterspell/.test(o.label)).id] : y.options.slice(0, Math.max(y.min, 1)).map(o => o.id));
  ok(d.cast(d.players[0], ct, { targets: [{ type: 'player', idx: 1 }] }), 'cast'); resolveAll(d, [], nameCounter);
  ok(c1.zone === 'graveyard' && c2.zone === 'graveyard' && is.zone === 'hand', `both Counterspells discarded, Island kept (${c1.zone}/${c2.zone}/${is.zone})`);
  ok(ct.zone === 'graveyard', 'Therapy in the graveyard');
  const c3 = hand(d, D('Counterspell'), 1);
  ok(d.canCast(d.players[0], ct, { targets: [{ type: 'player', idx: 1 }], sacrifice: gb.id }), 'flashback castable with a creature to sacrifice');
  ok(d.cast(d.players[0], ct, { targets: [{ type: 'player', idx: 1 }], sacrifice: gb.id }), 'flashback cast'); resolveAll(d, [], nameCounter);
  ok(gb.zone === 'graveyard' && c3.zone === 'graveyard' && ct.zone === 'exile', `Bears sacrificed, third Counterspell gone, Therapy exiled (${gb.zone}/${c3.zone}/${ct.zone})`); }

section('Buried Alive puts three creatures in the graveyard');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { B: 3 }); const ba = hand(d, D('Buried Alive'), 0);
  const a = lib(d, bears(), 0), b = lib(d, pile(), 0), c = lib(d, D('Masticore'), 0); lib(d, D('Island'), 0);
  ok(d.cast(d.players[0], ba, { targets: [] }), 'cast'); resolveAll(d, [], y => y.options.map(o => o.id));
  ok(a.zone === 'graveyard' && b.zone === 'graveyard' && c.zone === 'graveyard', `three creatures binned (${a.zone}/${b.zone}/${c.zone})`);
  ok(d.players[0].library.length === 1, 'library shuffled with the land left'); }

section('Exhume: everyone gets one back');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { B: 2 }); const ex = hand(d, D('Exhume'), 0); const mine = gy(d, D('Masticore'), 0), theirs = gy(d, bears(), 1);
  ok(d.cast(d.players[0], ex, { targets: [] }), 'cast'); resolveAll(d);
  ok(mine.zone === 'battlefield' && mine.controller === 0 && theirs.zone === 'battlefield' && theirs.controller === 1, `both creatures returned to their owners (${mine.zone}/${theirs.zone})`); }

section('Living Death swaps the yards and the board');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { B: 5 }); const ld = hand(d, D('Living Death'), 0);
  const myDead = gy(d, D('Masticore'), 0), theirDead = gy(d, pile(), 1), theirLive = place(d, bears(), 1);
  ok(d.cast(d.players[0], ld, { targets: [] }), 'cast'); resolveAll(d);
  ok(myDead.zone === 'battlefield' && theirDead.zone === 'battlefield' && theirLive.zone === 'graveyard', `dead rise, living fall (${myDead.zone}/${theirDead.zone}/${theirLive.zone})`); }

section('Donate hands over Illusions of Grandeur');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { U: 4 }); const dn = hand(d, D('Donate'), 0); const ill = place(d, D('Illusions of Grandeur'), 0);
  ok(d.cast(d.players[0], dn, { targets: [{ type: 'player', idx: 1 }, { type: 'perm', id: ill.id }] }), 'cast with player then permanent'); resolveAll(d);
  ok(ill.controller === 1 && d.players[1].battlefield.includes(ill), `B now controls Illusions (ctrl=${ill.controller})`); }

section('Intuition: the opponent picks the one you keep');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { U: 3 }); const it = hand(d, D('Intuition'), 0);
  const big = lib(d, D('Masticore'), 0), mid = lib(d, bears(), 0), small = lib(d, D('Lightning Bolt'), 0); lib(d, D('Island'), 0);
  ok(d.cast(d.players[0], it, { targets: [{ type: 'player', idx: 1 }] }), 'cast'); resolveAll(d, [], y => [big, mid, small].map(c => c.id));
  ok(small.zone === 'hand' && big.zone === 'graveyard' && mid.zone === 'graveyard', `AI opponent gave me the cheapest (${small.zone}/${mid.zone}/${big.zone})`); }

section('Fact or Fiction: opponent splits, I choose');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { U: 4 }); const ff = hand(d, D('Fact or Fiction'), 0);
  const cards = [D('Island'), bears(), D('Lightning Bolt'), D('Masticore'), D('Mountain')].map(x => lib(d, x, 0));
  ok(d.cast(d.players[0], ff, { targets: [] }), 'cast'); resolveAll(d);
  const inHand = cards.filter(c => c.zone === 'hand'), inGy = cards.filter(c => c.zone === 'graveyard');
  ok(inHand.length + inGy.length === 5 && inHand.length >= 1, `piles resolved: ${inHand.length} to hand, ${inGy.length} to graveyard`);
  ok(d.players[0].library.length === 0, 'library emptied of the five'); }

section('Recurring Nightmare: sac a creature, bounce itself, reanimate');
{ const d = newDuel(); mainPhase(d); const rn = place(d, D('Recurring Nightmare'), 0); const gb = place(d, bears(), 0); const mc = gy(d, D('Masticore'), 0);
  const i = abIdx(rn.def, a => a.type === 'activated'); ok(i >= 0 && rn.def.abilities[i].cost.returnSelf, 'cost includes returning itself');
  ok(d.activate(d.players[0], rn, i, { targets: [{ type: 'card', id: mc.id }], sacrifice: [gb.id] }), 'activated'); resolveAll(d);
  ok(gb.zone === 'graveyard' && rn.zone === 'hand' && mc.zone === 'battlefield', `Bears sacrificed, Nightmare in hand, Masticore back (${gb.zone}/${rn.zone}/${mc.zone})`); }

section('Pernicious Deed sweeps mana value X or less');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { G: 2 }); const pd = place(d, D('Pernicious Deed'), 0);
  const ms = place(d, D('Mind Stone'), 1), gb = place(d, bears(), 1), mc = place(d, D('Masticore'), 1);
  const i = abIdx(pd.def, a => a.type === 'activated'); ok(d.activate(d.players[0], pd, i, { targets: [], x: 2 }), 'activated for X=2'); resolveAll(d);
  ok(ms.zone === 'graveyard' && gb.zone === 'graveyard' && mc.zone === 'battlefield' && pd.zone === 'graveyard', `cmc≤2 swept, Masticore lives, Deed gone (${ms.zone}/${gb.zone}/${mc.zone}/${pd.zone})`); }

section("Mishra's Helix taps X of the opponent's lands");
{ const d = newDuel(); mainPhase(d); pool(d, 0, { R: 2 }); const mh = place(d, D("Mishra's Helix"), 0);
  const ls = [place(d, D('Island'), 1), place(d, D('Island'), 1), place(d, D('Island'), 1)];
  const i = abIdx(mh.def, a => a.type === 'activated'); ok(d.activate(d.players[0], mh, i, { targets: [{ type: 'player', idx: 1 }], x: 2 }), 'activated for X=2'); resolveAll(d);
  ok(ls.filter(l => l.tapped).length === 2, `two of three lands tapped (${ls.filter(l => l.tapped).length})`); }

section('Cursed Scroll names the card you hold most');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { R: 3 }); const cs = place(d, D('Cursed Scroll'), 0); hand(d, D('Lightning Bolt'), 0); hand(d, D('Lightning Bolt'), 0);
  const i = abIdx(cs.def, a => a.type === 'activated'); ok(i >= 0, 'Scroll ability parsed');
  ok(d.activate(d.players[0], cs, i, { targets: [{ type: 'player', idx: 1 }] }), 'activated'); resolveAll(d);
  ok(d.players[1].life === 18, `two Bolts in hand: guaranteed hit for 2 (life=${d.players[1].life})`); }

section('Phyrexian Processor: pay life, make a Minion that size');
{ const d = newDuel(); mainPhase(d); const pp = d.instance(D('Phyrexian Processor'), 0); d.moveTo(pp, 'battlefield'); processAndResolve(d);
  ok(d.players[0].life === 15 && pp.paidLife === 5, `paid 5 life on entry (life=${d.players[0].life}, paid=${pp.paidLife})`);
  pool(d, 0, { C: 4 }); const i = abIdx(pp.def, a => a.type === 'activated'); ok(d.activate(d.players[0], pp, i, { targets: [] }), 'token ability activated'); resolveAll(d);
  const tok = d.players[0].battlefield.find(c => c.token); ok(tok && power(tok) === 5 && toughness(tok) === 5, `a 5/5 Minion (${tok && power(tok)}/${tok && toughness(tok)})`); }

section('Reflecting Pool mirrors your other lands');
{ const d = newDuel(); mainPhase(d); const rp = place(d, D('Reflecting Pool'), 0);
  ok(rp.def.kind === 'land' && rp.def.status !== 'unsupported', 'compiles as a land');
  ok(!d.manaSources(d.players[0]).some(s => s.card === rp), 'nothing to mirror: not offered');
  place(d, D('Island'), 0); place(d, D('Mountain'), 0);
  const src = d.manaSources(d.players[0]).find(s => s.card === rp); ok(src && src.produces.includes('U') && src.produces.includes('R'), `mirrors U and R (${src && src.produces.join('')})`);
  ok(d.activateMana(d.players[0], rp, 0, 'R') && d.players[0].pool.R === 1, 'taps for red'); }

section('Cunning Wish fetches from the sideboard');
{ const d = newDuel({ player: { sideboard: [D('Counterspell'), D('Island')] } }); mainPhase(d); pool(d, 0, { U: 3 }); const cw = hand(d, D('Cunning Wish'), 0);
  ok(d.players[0].sideboard.length === 2, 'sideboard loaded');
  ok(d.cast(d.players[0], cw, { targets: [] }), 'cast'); resolveAll(d);
  const got = d.players[0].hand.find(c => c.def.name === 'Counterspell');
  ok(!!got && got.zone === 'hand' && d.players[0].sideboard.length === 1, `Counterspell wished into hand, sideboard shrank (${d.players[0].sideboard.length})`);
  ok(cw.zone === 'exile', `Wish exiled itself (zone=${cw.zone})`); }

section('Crumbling Sanctuary turns damage into exile');
{ const d = newDuel(); mainPhase(d); place(d, D('Crumbling Sanctuary'), 0); for (let i = 0; i < 5; i++) lib(d, D('Island'), 1); const gb = place(d, bears(), 0);
  d.dealDamage(gb, d.players[1], 3);
  ok(d.players[1].life === 20 && d.players[1].exile.length === 3 && d.players[1].library.length === 2, `no life lost, 3 cards exiled (life=${d.players[1].life}, exile=${d.players[1].exile.length})`); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
