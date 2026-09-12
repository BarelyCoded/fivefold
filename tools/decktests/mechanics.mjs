// Runtime checks for the Premodern deck cards: every fixed mechanic is driven in a live Duel.
//   node tools/decktests/mechanics.mjs   (also unsupported.mjs, sideboards.mjs)
// Runtime checks for the Premodern deck-audit fixes: every mechanic is exercised in a live Duel, not just compiled.
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
function drive(gen, targets = [], chooser = null) {
  let r = gen.next();
  while (!r.done) {
    const y = r.value;
    if (y.kind === 'target') r = gen.next(targets.shift());
    else if (y.kind === 'yesno') r = gen.next(true);
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
const processAndResolve = (d, targets = [], chooser = null) => { drive(d.processEvents(), targets, chooser); while (d.stack.length) drive(d.resolveTop(), targets, chooser); };

section('Squee returns from the graveyard at upkeep');
{ const d = newDuel(); mainPhase(d); const sq = gy(d, D('Squee, Goblin Nabob'), 0);
  d.fireEvent({ type: 'upkeep', player: 0 }); drive(d.processEvents());
  ok(d.stack.some(it => it.card === sq), 'Squee trigger on the stack'); drive(d.resolveTop());
  ok(sq.zone === 'hand', `Squee back in hand (zone=${sq.zone})`); }

section('Nether Shadow needs three creature cards above it');
{ const d = newDuel(); mainPhase(d); const sh = gy(d, D('Nether Shadow'), 0); gy(d, bears(), 0); gy(d, bears(), 0);
  d.fireEvent({ type: 'upkeep', player: 0 }); drive(d.processEvents());
  ok(!d.stack.length, 'no trigger with only two above');
  gy(d, bears(), 0); d.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d);
  ok(sh.zone === 'battlefield', `Nether Shadow returns with three above (zone=${sh.zone})`); }

section('Krovikan Horror wants a creature card directly above it');
{ const d = newDuel(); mainPhase(d); const kh = gy(d, D('Krovikan Horror'), 0); gy(d, D('Island'), 0);
  d.fireEvent({ type: 'endstep', player: 0 }); drive(d.processEvents()); ok(!d.stack.length, 'no trigger under a land');
  const d2 = newDuel(); mainPhase(d2); const kh2 = gy(d2, D('Krovikan Horror'), 0); gy(d2, bears(), 0);
  d2.fireEvent({ type: 'endstep', player: 0 }); processAndResolve(d2); ok(kh2.zone === 'hand', `returns to hand under a creature (zone=${kh2.zone})`); }

section('Death Spark pays {1} to return');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { R: 1 }); const ds = gy(d, D('Death Spark'), 0); gy(d, bears(), 0);
  d.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d);
  ok(ds.zone === 'hand', `Death Spark back in hand (zone=${ds.zone})`); ok(d.players[0].pool.R === 0, 'paid the {1}'); }

section('Ashen Ghoul activates from the graveyard during upkeep');
{ const d = newDuel(); mainPhase(d); d.step = 'upkeep'; pool(d, 0, { B: 1 }); const g = gy(d, D('Ashen Ghoul'), 0); gy(d, bears(), 0); gy(d, bears(), 0);
  const i = abIdx(g.def, a => a.type === 'activated'); ok(i >= 0 && g.def.abilities[i].zone === 'graveyard', 'ability is graveyard-zoned');
  ok(!d.canActivate(d.players[0], g, i), 'cannot activate with two above');
  gy(d, bears(), 0); ok(d.canActivate(d.players[0], g, i), 'can activate with three above');
  ok(d.activate(d.players[0], g, i, { targets: [] }), 'activation accepted'); while (d.stack.length) drive(d.resolveTop());
  ok(g.zone === 'battlefield', `Ashen Ghoul on the battlefield (zone=${g.zone})`); }

section('Duress takes a noncreature, nonland card');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { B: 1 }); const du = hand(d, D('Duress'), 0);
  const cs = hand(d, D('Counterspell'), 1), gb = hand(d, bears(), 1), is = hand(d, D('Island'), 1);
  ok(d.cast(d.players[0], du, { targets: [{ type: 'player', idx: 1 }] }), 'Duress cast'); while (d.stack.length) drive(d.resolveTop());
  ok(cs.zone === 'graveyard' && gb.zone === 'hand' && is.zone === 'hand', `Counterspell discarded, creature and land kept (${cs.zone}/${gb.zone}/${is.zone})`); }

