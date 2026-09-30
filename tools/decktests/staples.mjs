// Runtime checks for Premodern staples implemented in the card-coverage sweep (mana engines, tutors, riders, …).
//   node tools/decktests/staples.mjs
import fs from 'node:fs';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { compile } = await import(new URL('../../js/cards.js', import.meta.url).href);
const { Duel, power, toughness, isCreature, has, abilitiesOf } = await import(new URL('../../js/engine.js', import.meta.url).href);
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

section('Hatred: pay X life, target creature gets +X/+0');
{ const d = newDuel(); mainPhase(d); const b = place(d, bears(), 0); const h = hand(d, D('Hatred'), 0); pool(d, 0, { B: 2, C: 3 });
  ok(!d.canCast(d.players[0], h, { x: 25, targets: [{ type: 'perm', id: b.id }] }), 'cannot pay more life than you have');
  ok(d.cast(d.players[0], h, { x: 7, targets: [{ type: 'perm', id: b.id }] }), 'cast Hatred for X=7'); ok(d.players[0].life === 13, `paid 7 life (${d.players[0].life})`);
  processAndResolve(d); ok(power(b) === 9, `Bears are ${power(b)}/${toughness(b)}`); }

section('Necrologia: only in your end step; pay X life, draw X');
{ const d = newDuel(); mainPhase(d); for (let k = 0; k < 6; k++) lib(d, bears(), 0); const n = hand(d, D('Necrologia'), 0); pool(d, 0, { B: 2, C: 3 });
  ok(!d.canCast(d.players[0], n, { x: 3 }), 'not castable in the main phase'); d.step = 'end';
  ok(d.cast(d.players[0], n, { x: 3 }), 'castable in my end step'); processAndResolve(d);
  ok(d.players[0].life === 17 && d.players[0].hand.length === 3, `paid 3, drew 3 (${d.players[0].life}, hand ${d.players[0].hand.length})`); }

section('Snuff Out: pay 4 life with a Swamp');
{ const d = newDuel(); mainPhase(d); const b = place(d, bears(), 1); const so = hand(d, D('Snuff Out'), 0); pool(d, 0, {});
  ok(!d.canCast(d.players[0], so, { lifeAlt: true, targets: [{ type: 'perm', id: b.id }] }), 'needs a Swamp');
  place(d, D('Swamp'), 0); ok(d.cast(d.players[0], so, { lifeAlt: true, targets: [{ type: 'perm', id: b.id }] }), 'cast for 4 life');
  processAndResolve(d); ok(d.players[0].life === 16 && b.zone === 'graveyard', `paid 4, creature destroyed (${d.players[0].life}, ${b.zone})`); }

section('Prohibit: mana value 2 or less, 4 or less if kicked');
{ const mk = (kicked, victim) => { const d = newDuel(); mainPhase(d); d.active = 1; d.priority = 1; const v = hand(d, D(victim), 1); pool(d, 1, { W: 2, U: 2, B: 2, R: 2, G: 2, C: 4 });
    d.cast(d.players[1], v, {}); const item = d.stack[d.stack.length - 1]; d.priority = 0; const pr = hand(d, D('Prohibit'), 0); pool(d, 0, { U: 1, C: 3 });
    d.cast(d.players[0], pr, { kicked, targets: [{ type: 'spell', id: item.id }] }); processAndResolve(d); return v.zone; };
  ok(mk(false, 'Grizzly Bears') === 'graveyard', 'counters a 2-drop unkicked');
  ok(mk(false, 'Hill Giant') === 'battlefield', 'does not counter a 4-drop unkicked');
  ok(mk(true, 'Hill Giant') === 'graveyard', 'kicked counters a 4-drop'); }

section('Circular Logic: counter unless they pay 1 per card in my graveyard');
{ const d = newDuel(); mainPhase(d); d.active = 1; d.priority = 1; const b = hand(d, bears(), 1); pool(d, 1, { G: 1, C: 3 });
  d.cast(d.players[1], b, {}); const item = d.stack[d.stack.length - 1]; for (let k = 0; k < 3; k++) gy(d, D('Island'), 0);
  d.priority = 0; const cl = hand(d, D('Circular Logic'), 0); pool(d, 0, { U: 1, C: 2 });
  d.cast(d.players[0], cl, { targets: [{ type: 'spell', id: item.id }] }); processAndResolve(d);
  ok(b.zone === 'graveyard', `they had 2 floating against a tax of 3: countered (${b.zone})`); }

section('Madness: discarding Arrogant Wurm lets me cast it for {2}{G}');
{ const d = newDuel(); mainPhase(d); const wm = place(d, D('Wild Mongrel'), 0); const aw = hand(d, D('Arrogant Wurm'), 0); pool(d, 0, { G: 1, C: 2 });
  const i = abIdx(wm.def, a => a.type === 'activated');
  ok(d.activate(d.players[0], wm, i, { discard: [aw.id] }), 'Mongrel discards the Wurm'); ok(aw.zone === 'exile', `Wurm waits in exile (${aw.zone})`);
  processAndResolve(d); ok(aw.zone === 'battlefield', `Wurm cast for its madness cost (${aw.zone})`); ok(d.players[0].pool.G === 0, 'paid the madness cost');
  ok(power(wm) === 3, `Mongrel pumped (${power(wm)})`); }

section('Madness declined / unaffordable goes to the graveyard');
{ const d = newDuel(); mainPhase(d); const wm = place(d, D('Wild Mongrel'), 0); const aw = hand(d, D('Arrogant Wurm'), 0); pool(d, 0, {});
  d.activate(d.players[0], wm, abIdx(wm.def, a => a.type === 'activated'), { discard: [aw.id] }); processAndResolve(d);
  ok(aw.zone === 'graveyard', `no mana: Wurm is put into the graveyard (${aw.zone})`); }

section('Wild Mongrel changes color: dodges a colour-restricted removal');
{ const d = newDuel(); mainPhase(d); const wm = place(d, D('Wild Mongrel'), 0); hand(d, bears(), 0);
  d.activate(d.players[0], wm, abIdx(wm.def, a => a.type === 'activated'), {});
  const g = d.resolveTop(); let r = g.next(); while (!r.done) r = g.next(r.value.kind === 'color' ? 'B' : undefined); d.refresh();
  const tb = d.legalTargets(d.players[1], { sel: 'creature', restrict: { types: ['creature'], not: ['B'] } }, null);
  ok(wm.temp.color === 'B' && !tb.some(t => t.id === wm.id), `black Mongrel can't be hit by a nonblack-only spell (${wm.temp.color})`); }

section('Aquamoeba switches power and toughness (twice = back)');
{ const d = newDuel(); mainPhase(d); const aq = place(d, D('Aquamoeba'), 0); hand(d, bears(), 0); hand(d, bears(), 0); const i = abIdx(aq.def, a => a.type === 'activated');
  d.activate(d.players[0], aq, i, {}); processAndResolve(d); d.refresh(); ok(power(aq) === 3 && toughness(aq) === 1, `3/1 after one switch (${power(aq)}/${toughness(aq)})`);
  d.activate(d.players[0], aq, i, {}); processAndResolve(d); d.refresh(); ok(power(aq) === 1 && toughness(aq) === 3, `1/3 after two (${power(aq)}/${toughness(aq)})`); }

section('Replenish returns enchantments; Auras need a host');
{ const d = newDuel(); mainPhase(d); const b = place(d, bears(), 0); const w = gy(d, D('Worship'), 0); const r = gy(d, D('Rancor'), 0); gy(d, bears(), 0);
  const rp = hand(d, D('Replenish'), 0); pool(d, 0, { W: 1, C: 3 });
  ok(d.cast(d.players[0], rp, {}), 'cast Replenish'); processAndResolve(d);
  ok(w.zone === 'battlefield' && r.zone === 'battlefield' && r.attachedTo === b, `Worship returns, Rancor enchants the Bears (${w.zone}, ${r.zone}, ${r.attachedTo?.def.name})`);
  ok(d.players[0].graveyard.some(c => c.def.name === 'Grizzly Bears'), 'creature cards stay'); }

