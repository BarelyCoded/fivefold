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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