section('Unmask takes any nonland card');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { B: 4 }); const um = hand(d, D('Unmask'), 0);
  const gb = hand(d, bears(), 1), is = hand(d, D('Island'), 1);
  ok(d.cast(d.players[0], um, { targets: [{ type: 'player', idx: 1 }] }), 'Unmask cast'); while (d.stack.length) drive(d.resolveTop());
  ok(gb.zone === 'graveyard' && is.zone === 'hand', `creature discarded, land kept (${gb.zone}/${is.zone})`); }

section('Mesmeric Fiend exiles a card and gives it back when it leaves');
{ const d = newDuel(); mainPhase(d); const gb = hand(d, bears(), 1), is = hand(d, D('Island'), 1);
  const mf = d.instance(D('Mesmeric Fiend'), 0); d.moveTo(mf, 'battlefield'); processAndResolve(d, [{ type: 'player', idx: 1 }]);
  ok(gb.zone === 'exile' && is.zone === 'hand', `nonland card exiled (${gb.zone}), land kept`);
  d.moveTo(mf, 'graveyard'); processAndResolve(d);
  ok(gb.zone === 'hand', `exiled card returned to hand when Fiend left (zone=${gb.zone})`); }

section('Goblin Lackey drops a Goblin from hand on damage');
{ const d = newDuel(); mainPhase(d); const gl = place(d, D('Goblin Lackey'), 0); const gp = hand(d, pile(), 0); hand(d, bears(), 0);
  d.dealDamage(gl, d.players[1], 1); processAndResolve(d);
  ok(gp.zone === 'battlefield', `Piledriver put onto the battlefield (zone=${gp.zone})`); }

section('Goblin Ringleader reveals four, keeps the Goblins');
{ const d = newDuel(); mainPhase(d); const is = lib(d, D('Island'), 0); const p1 = lib(d, pile(), 0); lib(d, D('Mountain'), 0); const gl = lib(d, D('Goblin Lackey'), 0); const gb = lib(d, bears(), 0);
  const rl = d.instance(D('Goblin Ringleader'), 0); d.moveTo(rl, 'battlefield'); processAndResolve(d);
  ok(p1.zone === 'hand' && gl.zone === 'hand', 'both Goblins to hand');
  ok(gb.zone === 'library' && d.players[0].library[d.players[0].library.length - 1] === is, `non-Goblins to the bottom, Island still on top (lib=${d.players[0].library.map(c => c.def.name).join(',')})`); }

section('Wall of Roots: counter for mana, once per turn');
{ const d = newDuel(); mainPhase(d); const w = place(d, D('Wall of Roots'), 0);
  ok(d.manaSources(d.players[0]).some(s => s.card === w), 'offered as a mana source');
  ok(d.activateMana(d.players[0], w, 0, 'G'), 'adds G'); d.refresh();
  ok(d.players[0].pool.G === 1 && (w.counters['-0/-1'] || 0) === 1 && toughness(w) === 4 && !w.tapped, `G added, -0/-1 counter, 0/4 now, untapped (t=${toughness(w)})`);
  ok(!d.activateMana(d.players[0], w, 0, 'G'), 'second activation this turn refused');
  ok(!d.manaSources(d.players[0]).some(s => s.card === w), 'no longer offered this turn'); }

section('Metalworker adds two per artifact revealed');
{ const d = newDuel(); mainPhase(d); const mw = place(d, D('Metalworker'), 0); hand(d, D('Mind Stone'), 0); hand(d, D('Mind Stone'), 0); hand(d, bears(), 0);
  const src = d.manaSources(d.players[0]).find(s => s.card === mw); ok(src && src.amount === 4, `source amount 4 (got ${src?.amount})`);
  ok(d.activateMana(d.players[0], mw, 0, 'C') && d.players[0].pool.C === 4, `pool C=${d.players[0].pool.C}`); }