section('Show and Tell: each player may put a permanent onto the battlefield');
{ const d = newDuel(); mainPhase(d); const big = hand(d, D('Verdant Force'), 0); const theirs = hand(d, D('Hill Giant'), 1); const st = hand(d, D('Show and Tell'), 0); pool(d, 0, { U: 1, C: 2 });
  ok(d.cast(d.players[0], st, {}), 'cast Show and Tell'); processAndResolve(d, [], y => y.options.filter(o => o.label === 'Verdant Force').map(o => o.id));
  ok(big.zone === 'battlefield', `Verdant Force in play (${big.zone})`); ok(theirs.zone === 'battlefield', `AI put Hill Giant in (${theirs.zone})`); }

section('Pox: a third of everything, rounded up');
{ const d = newDuel(); mainPhase(d); for (let k = 0; k < 4; k++) place(d, bears(), 0); for (let k = 0; k < 5; k++) place(d, D('Swamp'), 0); for (let k = 0; k < 2; k++) hand(d, bears(), 0);
  place(d, bears(), 1); for (let k = 0; k < 3; k++) place(d, D('Forest'), 1); hand(d, bears(), 1);
  const px = hand(d, D('Pox'), 0); pool(d, 0, { B: 3 }); ok(d.cast(d.players[0], px, {}), 'cast Pox'); processAndResolve(d);
  const cnt = (i, f) => d.players[i].battlefield.filter(f).length;
  ok(d.players[0].life === 13 && d.players[1].life === 13, `each lost 7 (${d.players[0].life}/${d.players[1].life})`);
  ok(d.players[0].hand.length === 1 && d.players[1].hand.length === 0, `hands: 2->1, 1->0 (${d.players[0].hand.length}/${d.players[1].hand.length})`);
  ok(cnt(0, c => c.def.name === 'Grizzly Bears') === 2 && cnt(1, c => c.def.name === 'Grizzly Bears') === 0, 'creatures: 4->2, 1->0');
  ok(cnt(0, c => c.def.name === 'Swamp') === 3 && cnt(1, c => c.def.name === 'Forest') === 2, 'lands: 5->3, 3->2'); }

section('Hermit Druid digs to a basic land, bins the rest');
{ const d = newDuel(); mainPhase(d); const hd = place(d, D('Hermit Druid'), 0); lib(d, D('Forest'), 0); lib(d, bears(), 0); lib(d, D('Wasteland'), 0); lib(d, bears(), 0); pool(d, 0, { G: 1 });
  ok(d.activate(d.players[0], hd, abIdx(hd.def, a => a.type === 'activated'), {}), 'activate'); processAndResolve(d);
  ok(d.players[0].hand.some(c => c.def.name === 'Forest') && d.players[0].graveyard.length === 3, `Forest to hand, 3 milled (${d.players[0].graveyard.length})`); }

section('Oath of Druids: fewer creatures -> dig a creature into play');
{ const d = newDuel(); mainPhase(d); place(d, D('Oath of Druids'), 0); place(d, bears(), 1); lib(d, D('Verdant Force'), 0); lib(d, D('Island'), 0); lib(d, D('Island'), 0);
  d.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d);
  ok(d.players[0].battlefield.some(c => c.def.name === 'Verdant Force') && d.players[0].graveyard.length === 2, 'Verdant Force enters, two Islands milled');
  const d2 = newDuel(); mainPhase(d2); place(d2, D('Oath of Druids'), 0); lib(d2, D('Verdant Force'), 1); d2.fireEvent({ type: 'upkeep', player: 1 }); processAndResolve(d2);
  ok(!d2.players[1].battlefield.some(c => c.def.name === 'Verdant Force'), 'no trigger payoff when the opponent has no more creatures'); }

section('Oath of Ghouls: more creature cards in the yard -> return one');
{ const d = newDuel(); mainPhase(d); place(d, D('Oath of Ghouls'), 0); const g1 = gy(d, bears(), 0); gy(d, bears(), 0); gy(d, bears(), 1);
  d.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d, [], y => y.options.slice(0, 1).map(o => o.id));
  ok(d.players[0].hand.length === 1, `returned a creature card (${d.players[0].hand.length})`); }

section('Sylvan Library: draw two extra, pay 4 life or put back');
{ const d = newDuel(); mainPhase(d); d.step = 'draw'; place(d, D('Sylvan Library'), 0); for (let k = 0; k < 5; k++) lib(d, bears(), 0); d.turn = 3;
  d.drawCards(d.players[0], 1); d.fireEvent({ type: 'drawstep', player: 0 });
  let asked = 0; processAndResolve(d, [], y => y.options.slice(0, 2).map(o => o.id));   // yes/no answers default to yes: pay 4 life for both
  ok(d.players[0].hand.length === 3 && d.players[0].life === 12, `kept all three for 8 life (${d.players[0].hand.length}, ${d.players[0].life})`);
  const d2 = newDuel(); mainPhase(d2); d2.turn = 3; place(d2, D('Sylvan Library'), 1); for (let k = 0; k < 5; k++) lib(d2, bears(), 1); d2.players[1].life = 10;
  d2.drawCards(d2.players[1], 1); d2.fireEvent({ type: 'drawstep', player: 1 }); processAndResolve(d2);
  ok(d2.players[1].hand.length === 1 && d2.players[1].library.length === 4 && d2.players[1].life === 10, `AI at 10 life puts two back (${d2.players[1].hand.length}, lib ${d2.players[1].library.length})`); }

section('Energy Field / Solitary Confinement prevent damage to you');
{ const d = newDuel(); mainPhase(d); const ef = place(d, D('Energy Field'), 0); const bolt = hand(d, D('Lightning Bolt'), 1); d.priority = 1; pool(d, 1, { R: 1 });
  d.cast(d.players[1], bolt, { targets: [{ type: 'player', idx: 0 }] }); processAndResolve(d);
  ok(d.players[0].life === 20, `Bolt prevented (${d.players[0].life})`); ok(ef.zone === 'battlefield', `the Bolt went to its caster's graveyard: Energy Field stays (${ef.zone})`);
  const d2 = newDuel(); mainPhase(d2); place(d2, D('Solitary Confinement'), 0); const b2 = hand(d2, D('Lightning Bolt'), 1); d2.priority = 1; pool(d2, 1, { R: 1 });
  d2.cast(d2.players[1], b2, { targets: [{ type: 'player', idx: 0 }] }); processAndResolve(d2); ok(d2.players[0].life === 20, 'Solitary Confinement prevents it too'); }

section('Energy Field is sacrificed when a card goes to my graveyard');
{ const d = newDuel(); mainPhase(d); const ef = place(d, D('Energy Field'), 0); const b = place(d, bears(), 0); d.destroy(b); processAndResolve(d);
  ok(ef.zone === 'graveyard', `Energy Field gone (${ef.zone})`); }

section('Opalescence animates other enchantments');
{ const d = newDuel(); mainPhase(d); place(d, D('Opalescence'), 0); const w = place(d, D('Worship'), 0); d.refresh();
  ok(isCreature(w) && power(w) === 4 && toughness(w) === 4, `Worship is a 4/4 creature (${power(w)}/${toughness(w)})`); }

