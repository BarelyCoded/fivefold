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

section('Decree of Justice: cycle, then choose X (not forced to spend all mana)');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { W: 1, R: 5 }); const dj = hand(d, D('Decree of Justice'), 0); lib(d, D('Island'), 0);
  ok(d.cast(d.players[0], dj, { cycling: true }), 'cycled');
  const asked = []; processAndResolve(d, [], null, y => { asked.push(y); return 2; });   // affordable up to X=6; the player picks 2
  ok(asked.length === 1 && asked[0].kind === 'number' && asked[0].max === 3, `asked for an X value up to the mana left after cycling (max=${asked[0]?.max})`);
  const tokens = d.players[0].battlefield.filter(c => c.token);
  ok(tokens.length === 2, `made exactly the X the player chose (${tokens.length})`);
  ok(Object.values(d.players[0].pool).reduce((a, b) => a + b, 0) === 1, `only 2 of the 3 remaining mana spent, 1 still floating (${JSON.stringify(d.players[0].pool)})`); }

section('Decree of Justice: X=0 declines the trigger, no tokens');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { W: 1, R: 5 }); const dj = hand(d, D('Decree of Justice'), 0); lib(d, D('Island'), 0);
  ok(d.cast(d.players[0], dj, { cycling: true }), 'cycled'); processAndResolve(d, [], null, () => 0);
  ok(d.players[0].battlefield.filter(c => c.token).length === 0, 'X=0: no Soldiers'); }

section('Decree of Justice: the AI takes the maximum X');
{ const d = newDuel(); mainPhase(d); d.players[0].ai = true; pool(d, 0, { W: 1, R: 5 }); const dj = hand(d, D('Decree of Justice'), 0); lib(d, D('Island'), 0);
  ok(d.cast(d.players[0], dj, { cycling: true }), 'cycled'); processAndResolve(d);
  ok(d.players[0].battlefield.filter(c => c.token).length === 3, `AI spent the three left after cycling (${d.players[0].battlefield.filter(c => c.token).length})`); }

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

section('Llanowar Wastes taps only once: one mana per activation, not two');
{ const d = newDuel(); mainPhase(d); const lw = place(d, D('Llanowar Wastes'), 0); lw.sick = false;
  const surv = hand(d, D('Survival of the Fittest'), 0);   // {1}{G}
  ok(!d.canCast(d.players[0], surv, {}), 'one Llanowar Wastes cannot pay {1}{G} (two mana from one tap)');
  const lw2 = place(d, D('Llanowar Wastes'), 0); lw2.sick = false;
  ok(d.canCast(d.players[0], surv, {}), 'two Llanowar Wastes can pay {1}{G}');
  const before = d.players[0].life; ok(d.cast(d.players[0], surv, {}), 'cast'); processAndResolve(d);
  ok(lw.tapped && lw2.tapped, 'both lands are tapped');
  ok(Object.values(d.players[0].pool).reduce((a, b) => a + b, 0) === 0, `no mana left floating (${JSON.stringify(d.players[0].pool)})`);
  ok(d.players[0].life <= before - 1, `at least one point of pain-land damage taken (life ${before} -> ${d.players[0].life})`); }

section('Llanowar Wastes hand-activated: pick one colour, one mana');
{ const d = newDuel(); mainPhase(d); const lw = place(d, D('Llanowar Wastes'), 0); lw.sick = false;
  const i = lw.def.manaAbilities.findIndex(m => m.produces.includes('B') && m.produces.includes('G'));
  ok(d.activateMana(d.players[0], lw, i, 'G'), 'tap for green');
  ok(d.players[0].pool.G === 1 && d.players[0].pool.B === 0 && lw.tapped, `exactly one green added (${JSON.stringify(d.players[0].pool)})`); }

section('Draws are logged: the viewer sees card names, the opponent only a count');
{ const d = newDuel(); mainPhase(d); d.logViewer = 0; lib(d, D('Lightning Bolt'), 0); lib(d, D('Counterspell'), 1);
  d.drawCards(d.players[0], 1); ok(d.log.some(l => /A draws Counterspell|A draws Lightning Bolt/.test(l)), `the viewer's draw is named (${d.log.slice(-1)})`);
  d.drawCards(d.players[1], 1); ok(d.log.some(l => /B draws a card/.test(l)) && !d.log.some(l => /B draws (Lightning Bolt|Counterspell)/.test(l)), `the opponent's draw is a count only (${d.log.slice(-1)})`); }