section('Powder Keg blows up mana value = fuse counters');
{ const d = newDuel(); mainPhase(d); const keg = place(d, D('Powder Keg'), 0); keg.counters.fuse = 2;
  const ms = place(d, D('Mind Stone'), 1), gb = place(d, bears(), 1), mc = place(d, D('Masticore'), 1);
  const i = abIdx(keg.def, a => a.type === 'activated'); ok(d.activate(d.players[0], keg, i, { targets: [] }), 'Keg activated'); while (d.stack.length) drive(d.resolveTop());
  ok(ms.zone === 'graveyard' && gb.zone === 'graveyard' && mc.zone === 'battlefield', `cmc-2 things died, Masticore lived (${ms.zone}/${gb.zone}/${mc.zone})`); }

section('Karn animates a noncreature artifact');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { R: 1 }); const k = place(d, D('Karn, Silver Golem'), 0); const ms = place(d, D('Mind Stone'), 0);
  const i = abIdx(k.def, a => a.type === 'activated' && a.effects[0]?.type === 'animateTarget'); ok(i >= 0, 'animate ability parsed');
  ok(d.activate(d.players[0], k, i, { targets: [{ type: 'perm', id: ms.id }] }), 'Karn activated'); while (d.stack.length) drive(d.resolveTop()); d.refresh();
  ok(isCreature(ms) && power(ms) === 2 && toughness(ms) === 2, `Mind Stone is a 2/2 creature (${power(ms)}/${toughness(ms)})`); }

section('Fireblast: sacrifice two Mountains instead of paying');
{ const d = newDuel(); mainPhase(d); const m1 = place(d, D('Mountain'), 0), m2 = place(d, D('Mountain'), 0); const fb = hand(d, D('Fireblast'), 0);
  ok(d.canCast(d.players[0], fb, { sacLands: true, targets: [{ type: 'player', idx: 1 }] }), 'castable with no mana via sacrifice');
  ok(d.cast(d.players[0], fb, { sacLands: true, targets: [{ type: 'player', idx: 1 }] }), 'cast'); while (d.stack.length) drive(d.resolveTop());
  ok(d.players[1].life === 16 && m1.zone === 'graveyard' && m2.zone === 'graveyard', `4 damage dealt, both Mountains gone (life=${d.players[1].life})`); }

section('Undiscovered Paradise flags itself to bounce');
{ const d = newDuel(); mainPhase(d); const up = place(d, D('Undiscovered Paradise'), 0);
  ok(d.activateMana(d.players[0], up, 0, 'R'), 'tapped for mana'); ok(up.flags.has('bounceOnUntap'), 'bounce flag set for the next untap step'); }

section('Animate Dead reanimates, shrinks, and takes the creature with it');
{ const d = newDuel(); mainPhase(d); const gb = gy(d, bears(), 1);
  const ad = d.instance(D('Animate Dead'), 0); d.moveTo(ad, 'battlefield'); d.sba(); ok(ad.zone === 'battlefield', 'not killed by SBA before its trigger resolves');
  processAndResolve(d, [{ type: 'card', id: gb.id }]);
  ok(gb.zone === 'battlefield' && gb.controller === 0 && ad.attachedTo === gb, `Bears returned under my control, enchanted (zone=${gb.zone}, ctrl=${gb.controller})`);
  d.refresh(); ok(power(gb) === 1 && toughness(gb) === 2, `Bears are 1/2 (${power(gb)}/${toughness(gb)})`);
  d.moveTo(ad, 'graveyard'); ok(gb.zone === 'graveyard', `Bears sacrificed when Animate Dead left (zone=${gb.zone})`); }

section('Putrid Imp threshold');
{ const d = newDuel(); mainPhase(d); const imp = place(d, D('Putrid Imp'), 0); for (let i = 0; i < 6; i++) gy(d, D('Island'), 0); d.refresh();
  ok(power(imp) === 1 && !imp.cur.flags.has('cantBlock'), 'plain 1/1 with six in the yard');
  gy(d, D('Island'), 0); d.refresh(); ok(power(imp) === 2 && toughness(imp) === 2 && imp.cur.flags.has('cantBlock'), `2/2 and can't block at seven (${power(imp)}/${toughness(imp)})`); }