section('Aluren: free creature spells at instant speed');
{ const d = newDuel(); mainPhase(d); place(d, D('Aluren'), 1); const b = hand(d, bears(), 0); const big = hand(d, D('Hill Giant'), 0); pool(d, 0, {});
  ok(d.canCast(d.players[0], b, { aluren: true }), 'Bears castable for free'); ok(!d.canCast(d.players[0], big, { aluren: true }), 'a 4-drop is not');
  d.step = 'end'; d.active = 1; ok(d.canCast(d.players[0], b, { aluren: true }), 'and at instant speed'); d.cast(d.players[0], b, { aluren: true }); processAndResolve(d); ok(b.zone === 'battlefield', 'Bears resolve'); }

section('Recoup gives a sorcery flashback for the turn');
{ const d = newDuel(); mainPhase(d); const ss = gy(d, D('Stone Rain'), 0); const t = place(d, D('Forest'), 1); const rc = hand(d, D('Recoup'), 0); pool(d, 0, { R: 2, C: 3 });
  ok(!d.canCast(d.players[0], ss, { targets: [{ type: 'perm', id: t.id }] }), 'no flashback before Recoup');
  ok(d.cast(d.players[0], rc, { targets: [{ type: 'card', id: ss.id }] }), 'cast Recoup'); processAndResolve(d);
  ok(d.cast(d.players[0], ss, { targets: [{ type: 'perm', id: t.id }] }), 'Stone Rain cast from the graveyard'); processAndResolve(d);
  ok(t.zone === 'graveyard' && ss.zone === 'exile', `land destroyed, Stone Rain exiled (${t.zone}, ${ss.zone})`); }

section('Rogue Elephant, Cavern Harpy, Goblin Tinkerer');
{ const d = newDuel(); mainPhase(d); const re = hand(d, D('Rogue Elephant'), 0); pool(d, 0, { G: 1 }); d.cast(d.players[0], re, {}); processAndResolve(d);
  ok(re.zone === 'graveyard', `no Forest: Rogue Elephant is sacrificed (${re.zone})`);
  const d2 = newDuel(); mainPhase(d2); const f = place(d2, D('Forest'), 0); const re2 = hand(d2, D('Rogue Elephant'), 0); pool(d2, 0, { G: 1 }); d2.cast(d2.players[0], re2, {}); processAndResolve(d2, [], y => y.options.map(o => o.id).slice(0, 1));
  ok(re2.zone === 'battlefield' && f.zone === 'graveyard', `sacrificed the Forest to keep it (${re2.zone}, ${f.zone})`);
  const d3 = newDuel(); mainPhase(d3); const nb = place(d3, D('Nekrataal'), 0); const ch = hand(d3, D('Cavern Harpy'), 0); pool(d3, 0, { U: 1, B: 1 }); d3.cast(d3.players[0], ch, {}); processAndResolve(d3, [], y => y.options.filter(o => o.label === 'Nekrataal').map(o => o.id));
  ok(nb.zone === 'hand' && ch.zone === 'battlefield', `Harpy returned Nekrataal (${nb.zone})`);
  const d4 = newDuel(); mainPhase(d4); const gt = place(d4, D('Goblin Tinkerer'), 0); const art = place(d4, D('Cursed Scroll'), 1); pool(d4, 0, { R: 1 });
  d4.activate(d4.players[0], gt, abIdx(gt.def, a => a.type === 'activated'), { targets: [{ type: 'perm', id: art.id }] }); processAndResolve(d4);
  ok(art.zone === 'graveyard' && gt.zone === 'battlefield' && gt.damage === 1, `Cursed Scroll destroyed, Tinkerer takes 1 (${gt.damage})`); }

section('Nether Spirit / Genesis / Sarcomancy upkeep triggers');
{ const d = newDuel(); mainPhase(d); const ns = gy(d, D('Nether Spirit'), 0); d.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d);
  ok(ns.zone === 'battlefield', `Nether Spirit returns alone (${ns.zone})`);
  const d2 = newDuel(); mainPhase(d2); const ns2 = gy(d2, D('Nether Spirit'), 0); gy(d2, bears(), 0); d2.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d2);
  ok(ns2.zone === 'graveyard', 'not with another creature card');
  const d3 = newDuel(); mainPhase(d3); gy(d3, D('Genesis'), 0); const b = gy(d3, bears(), 0); pool(d3, 0, { G: 1, C: 2 }); d3.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d3, [{ type: 'card', id: b.id }]);
  ok(b.zone === 'hand', `Genesis returned the Bears (${b.zone})`);
  const d4 = newDuel(); mainPhase(d4); place(d4, D('Sarcomancy'), 0); d4.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d4); ok(d4.players[0].life === 19, `no Zombies: 1 damage (${d4.players[0].life})`); }

section('Graveborn Muse, Wirewood Savage');
{ const d = newDuel(); mainPhase(d); place(d, D('Graveborn Muse'), 0); place(d, D('Gravedigger'), 0); for (let k = 0; k < 4; k++) lib(d, bears(), 0);
  d.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d); ok(d.players[0].hand.length === 2 && d.players[0].life === 18, `Muse + Gravedigger: draw 2, lose 2 (${d.players[0].hand.length}, ${d.players[0].life})`);
  const d2 = newDuel(); mainPhase(d2); place(d2, D('Wirewood Savage'), 0); lib(d2, bears(), 0); const krosan = hand(d2, D('Krosan Tusker'), 0); pool(d2, 0, { G: 2, C: 5 }); d2.cast(d2.players[0], krosan, {}); processAndResolve(d2);
  ok(d2.players[0].hand.length === 1, `a Beast entered: drew (${d2.players[0].hand.length})`); }

section('Emerald Charm: creature loses flying');
{ const d = newDuel(); mainPhase(d); const bird = place(d, D('Birds of Paradise'), 1); const ec = hand(d, D('Emerald Charm'), 0); pool(d, 0, { G: 1 });
  const m = ec.def.spell.modes.findIndex(x => /flying/.test(x.text)); ok(m >= 0, 'has the flying mode');
  d.cast(d.players[0], ec, { modes: [m], targets: [{ type: 'perm', id: bird.id }] }); processAndResolve(d); d.refresh(); ok(!has(bird, 'Flying'), 'Birds lost flying'); }

section('Recycle: skip draw, draw per card played, hand size two');
{ const d = newDuel(); mainPhase(d); place(d, D('Recycle'), 0); for (let k = 0; k < 5; k++) lib(d, bears(), 0); const f = hand(d, D('Forest'), 0);
  d.cast(d.players[0], f); processAndResolve(d); ok(d.players[0].hand.length === 1, `playing a land drew a card (${d.players[0].hand.length})`);
  const b = d.players[0].hand[0]; pool(d, 0, { G: 2 }); d.cast(d.players[0], b, {}); processAndResolve(d); ok(d.players[0].hand.length === 1, `casting a spell drew a card (${d.players[0].hand.length})`); }

section('Elvish Vanguard counts only other Elves');
{ const d = newDuel(); mainPhase(d); const ev = hand(d, D('Elvish Vanguard'), 0); pool(d, 0, { G: 2 }); d.cast(d.players[0], ev, {}); processAndResolve(d);
  ok(!(ev.counters['+1/+1'] > 0), 'no counter for itself'); const le = hand(d, D('Llanowar Elves'), 0); pool(d, 0, { G: 1 }); d.cast(d.players[0], le, {}); processAndResolve(d); ok(ev.counters['+1/+1'] === 1, 'counter for another Elf'); }