section('Cinder Marsh: makes B or R, and stays tapped through the next untap step');
{ const d = newDuel(); mainPhase(d); const cm = place(d, D('Cinder Marsh'), 0); cm.sick = false;
  const ii = cm.def.manaAbilities.findIndex(m => m.produces.includes('B') && m.produces.includes('R'));
  ok(ii >= 0, 'has a B-or-R mana ability (not just colorless)');
  ok(d.activateMana(d.players[0], cm, ii, 'R'), 'tap for red');
  ok(d.players[0].pool.R === 1 && d.players[0].pool.B === 0 && cm.tapped, `one red added, land tapped (${JSON.stringify({R:d.players[0].pool.R,B:d.players[0].pool.B})})`);
  ok(cm.flags.has('noUntapNext'), 'flagged to skip its next untap step'); }

section('Threshold: creature grows once seven cards are in the graveyard');
{ const d = newDuel(); mainPhase(d); const w = place(d, D('Werebear'), 0);
  ok(power(w) === 1 && toughness(w) === 1, `1/1 below threshold (${power(w)}/${toughness(w)})`);
  for (let i = 0; i < 7; i++) gy(d, bears(), 0); d.refresh();
  ok(power(w) === 4 && toughness(w) === 4, `4/4 with threshold (${power(w)}/${toughness(w)})`); }

section("Blurred Mongoose can't be countered");
{ const d = newDuel(); mainPhase(d); d.players[1].pool = { W:0,U:2,B:0,R:0,G:0,C:0 }; const bm = hand(d, D('Blurred Mongoose'), 0); pool(d, 0, { G:1, C:1 });
  ok(d.cast(d.players[0], bm, {}), 'cast the Mongoose'); const item = d.stack[d.stack.length - 1];
  const cs = hand(d, D('Counterspell'), 1); d.priority = 1;
  ok(d.cast(d.players[1], cs, { targets: [{ type: 'spell', id: item.id }] }), 'opponent casts Counterspell at it');
  while (d.stack.length) drive(d.resolveTop());
  ok(d.card(bm.id)?.zone === 'battlefield', `the Mongoose resolved despite the counter (zone=${d.card(bm.id)?.zone})`); }

section('Amplify: enters with a counter per revealed sharing card');
{ const d = newDuel(); mainPhase(d); const h1 = hand(d, D('Aven Warhawk'), 0); const h2 = hand(d, D('Aven Warhawk'), 0); pool(d, 0, { W:1, C:4 });
  ok(d.cast(d.players[0], h1, {}), 'cast one Warhawk (another shares Bird/Soldier in hand)');
  processAndResolve(d, [], y => y.options ? y.options.map(o => o.id) : []);   // reveal all
  const warhawk = d.players[0].battlefield.find(c => c.def.name === 'Aven Warhawk');
  ok((warhawk.counters['+1/+1'] || 0) === 1, `entered with 1 +1/+1 counter from the revealed Warhawk (${warhawk.counters['+1/+1']})`); }

section('Rebel search: fetch a Rebel of low mana value to the battlefield');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { C:3 }); const rs = place(d, D('Ramosian Sergeant'), 0); rs.sick = false;
  const small = lib(d, D('Ramosian Lieutenant'), 0);   // a Rebel; MV check handled by the engine
  const i = abIdx(rs.def, a => a.type === 'activated');
  if (i >= 0 && d.activate(d.players[0], rs, i, {})) { processAndResolve(d, [], y => y.options ? [y.options[0].id] : []);
    ok(d.players[0].battlefield.some(c => c.def.subtypes.includes('Rebel') && c !== rs), 'a Rebel was put onto the battlefield'); }
  else ok(false, 'could not activate the Rebel search'); }