section('Masticore: discard to keep it, or lose it');
{ const d = newDuel(); mainPhase(d); const mc = place(d, D('Masticore'), 0); const is = hand(d, D('Island'), 0);
  d.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d);
  ok(mc.zone === 'battlefield' && is.zone === 'graveyard', `kept by discarding (${mc.zone}, Island ${is.zone})`);
  d.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d);
  ok(mc.zone === 'graveyard', `sacrificed with an empty hand (zone=${mc.zone})`); }

section('City of Traitors survives its own arrival, dies to the next land');
{ const d = newDuel(); mainPhase(d); const ct = d.instance(D('City of Traitors'), 0); d.moveTo(ct, 'battlefield'); processAndResolve(d);
  ok(ct.zone === 'battlefield', 'still here after entering');
  const m = d.instance(D('Mountain'), 0); d.moveTo(m, 'battlefield'); processAndResolve(d);
  ok(ct.zone === 'graveyard', `sacrificed when another land was played (zone=${ct.zone})`); }

section('Clickslither eats a Goblin');
{ const d = newDuel(); mainPhase(d); const ck = place(d, D('Clickslither'), 0); const gp = place(d, pile(), 0);
  const i = abIdx(ck.def, a => a.type === 'activated'); ok(d.activate(d.players[0], ck, i, { targets: [], sacrifice: [gp.id] }), 'activated'); while (d.stack.length) drive(d.resolveTop()); d.refresh();
  ok(gp.zone === 'graveyard' && power(ck) === 5 && toughness(ck) === 5 && has(ck, 'Trample'), `Goblin gone, 5/5 trample (${power(ck)}/${toughness(ck)})`); }

section('Gemstone Mine runs dry');
{ const d = newDuel(); mainPhase(d); const gm = d.instance(D('Gemstone Mine'), 0); d.moveTo(gm, 'battlefield');
  ok((gm.counters.mining || 0) === 3, `enters with three mining counters (${gm.counters.mining})`);
  for (let i = 0; i < 3; i++) { gm.tapped = false; d.activateMana(d.players[0], gm, 0, 'G'); }
  ok(gm.zone === 'graveyard', `sacrificed after the third use (zone=${gm.zone})`); }

section('Decree of Justice: cycle, pay X, make Soldiers');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { W: 1, R: 5 }); const dj = hand(d, D('Decree of Justice'), 0); lib(d, D('Island'), 0);
  ok(d.cast(d.players[0], dj, { cycling: true }), 'cycled'); processAndResolve(d);
  const tokens = d.players[0].battlefield.filter(c => c.token);
  ok(tokens.length === 3, `X=3 Soldier tokens made (${tokens.length})`); }

section('Price of Progress');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { R: 2 }); place(d, D('Mountain'), 0); place(d, D('Rishadan Port'), 1); place(d, D('Rishadan Port'), 1);
  const pp = hand(d, D('Price of Progress'), 0); ok(d.cast(d.players[0], pp, { targets: [] }), 'cast'); while (d.stack.length) drive(d.resolveTop());
  ok(d.players[1].life === 16 && d.players[0].life === 20, `4 to the nonbasic player, 0 to me (${d.players[0].life}/${d.players[1].life})`); }

section('Jackal Pup bites back');
{ const d = newDuel(); mainPhase(d); const jp = place(d, D('Jackal Pup'), 0); const gb = place(d, bears(), 1);
  d.dealDamage(gb, jp, 1); processAndResolve(d); ok(d.players[0].life === 19, `controller took 1 (life=${d.players[0].life})`); }

section('Vendetta costs toughness in life');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { B: 1 }); const gb = place(d, bears(), 1); const v = hand(d, D('Vendetta'), 0);
  ok(d.cast(d.players[0], v, { targets: [{ type: 'perm', id: gb.id }] }), 'cast'); while (d.stack.length) drive(d.resolveTop());
  ok(gb.zone === 'graveyard' && d.players[0].life === 18, `Bears dead, lost 2 life (life=${d.players[0].life})`); }