section('Necromancy at instant speed is sacrificed at cleanup; Dance of the Dead returns tapped and pumped');
{ const d = newDuel(); mainPhase(d); const vf = gy(d, D('Verdant Force'), 1); const nc = hand(d, D('Necromancy'), 0); pool(d, 0, { B: 1, C: 2 });
  d.active = 1; d.step = 'end';   // opponent's end step: instant speed
  ok(d.cast(d.players[0], nc, {}), 'Necromancy cast at instant speed'); processAndResolve(d, [{ type: 'card', id: vf.id }]);
  ok(vf.zone === 'battlefield' && vf.controller === 0, `Verdant Force reanimated under my control (${vf.zone})`);
  ok(nc.sacAtCleanup === true, 'flagged for sacrifice at cleanup');
  const d2 = newDuel(); mainPhase(d2); const b = gy(d2, bears(), 0); const dd = hand(d2, D('Dance of the Dead'), 0); pool(d2, 0, { B: 1, C: 1 });
  d2.cast(d2.players[0], dd, {}); processAndResolve(d2, [{ type: 'card', id: b.id }]); d2.refresh();
  ok(b.zone === 'battlefield' && b.tapped && power(b) === 3, `Bears back tapped as a 3/3 (${b.tapped}, ${power(b)})`); }

section('Pattern of Rebirth fetches a creature when the host dies');
{ const d = newDuel(); mainPhase(d); const b = place(d, bears(), 0); const vf = lib(d, D('Verdant Force'), 0); lib(d, D('Island'), 0);
  const pr = hand(d, D('Pattern of Rebirth'), 0); pool(d, 0, { G: 1, C: 3 }); d.cast(d.players[0], pr, { targets: [{ type: 'perm', id: b.id }] }); processAndResolve(d);
  ok(pr.attachedTo === b, 'Pattern on the Bears'); d.destroy(b); processAndResolve(d, [], y => y.options.filter(o => o.label === 'Verdant Force').map(o => o.id));
  ok(vf.zone === 'battlefield', `Verdant Force fetched onto the battlefield (${vf.zone})`); }

section('Mox Diamond: discard a land or it goes to the graveyard');
{ const d = newDuel(); mainPhase(d); const md = hand(d, D('Mox Diamond'), 0); const f = hand(d, D('Forest'), 0); pool(d, 0, {});
  d.cast(d.players[0], md, {}); processAndResolve(d, [], y => y.options.map(o => o.id).slice(0, 1));
  ok(md.zone === 'battlefield' && f.zone === 'graveyard', `Mox in play, Forest discarded (${md.zone}, ${f.zone})`);
  const d2 = newDuel(); mainPhase(d2); const md2 = hand(d2, D('Mox Diamond'), 0); hand(d2, bears(), 0); d2.cast(d2.players[0], md2, {}); processAndResolve(d2);
  ok(md2.zone === 'graveyard', `no land to discard: Mox to the graveyard (${md2.zone})`); }

section('Gilded Drake swaps for an opposing creature, or is sacrificed');
{ const d = newDuel(); mainPhase(d); const vf = place(d, D('Verdant Force'), 1); const gd = hand(d, D('Gilded Drake'), 0); pool(d, 0, { U: 1, C: 1 });
  d.cast(d.players[0], gd, {}); processAndResolve(d, [], y => y.options.map(o => o.id).slice(0, 1));
  ok(vf.controller === 0 && gd.controller === 1, `exchanged (Force: ${vf.controller}, Drake: ${gd.controller})`);
  const d2 = newDuel(); mainPhase(d2); const gd2 = hand(d2, D('Gilded Drake'), 0); pool(d2, 0, { U: 1, C: 1 }); d2.cast(d2.players[0], gd2, {}); processAndResolve(d2);
  ok(gd2.zone === 'graveyard', `nothing to take: sacrificed (${gd2.zone})`); }

section('Sneak Attack: haste, sacrificed at end of turn');
{ const d = newDuel(); mainPhase(d); const sa = place(d, D('Sneak Attack'), 0); const vf = hand(d, D('Verdant Force'), 0); pool(d, 0, { R: 1 });
  d.activate(d.players[0], sa, abIdx(sa.def, a => a.type === 'activated'), {}); processAndResolve(d, [], y => y.options.map(o => o.id).slice(0, 1));
  ok(vf.zone === 'battlefield' && has(vf, 'Haste'), `Force in play with haste (${vf.zone})`);
  ok(d.delayed.some(x => x.when === 'end'), 'end-step sacrifice scheduled'); for (const it of d.delayed.filter(x => x.when === 'end')) d.runDelayed(it);
  ok(vf.zone === 'graveyard', `sacrificed at end of turn (${vf.zone})`); }

section('Parallax Wave returns what it exiled when it leaves');
{ const d = newDuel(); mainPhase(d); const pw = place(d, D('Parallax Wave'), 0); pw.counters.fade = 5; const b = place(d, bears(), 1); const i = abIdx(pw.def, a => a.type === 'activated');
  d.activate(d.players[0], pw, i, { targets: [{ type: 'perm', id: b.id }] }); processAndResolve(d); ok(b.zone === 'exile', 'Bears exiled');
  d.destroy(pw); processAndResolve(d); ok(b.zone === 'battlefield' && b.controller === 1, `Bears back for its owner (${b.zone})`); }

section('Plainscycling fetches a Plains');
{ const d = newDuel(); mainPhase(d); const ed = hand(d, D('Eternal Dragon'), 0); const pl = lib(d, D('Plains'), 0); lib(d, bears(), 0); pool(d, 0, { C: 2 });
  ok(d.cast(d.players[0], ed, { cycling: true }), 'cycle it'); processAndResolve(d, [], y => y.options.map(o => o.id).slice(0, 1));
  ok(pl.zone === 'hand' && ed.zone === 'graveyard', `Plains in hand (${pl.zone})`); }

section('Spawning Pool regenerates only while animated');
{ const d = newDuel(); mainPhase(d); const sp = place(d, D('Spawning Pool'), 0); const ab = sp.def.abilities; const regen = ab.findIndex(a => a.type === 'activated' && a.effects[0]?.type === 'regenerate'); const anim = ab.findIndex(a => a.type === 'activated' && a.effects[0]?.type === 'animateSelf');
  ok(regen >= 0 && anim >= 0, 'has both abilities'); pool(d, 0, { B: 3, C: 1 });
  ok(!d.canActivate(d.players[0], sp, regen, {}), 'no regeneration as a land'); d.activate(d.players[0], sp, anim, {}); processAndResolve(d); d.refresh();
  ok(isCreature(sp) && d.canActivate(d.players[0], sp, regen, {}), 'regeneration once it is a Skeleton'); }

section('Phyrexian Negator: sacrifice a permanent per damage');
{ const d = newDuel(); mainPhase(d); const ng = place(d, D('Phyrexian Negator'), 0); for (let k = 0; k < 4; k++) place(d, D('Swamp'), 0);
  const bolt = hand(d, D('Shock'), 1); d.priority = 1; pool(d, 1, { R: 1 }); d.cast(d.players[1], bolt, { targets: [{ type: 'perm', id: ng.id }] }); processAndResolve(d);
  ok(d.players[0].battlefield.length === 3, `two permanents sacrificed (${d.players[0].battlefield.length} left)`); }

section('Goblin Welder swaps artifacts');
{ const d = newDuel(); mainPhase(d); const gw = place(d, D('Goblin Welder'), 0); const ms = place(d, D('Mind Stone'), 0); const td = gy(d, D('Thran Dynamo'), 0);
  d.activate(d.players[0], gw, abIdx(gw.def, a => a.type === 'activated'), { targets: [{ type: 'perm', id: ms.id }, { type: 'card', id: td.id }] }); processAndResolve(d);
  ok(ms.zone === 'graveyard' && td.zone === 'battlefield', `Mind Stone for Thran Dynamo (${ms.zone}, ${td.zone})`); }

section('Goblin Cadets change sides when blocked; Wild Dogs follow the life lead');
{ const d = newDuel(); mainPhase(d); const gc = place(d, D('Goblin Cadets'), 0); d.fireEvent({ type: 'becomesBlocked', card: gc, by: [] }); processAndResolve(d, [{ type: 'player', idx: 1 }]);
  ok(gc.controller === 1, `opponent controls the Cadets (${gc.controller})`);
  const d2 = newDuel(); mainPhase(d2); const wd = place(d2, D('Wild Dogs'), 0); d2.players[1].life = 25; d2.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d2);
  ok(wd.controller === 1, 'the player with most life takes Wild Dogs'); }