section('Cabal Ritual: three black, or five with threshold');
{ const d = newDuel(); mainPhase(d); const cr = hand(d, D('Cabal Ritual'), 0); pool(d, 0, { B:2 });
  ok(d.cast(d.players[0], cr, {}), 'cast'); while (d.stack.length) drive(d.resolveTop());
  ok(d.players[0].pool.B === 3, `three black with no threshold (${d.players[0].pool.B})`);
  const d2 = newDuel(); mainPhase(d2); const cr2 = hand(d2, D('Cabal Ritual'), 0); pool(d2, 0, { B:2 }); for (let i = 0; i < 7; i++) gy(d2, bears(), 0);
  ok(d2.cast(d2.players[0], cr2, {}), 'cast with threshold'); while (d2.stack.length) drive(d2.resolveTop());
  ok(d2.players[0].pool.B === 5, `five black with threshold (${d2.players[0].pool.B})`); }

section('Recurring Aura returns to hand when it dies');
{ const d = newDuel(); mainPhase(d); const bear = place(d, bears(), 1); const cess = D('Cessation'); const aura = d.instance(cess, 0); aura.zone = 'battlefield'; aura.attachedTo = bear; d.players[0].battlefield.push(aura); d.refresh();
  d.destroy(bear, true); d.sba(); processAndResolve(d);
  ok(d.card(aura.id)?.zone === 'hand', `Cessation returned to hand after falling off (${d.card(aura.id)?.zone})`); }

section('Depletion land: enters tapped with two counters, makes double mana');
{ const d = newDuel(); mainPhase(d); const hw = D('Hickory Woodlot'); const c = d.instance(hw, 0); c.zone = 'library'; d.players[0].library.push(c);
  d.players[0].landPlayed = 0; d.playLand ? null : null;
  const inst = d.instance(hw, 0); inst.zone = 'battlefield'; d.players[0].battlefield.push(inst);
  for (const ab of inst.def.abilities) if (ab.kind === 'entersWithCounters') inst.counters[ab.counter] = (inst.counters[ab.counter] || 0) + ab.amount;
  if (inst.def.abilities.some(a => a.kind === 'entersTapped')) inst.tapped = true;
  ok((inst.counters['depletion'] || 0) === 2 && inst.tapped, `enters tapped with two depletion counters (${inst.counters['depletion']}, tapped=${inst.tapped})`); }

section('Cho-Manno: all damage to it is prevented');
{ const d = newDuel(); mainPhase(d); const cho = place(d, D('Cho-Manno, Revolutionary'), 0); const bolt = hand(d, D('Lightning Bolt'), 1); pool(d, 1, { R:1 }); d.priority = 1;
  ok(d.cast(d.players[1], bolt, { targets: [{ type: 'perm', id: cho.id }] }), 'Bolt targets Cho-Manno');
  while (d.stack.length) drive(d.resolveTop());
  ok(cho.damage === 0 && cho.zone === 'battlefield', `no damage marked, Cho-Manno lives (${cho.damage} dmg)`); }

section('Spirit Flare: flashback costs mana and life');
{ const d = newDuel(); mainPhase(d); const sf = D('Spirit Flare'); const g = gy(d, sf, 0); pool(d, 0, { W:1, C:1 }); d.players[0].life = 20;
  const fb = g.def.keywords.find(k => k.k === 'Flashback');
  ok(fb && fb.life === 3 && fb.cost.generic === 1, `flashback is {1}{W} plus 3 life (${JSON.stringify(fb?.cost)}, life ${fb?.life})`); }

section('Daru Cavalier: on entry, fetch another copy to hand');
{ const d = newDuel(); mainPhase(d); const lib1 = lib(d, D('Daru Cavalier'), 0); lib(d, D('Grizzly Bears'), 0);
  const dc = place(d, D('Daru Cavalier'), 0);
  d.fireEvent({ type: 'etb', card: dc }); processAndResolve(d, [], y => y.options ? [y.options[0].id] : []);
  ok(d.card(lib1.id)?.zone === 'hand', `a second Daru Cavalier was fetched to hand (${d.card(lib1.id)?.zone})`); }