section('Recall: {X}{X}{U} discards X, returns that many from the graveyard, exiles itself');
{ const d = newDuel(); mainPhase(d); const rc = hand(d, D('Recall'), 0); const b1 = hand(d, bears(), 0), b2 = hand(d, bears(), 0); const g1 = gy(d, D('Lightning Bolt'), 0), g2 = gy(d, D('Counterspell'), 0);
  pool(d, 0, { U: 1 }); ok(!d.canCast(d.players[0], rc, { x: 1 }), 'X=1 needs three mana ({X}{X}{U}), one is not enough');
  ok(d.canCast(d.players[0], rc, { x: 0 }), 'X=0 castable for {U}');
  pool(d, 0, { U: 3 }); ok(d.canCast(d.players[0], rc, { x: 1 }), 'X=1 castable with three mana');
  ok(!d.canCast(d.players[0], rc, { x: 2 }), 'X=2 needs five mana');
  ok(d.cast(d.players[0], rc, { x: 1 }), 'cast with X=1');
  ok(d.players[0].pool.U === 0, `all three mana paid (U=${d.players[0].pool.U})`);
  const asked = []; processAndResolve(d, [], y => { asked.push(y.text); return y.text.startsWith('Discard') ? [b1.id] : [g2.id]; });
  ok(asked.length === 2 && /Discard 1 card/.test(asked[0]) && /return 1 card/.test(asked[1]), `asked to discard, then to pick from the graveyard (${asked.join(' | ')})`);
  ok(b1.zone === 'graveyard' && g2.zone === 'hand' && g1.zone === 'graveyard' && b2.zone === 'hand', `Bears discarded, Counterspell returned (${b1.zone}/${g2.zone})`);
  ok(rc.zone === 'exile', `Recall exiled itself (zone=${rc.zone})`); }

section('Recall with X=0 does nothing but exile itself');
{ const d = newDuel(); mainPhase(d); const rc = hand(d, D('Recall'), 0); hand(d, bears(), 0); gy(d, bears(), 0); pool(d, 0, { U: 1 });
  ok(d.cast(d.players[0], rc, { x: 0 }), 'cast for {U}'); let asked = 0; processAndResolve(d, [], y => { asked++; return []; });
  ok(asked === 0 && d.players[0].hand.length === 1 && d.players[0].graveyard.length === 1 && rc.zone === 'exile', `nothing discarded or returned, Recall exiled (asked=${asked})`); }

section('Frantic Search: draw two, discard two, untap up to three lands');
{ const d = newDuel(); mainPhase(d); const fs_ = hand(d, D('Frantic Search'), 0); const l = [1, 2, 3, 4].map(() => place(d, D('Island'), 0)); for (const c of l) c.tapped = true;
  for (let i = 0; i < 4; i++) lib(d, bears(), 0); pool(d, 0, { U: 3 });
  ok(d.cast(d.players[0], fs_, {}), 'cast');
  const asked = []; processAndResolve(d, [], y => { asked.push(y.text); return y.text.startsWith('Discard') ? y.options.slice(0, 2).map(o => o.id) : [l[0].id, l[1].id]; });
  ok(asked.some(t => /Discard 2 cards/.test(t)) && asked.some(t => /untap up to 3 of your lands/.test(t)), `asked to discard two and untap up to three (${asked.join(' | ')})`);
  ok(d.players[0].hand.length === 0 && d.players[0].graveyard.length === 3, `drew two, discarded two, Search in the graveyard (hand ${d.players[0].hand.length}, gy ${d.players[0].graveyard.length})`);
  ok(!l[0].tapped && !l[1].tapped && l[2].tapped && l[3].tapped, 'the two chosen lands untapped, the others stay tapped'); }

section('Cloud of Faeries untaps up to two lands as it enters');
{ const d = newDuel(); mainPhase(d); const l = [1, 2, 3].map(() => place(d, D('Island'), 0)); for (const c of l) c.tapped = true; pool(d, 0, { U: 2 });
  const cf = hand(d, D('Cloud of Faeries'), 0); ok(d.cast(d.players[0], cf, {}), 'cast');
  const ch = y => /untap up to 2/.test(y.text) ? [l[2].id] : [];
  processAndResolve(d, [], ch); processAndResolve(d, [], ch);   // the spell resolves, then its enters-the-battlefield trigger
  ok(cf.zone === 'battlefield' && !l[2].tapped && l[0].tapped && l[1].tapped, `entered and untapped the chosen land only (${l.map(c => c.tapped ? 'T' : 'U').join('')})`); }