section("Kirtar's Wrath adds Spirits with threshold");
{ const d = newDuel(); mainPhase(d); place(d, bears(), 1); for (let k = 0; k < 7; k++) gy(d, D('Island'), 0); const kw = hand(d, D("Kirtar's Wrath"), 0); pool(d, 0, { W: 2, C: 4 });
  d.cast(d.players[0], kw, {}); processAndResolve(d); const sp = d.players[0].battlefield.filter(c => c.token);
  ok(sp.length === 2 && d.players[1].battlefield.length === 0, `wrath + two Spirits (${sp.length})`); }

section('Golden / Living / Death Wish');
{ const d = new Duel({ player: { name: 'A', deck: [], life: 20, sideboard: [D('Worship'), D('Verdant Force'), D('Lightning Bolt')] }, ai: { name: 'B', deck: [], life: 20, ai: true }, hooks: {}, rules: {} }); mainPhase(d);
  const gw = hand(d, D('Golden Wish'), 0); pool(d, 0, { W: 2, C: 3 }); d.cast(d.players[0], gw, {}); processAndResolve(d);
  ok(d.players[0].hand.some(c => c.def.name === 'Worship') && gw.zone === 'exile', 'Golden Wish finds Worship');
  const dw = hand(d, D('Death Wish'), 0); pool(d, 0, { B: 2, C: 1 }); d.cast(d.players[0], dw, {}); processAndResolve(d, [], y => y.options.filter(o => o.label === 'Lightning Bolt').map(o => o.id));
  ok(d.players[0].hand.some(c => c.def.name === 'Lightning Bolt') && d.players[0].life === 10, `Death Wish: any card, lose half (${d.players[0].life})`); }

section('Catastrophe: choose lands or creatures');
{ const d = newDuel(); mainPhase(d); const b = place(d, bears(), 1); const f = place(d, D('Forest'), 1); const cat = hand(d, D('Catastrophe'), 0); pool(d, 0, { W: 2, C: 4 });
  d.cast(d.players[0], cat, {}); processAndResolve(d, [], y => [y.options.find(o => /land/.test(o.label)).id]);
  ok(f.zone === 'graveyard' && b.zone === 'battlefield', `chose lands (${f.zone}, ${b.zone})`); }

section('Doomsday: five cards on top, the rest exiled, lose half');
{ const d = newDuel(); mainPhase(d); for (let k = 0; k < 8; k++) lib(d, bears(), 0); const g = gy(d, D('Brainstorm'), 0); const dd = hand(d, D('Doomsday'), 0); pool(d, 0, { B: 3 });
  d.cast(d.players[0], dd, {}); processAndResolve(d, [], y => y.kind === 'choose' ? [g.id, ...y.options.filter(o => o.id !== g.id).slice(0, 4).map(o => o.id)] : undefined);
  ok(d.players[0].library.length === 5 && d.players[0].library.includes(g) && d.players[0].exile.length === 4, `library 5 incl. the graveyard card, 4 exiled (${d.players[0].library.length}, ${d.players[0].exile.length})`);
  ok(d.players[0].life === 10, `lost half (${d.players[0].life})`); }

section('Morph: cast face down for {3}, hidden, turn face up for the morph cost');
{ const d = newDuel(); mainPhase(d); const ea = hand(d, D('Exalted Angel'), 0); pool(d, 0, { C: 3 });
  ok(!d.canCast(d.players[0], ea), 'Angel not castable face up with 3 mana'); ok(d.canCast(d.players[0], ea, { faceDown: true }), 'castable face down for {3}');
  d.cast(d.players[0], ea, { faceDown: true }); processAndResolve(d); d.refresh();
  ok(ea.zone === 'battlefield' && ea.faceDown && power(ea) === 2 && toughness(ea) === 2 && !has(ea, 'Flying'), `a face-down 2/2 without flying (${power(ea)}/${toughness(ea)})`);
  const snap = d.snapshot(1).players[0].battlefield.find(c => c.id === ea.id); ok(snap.name === 'Face-down creature' && !snap.realName, 'the opponent snapshot hides it');
  ok(d.snapshot(0).players[0].battlefield.find(c => c.id === ea.id).realName === 'Exalted Angel', 'its controller sees the real card');
  ok(!d.log.slice(-6).some(l => /Exalted Angel/.test(typeof l === 'string' ? l : l.text || '')), 'the log does not name it');
  const i = abilitiesOf(ea).findIndex(a => a.special === 'unmorph'); pool(d, 0, { W: 2, C: 2 });
  ok(i >= 0 && d.activate(d.players[0], ea, i, {}), 'turn face up for {2}{W}{W}'); d.refresh();
  ok(!ea.faceDown && power(ea) === 4 && has(ea, 'Flying') && !d.stack.length, `Exalted Angel face up, no stack (${power(ea)}/${toughness(ea)})`); }

section('Morph: "when turned face up" triggers; face-down cards are revealed when they leave');
{ const d = newDuel(); mainPhase(d); const st = hand(d, D('Skinthinner'), 0); const b = place(d, bears(), 1); pool(d, 0, { C: 3 });
  d.cast(d.players[0], st, { faceDown: true }); processAndResolve(d);
  pool(d, 0, { B: 2, C: 3 }); d.activate(d.players[0], st, abilitiesOf(st).findIndex(a => a.special === 'unmorph'), {}); processAndResolve(d, [{ type: 'perm', id: b.id }]);
  ok(b.zone === 'graveyard', `Skinthinner's face-up trigger destroyed the Bears (${b.zone})`);
  const d2 = newDuel(); mainPhase(d2); const ea = hand(d2, D('Exalted Angel'), 0); pool(d2, 0, { C: 3 }); d2.cast(d2.players[0], ea, { faceDown: true }); processAndResolve(d2);
  d2.destroy(ea); ok(ea.zone === 'graveyard' && !ea.faceDown && ea.def.name === 'Exalted Angel', 'revealed as it dies'); }

section('Morph in multiplayer: the mirror hides the opponent\'s face-down card');
{ const { makeMirror, hydrate } = await import(new URL('../../js/mp.js', import.meta.url).href);
  const d = newDuel(); mainPhase(d); const ea = hand(d, D('Exalted Angel'), 0); pool(d, 0, { C: 3 }); d.cast(d.players[0], ea, { faceDown: true }); processAndResolve(d);
  const guest = makeMirror(); hydrate(guest, d.snapshot(1), n => { try { return D(n); } catch { return null; } }, 1);
  const gc = guest.players[0].battlefield.find(c => c.id === ea.id);
  ok(gc && gc.faceDown && gc.def.name === 'Face-down creature' && !gc.realDef, 'guest sees only a face-down 2/2');
  const host = makeMirror(); hydrate(host, d.snapshot(0), n => { try { return D(n); } catch { return null; } }, 0);
  const hc = host.players[0].battlefield.find(c => c.id === ea.id);
  ok(hc && hc.faceDown && hc.realDef?.name === 'Exalted Angel' && hc.unmorph, 'its controller\'s mirror knows the card and can turn it up'); }