section('Cabal Therapy: the caster names blind, discards every copy that matches');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { B:1 }); const ct = hand(d, D('Cabal Therapy'), 0);
  const s1 = hand(d, D('Standstill'), 1), s2 = hand(d, D('Standstill'), 1), wr = hand(d, D('Wrath of God'), 1); gy(d, D('Standstill'), 1);
  const namePool = d.namePool(d.players[0], d.players[1]);
  ok(namePool.some(o => /Standstill/.test(o.label)) && !namePool.some(o => /Wrath of God/.test(o.label)), 'the name pool holds public cards (Standstill in gy) but not the hidden Wrath of God');
  ok(d.cast(d.players[0], ct, { targets: [{ type: 'player', idx: 1 }] }), 'cast');
  processAndResolve(d, [], y => y.options ? [y.options.find(o => /Standstill/.test(o.label)).id] : []);
  ok(s1.zone === 'graveyard' && s2.zone === 'graveyard' && wr.zone === 'hand', `both Standstills discarded, Wrath kept (${s1.zone}/${s2.zone}/${wr.zone})`); }

section('Cabal Therapy AI names from public info, not the hidden hand');
{ const d = newDuel(); mainPhase(d); d.active = 1; d.priority = 1; pool(d, 1, { B:1 }); const ct = hand(d, D('Cabal Therapy'), 1);
  const s1 = hand(d, D('Standstill'), 0); gy(d, D('Counterspell'), 0);   // the AI can only see the graveyard Counterspell
  ok(d.cast(d.players[1], ct, { targets: [{ type: 'player', idx: 0 }] }), 'AI casts');
  processAndResolve(d);
  ok(s1.zone === 'hand', 'the AI named Counterspell (public) and missed the hidden Standstill'); }

section('Animate Dead needs a creature in a graveyard to be cast');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { B:1, C:1 }); const ad = hand(d, D('Animate Dead'), 0);
  ok(!d.canCast(d.players[0], ad, {}), 'not castable with no creature in any graveyard');
  gy(d, D('Verdant Force'), 0);
  ok(d.canCast(d.players[0], ad, {}), 'castable once a creature is in the graveyard');
  ok(d.cast(d.players[0], ad, {}), 'cast'); processAndResolve(d, [{ type: 'card', id: d.players[0].graveyard.find(c => c.def.name === 'Verdant Force').id }]);
  const vf = d.permanents().find(c => c.def.name === 'Verdant Force');
  ok(vf && vf.zone === 'battlefield', `Verdant Force reanimated (${vf?.zone})`); }

section('Fact or Fiction shows the taker two piles, then puts one in hand and one in the graveyard');
{ const d = newDuel(); mainPhase(d); pool(d, 0, { U:4 }); const ff = hand(d, D('Fact or Fiction'), 0);
  const cards = [D('Island'), bears(), D('Lightning Bolt'), D('Masticore'), D('Mountain')].map(x => lib(d, x, 0));
  ok(d.cast(d.players[0], ff, { targets: [] }), 'cast');
  // drive manually so we can inspect the piles request and take pile 1
  let sawPiles = null; const gen = d.resolveTop(); let r = gen.next();
  while (!r.done) { const y = r.value;
    if (y.kind === 'piles') { sawPiles = y.piles; r = gen.next(0); }
    else if (y.kind === 'choose') r = gen.next(y.options.slice(0, Math.max(y.min, 1)).map(o => o.id));
    else r = gen.next(); }
  ok(sawPiles && sawPiles.length === 2 && sawPiles.every(p => Array.isArray(p.cards)), `a two-pile request was shown with card lists (${sawPiles?.map(p => p.cards.map(c => c.name).join('+')).join(' | ')})`);
  const total = sawPiles.reduce((a, p) => a + p.cards.length, 0); ok(total === 5, `all five cards split across the piles (${total})`);
  const inHand = cards.filter(c => c.zone === 'hand'), inGy = cards.filter(c => c.zone === 'graveyard');
  ok(inHand.length + inGy.length === 5 && inHand.length === sawPiles[0].cards.length, `pile 1 went to hand, the rest to the graveyard (${inHand.length}/${inGy.length})`); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