section('Standstill: whoever casts, their opponent draws three');
{ const d = newDuel(); mainPhase(d); const ss = place(d, D('Standstill'), 1); for (let i = 0; i < 5; i++) { lib(d, bears(), 0); lib(d, bears(), 1); }
  const bolt = hand(d, D('Lightning Bolt'), 0); pool(d, 0, { R: 1 });
  ok(d.cast(d.players[0], bolt, { targets: [{ type: 'player', idx: 1 }] }), 'the opponent of Standstill\'s controller casts a spell');
  drive(d.processEvents()); ok(d.stack.some(it => it.card === ss), 'Standstill triggers');
  const h0 = d.players[0].hand.length, h1 = d.players[1].hand.length;
  drive(d.resolveTop());   // the trigger resolves first (on top of the Bolt)
  ok(ss.zone === 'graveyard', `Standstill sacrificed (zone=${ss.zone})`);
  ok(d.players[1].hand.length === h1 + 3 && d.players[0].hand.length === h0, `the caster's opponent (Standstill's controller) drew three (${d.players[1].hand.length - h1}/${d.players[0].hand.length - h0})`);
  // and the other way round: its controller casts, the other player draws
  const d2 = newDuel(); mainPhase(d2); d2.active = 1; d2.priority = 1; const ss2 = place(d2, D('Standstill'), 1); for (let i = 0; i < 5; i++) { lib(d2, bears(), 0); lib(d2, bears(), 1); }
  const keg = hand(d2, D('Powder Keg'), 1); pool(d2, 1, { U: 2 }); ok(d2.cast(d2.players[1], keg, {}), 'Standstill\'s controller casts');
  drive(d2.processEvents()); const g0 = d2.players[0].hand.length; drive(d2.resolveTop());
  ok(ss2.zone === 'graveyard' && d2.players[0].hand.length === g0 + 3, `sacrificed and the other player drew three (${d2.players[0].hand.length - g0})`); }

section('Cursed Scroll: the player names the card');
{ const d = newDuel(); mainPhase(d); const cs = place(d, D('Cursed Scroll'), 0); pool(d, 0, { R: 3 }); const a = hand(d, D('Lightning Bolt'), 0), b = hand(d, D('Lightning Bolt'), 0);
  const i = abIdx(cs.def, x => x.type === 'activated'); ok(d.activate(d.players[0], cs, i, { targets: [{ type: 'player', idx: 1 }] }), 'activated');
  const asked = []; processAndResolve(d, [], y => { asked.push(y); return [a.id]; });
  ok(asked.length === 1 && /name a card/.test(asked[0].text) && asked[0].options.length === 1 && /Lightning Bolt \(×2\)/.test(asked[0].options[0].label), `asked for a name, one option per distinct name (${asked[0]?.options.map(o => o.label).join(', ')})`);
  ok(d.players[1].life === 18, `two Bolts in hand, Bolt named: a guaranteed hit (life ${d.players[1].life})`); }

section("Lat-Nam's Legacy: shuffle a card in, draw two at the next upkeep");
{ const d = newDuel(); mainPhase(d); const ll = hand(d, D("Lat-Nam's Legacy"), 0); const b = hand(d, bears(), 0); for (let i = 0; i < 4; i++) lib(d, D('Island'), 0); pool(d, 0, { U: 2 });
  ok(d.cast(d.players[0], ll, {}), 'cast');
  processAndResolve(d, [], y => /shuffle 1 card/.test(y.text) ? [b.id] : []);
  ok(b.zone === 'library' && d.players[0].hand.length === 0, `Bears shuffled into the library (zone=${b.zone})`);
  ok(d.delayed.some(x => x.type === 'draw' && x.amount === 2 && x.player === 0), 'a two-card draw is scheduled for the next upkeep');
  const d2 = newDuel(); mainPhase(d2); const l2 = hand(d2, D("Lat-Nam's Legacy"), 0); for (let i = 0; i < 4; i++) lib(d2, D('Island'), 0); pool(d2, 0, { U: 2 });
  d2.cast(d2.players[0], l2, {}); processAndResolve(d2);
  ok(!d2.delayed.length && d2.players[0].hand.length === 0, `with no card to shuffle in, "if you do" fails and no draw is scheduled (${d2.delayed.length})`); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