section('Divided damage: Fire Covenant splits X among creatures; Arc Lightning hits a player too');
{ const d = newDuel(); mainPhase(d); const a = place(d, bears(), 1), b = place(d, D('Hill Giant'), 1); const fc = hand(d, D('Fire Covenant'), 0); pool(d, 0, { B: 1, R: 1, C: 1 });
  d.cast(d.players[0], fc, { x: 5 }); const g = d.resolveTop(); let r = g.next();
  while (!r.done) { const y = r.value; r = g.next(y.kind === 'choose' ? [a.id, b.id] : y.kind === 'divide' ? { [a.id]: 2, [b.id]: 3 } : undefined); }
  ok(a.zone === 'graveyard' && b.zone === 'graveyard' && d.players[0].life === 15, `both die, 5 life paid (${a.zone}, ${b.zone}, ${d.players[0].life})`);
  const d2 = newDuel(); mainPhase(d2); const c = place(d2, bears(), 1); const al = hand(d2, D('Arc Lightning'), 0); pool(d2, 0, { R: 1, C: 2 });
  d2.cast(d2.players[0], al, {}); const g2 = d2.resolveTop(); let r2 = g2.next();
  while (!r2.done) { const y = r2.value; r2 = g2.next(y.kind === 'choose' ? [c.id, -2] : y.kind === 'divide' ? { [c.id]: 2, [-2]: 1 } : undefined); }
  ok(c.zone === 'graveyard' && d2.players[1].life === 19, `Bears die, 1 to the face (${d2.players[1].life})`); }

section('Divided damage AI: kills what it can, rest to the face');
{ const d = newDuel(); mainPhase(d); const a = place(d, bears(), 0); const pk = hand(d, D('Violent Eruption'), 1); d.active = 1; d.priority = 1; pool(d, 1, { R: 3, C: 1 });
  d.cast(d.players[1], pk, {}); processAndResolve(d);
  ok(a.zone === 'graveyard' && d.players[0].life === 18, `AI: 2 to the Bears, 2 to me (${a.zone}, ${d.players[0].life})`); }

section('Divided prevention: Embolden shields');
{ const d = newDuel(); mainPhase(d); const a = place(d, bears(), 0); const em = hand(d, D('Embolden'), 0); pool(d, 0, { W: 1, C: 2 });
  d.cast(d.players[0], em, {}); const g = d.resolveTop(); let r = g.next();
  while (!r.done) { const y = r.value; r = g.next(y.kind === 'choose' ? [a.id, -1] : y.kind === 'divide' ? { [a.id]: 3, [-1]: 1 } : undefined); }
  ok(a.shield === 3 && d.players[0].shield === 1, `shields 3 and 1 (${a.shield}, ${d.players[0].shield})`); }

section('Rout costs {2} more at instant speed; Goblin Recruiter stacks Goblins on top');
{ const d = newDuel(); mainPhase(d); const r = hand(d, D('Rout'), 0); pool(d, 0, { W: 2, C: 3 });
  ok(d.canCast(d.players[0], r), 'sorcery speed for 5'); d.active = 1; d.step = 'end';
  ok(!d.canCast(d.players[0], r), 'not for 5 at instant speed'); pool(d, 0, { W: 2, C: 5 }); ok(d.canCast(d.players[0], r), 'for 7 at instant speed');
  const d2 = newDuel(); mainPhase(d2); for (let k = 0; k < 4; k++) lib(d2, D('Island'), 0); const g1 = lib(d2, D('Goblin Piledriver'), 0), g2 = lib(d2, D('Goblin Warchief'), 0); lib(d2, D('Island'), 0);
  const gr = hand(d2, D('Goblin Recruiter'), 0); pool(d2, 0, { R: 1, C: 1 }); d2.cast(d2.players[0], gr, {}); processAndResolve(d2, [], y => [g2.id, g1.id]);
  const L = d2.players[0].library; ok(L[L.length - 1] === g2 && L[L.length - 2] === g1, `Warchief on top, then Piledriver (${L.slice(-2).map(c => c.def.name).join(', ')})`); }

section('Lairs: three-colour mana, bounce a non-Lair land or sacrifice');
{ const d = newDuel(); mainPhase(d); const f = place(d, D('Island'), 0); const cc = hand(d, D("Crosis's Catacombs"), 0);
  d.cast(d.players[0], cc); processAndResolve(d, [], y => y.options.map(o => o.id).slice(0, 1));
  ok(cc.zone === 'battlefield' && f.zone === 'hand', `Island returned, Lair stays (${cc.zone}, ${f.zone})`);
  ok(JSON.stringify(cc.def.manaAbilities.find(m => m.produces.length === 3)?.produces) === '["U","B","R"]', 'taps for U, B or R');
  const d2 = newDuel(); mainPhase(d2); const c2 = hand(d2, D("Crosis's Catacombs"), 0); d2.cast(d2.players[0], c2); processAndResolve(d2); ok(c2.zone === 'graveyard', 'no other land: sacrificed'); }

section('Sanctuaries scale with your colours');
{ const d = newDuel(); mainPhase(d); place(d, D('Dega Sanctuary'), 0); place(d, D('Hypnotic Specter'), 0);
  d.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d); ok(d.players[0].life === 22, `black permanent: +2 (${d.players[0].life})`);
  place(d, D('Goblin Piledriver'), 0); d.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d); ok(d.players[0].life === 26, `black and red: +4 (${d.players[0].life})`);
  const d2 = newDuel(); mainPhase(d2); place(d2, D('Dega Sanctuary'), 0); d2.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d2); ok(d2.players[0].life === 20, 'no trigger without the colours'); }

section('Sphere of Law cuts red damage; Chaoslace recolours');
{ const d = newDuel(); mainPhase(d); place(d, D('Sphere of Law'), 0); const bolt = hand(d, D('Lightning Bolt'), 1); d.priority = 1; pool(d, 1, { R: 1 });
  d.cast(d.players[1], bolt, { targets: [{ type: 'player', idx: 0 }] }); processAndResolve(d); ok(d.players[0].life === 19, `3 - 2 = 1 damage (${d.players[0].life})`);
  const d2 = newDuel(); mainPhase(d2); const b = place(d2, bears(), 1); const cl = hand(d2, D('Chaoslace'), 0); pool(d2, 0, { R: 1 });
  d2.cast(d2.players[0], cl, { targets: [{ type: 'perm', id: b.id }] }); processAndResolve(d2);
  ok(d2.legalTargets(d2.players[0], { sel: 'creature', restrict: { types: ['creature'], colors: ['R'] } }, null).some(t => t.id === b.id), 'the Bears are red now'); }

section('Opal Champion animates when the opponent casts a creature');
{ const d = newDuel(); mainPhase(d); const oc = place(d, D('Opal Champion'), 0); d.active = 1; d.priority = 1; const b = hand(d, bears(), 1); pool(d, 1, { G: 2 });
  d.cast(d.players[1], b, {}); processAndResolve(d); d.refresh(); ok(isCreature(oc) && power(oc) === 3 && has(oc, 'First strike'), `a 3/3 first striker (${power(oc)})`); }

section('Planeswalker\'s Fury: random card, damage equal to its mana value');
{ const d = newDuel(); mainPhase(d); const pf = place(d, D("Planeswalker's Fury"), 0); hand(d, D('Hill Giant'), 1); pool(d, 0, { R: 1, C: 3 });
  d.activate(d.players[0], pf, abIdx(pf.def, a => a.type === 'activated'), { targets: [{ type: 'player', idx: 1 }] }); processAndResolve(d);
  ok(d.players[1].life === 16, `4 damage for Hill Giant (${d.players[1].life})`); }

section('Chosen-opponent creatures and Cursed Rack');
{ const d = newDuel(); mainPhase(d); const es = place(d, D('Entropic Specter'), 0); for (let k = 0; k < 3; k++) hand(d, bears(), 1); const lo = place(d, D('Lost Order of Jarkeld'), 0); place(d, bears(), 1); d.refresh();
  ok(power(es) === 3 && power(lo) === 2, `Specter 3/3 (opp hand), Lost Order 2/2 (1 + opp creatures) (${power(es)}, ${power(lo)})`); }

section('Time Ebb puts a creature on top; Submerge is free against a Forest');
{ const d = newDuel(); mainPhase(d); const b = place(d, bears(), 1); lib(d, D('Forest'), 1); const te = hand(d, D('Time Ebb'), 0); pool(d, 0, { U: 1, C: 2 });
  d.cast(d.players[0], te, { targets: [{ type: 'perm', id: b.id }] }); processAndResolve(d); const L = d.players[1].library; ok(L[L.length - 1] === b, 'Bears on top of the library');
  const d2 = newDuel(); mainPhase(d2); const b2 = place(d2, bears(), 1); place(d2, D('Forest'), 1); const sm = hand(d2, D('Submerge'), 0); pool(d2, 0, {});
  ok(!d2.canCast(d2.players[0], sm, { freeIf: true, targets: [{ type: 'perm', id: b2.id }] }), 'needs my Island'); place(d2, D('Island'), 0);
  ok(d2.cast(d2.players[0], sm, { freeIf: true, targets: [{ type: 'perm', id: b2.id }] }), 'free with an Island vs their Forest'); }

section('Storm: Brain Freeze copies itself per earlier spell');
{ const d = newDuel(); mainPhase(d); for (let k = 0; k < 20; k++) lib(d, bears(), 1);
  const r1 = hand(d, D('Dark Ritual'), 0), r2 = hand(d, D('Dark Ritual'), 0); pool(d, 0, { B: 2, U: 1, C: 1 });
  d.cast(d.players[0], r1, {}); processAndResolve(d); d.cast(d.players[0], r2, {}); processAndResolve(d);
  const bf = hand(d, D('Brain Freeze'), 0); d.cast(d.players[0], bf, { targets: [{ type: 'player', idx: 1 }] }); processAndResolve(d, [{ type: 'player', idx: 1 }, { type: 'player', idx: 1 }]);
  ok(d.players[1].graveyard.length === 9 && bf.zone === 'graveyard', `three Brain Freezes: 9 milled, one card in the graveyard (${d.players[1].graveyard.length}, ${bf.zone})`); }

section('Storm copies can take new targets (Temporal Fissure)');
{ const d = newDuel(); mainPhase(d); const a = place(d, bears(), 1), b = place(d, D('Hill Giant'), 1); d.noteCast();
  const tf = hand(d, D('Temporal Fissure'), 0); pool(d, 0, { U: 1, C: 4 }); d.cast(d.players[0], tf, { targets: [{ type: 'perm', id: a.id }] }); processAndResolve(d, [{ type: 'perm', id: b.id }]);
  ok(a.zone === 'hand' && b.zone === 'hand', `both bounced (${a.zone}, ${b.zone})`); }

section('Fertile Ground / Overgrowth add extra mana');
{ const d = newDuel(); mainPhase(d); const f = place(d, D('Forest'), 0); const og = place(d, D('Overgrowth'), 0); og.attachedTo = f; pool(d, 0, {}); d.refresh();
  d.activateMana(d.players[0], f, 0, 'G'); ok(d.players[0].pool.G === 3, `Forest + Overgrowth = GGG (${d.players[0].pool.G})`); }

section('Browbeat: the opponent takes 5 or I draw three');
{ const d = newDuel(); mainPhase(d); for (let k = 0; k < 5; k++) lib(d, bears(), 0); const bb = hand(d, D('Browbeat'), 0); pool(d, 0, { R: 1, C: 2 });
  d.cast(d.players[0], bb, { targets: [{ type: 'player', idx: 0 }] }); processAndResolve(d);
  ok(d.players[1].life === 15 && d.players[0].hand.length === 0, `AI at 20 takes 5 (${d.players[1].life}, hand ${d.players[0].hand.length})`);
  const d2 = newDuel(); mainPhase(d2); d2.players[1].life = 9; for (let k = 0; k < 5; k++) lib(d2, bears(), 0); const b2 = hand(d2, D('Browbeat'), 0); pool(d2, 0, { R: 1, C: 2 });
  d2.cast(d2.players[0], b2, { targets: [{ type: 'player', idx: 0 }] }); processAndResolve(d2); ok(d2.players[0].hand.length === 3, `AI at 9 lets me draw (${d2.players[0].hand.length})`); }

section('Extract / Lobotomy / Haunting Echoes');
{ const d = newDuel(); mainPhase(d); const t = lib(d, D('Hill Giant'), 1); lib(d, bears(), 1); const ex = hand(d, D('Extract'), 0); pool(d, 0, { U: 1 });
  d.cast(d.players[0], ex, { targets: [{ type: 'player', idx: 1 }] }); processAndResolve(d, [], y => [t.id]); ok(t.zone === 'exile', 'Extract exiled the chosen card');
  const d2 = newDuel(); mainPhase(d2); const h = hand(d2, D('Counterspell'), 1); lib(d2, D('Counterspell'), 1); gy(d2, D('Counterspell'), 1); lib(d2, bears(), 1); const lb = hand(d2, D('Lobotomy'), 0); pool(d2, 0, { U: 1, B: 1, C: 2 });
  d2.cast(d2.players[0], lb, { targets: [{ type: 'player', idx: 1 }] }); processAndResolve(d2, [], y => [h.id]);
  ok(d2.players[1].exile.filter(c => c.def.name === 'Counterspell').length === 3, 'Lobotomy exiled all three Counterspells');
  const d3 = newDuel(); mainPhase(d3); gy(d3, bears(), 1); gy(d3, D('Forest'), 1); lib(d3, bears(), 1); lib(d3, D('Island'), 1); const he = hand(d3, D('Haunting Echoes'), 0); pool(d3, 0, { B: 2, C: 3 });
  d3.cast(d3.players[0], he, { targets: [{ type: 'player', idx: 1 }] }); processAndResolve(d3);
  ok(d3.players[1].exile.length === 2 && d3.players[1].graveyard.length === 1, `Bears x2 exiled, Forest stays (${d3.players[1].exile.length})`); }

section('Oath of Mages / Scholars / Lieges');
{ const d = newDuel(); mainPhase(d); place(d, D('Oath of Mages'), 0); d.players[1].life = 25; d.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d);
  ok(d.players[1].life === 24, 'Mages pings the richer opponent');
  const d2 = newDuel(); mainPhase(d2); place(d2, D('Oath of Lieges'), 0); place(d2, D('Forest'), 1); const pl = lib(d2, D('Plains'), 0); d2.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d2, [], y => [pl.id]);
  ok(pl.zone === 'battlefield', 'Lieges fetches a basic land'); }

section('Mind Whip, Paroxysm, Unnatural Hunger');
{ const d = newDuel(); mainPhase(d); const b = place(d, bears(), 1); const mw = place(d, D('Mind Whip'), 0); mw.attachedTo = b; d.fireEvent({ type: 'upkeep', player: 1 }); processAndResolve(d);
  ok(d.players[1].life === 18 && b.tapped, `no mana to pay: 2 damage and tapped (${d.players[1].life})`);
  const d2 = newDuel(); mainPhase(d2); const b2 = place(d2, bears(), 0); const px = place(d2, D('Paroxysm'), 1); px.attachedTo = b2; lib(d2, D('Forest'), 0); d2.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d2);
  ok(b2.zone === 'graveyard', 'Paroxysm: a land on top destroys it');
  const d3 = newDuel(); mainPhase(d3); const b3 = place(d3, D('Hill Giant'), 0); const uh = place(d3, D('Unnatural Hunger'), 1); uh.attachedTo = b3; d3.fireEvent({ type: 'upkeep', player: 0 }); processAndResolve(d3);
  ok(d3.players[0].life === 17, `no other creature: 3 damage (${d3.players[0].life})`); }

section('Mortuary and Angelic Renewal');
{ const d = newDuel(); mainPhase(d); place(d, D('Mortuary'), 0); const b = place(d, bears(), 0); d.destroy(b); processAndResolve(d);
  const L = d.players[0].library; ok(L[L.length - 1] === b, 'Mortuary puts the creature on top');
  const d2 = newDuel(); mainPhase(d2); const ar = place(d2, D('Angelic Renewal'), 0); const b2 = place(d2, bears(), 0); d2.destroy(b2); processAndResolve(d2);
  ok(b2.zone === 'battlefield' && ar.zone === 'graveyard', `Angelic Renewal brings it back (${b2.zone}, ${ar.zone})`); }

section('Two-target spells need two different targets (Rain of Salt, Symbiosis)');
{ const d = newDuel(); mainPhase(d); const a = place(d, D('Forest'), 1), b = place(d, D('Island'), 1); const rs = hand(d, D('Rain of Salt'), 0); pool(d, 0, { R: 2, C: 4 });
  ok(!d.cast(d.players[0], rs, { targets: [{ type: 'perm', id: a.id }, { type: 'perm', id: a.id }] }), 'the same land twice is refused');
  ok(d.cast(d.players[0], rs, { targets: [{ type: 'perm', id: a.id }, { type: 'perm', id: b.id }] }), 'two different lands'); processAndResolve(d);
  ok(a.zone === 'graveyard' && b.zone === 'graveyard', 'both destroyed');
  const d2 = newDuel(); mainPhase(d2); place(d2, D('Forest'), 1); const r2 = hand(d2, D('Rain of Salt'), 0); pool(d2, 0, { R: 2, C: 4 }); ok(!d2.canCast(d2.players[0], r2), 'not castable with one land to hit');
  const d3 = newDuel(); mainPhase(d3); const x = place(d3, bears(), 0), y = place(d3, bears(), 0); const sy = hand(d3, D('Symbiosis'), 0); pool(d3, 0, { G: 1, C: 1 });
  d3.cast(d3.players[0], sy, { targets: [{ type: 'perm', id: x.id }, { type: 'perm', id: y.id }] }); processAndResolve(d3); ok(power(x) === 4 && power(y) === 4, 'both +2/+2'); }

section('Single-sentence spells: Blessed Wind, Time Stretch, Summer Bloom, Traumatize, Brightstone Ritual');
{ const d = newDuel(); mainPhase(d); d.players[0].life = 3; const bw = hand(d, D('Blessed Wind'), 0); pool(d, 0, { W: 2, C: 7 }); d.cast(d.players[0], bw, { targets: [{ type: 'player', idx: 0 }] }); processAndResolve(d); ok(d.players[0].life === 20, 'life becomes 20');
  const ts = hand(d, D('Time Stretch'), 0); pool(d, 0, { U: 2, C: 8 }); d.cast(d.players[0], ts, { targets: [{ type: 'player', idx: 0 }] }); processAndResolve(d); ok(d.extraTurns === 2, 'two extra turns');
  const sb = hand(d, D('Summer Bloom'), 0); pool(d, 0, { G: 1, C: 1 }); d.cast(d.players[0], sb, {}); processAndResolve(d); ok(d.landLimit(d.players[0]) === 4, `four land drops (${d.landLimit(d.players[0])})`);
  for (let k = 0; k < 9; k++) lib(d, bears(), 1); const tr = hand(d, D('Traumatize'), 0); pool(d, 0, { U: 2, C: 3 }); d.cast(d.players[0], tr, { targets: [{ type: 'player', idx: 1 }] }); processAndResolve(d); ok(d.players[1].graveyard.length === 4, 'mills half rounded down');
  place(d, D('Goblin Piledriver'), 0); place(d, D('Goblin Piledriver'), 1); const br = hand(d, D('Brightstone Ritual'), 0); pool(d, 0, { R: 1 }); d.cast(d.players[0], br, {}); processAndResolve(d); ok(d.players[0].pool.R === 2, `R per Goblin (${d.players[0].pool.R})`); }

section('Falter, Winds of Rath, Humble, Flicker, Oblation, Misstep');
{ const d = newDuel(); mainPhase(d); const bird = place(d, D('Birds of Paradise'), 1), b = place(d, bears(), 1); const f = hand(d, D('Falter'), 0); pool(d, 0, { R: 1, C: 1 }); d.cast(d.players[0], f, {}); processAndResolve(d);
  ok(b.flags.has('cantBlock') && !bird.flags.has('cantBlock'), 'ground creatures can\'t block');
  const d2 = newDuel(); mainPhase(d2); const e = place(d2, bears(), 0), n = place(d2, bears(), 1); const r = place(d2, D('Rancor'), 0); r.attachedTo = e; const wr = hand(d2, D('Winds of Rath'), 0); pool(d2, 0, { W: 2, C: 3 }); d2.cast(d2.players[0], wr, {}); processAndResolve(d2);
  ok(e.zone === 'battlefield' && n.zone === 'graveyard', 'only the unenchanted creature dies');
  const d3 = newDuel(); mainPhase(d3); const g = place(d3, D('Exalted Angel'), 1); const hm = hand(d3, D('Humble'), 0); pool(d3, 0, { W: 1, C: 1 }); d3.cast(d3.players[0], hm, { targets: [{ type: 'perm', id: g.id }] }); processAndResolve(d3); d3.refresh();
  ok(power(g) === 0 && toughness(g) === 1 && !has(g, 'Flying'), `Humbled Angel is a 0/1 with no flying (${power(g)}/${toughness(g)})`);
  const d4 = newDuel(); mainPhase(d4); const t = place(d4, bears(), 0); t.tapped = true; t.counters['+1/+1'] = 1; const fl = hand(d4, D('Flicker'), 0); pool(d4, 0, { W: 1, C: 1 }); d4.cast(d4.players[0], fl, { targets: [{ type: 'perm', id: t.id }] }); processAndResolve(d4);
  ok(t.zone === 'battlefield' && !t.tapped && !t.counters['+1/+1'], 'flickered: back fresh');
  const d5 = newDuel(); mainPhase(d5); lib(d5, bears(), 1); lib(d5, bears(), 1); const o = place(d5, D('Hill Giant'), 1); const ob = hand(d5, D('Oblation'), 0); pool(d5, 0, { W: 1, C: 2 }); d5.cast(d5.players[0], ob, { targets: [{ type: 'perm', id: o.id }] }); processAndResolve(d5);
  ok(o.zone !== 'battlefield' && d5.players[1].hand.length === 2, 'shuffled in, owner draws two');
  const d6 = newDuel(); mainPhase(d6); const m1 = place(d6, bears(), 1); m1.tapped = true; const ms = hand(d6, D('Misstep'), 0); pool(d6, 0, { U: 1, C: 1 }); d6.cast(d6.players[0], ms, { targets: [{ type: 'player', idx: 1 }] }); processAndResolve(d6);
  ok(m1.flags.has('noUntapNext'), 'their creatures skip the next untap'); }

section('Rhystic Syphon and Rethink');
{ const d = newDuel(); mainPhase(d); const rs = hand(d, D('Rhystic Syphon'), 0); pool(d, 0, { B: 2, C: 3 }); d.cast(d.players[0], rs, { targets: [{ type: 'player', idx: 1 }] }); processAndResolve(d);
  ok(d.players[1].life === 15 && d.players[0].life === 25, `AI can't pay: drain 5 (${d.players[1].life}/${d.players[0].life})`);
  const d2 = newDuel(); mainPhase(d2); d2.active = 1; d2.priority = 1; const hg = hand(d2, D('Hill Giant'), 1); pool(d2, 1, { R: 1, C: 3 }); d2.cast(d2.players[1], hg, {}); const it = d2.stack[d2.stack.length - 1];
  d2.priority = 0; const rt = hand(d2, D('Rethink'), 0); pool(d2, 0, { U: 1, C: 2 }); d2.cast(d2.players[0], rt, { targets: [{ type: 'spell', id: it.id }] }); processAndResolve(d2);
  ok(hg.zone === 'graveyard', 'Rethink counters when they can\'t pay the mana value'); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
