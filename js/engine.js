// Rules core v2. Stack and priority, phases and steps, triggered/static/activated abilities,
// auras and equipment, tokens, counters, protection, regeneration, X costs, kicker, flashback,
// cycling, echo, cumulative upkeep, poison, extra turns. Targets Alpha–Alliances mechanics.
//
// Driving model: call tick() repeatedly. It returns 'over' | 'wait' (human input needed, see
// duel.pending) | 'job' | 'ai' | 'auto'. AI decisions come from hooks {decide, choose}.

import { needsTarget, COLORS, cmcOf, costString } from './cards.js';

let uid = 1;
export function shuffle(a, rng = Math.random) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const STEPS = ['untap', 'upkeep', 'draw', 'main1', 'beginCombat', 'attackers', 'blockers', 'firstStrike', 'damage', 'endCombat', 'main2', 'end', 'cleanup'];
export const STEP_NAME = { untap: 'Untap', upkeep: 'Upkeep', draw: 'Draw', main1: 'Main phase', beginCombat: 'Beginning of combat', attackers: 'Declare attackers', blockers: 'Declare blockers', firstStrike: 'First-strike damage', damage: 'Combat damage', endCombat: 'End of combat', main2: 'Second main', end: 'End step', cleanup: 'Cleanup' };
const emptyPool = () => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
const kwName = k => (typeof k === 'string' ? k : k.k);

export const has = (c, kw) => !!c.cur && c.cur.kw.has(kw);
export const power = c => (c.cur ? c.cur.p : c.def.power || 0);
export const toughness = c => (c.cur ? c.cur.t : c.def.toughness || 0);
export const isCreature = c => c.cur ? c.cur.types.has('creature') : c.def.types.includes('Creature');
export const isLand = c => c.def.types.includes('Land');
export const isType = (c, t) => c.def.types.map(x => x.toLowerCase()).includes(t) || (t === 'permanent' && c.def.isPermanent);
export const hasSubtype = (c, s) => c.def.subtypes.includes(s) || (has(c, 'Changeling') && isCreature(c));
// Printed abilities plus any granted by statics (Farmstead, Energy Flux, The Tabernacle at Pendrell Vale).
export const abilitiesOf = c => c.cur?.flags?.has('noAbilities') ? [] : (c.cur?.granted?.length ? [...c.def.abilities, ...c.cur.granted] : c.def.abilities);   // Humility strips them

export class Duel {
  constructor({ player, ai, rng = Math.random, hooks = null, rules = {} }) {
    this.rng = rng; this.hooks = hooks; this.rules = rules;
    this.logViewer = rules.viewer ?? null;   // whose drawn cards are named in the log (others show only a count); null = name the sole human's
    this.players = [this.makePlayer(player, 0), this.makePlayer(ai, 1)];
    this.turn = 0; this.active = 0; this.priority = 0; this.passes = 0; this.step = 'setup'; this.stepIndex = -1;
    this.stack = []; this.jobs = []; this.events = []; this.pending = null; this.winner = null;
    this.log = []; this.listeners = []; this.attackers = []; this.blocks = {}; this.fog = false; this.extraTurns = 0;
    this.firstPlayer = 0; this.stepCount = 0; this.delayed = []; this.fx = []; this.ignoreLandwalk = new Set(); this.damageReplacements = []; this.noPrevention = false;
  }
  makePlayer(p, idx) {
    const library = shuffle(p.deck.map(def => this.instance(def, idx)), this.rng);
    const sideboard = (p.sideboard || []).map(def => { const c = this.instance(def, idx); c.zone = 'sideboard'; return c; });   // cards "outside the game" for Wishes
    return { idx, name: p.name, life: p.life, poison: 0, library, hand: [], battlefield: [], graveyard: [], exile: [], sideboard, landPlayed: 0, ai: !!p.ai, pool: emptyPool(), skipToEnd: false, portrait: p.portrait || null, shield: 0, cop: [], skipTurns: 0, skipDraw: 0 };
  }
  instance(def, owner) {
    return { id: uid++, def, owner, controller: owner, zone: 'library', tapped: false, sick: true, damage: 0, counters: {}, temp: { p: 0, t: 0, kw: [], flags: [] }, attachedTo: null, regen: 0, flags: new Set(), controlUntilEot: null, token: false, cur: null, damaged: new Set(), attackedThisTurn: false, blockedThisTurn: false, enteredTurn: 0, uses: { turn: -1, n: {} }, chosenColor: null, shield: 0, linked: [], controlLink: null, animatePerm: null };
  }
  say(msg) { this.log.push(msg); if (this.log.length > 400) this.log.shift(); }
  // A disambiguating label for the log: whose creature it is and its current power/toughness, so a combat
  // log with two "Black Knight"s or three "Vampire Bats" can still be read back to figure out what happened.
  cname(c) {
    if (!c || !c.def) return 'something';
    const who = this.players[c.controller]?.name || '?';
    const pt = isCreature(c) ? ` (${power(c)}/${toughness(c)})` : '';
    return `${who}'s ${c.def.name}${pt} #${c.id}`;   // #id disambiguates identical copies in the log
  }
  emit() { for (const l of this.listeners) l(this); }
  onChange(fn) { this.listeners.push(fn); }
  get activePlayer() { return this.players[this.active]; }
  get defender() { return this.players[1 - this.active]; }
  opponentOf(p) { return this.players[1 - p.idx]; }
  find(id) {
    for (const p of this.players) for (const zone of ['battlefield', 'hand', 'graveyard', 'library', 'exile', 'sideboard']) {
      const c = p[zone].find(x => x.id === id); if (c) return { card: c, zone, owner: p };
    }
    const s = this.stack.find(i => i.id === id || (i.card && i.card.id === id));
    if (s) return { card: s.card, zone: 'stack', item: s };
    return null;
  }
  card(id) { return this.find(id)?.card || null; }
  permanents() { return [...this.players[0].battlefield, ...this.players[1].battlefield]; }
  controllerOf(c) { return this.players[c.controller]; }

  // ---- lifecycle -------------------------------------------------------------
  start() {
    for (const p of this.players) this.drawCards(p, p.idx === 0 ? (this.rules.handSize || 7) : 7, { silent: true });
    // The AI takes the same mulligan the human is offered: redraw a hand of one land or none (bounded retries).
    // A remote (human) opponent is offered the mulligan through the UI instead, so don't auto-mulligan them.
    for (let tries = 0; this.players[1].ai && tries < 3 && this.players[1].hand.filter(isLand).length <= 1; tries++) this.mulligan(1);
    for (const [idx, defs] of [[0, this.rules.playerStart], [1, this.rules.oppStart]]) for (const def of defs || []) { const c = this.instance(def, idx); c.zone = 'limbo'; this.moveTo(c, 'battlefield', { controller: idx }); c.sick = false; }
    this.events.length = 0;
    this.active = this.rng() < 0.5 ? 0 : 1; this.firstPlayer = this.active;
    this.turn = 1; this.stepIndex = -1; this.step = 'setup';
    this.say(`${this.activePlayer.name} plays first.`);
    this.jobs.push({ gen: this.nextStep() });
    this.refresh(); this.emit();
  }
  // A free opening-hand mulligan: shuffle the hand back and redraw the same number of cards. Meant to be
  // called right after start(), before the game proceeds; the duel view offers it on a land-starved hand.
  mulligan(idx = 0) {
    const p = this.players[idx];
    for (const c of p.hand.slice()) this.moveTo(c, 'library');
    shuffle(p.library, this.rng);
    this.drawCards(p, idx === 0 ? (this.rules.handSize || 7) : 7, { silent: true });
    this.say(`${p.name} takes a mulligan.`);
    this.refresh(); this.emit();
  }
  end(winnerIdx, why) {
    if (this.winner !== null) return;
    this.winner = winnerIdx; this.pending = null;
    this.say(`${why} ${this.players[winnerIdx].name} wins!`);
    this.emit();
  }

  tick() {
    if (this.winner !== null) return 'over';
    if (this.pending) return 'wait';
    if (this.jobs.length) {
      const r = this.pump(this.jobs[0]);
      if (r === 'done') this.jobs.shift();
      this.refresh();
      return r === 'wait' ? 'wait' : 'job';
    }
    this.sba(); if (this.winner !== null) return 'over';
    if (this.events.length) { this.jobs.push({ gen: this.processEvents() }); return 'job'; }
    const p = this.players[this.priority];
    if (p.ai) {
      const act = this.hooks.decide(this, p) || { type: 'pass' };
      const ok = this.apply(p, act);
      if (!ok) this.pass(p);
      this.refresh();
      return act.type === 'pass' || !ok ? 'auto' : 'ai';
    }
    if (this.shouldStop(p)) { this.pending = { type: 'priority' }; this.emit(); return 'wait'; }
    this.pass(p); return 'auto';
  }
  pump(job) {
    const r = job.gen.next(job.answer); job.answer = undefined;
    if (r.done) return 'done';
    const req = r.value;
    const p = this.players[req.player];
    if (p.ai) { job.answer = this.hooks.choose(this, req); return 'more'; }
    this.pending = { type: 'request', req, job }; this.emit(); return 'wait';
  }
  apply(p, act) {
    switch (act.type) {
      case 'pass': this.pass(p); return true;
      case 'cast': return this.cast(p, act.card, act.opts || {});
      case 'activate': return this.activate(p, act.card, act.index, act.opts || {});
      case 'mana': return this.activateMana(p, act.card, act.index, act.color);
    }
    return false;
  }
  // ---- player input (index-aware) ----------------------------------------------------
  // The engine pauses (pending) for any non-AI player; whoever provides that player's input calls these.
  // Single-player is player 0 only (the human* wrappers); multiplayer routes the remote player's input
  // to their own index. Each guards that it really is that player's turn to act, so out-of-turn or
  // spoofed input is a no-op.
  actingPlayer() {   // index of the player who currently owes an action, or null
    if (this.pending?.type === 'priority') return this.priority;
    if (this.pending?.type === 'request') return this.pending.req.player;
    return null;
  }
  canAct(idx) { return this.actingPlayer() === idx; }
  hasPriority(idx) { return this.pending?.type === 'priority' && this.priority === idx; }
  passFor(idx) { if (!this.hasPriority(idx)) return false; this.pending = null; this.pass(this.players[idx]); this.refresh(); return true; }
  endTurnFor(idx) { if (!this.hasPriority(idx)) return false; this.players[idx].skipToEnd = true; return this.passFor(idx); }
  castFor(idx, card, opts) { if (!this.hasPriority(idx)) return false; const ok = this.cast(this.players[idx], card, opts); if (ok) this.pending = null; this.refresh(); return ok; }
  activateFor(idx, card, i, opts) { if (!this.hasPriority(idx)) return false; const ok = this.activate(this.players[idx], card, i, opts); if (ok) this.pending = null; this.refresh(); return ok; }
  manaFor(idx, card, i, color) { if (!this.hasPriority(idx)) return false; const ok = this.activateMana(this.players[idx], card, i, color); this.refresh(); return ok; }
  answerFor(idx, value) { if (this.pending?.type !== 'request' || this.pending.req.player !== idx) return false; this.pending.job.answer = value; this.pending = null; return true; }

  // human entry points — single-player: the local human is always player 0
  humanPass() { return this.passFor(0); }
  humanEndTurn() { return this.endTurnFor(0); }
  humanCast(card, opts) { return this.castFor(0, card, opts); }
  humanActivate(card, i, opts) { return this.activateFor(0, card, i, opts); }
  humanMana(card, i, color) { return this.manaFor(0, card, i, color); }
  humanAnswer(value) { return this.answerFor(0, value); }

  // ---- multiplayer serialization -----------------------------------------------------
  // A redacted, plain-object snapshot of the whole game as `forIdx` is allowed to see it: their own
  // hand is visible, the opponent's hand and both libraries are face-down (id + count only). Public
  // zones (battlefield, graveyard, exile, stack) are fully visible. Card names let the receiver rebuild
  // a render mirror via defOf; the per-card fields let it re-derive current characteristics with refresh().
  snapshot(forIdx) {
    const serCard = c => ({
      id: c.id, name: c.def.name, controller: c.controller, owner: c.owner,
      tapped: !!c.tapped, sick: !!c.sick, damage: c.damage | 0, token: !!c.token,
      counters: { ...c.counters }, temp: { p: c.temp.p | 0, t: c.temp.t | 0, kw: [...c.temp.kw], flags: [...c.temp.flags] },
      flags: [...c.flags], regen: c.regen | 0, shield: c.shield | 0, chosenColor: c.chosenColor || null,
      attachedTo: c.attachedTo ? c.attachedTo.id : null,
      power: isCreature(c) ? power(c) : null, toughness: isCreature(c) ? toughness(c) : null,
    });
    const serPlayer = i => {
      const p = this.players[i], mine = i === forIdx;
      return {
        idx: i, name: p.name, life: p.life, poison: p.poison, landPlayed: p.landPlayed,
        pool: { ...p.pool }, shield: p.shield | 0, cop: [...p.cop], ai: !!p.ai, skipTurns: p.skipTurns | 0, skipDraw: p.skipDraw | 0,
        battlefield: p.battlefield.map(serCard), graveyard: p.graveyard.map(serCard), exile: p.exile.map(serCard),
        hand: mine ? p.hand.map(serCard) : p.hand.map(c => ({ id: c.id, hidden: true })),
        handCount: p.hand.length, libraryCount: p.library.length,
      };
    };
    const stack = this.stack.map(it => ({
      id: it.id, kind: it.kind, controller: it.controller,
      name: it.card ? it.card.def.name : (it.label || it.name || 'ability'),
      targets: (it.targets || []).map(t => ({ ...t })),
    }));
    // The opponent's private requests are hidden — the receiver only learns that they are waiting on them.
    let pending = null;
    if (this.pending?.type === 'priority') pending = { type: 'priority', player: this.priority };
    else if (this.pending?.type === 'request') {
      const req = this.pending.req;
      pending = req.player === forIdx ? { type: 'request', req } : { type: 'request', player: req.player, waiting: true };
    }
    return {
      forIdx, turn: this.turn, active: this.active, priority: this.priority, step: this.step,
      stepIndex: this.stepIndex, firstPlayer: this.firstPlayer, winner: this.winner,
      fog: this.fog, extraTurns: this.extraTurns, attackers: [...this.attackers],
      blocks: Object.fromEntries(Object.entries(this.blocks).map(([k, v]) => [k, [...v]])),
      stack, pending, fx: this.fx.map(f => ({ ...f })), log: this.log.slice(-60),
      players: [serPlayer(0), serPlayer(1)],
    };
  }

  pass(p) {
    this.passes++;
    if (this.passes >= 2) {
      this.passes = 0;
      if (this.stack.length) this.jobs.push({ gen: this.resolveTop() });
      else this.jobs.push({ gen: this.nextStep() });
    } else this.priority = 1 - this.priority;
  }
  shouldStop(p) {
    if (this.stack.length) {
      const top = this.stack[this.stack.length - 1];
      if (top.controller === p.idx && this.passes === 0) return false; // just cast it: let it go to the opponent
      return this.hasInstantAction(p) && (top.controller !== p.idx || !p.skipToEnd);
    }
    if (p.skipToEnd) return false;
    const mine = this.active === p.idx;
    if (mine && (this.step === 'main1' || this.step === 'main2')) return true;
    if (['attackers', 'blockers', 'firstStrike', 'damage'].includes(this.step)) return this.hasInstantAction(p);
    if (!mine && ['beginCombat', 'end', 'upkeep'].includes(this.step)) return this.hasInstantAction(p);
    if (mine && this.step === 'upkeep') return this.hasUpkeepAction(p);
    return false;
  }
  // Mirror Universe, Life Chisel, Gate to Phyrexia: abilities usable only during your own upkeep.
  hasUpkeepAction(p) {
    for (const c of p.battlefield) { const abs = abilitiesOf(c); for (let i = 0; i < abs.length; i++) if (abs[i].type === 'activated' && abs[i].timing === 'upkeep' && this.canActivate(p, c, i)) return true; }
    for (const c of p.graveyard) { const abs = c.def.abilities; for (let i = 0; i < abs.length; i++) if (abs[i].type === 'activated' && abs[i].zone === 'graveyard' && this.canActivate(p, c, i)) return true; }
    return false;
  }
  hasInstantAction(p) {
    for (const c of p.hand) if ((c.def.kind === 'instant' || has0(c.def, 'Flash') || c.def.keywords.some(k => k.k === 'Cycling')) && this.canCast(p, c)) return true;
    for (const c of p.battlefield) { const abs = abilitiesOf(c); for (let i = 0; i < abs.length; i++) if (abs[i].type === 'activated' && (abs[i].timing === 'instant' || abs[i].timing === 'yourTurn' || (abs[i].timing === 'upkeep' && this.step === 'upkeep')) && this.canActivate(p, c, i)) return true; }
    for (const c of p.graveyard) { const abs = c.def.abilities; for (let i = 0; i < abs.length; i++) if (abs[i].type === 'activated' && abs[i].zone === 'graveyard' && this.canActivate(p, c, i)) return true; }
    return false;
  }

  // ---- steps -------------------------------------------------------------------
  *nextStep() {
    for (;;) {
      this.stepIndex++;
      if (this.stepIndex >= STEPS.length) { this.newTurn(); }
      this.step = STEPS[this.stepIndex];
      this.stepCount++;
      for (const p of this.players) p.pool = emptyPool();
      const ap = this.activePlayer;
      let priority = true;
      switch (this.step) {
        case 'untap': {
          ap.landPlayed = 0; for (const pl of this.players) pl.skipToEnd = false;
          const keep = new Set();
          const canUntap = c => c.tapped && !c.flags.has('frozen') && !c.cur?.flags.has('doesntUntap');
          for (const [what, n] of Object.entries(this.untapLimits())) {
            const tapped = ap.battlefield.filter(c => canUntap(c) && (what === 'land' ? isLand(c) : what === 'artifact' ? isType(c, 'artifact') : isCreature(c)));
            if (tapped.length <= n) continue;
            const ids = yield { kind: 'choose', player: ap.idx, text: `Untap ${n} ${what}${n > 1 ? 's' : ''}`, options: tapped.map(c => ({ id: c.id, label: c.def.name })), min: n, max: n };
            const chosen = (ids || []).map(id => this.card(id)).filter(c => c && tapped.includes(c)).slice(0, n);
            while (chosen.length < n) chosen.push(tapped.find(c => !chosen.includes(c)));
            for (const c of tapped) if (!chosen.includes(c)) keep.add(c);
            this.say(`${ap.name} untaps only ${chosen.map(c => c.def.name).join(', ')}.`);
          }
          for (const c of ap.battlefield.slice()) {
            if (!canUntap(c) || keep.has(c) || !c.def.abilities.some(ab => ab.kind === 'mayNotUntap')) continue;
            const yes = yield { kind: 'yesno', player: ap.idx, text: `Untap ${c.def.name}?`, card: c.id, value: 'untap' };
            if (!yes) { keep.add(c); this.say(`${ap.name} leaves ${c.def.name} tapped.`); }
          }
          for (const c of ap.battlefield.slice()) if (c.flags.has('bounceOnUntap')) { this.say(`${c.def.name} returns to ${ap.name}'s hand.`); this.moveTo(c, 'hand'); }   // Undiscovered Paradise
          for (const c of ap.battlefield) {
            c.sick = false; c.attackedThisTurn = false; c.blockedThisTurn = false;
            if (c.flags.has('frozen')) { c.flags.delete('frozen'); continue; }
            if (c.cur?.flags.has('doesntUntap') || keep.has(c)) continue;
            if (c.tapped) c.tapped = false;
          }
          priority = false; break;
        }
        case 'upkeep': {
          this.say(`Turn ${this.turn}: ${ap.name}.`);
          for (const d of this.delayed.splice(0)) if (d.type === 'draw') { this.drawCards(this.players[d.player], d.amount || 1); }
          if (this.rules.upkeepDamage && ap.idx === 0 && this.turn > 1) { ap.life -= this.rules.upkeepDamage; this.say(`The miasma drains ${this.rules.upkeepDamage} life from ${ap.name}.`); }
          this.fireEvent({ type: 'upkeep', player: ap.idx });
          yield* this.upkeepCosts(ap);
          break;
        }
        case 'draw': {
          if (ap.skipDraw > 0) { ap.skipDraw--; this.say(`${ap.name} skips their draw step.`); }
          else if (!(this.turn === 1)) this.drawCards(ap, 1);
          this.fireEvent({ type: 'drawstep', player: ap.idx });
          break;
        }
        case 'beginCombat': this.fireEvent({ type: 'beginCombat', player: ap.idx }); break;
        case 'attackers': {
          const options = ap.battlefield.filter(c => this.canAttack(c)).map(c => c.id);
          if (!options.length) { this.attackers = []; this.stepIndex = STEPS.indexOf('endCombat') - 1; continue; }
          const must = options.filter(id => this.card(id).cur.flags.has('mustAttack'));
          let ids = yield { kind: 'attackers', player: ap.idx, options, must };
          ids = (ids || []).filter(id => options.includes(id));
          for (const id of must) if (!ids.includes(id)) ids.push(id);
          this.attackers = ids;
          for (const id of ids) { const c = this.card(id); if (!has(c, 'Vigilance')) this.tap(c); c.attackedThisTurn = true; this.fireEvent({ type: 'attacks', card: c }); }
          if (!ids.length) { this.say(`${ap.name} does not attack.`); this.stepIndex = STEPS.indexOf('endCombat') - 1; continue; }
          this.say(`${ap.name} attacks with ${ids.map(id => { const c = this.card(id); return `${c.def.name} (${power(c)}/${toughness(c)}) #${c.id}`; }).join(', ')}.`);
          this.fx.push({ type: 'attack', ids: ids.slice() });
          if (ids.length === 1) for (const c of ap.battlefield) { const n = [...c.cur.kw].filter(k => k === 'Exalted').length; if (n) this.pushTrigger(c, { type: 'triggered', event: 'exalted', effects: [{ type: 'pump', p: 1, t: 1, sel: 'fixed' }], text: 'Exalted' }, { fixed: this.card(ids[0]) }); }
          break;
        }
        case 'blockers': {
          const def = this.defender;
          const blocks = yield { kind: 'blockers', player: def.idx, attackers: this.attackers.slice() };
          const clean = {};
          for (const [aid, bids] of Object.entries(blocks || {})) if (bids.length) clean[Number(aid)] = bids.slice();
          if (!this.validBlocks(clean)) { this.say('Illegal blocks were ignored.'); }
          else this.blocks = clean;
          const names = Object.entries(this.blocks).map(([aid, bids]) => `${bids.map(id => this.cname(this.card(id))).join(' + ')} blocks ${this.cname(this.card(Number(aid)))}`);
          this.say(names.length ? names.join('; ') + '.' : `${def.name} does not block.`);
          for (const [aid, bids] of Object.entries(this.blocks)) this.fx.push({ type: 'block', attacker: Number(aid), blockers: bids.slice() });
          for (const [aid, bids] of Object.entries(this.blocks)) {
            const a = this.card(Number(aid));
            a.flags.add('blocked');   // a creature that has been blocked stays blocked even if its blockers later leave combat (e.g. regenerate)
            this.fireEvent({ type: 'becomesBlocked', card: a, by: bids.map(id => this.card(id)) });
            const ramp = a.def.keywords.find(k => k.k === 'Rampage');
            if (ramp && bids.length > 1) { const n = ramp.n * (bids.length - 1); a.temp.p += n; a.temp.t += n; this.say(`${a.def.name} rampages +${n}/+${n}.`); }
            for (const bid of bids) {
              const b = this.card(bid); b.blockedThisTurn = true;
              this.fireEvent({ type: 'blocks', card: b, attacker: a });
              if (has(a, 'Flanking') && !has(b, 'Flanking')) { b.temp.p -= 1; b.temp.t -= 1; this.say(`${b.def.name} gets -1/-1 from flanking.`); }
            }
          }
          this.refresh();
          break;
        }
        case 'firstStrike': {
          const fs = c => has(c, 'First strike') || has(c, 'Double strike');
          const any = this.attackers.some(id => fs(this.card(id))) || Object.values(this.blocks).flat().some(id => fs(this.card(id)));
          if (!any) continue;
          yield* this.combatDamage('first'); break;
        }
        case 'damage': yield* this.combatDamage('regular'); break;
        case 'endCombat': {
          this.fireEvent({ type: 'endCombat' });
          for (const c of this.permanents()) if (c.flags.has('destroyAtEndOfCombat')) { c.flags.delete('destroyAtEndOfCombat'); this.destroy(c, false); }
          for (const c of this.permanents()) c.flags.delete('blocked');
          this.attackers = []; this.blocks = {}; priority = false; break;
        }
        case 'end': {
          this.fireEvent({ type: 'endstep', player: ap.idx });
          for (const c of this.permanents()) if (c.flags.has('sacrificeAtEnd')) this.sacrifice(c);
          for (const item of this.delayed.filter(d => d.kind === 'scheduled' && d.when === 'end')) {
            if (item.cond === 'attacked') { const t = this.card(item.targetId); if (!t || !t.attackedThisTurn) continue; }
            this.runDelayed(item);
          }
          this.delayed = this.delayed.filter(d => !(d.kind === 'scheduled' && d.when === 'end'));
          break;
        }
        case 'cleanup': {
          const maxHand = ap.battlefield.some(c => c.def.abilities.some(ab => ab.type === 'static' && ab.kind === 'noMaxHand')) ? Infinity : 7;
          if (ap.hand.length > maxHand) {
            const n = ap.hand.length - 7;
            const ids = yield { kind: 'choose', player: ap.idx, text: `Discard down to seven: choose ${n} card${n > 1 ? 's' : ''}`, options: ap.hand.map(c => ({ id: c.id, label: c.def.name })), min: n, max: n };
            this.discardCards(ap, (ids || []).map(id => this.card(id)).filter(Boolean).slice(0, n));
            while (ap.hand.length > 7) this.discardCards(ap, [ap.hand[ap.hand.length - 1]]);
          }
          for (const d of this.delayed.filter(d => d.type === 'bounce')) { const c = this.card(d.card); if (c && c.zone === 'battlefield') { this.say(`${c.def.name} returns to its owner's hand.`); this.moveTo(c, 'hand'); } }
          this.delayed = this.delayed.filter(d => d.type !== 'bounce');
          this.endOfTurnCleanup();
          priority = false; break;
        }
      }
      if (priority) { this.priority = this.active; this.passes = 0; this.refresh(); this.emit(); return; }
      if (this.events.length) { this.priority = this.active; this.passes = 0; return; } // triggers will be processed, then priority
    }
  }
  untapLimits() {
    const out = {};
    for (const c of this.permanents()) for (const ab of c.def.abilities) {
      if (ab.type !== 'static' || ab.kind !== 'untapLimit') continue;
      if (ab.condition?.selfUntapped && c.tapped) continue;
      out[ab.what] = Math.min(out[ab.what] ?? 99, ab.n);
    }
    return out;
  }
  newTurn() {
    if (this.extraTurns > 0) { this.extraTurns--; this.say(`${this.activePlayer.name} takes an extra turn.`); }
    else this.active = 1 - this.active;
    // a player who must skip their turn passes it straight on (Meditate, Time Ebb-style effects)
    let guard = 0;
    while (this.players[this.active].skipTurns > 0 && guard++ < 4) { this.players[this.active].skipTurns--; this.say(`${this.activePlayer.name} skips their turn.`); this.active = 1 - this.active; }
    this.turn++;
    this.stepIndex = 0;
    this.fog = false;
  }
  endOfTurnCleanup() {
    for (const p of this.players) { p.shield = 0; p.cop = []; }
    for (const p of this.players) for (const c of p.battlefield) {
      c.damage = 0; c.temp = { p: 0, t: 0, kw: [], flags: [], animate: null }; c.damaged = new Set(); c.shield = 0; c.regen = 0;   // regeneration shields last only until end of turn
      for (const f of ['cantBlock', 'cantAttack', 'cantAttackOrBlock', 'unblockable', 'noCombatDamage', 'dealsNoCombatDamage', 'dealsNoDamage', 'noDamage', 'cantBeBlockedByWalls', 'blockableOnlyByWalls']) c.flags.delete(f);
      if (c.controlUntilEot !== null) { const orig = c.controlUntilEot; c.controlUntilEot = null; this.changeControl(c, orig); }
    }
    this.delayed = this.delayed.filter(d => d.kind !== 'scheduled');
    this.damageReplacements = [];
    this.fog = false; this.noPrevention = false;
  }
  *upkeepCosts(ap) {
    for (const c of ap.battlefield.slice()) {
      // Fading: remove a fade counter each upkeep; sacrifice it once there are none to remove.
      if (c.def.keywords.some(k => k.k === 'Fading')) {
        if ((c.counters.fade || 0) > 0) { c.counters.fade--; this.say(`${c.def.name} fades (${c.counters.fade} left).`); }
        else { this.say(`${c.def.name} fades away.`); this.sacrifice(c); continue; }
      }
      const cu = c.def.keywords.find(k => k.k === 'Cumulative upkeep');
      if (cu) {
        c.counters.age = (c.counters.age || 0) + 1;
        const n = c.counters.age;
        const cost = { pips: [].concat(...Array(n).fill(cu.cost.mana.pips)), generic: cu.cost.mana.generic * n, x: false };
        const extra = { life: (cu.cost.life || 0) * n, sacrifice: cu.cost.sacrifice, discard: cu.cost.discard * n };
        const can = this.canPay(ap, cost) && ap.life > extra.life && !(extra.sacrifice) && (ap.hand.length >= extra.discard);
        let pay = false;
        if (can) pay = yield { kind: 'yesno', player: ap.idx, text: `Pay cumulative upkeep for ${c.def.name} (${n}× ${costText(cu.cost)})?`, card: c.id, value: 'upkeep' };
        if (pay) { this.payMana(ap, this.planPayment(ap, cost)); ap.life -= extra.life; for (let i = 0; i < extra.discard; i++) this.discardCards(ap, [ap.hand[ap.hand.length - 1]]); this.say(`${ap.name} pays cumulative upkeep for ${c.def.name}.`); }
        else { this.say(`${ap.name} lets ${c.def.name} go.`); this.sacrifice(c); }
      }
      const echo = c.def.keywords.find(k => k.k === 'Echo');
      if (echo && c.enteredTurn === this.turn - 2 + (this.extraTurns ? 0 : 0) && !c.echoPaid) {
        c.echoPaid = true;
        const can = this.canPay(ap, echo.cost);
        let pay = false;
        if (can) pay = yield { kind: 'yesno', player: ap.idx, text: `Pay echo ${costText({ mana: echo.cost })} for ${c.def.name}?`, card: c.id, value: 'echo' };
        if (pay) this.payMana(ap, this.planPayment(ap, echo.cost)); else this.sacrifice(c);
      }
    }
  }

  // ---- events & triggers ------------------------------------------------------------
  fireEvent(ev) { this.events.push(ev); }
  *processEvents() {
    const evs = this.events.splice(0);
    const triggers = [];
    for (const ev of evs) {
      for (const c of this.permanents()) for (const ab of abilitiesOf(c)) if (ab.type === 'triggered' && this.triggerMatches(c, ab, ev)) triggers.push({ source: c, ab, ev });
      // dies triggers of the card that died (it is in the graveyard now)
      if (ev.type === 'dies' || ev.type === 'leaves') for (const ab of ev.card.def.abilities) if (ab.type === 'triggered' && ab.event === ev.type) triggers.push({ source: ev.card, ab, ev });
      // "when you cycle this card" triggers: the card is in the graveyard now, like a dies trigger
      if (ev.type === 'cycle') for (const ab of ev.card.def.abilities) if (ab.type === 'triggered' && ab.event === 'cycle') triggers.push({ source: ev.card, ab, ev });
      // Gaea's Blessing: the card just milled from a library triggers from the graveyard.
      if (ev.type === 'milled') for (const ab of ev.card.def.abilities) if (ab.type === 'triggered' && ab.event === 'milled') triggers.push({ source: ev.card, ab, ev });
      // Graveyard-recursion triggers (Squee, Nether Shadow, Krovikan Horror, Death Spark): abilities marked
      // zone 'graveyard' watch upkeep/end-step events from the graveyard, gated by their position condition.
      if (ev.type === 'upkeep' || ev.type === 'endstep') for (const pl of this.players) for (const c of pl.graveyard.slice()) for (const ab of c.def.abilities) if (ab.type === 'triggered' && ab.zone === 'graveyard' && this.triggerMatches(c, ab, ev)) triggers.push({ source: c, ab, ev });
      if (ev.type === 'enchantedGone') for (const ab of ev.aura.def.abilities) if (ab.type === 'triggered' && ((ab.event === 'enchantedDies' && ev.died) || ab.event === 'enchantedLeaves')) triggers.push({ source: ev.aura, ab, ev });
      if (ev.type === 'dies') { // undying / persist
        const c = ev.card;
        if (has0(c.def, 'Undying') && !(ev.counters?.['+1/+1'])) { this.returnFromGraveyard(c, '+1/+1'); }
        else if (has0(c.def, 'Persist') && !(ev.counters?.['-1/-1'])) { this.returnFromGraveyard(c, '-1/-1'); }
      }
    }
    // APNAP: non-active player's triggers go on the stack first so the active player's resolve first
    triggers.sort((a, b) => (a.source.controller === this.active ? 1 : 0) - (b.source.controller === this.active ? 1 : 0));
    for (const t of triggers) yield* this.pushTriggerJob(t.source, t.ab, t.ev);
    this.priority = this.active; this.passes = 0;
  }
  triggerMatches(c, ab, ev) {
    switch (ab.event) {
      case 'etb': return ev.type === 'etb' && ev.card === c;
      case 'attacks': return ev.type === 'attacks' && ev.card === c;
      case 'unblocked': return ev.type === 'unblocked' && ev.card === c;
      case 'blocks': return ev.type === 'blocks' && ev.card === c;
      case 'blocksOrBecomesBlocked': return (ev.type === 'blocks' || ev.type === 'becomesBlocked') && ev.card === c;
      case 'becomesBlocked': return ev.type === 'becomesBlocked' && ev.card === c;
      case 'becomesBlockedBy': return ev.type === 'becomesBlocked' && ev.card === c && ev.by.some(b => this.matchFilter(b, ab.filter));
      case 'enchantedTapped': return ev.type === 'tapped' && !!c.attachedTo && ev.card === c.attachedTo;
      case 'enchantedBlocksOrBlockedBy': return !!c.attachedTo && ((ev.type === 'blocks' && ev.card === c.attachedTo && this.matchFilter(ev.attacker, ab.filter)) || (ev.type === 'becomesBlocked' && ev.card === c.attachedTo && ev.by.some(b => this.matchFilter(b, ab.filter))));
      case 'enchantedBlocks': return !!c.attachedTo && ev.type === 'blocks' && ev.card === c.attachedTo;
      case 'enchantedBecomesBlocked': return !!c.attachedTo && ev.type === 'becomesBlocked' && ev.card === c.attachedTo;
      case 'enchantedLeaves': return false; // fired directly from moveTo (the aura has already been detached by then)
      case 'anyTapped': return ev.type === 'tapped' && ev.card !== c && this.matchesRestrict(ev.card, ab.restrict, this.players[c.controller]);
      case 'anyDies': return ev.type === 'dies' && ev.card !== c && this.matchesRestrict(ev.card, ab.restrict, this.players[c.controller]) && !(ab.notSacrificed && ev.sacrificed);
      case 'dealtDamage': return ev.type === 'damage' && ev.target === c;
      case 'endCombat': return ev.type === 'endCombat';
      case 'youPlayLand': return ev.type === 'etb' && isLand(ev.card) && ev.card.controller === c.controller && !(ab.other && ev.card === c);
      case 'anyLandEtb': return ev.type === 'etb' && isLand(ev.card);
      case 'oppDraws': return ev.type === 'draws' && ev.player !== c.controller;
      case 'manaTap': return ev.type === 'manaTap';
      case 'attacksOrBlocks': return (ev.type === 'attacks' || ev.type === 'blocks') && ev.card === c;
      case 'blocksOrBlockedBy': return (ev.type === 'blocks' && ev.card === c && this.matchFilter(ev.attacker, ab.filter)) || (ev.type === 'becomesBlocked' && ev.card === c && ev.by.some(b => this.matchFilter(b, ab.filter)));
      case 'combatDamagePlayer': return ev.type === 'damage' && ev.source === c && ev.combat && ev.target.idx !== undefined;
      case 'damagePlayer': return ev.type === 'damage' && ev.source === c && ev.target.idx !== undefined;
      case 'combatDamageCreature': return ev.type === 'damage' && ev.source === c && ev.combat && ev.target.def;
      case 'dealsDamage': return ev.type === 'damage' && ev.source === c;
      case 'becomesTapped': return ev.type === 'tapped' && ev.card === c;
      case 'targeted': return ev.type === 'targeted' && ev.card === c;
      case 'anyCreatureDies': return ev.type === 'dies' && isCreatureDef(ev.card) && (!ab.other || ev.card !== c);
      case 'damagedByDies': return ev.type === 'dies' && !!ev.damaged && ev.damaged.has(c.id);
      case 'anyCreatureEtb': return ev.type === 'etb' && isCreatureDef(ev.card) && (!ab.yours || ev.card.controller === c.controller) && (!ab.other || ev.card !== c);
      case 'enchantedDealsDamage': return ev.type === 'damage' && ev.source === c.attachedTo && !!c.attachedTo && (!ab.toYou || ev.target === this.players[c.controller]);
      case 'enchantedDies': return false; // fired directly from moveTo (see enchantedGone)
      case 'enchantedAttacks': return ev.type === 'attacks' && ev.card === c.attachedTo;
      case 'upkeep': return ev.type === 'upkeep' && (ab.who === 'each' || (ab.who === 'you' && ev.player === c.controller) || (ab.who === 'opp' && ev.player !== c.controller) || (ab.who === 'enchantedController' && c.attachedTo && ev.player === c.attachedTo.controller));
      case 'endstep': return ev.type === 'endstep' && (ab.who === 'each' || ev.player === c.controller);
      case 'drawstep': return ev.type === 'drawstep' && (ab.who === 'each' || ev.player === c.controller);
      case 'beginCombat': return ev.type === 'beginCombat' && ev.player === c.controller;
      case 'youCast': return ev.type === 'cast' && ev.player === c.controller && (ab.kind === 'any' || (ab.kind === 'creature' ? isCreatureDef(ev.card) : ab.kind === 'noncreature' ? !isCreatureDef(ev.card) : ev.card.def.kind === ab.kind || ev.card.def.types.map(t => t.toLowerCase()).includes(ab.kind)));
      case 'anyCombatToPlayer': return ev.type === 'damage' && ev.combat && ev.target && ev.target.idx !== undefined && ev.source && ev.source.def && this.matchesRestrict(ev.source, ab.filter || {}, this.players[c.controller]);
      case 'anyCast': return ev.type === 'cast' && (!ab.color || ev.card.def.colors.includes(ab.color)) && (!ab.who || (ab.who === 'opp') === (ev.player !== c.controller)) && (!ab.kind || ab.kind === 'any' || (ab.kind === 'noncreature' ? !isCreatureDef(ev.card) : ab.kind === 'creature' ? isCreatureDef(ev.card) : ev.card.def.kind === ab.kind || ev.card.def.types.map(t => t.toLowerCase()).includes(ab.kind)));
      case 'exalted': return false;
    }
    return false;
  }
  matchFilter(c, f) {
    if (!f || !Object.keys(f).length) return true;
    if (f.artifact && !isType(c, 'artifact')) return false;
    if (f.colors && !f.colors.some(col => c.def.colors.includes(col))) return false;
    if (f.flying && !has(c, 'Flying')) return false;
    if (f.subtype && !hasSubtype(c, f.subtype)) return false;
    return true;
  }
  *pushTriggerJob(source, ab, ev) {
    if (ab.condition && !this.conditionHolds(ab.condition, source)) return;
    const controller = this.players[source.controller];
    const targets = [];
    for (const e of ab.effects) {
      if (!needsTarget(e)) continue;
      const legal = this.legalTargets(controller, e, source);
      if (!legal.length) { this.say(`${source.def.name}'s ability has no legal target.`); return; }
      const pick = yield { kind: 'target', player: controller.idx, text: `${source.def.name}: choose a target`, options: legal, effect: e, source: source.id };
      if (!pick) return;
      targets.push(pick);
    }
    // "that creature" in block triggers refers to the other creature in the fight
    let fixed = null;
    if (ev.type === 'blocks') fixed = ev.attacker;
    else if (ev.type === 'becomesBlocked') fixed = (ab.filter && ev.by.find(b => this.matchFilter(b, ab.filter))) || ev.by?.[0] || null;
    else if ((ev.type === 'etb' || ev.type === 'tapped' || ev.type === 'manaTap' || ev.type === 'dies' || ev.type === 'cast') && ev.card !== source) fixed = ev.card;
    else if (ev.type === 'damage' && ev.source !== source) fixed = ev.source;
    if (/^enchanted/.test(ab.event) && source.attachedTo && ev.type !== 'blocks' && ev.type !== 'becomesBlocked') fixed = fixed && fixed !== source.attachedTo ? fixed : source.attachedTo;
    if (ev.type === 'enchantedGone') fixed = ev.host;
    const thatPlayer = ev.player ?? ev.target?.idx ?? (fixed && fixed.def ? fixed.controller : undefined) ?? (source.attachedTo ? source.attachedTo.controller : undefined);
    this.pushTrigger(source, ab, { targets, ev, fixed, thatPlayer });
  }
  pushTrigger(source, ab, extra = {}) {
    const item = { id: uid++, kind: 'trigger', card: source, controller: source.controller, targets: extra.targets || [], effects: ab.effects, optional: ab.optional, pay: ab.pay || null, payer: ab.payer || null, text: ab.text || '', ev: extra.ev, fixed: extra.fixed || null, thatPlayer: extra.thatPlayer ?? extra.ev?.player ?? (extra.ev?.target?.idx) };
    this.stack.push(item);
    this.say(`${source.def.name} triggers${this.targetText(item.targets)}.`);
  }

  // ---- mana --------------------------------------------------------------------
  manaSources(p) {
    const out = [];
    const nullRod = this.nullRod();
    for (const c of p.battlefield) {
      if (c.cur?.flags.has('noAbilities') || (nullRod && isType(c, 'artifact'))) continue;   // Humility / Null Rod
      c.def.manaAbilities.forEach((ma, i) => {
        // Only free-to-use abilities are planned automatically: tap abilities, or counter-cost ones like Wall of Roots.
        if (!((ma.cost.tap || ma.cost.addCounter) && !ma.cost.sacSelf && !ma.cost.sacrifice && !ma.cost.life && !ma.cost.mana.pips.length && !ma.cost.mana.generic)) return;
        if (ma.cost.tap && (c.tapped || (isCreature(c) && c.sick && !has(c, 'Haste')))) return;
        if (ma.limit && c.uses.turn === this.turn && (c.uses.n['m' + i] || 0) >= ma.limit) return;   // "activate only once each turn"
        if (ma.cost.removeCounter && ma.cost.removeCounter.n !== 'all' && (c.counters[ma.cost.removeCounter.kind] || 0) < ma.cost.removeCounter.n) return;
        let amount = ma.amount || 1;
        if (typeof amount === 'object') amount = this.amount(amount, { p, source: c });
        if (ma.cost.removeCounter?.n === 'all') { const removed = c.counters[ma.cost.removeCounter.kind] || 0; amount = (ma.plus === 'counters' ? 1 : 0) + removed; if (!removed) return; }
        if (amount <= 0) return;
        const produces = ma.reflect ? this.reflectProduces(p, c) : ma.produces;   // Reflecting Pool mirrors your other lands
        if (!produces.length) return;
        out.push({ card: c, index: i, produces, amount, taps: !!ma.cost.tap });   // taps: a card with two tap abilities (Llanowar Wastes: {C} vs {B}/{G}) can still only be tapped once
      });
    }
    return out;
  }
  totalMana(p) { return Object.values(p.pool).reduce((a, b) => a + b, 0) + this.manaSources(p).reduce((s, x) => s + x.amount, 0); }
  // Returns a payment plan {pool:{...}, taps:[{src,color}]} or null
  planPayment(p, cost, x = 0, poolOnly = false) {
    const pips = (cost.pips || []).slice().sort((a, b) => a.length - b.length);
    let generic = (cost.generic || 0) + (cost.x ? x * cost.x : 0);   // cost.x counts the X pips
    const pool = { ...p.pool };
    const usePool = {};
    const rem = [];
    for (const pip of pips) { const col = pip.find(c => pool[c] > 0); if (col) { pool[col]--; usePool[col] = (usePool[col] || 0) + 1; } else rem.push(pip); }
    const sources = poolOnly ? [] : this.manaSources(p);   // poolOnly: pay from the pool the player tapped, never auto-tap
    const used = new Array(sources.length).fill(null); // color chosen
    const left = sources.map(s => s.amount);
    // A tap-cost source is unavailable if another mana ability of the same card is already tapped in this plan
    // (Llanowar Wastes has two tap abilities but only one tap): one tap per card.
    const tapBlocked = (s) => sources[s].taps && sources.some((o, t) => t !== s && o.taps && o.card === sources[s].card && used[t]);
    const assign = (i) => {
      if (i === rem.length) return true;
      for (let s = 0; s < sources.length; s++) {
        const col = rem[i].find(c => sources[s].produces.includes(c));
        if (!col) continue;
        if (used[s] && used[s] !== col) continue;
        if (left[s] <= 0) continue;
        if (!used[s] && tapBlocked(s)) continue;
        const prev = used[s]; used[s] = col; left[s]--;
        if (assign(i + 1)) return true;
        used[s] = prev; left[s]++;
      }
      return false;
    };
    if (!assign(0)) return null;
    // Leftover mana available for generic: a card with two untapped tap abilities can only contribute once, so
    // count each untapped source but skip a tap ability whose card already contributes an untapped tap ability.
    let genericAvail = Object.values(pool).reduce((a, b) => a + b, 0);
    const seenTap = new Set();
    for (let s = 0; s < sources.length; s++) { if (left[s] <= 0) continue; if (sources[s].taps && !used[s]) { if (seenTap.has(sources[s].card) || tapBlocked(s)) continue; seenTap.add(sources[s].card); } genericAvail += left[s]; }
    if (genericAvail < generic) return null;
    // consume generic: pool first, then leftover units on already-tapped sources, then new sources (fewest colours first)
    for (const col of ['C', 'W', 'U', 'B', 'R', 'G']) while (generic > 0 && pool[col] > 0) { pool[col]--; usePool[col] = (usePool[col] || 0) + 1; generic--; }
    const order = sources.map((s, i) => i).sort((a, b) => (used[a] ? -1 : 0) - (used[b] ? -1 : 0) || sources[a].produces.length - sources[b].produces.length || (isLand(sources[a].card) ? -1 : 1) - (isLand(sources[b].card) ? -1 : 1));
    for (const i of order) { if (!used[i] && tapBlocked(i)) continue; while (generic > 0 && left[i] > 0) { if (!used[i]) used[i] = sources[i].produces[0]; left[i]--; generic--; } if (generic <= 0) break; }
    const taps = sources.map((s, i) => used[i] ? { src: s, color: used[i], spare: left[i] } : null).filter(Boolean);
    return { usePool, taps };
  }
  canPay(p, cost, x = 0, poolOnly = false) { return !!this.planPayment(p, cost, x, poolOnly); }
  payMana(p, plan) {
    if (!plan) return;
    for (const [col, n] of Object.entries(plan.usePool)) p.pool[col] -= n;
    for (const t of plan.taps) {
      const ma = t.src.card.def.manaAbilities[t.src.index];
      if (!ma || ma.cost.tap) this.tap(t.src.card);
      if (t.spare > 0) p.pool[t.color] += t.spare;
      if (ma?.cost.removeCounter?.n === 'all') t.src.card.counters[ma.cost.removeCounter.kind] = 0;
      else if (ma?.cost.removeCounter) { const k = ma.cost.removeCounter.kind; t.src.card.counters[k] = Math.max(0, (t.src.card.counters[k] || 0) - ma.cost.removeCounter.n); this.say(`${t.src.card.def.name} loses a ${k} counter (${t.src.card.counters[k]} left).`); }
      if (ma?.cost.addCounter) { const k = ma.cost.addCounter.kind; t.src.card.counters[k] = (t.src.card.counters[k] || 0) + ma.cost.addCounter.n; this.say(`${t.src.card.def.name} gets a ${k} counter (${t.src.card.counters[k]} now).`); }   // Wall of Roots
      if (ma?.limit) { const c = t.src.card; if (c.uses.turn !== this.turn) c.uses = { turn: this.turn, n: {} }; c.uses.n['m' + t.src.index] = (c.uses.n['m' + t.src.index] || 0) + 1; }
      if (ma?.counter) t.src.card.counters[ma.counter] = (t.src.card.counters[ma.counter] || 0) + 1;
      if (ma?.bounceOnUntap) t.src.card.flags.add('bounceOnUntap');   // Undiscovered Paradise
      if (!ma || ma.cost.tap) this.tappedForMana(p, t.src.card, ma, t.color);
      if (ma?.sacWhenEmpty && !(t.src.card.counters[ma.sacWhenEmpty] || 0)) { this.say(`${t.src.card.def.name} is spent.`); this.sacrifice(t.src.card); }   // Gemstone Mine
    }
  }
  // Side effects of tapping a permanent for mana: painland damage, Wild Growth / Mana Flare bonuses, Manabarbs triggers.
  tappedForMana(p, card, ma, color) {
    if (ma?.damage) this.dealDamage(card, p, ma.damage);
    if (isLand(card)) {
      for (const src of this.permanents()) for (const ab of src.def.abilities) {
        if (ab.type !== 'static' || ab.kind !== 'manaBonus' || !this.inScope(ab.scope, src, card)) continue;
        const col = ab.mana === 'same' ? color : ab.mana; p.pool[col]++; this.say(`${src.def.name} adds an extra ${col}.`);
      }
      this.fireEvent({ type: 'manaTap', player: p.idx, card });
    }
  }
  nullRod() { return this.permanents().some(r => r.def.abilities.some(ab => ab.type === 'static' && ab.kind === 'nullRod')); }
  ownTurnOnly() { return this.permanents().some(r => r.def.abilities.some(ab => ab.type === 'static' && ab.kind === 'ownTurnOnly')); }
  // Life gain that Sulfuric Vortex can shut off. Returns the amount actually gained.
  gainLife(pl, n) {
    if (n <= 0) return 0;
    if (this.permanents().some(c => c.def.abilities.some(ab => ab.type === 'static' && ab.kind === 'noLifeGain'))) { this.say(`${pl.name} gains no life.`); return 0; }
    pl.life += n; return n;
  }
  // Reflecting Pool: every colour any other land you control could produce.
  reflectProduces(p, self) { const out = new Set(); for (const l of p.battlefield) if (l !== self && isLand(l)) for (const col of l.def.produces || []) out.add(col); return [...out]; }
  // Card filters from parseCardFilter: { types, not, colors, subtypes } — used for hand/library picks.
  cardMatchesFilter(c, f) {
    if (!f) return true;
    const kindIs = (k) => k === 'creature' ? isCreatureDef(c) : k === 'permanent' ? !!c.def.isPermanent : (c.def.kind === k || c.def.types.map(t => t.toLowerCase()).includes(k));
    if (f.types && !f.types.every(kindIs)) return false;
    if (f.not && f.not.some(kindIs)) return false;
    if (f.colors && !f.colors.some(col => c.def.colors.includes(col))) return false;
    if (f.subtypes && !f.subtypes.some(st => c.def.subtypes.includes(st))) return false;
    return true;
  }
  sacMatches(c, what, cost = null) {
    if (!(isType(c, what) || hasSubtype(c, cap(what)) || (what === 'creature' && isCreature(c)))) return false;
    if (cost?.sacColor && !c.def.colors.includes(cost.sacColor)) return false;
    if (cost?.sacToken && !c.token) return false;
    if (cost?.sacSnow && !c.def.supertypes.includes('Snow')) return false;
    return true;
  }
  sacOptions(p, card, cost) { return p.battlefield.filter(x => this.sacMatches(x, cost.sacrifice, cost) && x !== card); }
  activateMana(p, card, i, color) {
    const ma = card.def.manaAbilities[i]; if (!ma || card.controller !== p.idx || card.zone !== 'battlefield') return false;
    if (card.cur?.flags.has('noAbilities') || (isType(card, 'artifact') && this.nullRod())) return false;
    if (ma.cost.tap && (card.tapped || (isCreature(card) && card.sick && !has(card, 'Haste')))) return false;
    if (ma.cost.mana.pips.length || ma.cost.mana.generic) { const plan = this.planPayment(p, ma.cost.mana); if (!plan) return false; this.payMana(p, plan); }
    if (ma.cost.tap) this.tap(card);
    if (ma.cost.sacSelf) this.sacrifice(card);
    if (ma.cost.sacrifice) { const opts = this.sacOptions(p, card, ma.cost); if (!opts.length) return false; this.sacrifice(opts.sort((a, b) => (a.tapped ? 0 : 1) - (b.tapped ? 0 : 1) || a.def.cmc - b.def.cmc)[0]); }
    if (ma.cost.life) p.life -= ma.cost.life;
    if (ma.limit) { if (card.uses.turn === this.turn && (card.uses.n['m' + i] || 0) >= ma.limit) return false; if (card.uses.turn !== this.turn) card.uses = { turn: this.turn, n: {} }; card.uses.n['m' + i] = (card.uses.n['m' + i] || 0) + 1; }
    let amount = ma.amount || 1;
    if (typeof amount === 'object') amount = this.amount(amount, { p, source: card });
    if (ma.cost.removeCounter) { const k = ma.cost.removeCounter.kind; const have = card.counters[k] || 0; if (ma.cost.removeCounter.n === 'all') { if (!have) return false; amount = (ma.plus === 'counters' ? 1 : 0) + have; card.counters[k] = 0; } else { if (have < ma.cost.removeCounter.n) return false; card.counters[k] = have - ma.cost.removeCounter.n; this.say(`${card.def.name} loses a ${k} counter (${card.counters[k]} left).`); } }
    if (ma.cost.addCounter) { const k = ma.cost.addCounter.kind; card.counters[k] = (card.counters[k] || 0) + ma.cost.addCounter.n; this.say(`${card.def.name} gets a ${k} counter (${card.counters[k]} now).`); }
    if (ma.counter) card.counters[ma.counter] = (card.counters[ma.counter] || 0) + 1;
    if (ma.bounceOnUntap) card.flags.add('bounceOnUntap');
    const prod = ma.reflect ? this.reflectProduces(p, card) : ma.produces;
    const col = prod.includes(color) ? color : prod[0];
    if (!col) return false;
    p.pool[col] += amount;
    this.say(`${p.name} adds ${amount} ${col} mana.`);
    if (ma.cost.tap) this.tappedForMana(p, card, ma, col);
    if (ma.sacWhenEmpty && !(card.counters[ma.sacWhenEmpty] || 0)) { this.say(`${card.def.name} is spent.`); this.sacrifice(card); }   // Gemstone Mine
    this.emit(); return true;
  }

  // ---- casting -------------------------------------------------------------------
  sorcerySpeed(p) { return this.active === p.idx && (this.step === 'main1' || this.step === 'main2') && this.stack.length === 0; }
  canCast(p, card, opts = {}) {
    if (this.winner !== null || this.priority !== p.idx) return false;
    const d = card.def;
    if (d.kind === 'unsupported') return false;
    const fromGrave = card.zone === 'graveyard' && d.keywords.some(k => k.k === 'Flashback');
    if (!(card.zone === 'hand' && p.hand.includes(card)) && !(fromGrave && p.graveyard.includes(card))) return false;
    if (opts.cycling) { const cy = d.keywords.find(k => k.k === 'Cycling'); return !!cy && card.zone === 'hand' && this.canPay(p, cy.cost); }
    if (d.kind === 'land') return this.sorcerySpeed(p) && p.landPlayed < this.landLimit(p);
    if (this.active !== p.idx && this.ownTurnOnly()) return false;   // City of Solitude
    const instantSpeed = d.kind === 'instant' || has0(d, 'Flash');
    if (!instantSpeed && !this.sorcerySpeed(p)) return false;
    let cost = fromGrave ? d.keywords.find(k => k.k === 'Flashback').cost : d.cost;
    if (opts.kicked) { const k = d.keywords.find(k => k.k === 'Kicker'); if (!k) return false; cost = addCosts(cost, k.cost); }
    if (opts.buyback) { const k = d.keywords.find(k => k.k === 'Buyback'); if (!k) return false; cost = addCosts(cost, k.cost); }
    cost = this.modifiedCost(p, card, cost);
    if (opts.pitch !== undefined && d.spell?.alternativeCost?.pitch) {
      const pc = this.card(opts.pitch); if (!pc || !p.hand.includes(pc) || pc === card || !pc.def.colors.includes(d.spell.alternativeCost.pitch)) return false;
    } else if (opts.sacLands && d.spell?.alternativeCost?.sacLands) {
      const alt = d.spell.alternativeCost.sacLands; if (p.battlefield.filter(l => isLand(l) && hasSubtype(l, alt.land)).length < alt.n) return false;   // Fireblast
    } else if (!this.canPay(p, cost, opts.x || 0, opts.poolOnly)) return false;
    const fbSac = fromGrave ? d.keywords.find(k => k.k === 'Flashback')?.sacrifice : null;   // Cabal Therapy's flashback
    const add = (fbSac ? { sacrifice: fbSac } : null) || d.spell?.additionalCost || d.additionalCost;
    if (add) {
      if (add.sacrifice && !p.battlefield.some(c => this.sacMatches(c, add.sacrifice))) return false;
      if (add.discard && p.hand.length - 1 < add.discard) return false;
      if (add.life && p.life <= add.life) return false;
    }
    if (d.aura) { const spec = { sel: d.aura === 'creature' ? 'creature' : 'permanent', restrict: auraRestrict(d.aura) }; if (!this.legalTargets(p, spec, card).length) return false; }
    if (d.spell) {
      const effects = this.spellEffects(d, opts);
      for (const e of effects) if (needsTarget(e) && !this.legalTargets(p, e, card).length) return false;
      if (d.spell.modes && !opts.modes && !this.availableModes(p, card).length) return false;
    }
    return true;
  }
  // Feroz's Ban, Gloom, Planar Gate, Stone Calendar: generic cost changes from statics on the battlefield.
  modifiedCost(p, card, cost) {
    let delta = 0;
    for (const src of this.permanents()) for (const ab of src.def.abilities) {
      if (ab.type !== 'static' || ab.kind !== 'costMod') continue;
      if (ab.who === 'you' && src.controller !== p.idx) continue;
      if (ab.who === 'opp' && src.controller === p.idx) continue;
      const f = ab.filter || {};
      if (f.kinds && !f.kinds.some(k => k === 'creature' ? isCreatureDef(card) : card.def.kind === k || card.def.types.map(t => t.toLowerCase()).includes(k))) continue;
      if (f.colors && !f.colors.some(col => card.def.colors.includes(col))) continue;
      if (f.subtypes && !f.subtypes.some(st => card.def.subtypes.includes(st))) continue;   // "Goblin spells cost {1} less"
      if (ab.offTurn && this.active === p.idx) continue;   // Defense Grid only taxes off-turn casting
      delta += ab.delta;
    }
    if (!delta) return cost;
    return { ...cost, generic: Math.max(0, (cost.generic || 0) + delta) };
  }
  landLimit(p) {
    let n = 1;
    for (const src of this.permanents()) for (const ab of src.def.abilities) if (ab.type === 'static' && ab.kind === 'extraLands' && (ab.who === 'all' || src.controller === p.idx)) n = ab.any ? 99 : n + ab.n;
    return n;
  }
  availableModes(p, card) {
    const d = card.def; if (!d.spell?.modes) return [];
    return d.spell.modes.map((m, i) => ({ index: i, text: m.text, ok: m.effects.every(e => !needsTarget(e) || this.legalTargets(p, e, card).length) })).filter(m => m.ok);
  }
  spellEffects(d, opts = {}) {
    if (!d.spell) return [];
    let eff = d.spell.effects.slice();
    if (d.spell.modes) { const chosen = opts.modes || [this.availableModesIndex(d)]; for (const i of chosen) if (d.spell.modes[i]) eff.push(...d.spell.modes[i].effects); }
    if (opts.kicked && d.spell.kickedEffects) eff.push(...d.spell.kickedEffects);
    return eff;
  }
  availableModesIndex(d) { return 0; }
  // Describe everything the caster must decide before casting.
  castOptions(p, card) {
    const d = card.def;
    const out = { targets: [], x: !!d.cost.x, kicker: d.keywords.find(k => k.k === 'Kicker')?.cost || null, buyback: d.keywords.find(k => k.k === 'Buyback')?.cost || null, modes: null, additional: d.spell?.additionalCost || d.additionalCost || null, pitch: d.spell?.alternativeCost?.pitch || null, sacLands: d.spell?.alternativeCost?.sacLands || null, flashback: card.zone === 'graveyard', cycling: d.keywords.find(k => k.k === 'Cycling')?.cost || null };
    if (d.spell?.modes) out.modes = { pick: d.spell.modal === 'one' ? 1 : 2, options: this.availableModes(p, card) };
    if (d.aura) out.targets.push({ text: `Enchant ${d.aura}`, options: this.legalTargets(p, { sel: 'permanent', restrict: auraRestrict(d.aura) }, card) });
    return out;
  }
  targetSpecs(p, card, opts = {}) {
    const d = card.def; const specs = [];
    if (d.aura) specs.push({ effect: { sel: 'permanent', restrict: auraRestrict(d.aura) }, text: `Enchant ${d.aura}` });
    for (const e of this.spellEffects(d, opts)) if (needsTarget(e)) specs.push({ effect: e, text: describeTarget(e) });
    return specs;
  }
  cast(p, card, opts = {}) {
    if (!this.canCast(p, card, opts)) return false;
    const d = card.def;
    if (opts.cycling) {
      const cy = d.keywords.find(k => k.k === 'Cycling');
      this.payMana(p, this.planPayment(p, cy.cost));
      this.moveTo(card, 'graveyard'); this.drawCards(p, 1); this.say(`${p.name} cycles ${d.name}.`);
      if (d.abilities.some(ab => ab.type === 'triggered' && ab.event === 'cycle')) this.fireEvent({ type: 'cycle', card, controller: p.idx });
      this.passes = 0; this.priority = p.idx; this.emit(); return true;
    }
    if (d.kind === 'land') {
      p.landPlayed++; this.moveTo(card, 'battlefield'); this.say(`${p.name} plays ${d.name}.`);
      this.fx.push({ type: 'land', id: card.id, controller: p.idx });
      this.passes = 0; this.priority = p.idx; this.emit(); return true;
    }
    const specs = this.targetSpecs(p, card, opts);
    const targets = opts.targets || [];
    for (let i = 0; i < specs.length; i++) {
      const legal = this.legalTargets(p, specs[i].effect, card);
      if (!targets[i] || !legal.some(l => sameRef(l, targets[i]))) return false;
    }
    const fromGrave = card.zone === 'graveyard';
    let cost = fromGrave ? d.keywords.find(k => k.k === 'Flashback').cost : d.cost;
    if (opts.kicked) cost = addCosts(cost, d.keywords.find(k => k.k === 'Kicker').cost);
    if (opts.buyback) cost = addCosts(cost, d.keywords.find(k => k.k === 'Buyback').cost);
    cost = this.modifiedCost(p, card, cost);
    if (opts.pitch !== undefined && d.spell?.alternativeCost?.pitch) { const pc = this.card(opts.pitch); this.moveTo(pc, 'exile'); p.life -= d.spell.alternativeCost.life || 0; this.say(`${p.name} exiles ${pc.def.name} from hand.`); }
    else if (opts.sacLands && d.spell?.alternativeCost?.sacLands) {
      const alt = d.spell.alternativeCost.sacLands;
      const chosen = [].concat(opts.sacLands === true ? [] : opts.sacLands).map(id => this.card(id)).filter(l => l && p.battlefield.includes(l) && isLand(l) && hasSubtype(l, alt.land));
      const rest = p.battlefield.filter(l => isLand(l) && hasSubtype(l, alt.land) && !chosen.includes(l)).sort((a, b) => (a.tapped ? 0 : 1) - (b.tapped ? 0 : 1));
      while (chosen.length < alt.n && rest.length) chosen.push(rest.shift());
      for (const l of chosen) this.sacrifice(l);
      this.say(`${p.name} sacrifices ${chosen.map(l => l.def.name).join(' and ')} to cast ${d.name}.`);
    }
    else this.payMana(p, this.planPayment(p, cost, opts.x || 0, opts.poolOnly));
    const fbSac = fromGrave ? d.keywords.find(k => k.k === 'Flashback')?.sacrifice : null;
    const add = (fbSac ? { sacrifice: fbSac } : null) || d.spell?.additionalCost || d.additionalCost;
    if (add) {
      if (add.sacrifice) { const c = this.card(opts.sacrifice) || p.battlefield.filter(x => this.sacMatches(x, add.sacrifice)).sort((a, b) => a.def.cmc - b.def.cmc)[0]; if (c) { opts._sacrificed = c; this.sacrifice(c); } }
      if (add.discard) { const cs = (opts.discard || []).map(id => this.card(id)).filter(c => c && p.hand.includes(c) && c !== card); while (cs.length < add.discard) { const c = p.hand.find(x => x !== card && !cs.includes(x)); if (!c) break; cs.push(c); } this.discardCards(p, cs); }
      if (add.life) p.life -= add.life;
    }
    card.zone = 'stack'; removeFrom(p.hand, card); removeFrom(p.graveyard, card);
    const item = { id: uid++, kind: 'spell', card, controller: p.idx, targets, x: opts.x || 0, modes: opts.modes || null, kicked: !!opts.kicked, buyback: !!opts.buyback, flashback: fromGrave, effects: this.spellEffects(d, opts), sacrificed: opts._sacrificed || null };
    this.stack.push(item);
    this.say(`${p.name} casts ${d.name}${opts.x ? ` (X=${opts.x})` : ''}${opts.kicked ? ' with kicker' : ''}${this.targetText(targets)}.`);
    this.fx.push({ type: 'cast', id: card.id, controller: p.idx });
    for (const t of targets) if (t.type === 'perm') this.fireEvent({ type: 'targeted', card: this.card(t.id) });
    this.fireEvent({ type: 'cast', player: p.idx, card });
    for (const c of p.battlefield) if (has(c, 'Prowess') && !isCreatureDef(card)) this.pushTrigger(c, { effects: [{ type: 'pump', p: 1, t: 1, sel: 'self' }], text: 'Prowess' });
    this.passes = 0; this.priority = p.idx; this.emit(); return true;
  }

  // ---- activated abilities -----------------------------------------------------------
  canActivate(p, card, i, opts = {}) {
    if (this.winner !== null || this.priority !== p.idx) return false;
    const ab = abilitiesOf(card)[i]; if (!ab || ab.type !== 'activated') return false;
    if (ab.zone === 'graveyard') { if (card.zone !== 'graveyard' || card.owner !== p.idx) return false; }   // Ashen Ghoul
    else if (card.zone !== 'battlefield' || card.controller !== p.idx) return false;
    if (isType(card, 'artifact') && this.nullRod()) return false;
    if (this.active !== p.idx && this.ownTurnOnly()) return false;   // City of Solitude
    if (ab.timing === 'sorcery' && !this.sorcerySpeed(p)) return false;
    const lim = ab.limit || (ab.once ? 1 : 0);
    if (lim && card.uses.turn === this.turn && (card.uses.n[i] || 0) >= lim) return false;
    const c = ab.cost;
    if (c.tap && (card.tapped || (isCreature(card) && card.sick && !has(card, 'Haste')))) return false;
    if (c.untap && !card.tapped) return false;
    if (c.life && p.life <= c.life) return false;
    if (c.discard && p.hand.length < c.discard) return false;
    if (c.sacrifice && this.sacOptions(p, card, c).length < (c.sacN || 1)) return false;
    if (c.exileTop && p.library.length < c.exileTop) return false;
    if (c.tapLand && !p.battlefield.some(x => isLand(x) && !x.tapped && hasSubtype(x, c.tapLand))) return false;
    if (ab.timing === 'yourTurn' && this.active !== p.idx) return false;
    if (c.removeCounter && !((card.counters[c.removeCounter.kind] || 0) >= c.removeCounter.n)) return false;
    if (c.exileFromGraveyard && p.graveyard.length < c.exileFromGraveyard) return false;
    if (ab.condition && !this.conditionHolds(ab.condition, card)) return false;   // threshold etc.
    if (ab.timing === 'upkeep' && !(this.step === 'upkeep' && this.active === p.idx)) return false;
    if (c.tapCreature && !p.battlefield.some(x => isCreature(x) && !x.tapped && x !== card)) return false;
    if ((c.mana.pips.length || c.mana.generic || c.mana.x) && !this.canPay(p, c.mana, opts.x || 0)) return false;
    for (const e of ab.effects) if (needsTarget(e) && !this.legalTargets(p, e, card).length) return false;
    return true;
  }
  activateOptions(p, card, i) {
    const ab = abilitiesOf(card)[i];
    return { x: !!ab.cost.mana.x, targets: ab.effects.filter(needsTarget).map(e => ({ text: describeTarget(e), options: this.legalTargets(p, e, card), effect: e })), sacrifice: ab.cost.sacrifice ? this.sacOptions(p, card, ab.cost).map(x => x.id) : null, sacN: ab.cost.sacN || 1, discard: ab.cost.discard ? p.hand.map(x => x.id) : null };
  }
  activate(p, card, i, opts = {}) {
    if (!this.canActivate(p, card, i, opts)) return false;
    const ab = abilitiesOf(card)[i]; const c = ab.cost;
    const specs = ab.effects.filter(needsTarget);
    const targets = opts.targets || [];
    for (let k = 0; k < specs.length; k++) { const legal = this.legalTargets(p, specs[k], card); if (!targets[k] || !legal.some(l => sameRef(l, targets[k]))) return false; }
    if (c.mana.pips.length || c.mana.generic || c.mana.x) this.payMana(p, this.planPayment(p, c.mana, opts.x || 0));
    if (c.tap) this.tap(card);
    if (c.untap) card.tapped = false;
    if (c.life) p.life -= c.life;
    const sacCounters = c.sacSelf ? { ...card.counters } : null;   // Powder Keg reads its fuse counters after being sacrificed
    if (c.sacSelf) this.sacrifice(card);
    if (c.exileSelf) this.moveTo(card, 'exile');
    let sacrificed = null;
    if (c.sacrifice) {
      const chosen = [].concat(opts.sacrifice ?? []).map(id => this.card(id)).filter(x => x && this.sacMatches(x, c.sacrifice, c) && x !== card && x.zone === 'battlefield');
      const rest = this.sacOptions(p, card, c).filter(x => !chosen.includes(x)).sort((a, b) => a.def.cmc - b.def.cmc);
      while (chosen.length < (c.sacN || 1) && rest.length) chosen.push(rest.shift());
      for (const s of chosen) this.sacrifice(s);
      sacrificed = chosen[0] || null;
    }
    if (c.exileTop) for (let k = 0; k < c.exileTop; k++) { const t = p.library.pop(); if (t) { t.zone = 'limbo'; this.moveTo(t, 'exile'); } }
    if (c.exileFromGraveyard) { const chosen = [].concat(opts.exileFromGraveyard ?? []).map(id => this.card(id)).filter(x => x && p.graveyard.includes(x)); const rest = p.graveyard.filter(x => !chosen.includes(x)); while (chosen.length < c.exileFromGraveyard && rest.length) chosen.push(rest.shift()); for (const x of chosen) this.moveTo(x, 'exile'); }
    if (c.returnSelf) this.moveTo(card, 'hand');   // Recurring Nightmare
    if (c.tapLand) { const l = this.card(opts.tapLand) || p.battlefield.find(x => isLand(x) && !x.tapped && hasSubtype(x, c.tapLand)); if (l) this.tap(l); }
    if (c.discard) { const cs = (opts.discard || []).map(id => this.card(id)).filter(x => x && p.hand.includes(x)); while (cs.length < c.discard) { const x = p.hand.find(h => !cs.includes(h)); if (!x) break; cs.push(x); } this.discardCards(p, cs); }
    if (c.removeCounter) card.counters[c.removeCounter.kind] -= c.removeCounter.n;
    if (c.tapCreature) { const t = this.card(opts.tapCreature) || p.battlefield.find(x => isCreature(x) && !x.tapped && x !== card); if (t) this.tap(t); }
    if (card.uses.turn !== this.turn) card.uses = { turn: this.turn, n: {} };
    card.uses.n[i] = (card.uses.n[i] || 0) + 1;
    const item = { id: uid++, kind: 'ability', card, controller: p.idx, targets, x: opts.x || 0, effects: ab.effects, optional: ab.optional, text: ab.text, sacrificed, sacCounters, abilityIndex: i };
    this.stack.push(item);
    this.say(`${p.name} activates ${card.def.name}${this.targetText(targets)}.`);
    for (const t of targets) if (t.type === 'perm') this.fireEvent({ type: 'targeted', card: this.card(t.id) });
    this.passes = 0; this.priority = p.idx; this.emit(); return true;
  }

  // ---- targets ----------------------------------------------------------------------
  // " targeting X" for the log, so the opponent sees what a spell, ability or trigger was aimed at — a
  // creature, a player, a spell on the stack, or (Raise Dead, Gravedigger) a card in a graveyard.
  targetText(targets) {
    const names = (targets || []).map(t => {
      if (!t) return null;
      if (t.type === 'player') return t.label || this.players[t.idx]?.name;
      if (t.type === 'spell') { const it = this.stack.find(x => x.id === t.id); return (t.label || it?.card?.def?.name || 'a spell') + ' on the stack'; }
      const c = this.card(t.id); const name = t.label || c?.def?.name;
      if (!name) return null;
      if (t.type === 'card' || c?.zone === 'graveyard') { const who = this.players[c?.owner ?? c?.controller]; return who ? `${name} in ${who.name}'s graveyard` : `${name} in the graveyard`; }
      return name;
    }).filter(Boolean);
    return names.length ? ` targeting ${names.join(' and ')}` : '';
  }
  legalTargets(p, e, source) {
    const out = [];
    const r = e.restrict || {};
    const addPerm = (c) => { if (this.canTarget(p, c, source) && this.matchesRestrict(c, r, p)) out.push({ type: 'perm', id: c.id, label: c.def.name }); };
    switch (e.sel) {
      case 'any':
        for (const pl of this.players) for (const c of pl.battlefield) if (isCreature(c)) addPerm(c);
        for (const pl of this.players) out.push({ type: 'player', idx: pl.idx, label: pl.name });
        break;
      case 'creature': for (const pl of this.players) for (const c of pl.battlefield) if (isCreature(c)) addPerm(c); break;
      case 'permanent': for (const pl of this.players) for (const c of pl.battlefield) addPerm(c); break;
      case 'player': for (const pl of this.players) out.push({ type: 'player', idx: pl.idx, label: pl.name }); break;
      case 'opponent': out.push({ type: 'player', idx: 1 - p.idx, label: this.opponentOf(p).name }); break;
      case 'spell':
        for (const it of this.stack) {
          if (it.kind !== 'spell') continue;
          const d = it.card.def; const k = r.spellKind || 'spell';
          const isC = isCreatureDef(it.card);
          let ok = true;
          if (k === 'creature') ok = isC; else if (k === 'noncreature') ok = !isC; else if (k === 'instant or sorcery') ok = d.kind === 'instant' || d.kind === 'sorcery';
          else if (['artifact', 'enchantment', 'instant', 'sorcery'].includes(k)) ok = d.kind === k || d.types.map(x => x.toLowerCase()).includes(k);
          if (ok) out.push({ type: 'spell', id: it.id, label: d.name });
        }
        break;
      case 'card': {
        const zones = r.who === 'you' ? [p] : this.players;
        for (const pl of zones) for (const c of pl.graveyard) if (matchCardWhat(c, r.what)) out.push({ type: 'card', id: c.id, label: c.def.name });
        break;
      }
    }
    return out;
  }
  canTarget(p, c, source) {
    if (has(c, 'Shroud')) return false;
    if (source?.def?.aura && c.cur?.flags.has('noAuras')) return false;
    if (has(c, 'Hexproof') && c.controller !== p.idx) return false;
    if (source && this.protectedFrom(c, source)) return false;
    return true;
  }
  protectedFrom(c, source) {
    if (!c.cur) return false;
    for (const k of c.cur.kw) {
      if (typeof k !== 'object' || k.k !== 'Protection') continue;
      const f = k.from;
      if (COLORS.includes(f) && (source.def?.colors || []).includes(f)) return true;
      if (f === 'artifacts' && source.def && isType(source, 'artifact')) return true;
      if (f === 'creatures' && source.def && isCreatureDef(source)) return true;
      if (f === 'instants' && source.def?.kind === 'instant') return true;
      if (f === 'sorceries' && source.def?.kind === 'sorcery') return true;
      if (f === 'enchantments' && source.def && isType(source, 'enchantment')) return true;
      if (f === 'everything') return true;
    }
    return false;
  }
  matchesRestrict(c, r, p) {
    if (!r) return true;
    if (r.types && !r.types.some(t => t === 'permanent' || isType(c, t) || (t === 'creature' && isCreature(c)))) return false;
    if (r.not) for (const n of r.not) {
      if (COLORS.includes(n) && c.def.colors.includes(n)) return false;
      if (['artifact', 'land', 'creature', 'enchantment'].includes(n) && isType(c, n)) return false;
      if (n === 'wall' && hasSubtype(c, 'Wall')) return false;
      if (n === 'token' && c.token) return false;
      if (n === 'basic' && c.def.basic) return false;
      if (n === 'legendary' && c.def.legendary) return false;
    }
    if (r.colors && !r.colors.some(col => c.def.colors.includes(col))) return false;
    if (r.subtypes && !r.subtypes.some(s => hasSubtype(c, s))) return false;
    if (r.state === 'attacking' && !this.attackers.includes(c.id)) return false;
    if (r.state === 'blocking' && !Object.values(this.blocks).flat().includes(c.id)) return false;
    if (r.state === 'combat' && !this.attackers.includes(c.id) && !Object.values(this.blocks).flat().includes(c.id)) return false;
    if (r.state === 'tapped' && !c.tapped) return false;
    if (r.state === 'untapped' && c.tapped) return false;
    if (r.control === 'you' && c.controller !== p.idx) return false;
    if (r.control === 'opp' && c.controller === p.idx) return false;
    if (r.flying === true && !has(c, 'Flying')) return false;
    if (r.flying === false && has(c, 'Flying')) return false;
    if (r.legendary && !c.def.legendary) return false;
    if (r.basic && !c.def.basic) return false;
    if (r.token && !c.token) return false;
    if (r.power) { const pw = power(c); if (r.power.op === 'less' ? pw > r.power.n : pw < r.power.n) return false; }
    if (r.toughness) { const t = toughness(c); if (r.toughness.op === 'less' ? t > r.toughness.n : t < r.toughness.n) return false; }
    if (r.pt && !(power(c) === r.pt[0] && toughness(c) === r.pt[1])) return false;
    if (r.name && c.def.name !== r.name) return false;
    if (r.snow && !c.def.supertypes.includes('Snow')) return false;
    return true;
  }
  refIsLegal(p, e, ref, source) { return this.legalTargets(p, e, source).some(l => sameRef(l, ref)); }

  // ---- resolution ---------------------------------------------------------------------
  *resolveTop() {
    const item = this.stack.pop();
    const p = this.players[item.controller];
    const card = item.card;
    if (item.kind === 'spell') {
      const d = card.def;
      const specs = this.targetSpecs(p, card, { modes: item.modes, kicked: item.kicked });
      const legal = specs.map((s, i) => this.refIsLegal(p, s.effect, item.targets[i], card));
      if (specs.length && !legal.some(Boolean)) { this.say(`${d.name} is countered on resolution (no legal targets).`); this.moveTo(card, item.flashback ? 'exile' : 'graveyard'); this.afterResolve(); return; }
      if (d.isPermanent) {
        if (d.aura) {
          const t = this.card(item.targets[0].id);
          if (!t || !legal[0]) { this.moveTo(card, 'graveyard'); this.afterResolve(); return; }
          this.moveTo(card, 'battlefield', { attachTo: t, kicked: item.kicked });
        } else this.moveTo(card, 'battlefield', { kicked: item.kicked });
        this.say(`${d.name} enters the battlefield.`);
        this.afterResolve(); return;
      }
      const ctx = { p, source: card, targets: item.targets.slice(), ti: 0, x: item.x, prev: null, legal, item };
      yield* this.runEffects(item.effects, ctx, d.spellOptional);
      if (card.zone === 'stack') this.moveTo(card, item.flashback || item.exileSelf ? 'exile' : item.buyback ? 'hand' : 'graveyard');
      this.afterResolve(); return;
    }
    // ability or trigger
    if (item.optional) {
      const yes = yield { kind: 'yesno', player: p.idx, text: `${card.def.name}: ${item.text || 'use this ability'}?`, card: card.id, value: 'optional' };
      if (!yes) { this.afterResolve(); return; }
    }
    if (item.pay) {
      const payer = item.payer === 'thatPlayer' && item.thatPlayer !== undefined ? this.players[item.thatPlayer] : p;
      let yes = false;
      // "you may pay {X}" (Decree of Justice's cycling trigger): X is whatever the payer can afford.
      let x = 0; if (item.pay.x) { for (x = 20; x > 0; x--) if (this.canPay(payer, item.pay, x)) break; }
      if (item.pay.x ? x > 0 : this.canPay(payer, item.pay)) yes = yield { kind: 'yesno', player: payer.idx, text: `${card.def.name}: pay ${item.pay.x ? `{X} with X=${x}` : costString(item.pay)}? (${item.text || 'if you do, the effect happens'})`, card: card.id, value: 'payTrigger' };
      if (!yes) { this.say(`${payer.name} does not pay for ${card.def.name}.`); this.afterResolve(); return; }
      this.payMana(payer, this.planPayment(payer, item.pay, x)); item.x = x; this.say(`${payer.name} pays ${item.pay.x ? `X=${x}` : costString(item.pay)} for ${card.def.name}.`);
    }
    const specs = item.effects.filter(needsTarget);
    const legal = specs.map((e, i) => item.targets[i] && this.refIsLegal(p, e, item.targets[i], card));
    if (specs.length && !legal.some(Boolean)) { this.say(`${card.def.name}'s ability fizzles.`); this.afterResolve(); return; }
    const ctx = { p, source: card, targets: item.targets.slice(), ti: 0, x: item.x, prev: item.fixed ? { type: 'perm', id: item.fixed.id } : null, legal, item, thatPlayer: item.thatPlayer, lastDamage: item.ev?.type === 'damage' ? item.ev.amount : undefined };
    yield* this.runEffects(item.effects, ctx, false);
    this.afterResolve();
  }
  afterResolve() { this.priority = this.active; this.passes = 0; this.refresh(); this.emit(); }
  // Run a scheduled delayed effect. Its effects use no interactive choices (destroy / sacrifice self), so drain synchronously.
  runDelayed(item) {
    const source = this.card(item.source) || { id: item.source, def: { name: 'a delayed effect' }, zone: 'gone', controller: item.controller, flags: new Set() };
    const ctx = { p: this.players[item.controller], source, prev: item.targetId ? { type: 'perm', id: item.targetId } : null, targets: [], ti: 0, item: null };
    for (const e of item.effects) { const g = this.applyEffect(e, ctx); let r = g.next(); while (!r.done) r = g.next(); this.sba(); if (this.winner !== null) return; }
  }

  *runEffects(effects, ctx, optionalAll) {
    if (optionalAll && !ctx.p.ai) { const yes = yield { kind: 'yesno', player: ctx.p.idx, text: `${ctx.source.def.name}: apply the effect?`, value: 'optional' }; if (!yes) return; }
    for (const e of effects) {
      if (e.ifDid && ctx.did === false) continue;   // "sacrifice ~. If you do, …" when the sacrifice could not happen
      yield* this.applyEffect(e, ctx);
      this.sba();
      if (this.winner !== null) return;
    }
  }
  // Amounts: a number, 'X'/'-X', 'LAST' (damage that caused a trigger) or a calc object. `sub` is the current subject
  // for per-subject counts ("equal to the number of Islands that player controls").
  amount(v, ctx, sub = null) {
    if (v && typeof v === 'object') {
      const who = v.of === 'thatPlayer' && ctx.thatPlayer !== undefined ? this.players[ctx.thatPlayer] : v.of === 'subject' && sub?.player ? sub.player : v.of === 'subject' && sub?.card ? this.players[sub.card.controller] : ctx.p;
      let n = 0;
      if (v.calc === 'hand') n = (v.base || 0) + (v.mult || 1) * v.sign * who.hand.length;
      else if (v.calc === 'lands') n = (v.base || 0) + (v.mult || 1) * who.battlefield.filter(l => isLand(l) && (!v.land || hasSubtype(l, v.land)) && (!v.nonbasic || !l.def.basic)).length;
      else if (v.calc === 'x') n = ctx.x + (v.base || 0);
      else if (v.calc === 'count') { const src = ctx.source; const r = v.restrict?.control === 'targetPlayer' ? { ...v.restrict, control: 'you' } : v.restrict; n = (v.base || 0) + (v.mult || 1) * this.permanents().filter(c => c !== (v.restrict?.other ? src : null) && this.matchesRestrict(c, r, who)).length; }
      else if (v.calc === 'graveyard') n = (v.base || 0) + who.graveyard.filter(c => matchCardWhat(c, v.what)).length;
      else if (v.calc === 'attackers') n = (v.base || 0) + this.attackers.length;
      else if (v.calc === 'domain') { const T = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']; n = (v.base || 0) + T.filter(t => who.battlefield.some(l => isLand(l) && hasSubtype(l, t))).length; }
      else if (v.calc === 'graveyardNameAll') { const nm = ctx.source?.def?.name; n = (v.base || 0) + this.players.reduce((a, pl) => a + pl.graveyard.filter(c => c.def.name === nm).length, 0); }
      else if (v.calc === 'maxCmc') { const perms = this.permanents().filter(c => v.control !== 'you' || c.controller === who.idx); n = (v.base || 0) + (perms.length ? Math.max(...perms.map(c => c.def.cmc || 0)) : 0); }
      else if (v.calc === 'handKind') n = (v.base || 0) + (v.mult || 1) * who.hand.filter(c => matchCardWhat(c, v.what)).length;   // Metalworker
      else if (v.calc === 'counters') n = (v.base || 0) + (((ctx.item?.sacCounters) ?? ctx.source?.counters ?? {})[v.kind] || 0);   // Powder Keg (counters as they were when it was sacrificed)
      else if (v.calc === 'paidLife') n = (v.base || 0) + (ctx.source?.paidLife || 0);   // Phyrexian Processor
      else if (v.calc === 'stat') {
        const c = v.of === 'sacrificed' ? ctx.item?.sacrificed : v.of === 'castSpell' ? ctx.item?.ev?.card : v.of === 'self' ? ctx.source : sub?.card || this.prevCard(ctx);
        if (c) n = v.stat === 'power' ? power(c) : v.stat === 'toughness' ? toughness(c) : c.def.cmc;
        n = (v.base || 0) + (v.mult || 1) * n;
      }
      return Math.max(0, n);
    }
    if (v === 'LAST') return ctx.lastDamage || 0;
    return v === 'X' ? ctx.x : v === '-X' ? -ctx.x : v;
  }
  // Resolve the "subject" of an effect into a list of {card} / {player} objects.
  *subjects(e, ctx) {
    const p = ctx.p;
    switch (e.sel) {
      case 'you': return [{ player: p }];
      case 'self': return ctx.source.zone === 'battlefield' || ctx.source.zone === 'stack' ? [{ card: ctx.source }] : [];
      case 'enchanted': return ctx.source.attachedTo ? [{ card: ctx.source.attachedTo }] : [];
      case 'fixed': return ctx.item?.fixed ? [{ card: ctx.item.fixed }] : [];
      case 'thatPlayer': return ctx.thatPlayer !== undefined ? [{ player: this.players[ctx.thatPlayer] }] : [];
      case 'thatOpp': return ctx.thatPlayer !== undefined ? [{ player: this.opponentOf(this.players[ctx.thatPlayer]) }] : [];   // "each of that player's opponents"
      case 'castSpell': { const cc = ctx.item?.ev?.card; const it = cc && this.stack.find(x => x.card === cc); return it ? [{ item: it }] : []; }
      case 'sacrificed': return ctx.item?.sacrificed ? [{ card: ctx.item.sacrificed }] : [];
      case 'prevController': { const s = ctx.prev ? this.deref(ctx.prev) : ctx.item?.fixed ? { card: ctx.item.fixed } : null; return s?.card ? [{ player: this.players[s.card.controller] }] : []; }
      case 'prev': {
        // "that creature" / "its controller": the previous target, even if it has since left the battlefield
        if (ctx.prev) { if (ctx.prev.type === 'perm') { const c = this.card(ctx.prev.id); return c ? [{ card: c }] : []; } return [this.deref(ctx.prev)].filter(Boolean); }
        return ctx.item?.fixed ? [{ card: ctx.item.fixed }] : [];
      }
      case 'each': {
        const r = e.restrict || {}; const out = [];
        if (r.types) for (const pl of this.players) for (const c of pl.battlefield.slice()) if (this.matchesRestrict(c, r, p) && !(r.other && c === ctx.source)) out.push({ card: c });
        if (r.players === 'all') for (const pl of this.players) out.push({ player: pl });
        if (r.players === 'opp') out.push({ player: this.opponentOf(p) });
        if (r.players === 'you') out.push({ player: p });
        return out;
      }
      default: {
        if (!needsTarget(e)) return [];
        const i = ctx.ti++;
        const ref = ctx.targets[i];
        if (!ref || ctx.legal && ctx.legal[i] === false) return [];
        const s = this.deref(ref);
        if (s) ctx.prev = ref;
        return s ? [s] : [];
      }
    }
  }
  // The card an earlier target referred to, even if it has since left the battlefield (Exile, Creature Bond).
  prevCard(ctx) {
    if (ctx.prev?.type === 'perm' || ctx.prev?.type === 'card') return this.card(ctx.prev.id) || null;
    if (ctx.prev) return this.deref(ctx.prev)?.card || null;
    return ctx.item?.fixed || null;
  }
  deref(ref) {
    if (ref.type === 'player') return { player: this.players[ref.idx] };
    if (ref.type === 'perm') { const c = this.card(ref.id); return c && c.zone === 'battlefield' ? { card: c } : null; }
    if (ref.type === 'card') { const c = this.card(ref.id); return c ? { card: c } : null; }
    if (ref.type === 'spell') { const it = this.stack.find(x => x.id === ref.id); return it ? { item: it } : null; }
    return null;
  }
  *applyEffect(e, ctx) {
    const p = ctx.p, src = ctx.source;
    const subs = yield* this.subjects(e, ctx);
    const n = this.amount(e.amount, ctx);
    switch (e.type) {
      case 'damage': for (const s of subs) { const k = this.amount(e.amount, ctx, s); if (s.card) this.dealDamage(src, s.card, k); else if (s.player) this.dealDamage(src, s.player, k); } break;
      case 'damageEqualStat': for (const s of subs) { const c = this.prevCard(ctx); const k = c ? (e.stat === 'power' ? power(c) : toughness(c)) : 0; if (s.card) this.dealDamage(src, s.card, k); else if (s.player) this.dealDamage(src, s.player, k); } break;
      case 'damageEqualPower': for (const s of subs) if (s.card) this.dealDamage(src, s.card, power(src)); else if (s.player) this.dealDamage(src, s.player, power(src)); break;
      case 'fight': for (const s of subs) if (s.card) { this.dealDamage(src, s.card, power(src)); this.dealDamage(s.card, src, power(s.card)); } break;
      case 'destroy': for (const s of subs) if (s.card) this.destroy(s.card, !!e.noRegen); break;
      case 'destroyAll': { const cmcEq = e.cmcEq !== undefined ? this.amount(e.cmcEq, ctx) : null, cmcLE = e.cmcLE !== undefined ? this.amount(e.cmcLE, ctx) : null; for (const pl of this.players) for (const c of pl.battlefield.slice()) if (this.matchesRestrict(c, e.restrict, p) && (cmcEq === null || (c.def.cmc || 0) === cmcEq) && (cmcLE === null || (c.def.cmc || 0) <= cmcLE)) this.destroy(c, true); break; }
      case 'chaosOrb': {
        // Tear the orb up: a handful of pieces flutter down onto random nontoken permanents (either side's)
        // and destroy what they touch, then the orb itself shatters. Randomness lives here so the outcome
        // is authoritative; the duel view animates the pieces drifting to these victims.
        const orb = src;
        const board = this.permanents().filter(c => c !== orb && !c.token);
        const pieces = 5;
        const hit = new Set();
        for (let k = 0; k < pieces && board.length; k++) hit.add(board[Math.floor(this.rng() * board.length)]);
        const victims = [...hit];
        this.say(`${this.players[orb.controller].name} tears ${orb.def.name} into pieces!`);
        this.fx.push({ type: 'chaosOrb', orb: orb.id, controller: orb.controller, victims: victims.map(c => c.id) });
        for (const c of victims) this.destroy(c, true);
        if (orb.zone === 'battlefield') { this.say(`${orb.def.name} shatters and is gone.`); this.moveTo(orb, 'graveyard'); }
        this.chaosFlips = this.chaosFlips || [0, 0]; this.chaosFlips[orb.controller]++;
        break;
      }
      case 'exile': for (const s of subs) if (s.card) { this.say(`${s.card.def.name} is exiled.`); this.moveTo(s.card, 'exile'); } break;
      case 'exileAll': for (const pl of this.players) for (const c of pl.battlefield.slice()) if (this.matchesRestrict(c, e.restrict, p)) this.moveTo(c, 'exile'); break;
      case 'bounce': for (const s of subs) if (s.card) this.moveTo(s.card, 'hand'); break;
      case 'bounceSelf': if (src.zone === 'battlefield' || src.zone === 'stack') this.moveTo(src, 'hand'); break;
      case 'fromGraveyard': for (const s of subs) if (s.card && s.card.zone === 'graveyard') { this.moveTo(s.card, e.to === 'hand' ? 'hand' : 'battlefield', { controller: p.idx }); if (e.tapped) s.card.tapped = true; } break;
      case 'pump': { const dp = this.amount(e.p, ctx), dt = this.amount(e.t, ctx); for (const s of subs) if (s.card && isCreature(s.card)) { if (e.whileTapped) s.card.linked.push({ src: src.id, p: dp, t: dt }); else { s.card.temp.p += dp; s.card.temp.t += dt; } this.say(`${s.card.def.name} gets ${dp >= 0 ? '+' : ''}${dp}/${dt >= 0 ? '+' : ''}${dt}${e.whileTapped ? ` while ${src.def.name} stays tapped` : ''}.`); } break; }
      case 'grant': for (const s of subs) if (s.card) { s.card.temp.kw.push(e.keyword); this.say(`${s.card.def.name} gains ${kwName(e.keyword).toLowerCase()}.`); } break;
      case 'animateSelf': { const a = { p: e.p, t: e.t, types: e.types || ['creature'], kw: e.keywords || [] }; if (e.permanent) src.animatePerm = a; else src.temp.animate = a; this.say(`${src.def.name} becomes a ${e.p}/${e.t} creature${e.permanent ? '' : ' until end of turn'}.`); break; }
      // Karn: a noncreature artifact becomes an X/X artifact creature, X = its mana value, until end of turn.
      case 'animateTarget': for (const s of subs) if (s.card) { const n = s.card.def.cmc || 0; s.card.temp.animate = { p: n - (s.card.def.power || 0), t: n - (s.card.def.toughness || 0), types: ['creature', 'artifact'], kw: [] }; this.say(`${s.card.def.name} becomes a ${n}/${n} artifact creature until end of turn.`); } break;
      // Squee / Nether Shadow / Krovikan Horror / Death Spark / Ashen Ghoul: the source returns from the graveyard.
      case 'selfFromGraveyard': if (src.zone === 'graveyard') { this.moveTo(src, e.to, { controller: src.owner }); this.say(`${src.def.name} returns from the graveyard to ${e.to === 'hand' ? `${this.players[src.owner].name}'s hand` : 'the battlefield'}.`); } break;
      // Duress / Unmask / Mesmeric Fiend: look at a hand, pick a matching card, discard or exile it.
      case 'handPick': for (const s of subs) if (s.player) {
        const pl = s.player; const opts = pl.hand.filter(c => this.cardMatchesFilter(c, e.filter));
        this.say(`${pl.name} reveals: ${pl.hand.map(c => c.def.name).join(', ') || 'an empty hand'}.`);
        if (!opts.length) { this.say(`No matching card.`); continue; }
        let pick = null;
        if (p.ai) pick = opts.slice().sort((a, b) => (b.def.cmc || 0) - (a.def.cmc || 0))[0];
        else { const ids = yield { kind: 'choose', player: p.idx, text: `${src.def.name}: choose a card from ${pl.name}'s hand`, options: opts.map(c => ({ id: c.id, label: c.def.name })), min: 1, max: 1 }; pick = this.card((ids || [])[0]); if (!pick || !opts.includes(pick)) pick = opts[0]; }
        if (e.action === 'exile') { this.moveTo(pick, 'exile'); src.linkedExile = pick.id; this.say(`${pick.def.name} is exiled.`); }
        else if (e.action === 'discardName') { const all = pl.hand.filter(c => c.def.name === pick.def.name); this.discardCards(pl, all); this.say(`${p.name} names ${pick.def.name}; ${pl.name} discards ${all.length}.`); }   // Cabal Therapy
        else this.discardCards(pl, [pick]);
      } break;
      case 'returnLinkedExile': { const c = src.linkedExile != null ? this.card(src.linkedExile) : null; if (c && c.zone === 'exile') { this.moveTo(c, 'hand'); this.say(`${c.def.name} returns to ${this.players[c.owner].name}'s hand.`); } break; }
      // Goblin Lackey: put a matching permanent card from your hand onto the battlefield.
      case 'putFromHand': {
        const opts = p.hand.filter(c => c.def.isPermanent && c.def.kind !== 'unsupported' && this.cardMatchesFilter(c, e.filter));
        if (!opts.length) { this.say(`${p.name} has nothing to put onto the battlefield.`); break; }
        let pick = null;
        if (p.ai) pick = opts.slice().sort((a, b) => (b.def.cmc || 0) - (a.def.cmc || 0))[0];
        else { const ids = yield { kind: 'choose', player: p.idx, text: `${src.def.name}: put a card from your hand onto the battlefield`, options: opts.map(c => ({ id: c.id, label: c.def.name })), min: 0, max: 1, secret: true }; pick = this.card((ids || [])[0]); if (pick && !opts.includes(pick)) pick = null; }
        if (pick) { this.moveTo(pick, 'battlefield', { controller: p.idx }); this.say(`${p.name} puts ${pick.def.name} onto the battlefield.`); }
        break;
      }
      // Goblin Ringleader: reveal the top N, matching cards to hand, the rest to the bottom.
      case 'revealTake': {
        const top = p.library.slice(-n).reverse(); if (!top.length) break;
        this.say(`${p.name} reveals ${top.map(c => c.def.name).join(', ')}.`);
        for (const c of top) removeFrom(p.library, c);
        const keep = top.filter(c => this.cardMatchesFilter(c, e.filter)), rest = top.filter(c => !keep.includes(c));
        for (const c of keep) { c.zone = 'limbo'; this.moveTo(c, 'hand'); }
        for (const c of rest) p.library.unshift(c);
        this.say(`${p.name} takes ${keep.length ? keep.map(c => c.def.name).join(', ') : 'nothing'} and puts ${rest.length} on the bottom.`);
        break;
      }
      // Exhume: each player (active first) returns a creature card from their graveyard.
      case 'eachReanimate': for (const pl of [this.activePlayer, this.opponentOf(this.activePlayer)]) {
        const opts = pl.graveyard.filter(isCreatureDef); if (!opts.length) continue;
        let pick = null;
        if (pl.ai) pick = opts.slice().sort((a, b) => (b.def.power || 0) - (a.def.power || 0))[0];
        else { const ids = yield { kind: 'choose', player: pl.idx, text: `${src.def.name}: put a creature card from your graveyard onto the battlefield`, options: opts.map(c => ({ id: c.id, label: c.def.name })), min: 1, max: 1 }; pick = this.card((ids || [])[0]); if (!pick || !opts.includes(pick)) pick = opts[0]; }
        this.moveTo(pick, 'battlefield', { controller: pl.idx }); this.say(`${pl.name} returns ${pick.def.name} to the battlefield.`);
      } break;
      // Living Death: graveyard creatures and battlefield creatures trade places.
      case 'livingDeath': {
        const ex = this.players.map(pl => pl.graveyard.filter(isCreatureDef));
        for (const pl of this.players) for (const c of ex[pl.idx]) this.moveTo(c, 'exile');
        for (const pl of this.players) for (const c of pl.battlefield.slice()) if (isCreature(c)) this.sacrifice(c);
        for (const pl of this.players) for (const c of ex[pl.idx]) if (c.zone === 'exile') this.moveTo(c, 'battlefield', { controller: pl.idx });
        this.say(`${src.def.name}: every creature in play dies and every creature card in the graveyards returns.`);
        break;
      }
      // Donate: remember the chosen player, then hand them the chosen permanent.
      case 'pickPlayer': for (const s of subs) if (s.player) ctx.thatPlayer = s.player.idx; break;
      case 'donate': for (const s of subs) if (s.card && ctx.thatPlayer !== undefined) { this.changeControl(s.card, ctx.thatPlayer); this.say(`${this.players[ctx.thatPlayer].name} gains control of ${s.card.def.name}.`); } break;
      // Intuition: you find three, the opponent decides which one you keep.
      case 'intuition': for (const s of subs) if (s.player) {
        const opp = s.player; if (!p.library.length) break;
        const want = Math.min(3, p.library.length); let three;
        if (p.ai) three = p.library.slice().sort((a, b) => (b.def.cmc || 0) - (a.def.cmc || 0)).slice(0, want);
        else { const ids = yield { kind: 'choose', player: p.idx, text: `${src.def.name}: search your library for three cards`, options: p.library.map(c => ({ id: c.id, label: c.def.name })), min: want, max: want, secret: true }; three = (ids || []).map(id => this.card(id)).filter((c, i, a) => c && p.library.includes(c) && a.indexOf(c) === i); }
        if (!three.length) break;
        this.say(`${p.name} reveals ${three.map(c => c.def.name).join(', ')}.`);
        let keep;
        if (opp.ai) keep = three.slice().sort((a, b) => (a.def.cmc || 0) - (b.def.cmc || 0))[0];
        else { const ids = yield { kind: 'choose', player: opp.idx, text: `${src.def.name}: choose the card ${p.name} keeps`, options: three.map(c => ({ id: c.id, label: c.def.name })), min: 1, max: 1 }; keep = this.card((ids || [])[0]); if (!keep || !three.includes(keep)) keep = three[0]; }
        for (const c of three) this.moveTo(c, c === keep ? 'hand' : 'graveyard');
        shuffle(p.library, this.rng); this.say(`${opp.name} lets ${p.name} keep ${keep.def.name}; the rest go to the graveyard.`);
      } break;
      // Fact or Fiction: the opponent splits the top five; you take a pile.
      case 'fof': {
        const top = p.library.slice(-5).reverse(); if (!top.length) break;
        for (const c of top) { removeFrom(p.library, c); c.zone = 'limbo'; }
        this.say(`${p.name} reveals ${top.map(c => c.def.name).join(', ')}.`);
        const opp = this.opponentOf(p); let pileA;
        if (opp.ai) pileA = [top.slice().sort((a, b) => (b.def.cmc || 0) - (a.def.cmc || 0))[0]];
        else { const ids = yield { kind: 'choose', player: opp.idx, text: `${src.def.name}: pick the cards for pile 1 (the rest form pile 2)`, options: top.map(c => ({ id: c.id, label: c.def.name })), min: 0, max: top.length }; pileA = (ids || []).map(id => this.card(id)).filter(c => c && top.includes(c)); }
        const pileB = top.filter(c => !pileA.includes(c));
        const val = pile => pile.reduce((a, c) => a + (c.def.cmc || 0) + (isLand(c) ? 1.5 : 0.5), 0);
        const takeA = p.ai ? val(pileA) >= val(pileB) : yield { kind: 'yesno', player: p.idx, text: `${src.def.name}: take pile 1 (${pileA.map(c => c.def.name).join(', ') || 'nothing'})? "No" takes pile 2 (${pileB.map(c => c.def.name).join(', ') || 'nothing'})`, value: 'fof' };
        const take = takeA ? pileA : pileB, rest = takeA ? pileB : pileA;
        for (const c of take) this.moveTo(c, 'hand'); for (const c of rest) this.moveTo(c, 'graveyard');
        this.say(`${p.name} takes ${take.map(c => c.def.name).join(', ') || 'nothing'}.`);
        break;
      }
      // Tangle Wire / Mishra's Helix: a player taps N permanents; `chooser` says who picks them.
      case 'tapMany': for (const s of subs) if (s.player) {
        const pl = s.player; const k = this.amount(e.amount, ctx, s); if (k <= 0) continue;
        const opts = pl.battlefield.filter(c => !c.tapped && this.matchesRestrict(c, e.restrict, pl)); if (!opts.length) continue;
        const chooser = e.chooser === 'controller' ? p : pl; const nn = Math.min(k, opts.length);
        let picks;
        if (chooser.ai) picks = opts.slice().sort((a, b) => (chooser === pl ? ((isLand(a) ? 1 : 0) - (isLand(b) ? 1 : 0)) : 0) || (a.def.cmc || 0) - (b.def.cmc || 0)).slice(0, nn);
        else { const ids = yield { kind: 'choose', player: chooser.idx, text: `${src.def.name}: tap ${nn} of ${chooser === pl ? 'your' : pl.name + "'s"} permanents`, options: opts.map(c => ({ id: c.id, label: c.def.name })), min: nn, max: nn }; picks = (ids || []).map(id => this.card(id)).filter((c, i, a) => c && opts.includes(c) && a.indexOf(c) === i).slice(0, nn); while (picks.length < nn) picks.push(opts.find(c => !picks.includes(c))); }
        for (const c of picks) this.tap(c);
        this.say(`${pl.name} taps ${picks.map(c => c.def.name).join(', ')}.`);
      } break;
      // Cursed Scroll: name the card you hold most copies of, reveal one at random, hit if it matches.
      case 'cursedScroll': {
        if (!p.hand.length) { this.say(`${p.name} has no cards in hand.`); break; }
        const counts = {}; for (const c of p.hand) counts[c.def.name] = (counts[c.def.name] || 0) + 1;
        let name = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];   // the AI names its most-held card
        if (!p.ai) {   // one entry per distinct name in hand; the pick is a name, so any card of that name stands for it
          const seen = new Set(); const opts = p.hand.filter(c => !seen.has(c.def.name) && seen.add(c.def.name)).map(c => ({ id: c.id, label: `${c.def.name}${counts[c.def.name] > 1 ? ` (×${counts[c.def.name]})` : ''}` }));
          const ids = yield { kind: 'choose', player: p.idx, text: `${src.def.name}: name a card (a random card from your hand is revealed; a match deals ${n} damage)`, options: opts, min: 1, max: 1, secret: true };
          const chosen = this.card((ids || [])[0]); if (chosen) name = chosen.def.name;
        }
        const rc = p.hand[Math.floor(this.rng() * p.hand.length)];
        this.say(`${p.name} names ${name} and reveals ${rc.def.name}.`);
        if (rc.def.name === name) { for (const s of subs) { if (s.card) this.dealDamage(src, s.card, n); else if (s.player) this.dealDamage(src, s.player, n); } }
        else this.say(`${src.def.name} misses.`);
        break;
      }
      // Phyrexian Processor: pay life as it enters; the Minion ability reads the amount back.
      case 'payAnyLife': {
        const max = Math.max(0, p.life - 1), suggested = Math.min(max, p.life > 10 ? 5 : 2);
        const paid = p.ai ? suggested : yield { kind: 'number', player: p.idx, text: `${src.def.name}: pay how much life?`, min: 0, max, default: suggested };
        const k = Math.max(0, Math.min(max, Number(paid) || 0)); p.life -= k; src.paidLife = k;
        this.say(`${p.name} pays ${k} life for ${src.def.name}.`);
        break;
      }
      // Cunning Wish: bring a card in from the sideboard.
      case 'wish': {
        const opts = (p.sideboard || []).filter(c => c.def.kind === e.what || c.def.types.map(t => t.toLowerCase()).includes(e.what));
        if (!opts.length) { this.say(`${p.name} has no ${e.what} card outside the game.`); break; }
        let pick = null;
        if (p.ai) pick = opts.slice().sort((a, b) => (b.def.cmc || 0) - (a.def.cmc || 0))[0];
        else { const ids = yield { kind: 'choose', player: p.idx, text: `${src.def.name}: choose a${e.what === 'instant' || e.what === 'artifact' || e.what === 'enchantment' ? 'n' : ''} ${e.what} card from your sideboard`, options: opts.map(c => ({ id: c.id, label: c.def.name })), min: 0, max: 1, secret: true }; pick = this.card((ids || [])[0]); if (pick && !opts.includes(pick)) pick = null; }
        if (pick) { this.moveTo(pick, 'hand'); this.say(`${p.name} wishes for ${pick.def.name}.`); }
        break;
      }
      case 'exileSelfSpell': if (src.zone === 'stack' && ctx.item) ctx.item.exileSelf = true; else if (src.zone === 'battlefield') this.moveTo(src, 'exile'); break;
      // Smokestack: a player sacrifices N permanents of their choice.
      case 'sacrificeMany': for (const s of subs) if (s.player) { const k = this.amount(e.amount, ctx, s); for (let i = 0; i < k; i++) { const did = yield* this.sacrificeChoice(s.player, e.what); if (!did) break; } } break;
      // Volrath's Dungeon: a player puts a card from their hand on top of their library.
      case 'handToTop': for (const s of subs) if (s.player) {
        const pl = s.player; if (!pl.hand.length) continue;
        let pick = null;
        if (pl.ai) pick = pl.hand.slice().sort((a, b) => (a.def.cmc || 0) - (b.def.cmc || 0))[0];
        else { const ids = yield { kind: 'choose', player: pl.idx, text: `${src.def.name}: put a card from your hand on top of your library`, options: pl.hand.map(c => ({ id: c.id, label: c.def.name })), min: 1, max: 1 }; pick = this.card((ids || [])[0]); if (!pick || !pl.hand.includes(pick)) pick = pl.hand[0]; }
        this.moveTo(pick, 'library'); this.say(`${pl.name} puts a card from hand on top of their library.`);
      } break;
      // Engineered Plague: pick a creature type (from types in play, in graveyards, or in your own hand).
      case 'chooseType': {
        const types = new Set();
        for (const pl of this.players) for (const c of [...pl.battlefield, ...pl.graveyard, ...(pl === p ? pl.hand : [])]) if (isCreatureDef(c)) for (const st of c.def.subtypes) types.add(st);
        const opp = this.opponentOf(p), count = {};
        for (const c of opp.battlefield) if (isCreature(c)) for (const st of c.def.subtypes) count[st] = (count[st] || 0) + 1;
        const list = [...types].sort((a, b) => (count[b] || 0) - (count[a] || 0) || a.localeCompare(b));
        let pick = list[0] || 'Goblin';
        if (!p.ai && list.length > 1) { const ids = yield { kind: 'choose', player: p.idx, text: `${src.def.name}: choose a creature type`, options: list.map(t => ({ id: 'type:' + t, label: t })), min: 1, max: 1 }; const got = String((ids || [])[0] || '').replace(/^type:/, ''); if (list.includes(got)) pick = got; }
        src.chosenType = pick; this.say(`${p.name} chooses ${pick} for ${src.def.name}.`); this.refresh();
        break;
      }
      // Evacuation / Hibernation.
      case 'bounceAllPerms': for (const pl of this.players) for (const c of pl.battlefield.slice()) if (this.matchesRestrict(c, e.restrict, p)) this.moveTo(c, 'hand'); break;
      // Flaring Pain.
      case 'noPrevent': this.noPrevention = true; this.say(`Damage can't be prevented this turn.`); break;
      // Stronghold Gambit.
      case 'gambit': {
        const picks = [];
        for (const pl of this.players) {
          if (!pl.hand.length) continue;
          let pick = null;
          if (pl.ai) pick = pl.hand.slice().sort((a, b) => ((isCreatureDef(b) ? 1 : 0) - (isCreatureDef(a) ? 1 : 0)) || (b.def.cmc || 0) - (a.def.cmc || 0))[0];
          else { const ids = yield { kind: 'choose', player: pl.idx, text: `${src.def.name}: choose a card from your hand to reveal`, options: pl.hand.map(c => ({ id: c.id, label: c.def.name })), min: 1, max: 1, secret: true }; pick = this.card((ids || [])[0]); if (!pick || !pl.hand.includes(pick)) pick = pl.hand[0]; }
          picks.push([pl, pick]);
        }
        for (const [pl, c] of picks) this.say(`${pl.name} reveals ${c.def.name}.`);
        const creatures = picks.filter(([, c]) => isCreatureDef(c));
        const floor = e.lowest && creatures.length ? Math.min(...creatures.map(([, c]) => c.def.cmc || 0)) : null;   // only the cheapest revealed creature(s) enter
        for (const [pl, c] of creatures) if (floor === null || (c.def.cmc || 0) === floor) this.moveTo(c, 'battlefield', { controller: pl.idx });
        break;
      }
      // Animate Dead: return the chosen creature card under your control and attach the Aura to it.
      case 'animateDead': for (const s of subs) if (s.card && s.card.zone === 'graveyard') { const host = s.card; this.moveTo(host, 'battlefield', { controller: p.idx }); src.attachedTo = host; src.animatedOnce = true; this.say(`${host.def.name} returns to the battlefield under ${p.name}'s control, enchanted by ${src.def.name}.`); } break;
      case 'flag': for (const s of subs) if (s.card) { if (e.temp) s.card.temp.flags.push(e.flag); else s.card.flags.add(e.flag); } break;
      case 'loseTemp': for (const s of subs) if (s.card) s.card.temp.flags.push('lose:' + e.keyword); break;
      case 'removeFromCombat': for (const s of subs) if (s.card) { removeFrom(this.attackers, s.card.id); delete this.blocks[s.card.id]; for (const k of Object.keys(this.blocks)) this.blocks[k] = this.blocks[k].filter(id => id !== s.card.id); this.say(`${s.card.def.name} is removed from combat.`); } break;
      case 'draw': for (const s of subs) if (s.player) this.drawCards(s.player, this.amount(e.amount, ctx, s)); break;
      case 'drawDiscardHand': for (const sb of subs) if (sb.player) { const k = sb.player.hand.length; this.drawCards(sb.player, k); yield* this.discardChoice(sb.player, k, false, p); } break;
      case 'discardDownTo': for (const sb of subs) if (sb.player) { const keep = this.amount(e.amount, ctx) || 0; const nn = Math.max(0, sb.player.hand.length - keep); if (nn > 0) yield* this.discardChoice(sb.player, nn, false, p); } break;
      case 'discardDraw': for (const s of subs) if (s.player) { const k = s.player.hand.length; this.discardCards(s.player, s.player.hand.slice()); this.drawCards(s.player, k); } break;
      case 'skipDrawStep': for (const sb of subs) if (sb.player) { sb.player.skipDraw = (sb.player.skipDraw || 0) + 1; this.say(`${sb.player.name} will skip their next draw step.`); } break;
      case 'fluxDiscard': for (const pl of this.players) { const opts = pl.hand.map(c => ({ id: c.id, label: c.def.name })); let ids = []; if (pl.ai) ids = []; else ids = (yield { kind: 'choose', player: pl.idx, text: `Discard any number of cards, then draw that many`, options: opts, min: 0, max: pl.hand.length, secret: true }) || []; const cs = ids.map(id => this.card(id)).filter(c => c && pl.hand.includes(c)); this.discardCards(pl, cs); this.drawCards(pl, cs.length); this.say(`${pl.name} discards ${cs.length} and draws ${cs.length}.`); } break;
      case 'shuffleHandDraw': { const k = p.hand.length; for (const c of p.hand.slice()) this.moveTo(c, 'library'); shuffle(p.library, this.rng); this.say(`${p.name} shuffles ${k} card${k === 1 ? '' : 's'} from hand into their library.`); this.drawCards(p, k); break; }
      case 'windfall': { const counts = this.players.map(pl => pl.hand.length); const max = Math.max(0, ...counts); for (const pl of this.players) { this.discardCards(pl, pl.hand.slice()); } this.say('Each player discards their hand.'); for (const pl of this.players) this.drawCards(pl, max); break; }
      case 'putBottom': { const k = Math.min(this.amount(e.amount, ctx) || 0, p.hand.length); if (k > 0) { const ids = p.ai ? p.hand.slice(0, k).map(c => c.id) : (yield { kind: 'choose', player: p.idx, text: `Put ${k} card${k > 1 ? 's' : ''} from your hand on the bottom of your library`, options: p.hand.map(c => ({ id: c.id, label: c.def.name })), min: k, max: k, secret: true }) || []; const chosen = ids.map(id => this.card(id)).filter(c => c && p.hand.includes(c)); for (const c of chosen) { removeFrom(p.hand, c); c.zone = 'library'; p.library.unshift(c); } this.say(`${p.name} puts ${chosen.length} card${chosen.length === 1 ? '' : 's'} on the bottom of their library.`); } break; }
      case 'discard': for (const s of subs) if (s.player) { if (e.filter === 'nonland') { const cs = s.player.hand.filter(c => !isLand(c)); this.say(`${s.player.name} reveals their hand.`); this.discardCards(s.player, cs); } else yield* this.discardChoice(s.player, e.all ? s.player.hand.length : n, e.random, p); } break;
      case 'gain': for (const s of subs) if (s.player) { const k = this.amount(e.amount, ctx, s); if (this.gainLife(s.player, k)) this.say(`${s.player.name} gains ${k} life.`); } break;
      case 'lose': for (const s of subs) if (s.player) { const k = this.amount(e.amount, ctx, s); s.player.life -= k; this.say(`${s.player.name} loses ${k} life.`); } break;
      case 'swapLife': for (const s of subs) if (s.player) { const a = p.life; p.life = s.player.life; s.player.life = a; this.say(`${p.name} and ${s.player.name} exchange life totals.`); } break;
      case 'destroyLeastPower': { const cs = this.permanents().filter(isCreature); if (cs.length) { const min = Math.min(...cs.map(power)); for (const c of cs.filter(c => power(c) === min)) this.destroy(c, true); } break; }
      case 'balance': {
        for (const what of ['land', 'hand', 'creature']) {
          const count = pl => what === 'hand' ? pl.hand.length : pl.battlefield.filter(c => what === 'land' ? isLand(c) : isCreature(c)).length;
          const min = Math.min(...this.players.map(count));
          for (const pl of this.players) {
            while (count(pl) > min) {
              if (what === 'hand') { yield* this.discardChoice(pl, count(pl) - min, false, p); break; }
              const did = yield* this.sacrificeChoice(pl, what);
              if (!did) break;
            }
          }
        }
        this.say('Balance evens out lands, hands and creatures.'); break;
      }
      case 'windsOfChange': for (const pl of this.players) { const k = pl.hand.length; for (const c of pl.hand.slice()) this.moveTo(c, 'library'); shuffle(pl.library, this.rng); this.say(`${pl.name} shuffles their hand away.`); this.drawCards(pl, k); } break;
      case 'shuffleGraveyard': { const pls = subs.filter(s => s.player).map(s => s.player); for (const pl of (pls.length ? pls : [p])) { for (const c of pl.graveyard.slice()) this.moveTo(c, 'library'); shuffle(pl.library, this.rng); this.say(`${pl.name} shuffles their graveyard into their library.`); } break; }
      case 'graveyardTopToBottom': { const c = p.graveyard[p.graveyard.length - 1]; if (c) { this.moveTo(c, 'library'); removeFrom(p.library, c); p.library.unshift(c); this.say(`${c.def.name} goes to the bottom of ${p.name}'s library.`); } break; }
      case 'lookHand': for (const s of subs) if (s.player) { const cards = e.random ? [s.player.hand[Math.floor(this.rng() * s.player.hand.length)]].filter(Boolean) : s.player.hand; if (!p.ai) yield { kind: 'look', player: p.idx, text: `${s.player.name}'s hand${e.random ? ' (one card at random)' : ''}`, options: cards.map(c => ({ id: c.id, label: c.def.name })), secret: true }; else this.say(`${p.name} looks at ${s.player.name}'s hand.`); } break;
      case 'bounceAll': for (const s of subs) if (s.player) for (const c of this.permanents().filter(c => c.owner === s.player.idx && this.matchesRestrict(c, e.restrict, p))) this.moveTo(c, 'hand'); break;
      case 'coin': { const win = this.rng() < 0.5; this.say(`${p.name} flips a coin and ${win ? 'wins' : 'loses'}.`); yield* this.runEffects(win ? e.win : e.lose, ctx, false); break; }
      case 'overuse': if (ctx.item?.abilityIndex !== undefined && (src.uses?.n[ctx.item.abilityIndex] || 0) >= e.n) { src.flags.add('sacrificeAtEnd'); this.say(`${src.def.name} will be sacrificed at end of turn.`); } break;
      case 'controlLinked': for (const s of subs) if (s.card) { s.card.controlLink = { src: src.id, back: s.card.controller }; this.changeControl(s.card, p.idx); this.say(`${p.name} gains control of ${s.card.def.name} while ${src.def.name} stays tapped.`); } break;
      case 'gainEqualPower': for (const s of subs) if (s.card) { const pl = this.players[s.card.controller]; const n = power(s.card); if (this.gainLife(pl, n)) this.say(`${pl.name} gains ${n} life.`); } break;
      case 'gainEqualPrev': { const s = e.of === 'sacrificed' ? (ctx.item?.sacrificed ? { card: ctx.item.sacrificed } : null) : (this.prevCard(ctx) ? { card: this.prevCard(ctx) } : null); const k = s?.card ? (e.stat === 'toughness' ? toughness(s.card) : e.stat === 'cmc' ? s.card.def.cmc : power(s.card)) : (ctx.lastDamage || 0); if (k && this.gainLife(p, k)) this.say(`${p.name} gains ${k} life.`); break; }
      case 'mill': for (const s of subs) if (s.player) { const k = this.amount(e.amount, ctx, s); for (let i = 0; i < k; i++) { const c = s.player.library.pop(); if (c) this.moveTo(c, 'graveyard'); } } break;
      case 'counter': for (const s of subs) if (s.item) {
        if (e.toTop) s.item._toTop = true;
        const ctrl = this.players[s.item.controller];
        if (e.unlessPay) { const pay = this.amount(e.unlessPay, ctx); const cost = { pips: [], generic: pay, x: false }; if (this.canPay(ctrl, cost)) { const yes = yield { kind: 'yesno', player: ctrl.idx, text: `Pay {${pay}} to stop ${s.item.card.def.name} from being countered?`, value: 'pay' }; if (yes) { this.payMana(ctrl, this.planPayment(ctrl, cost)); this.say(`${ctrl.name} pays ${pay}.`); continue; } } }
        if (e.drawController) this.delayed.push({ player: s.item.controller, type: 'draw', amount: e.drawController });
        this.counterItem(s.item);
      } break;
      case 'tutor': yield* this.tutor(p, e); break;
      case 'tap': for (const s of subs) if (s.card) this.tap(s.card); break;
      case 'untap': for (const s of subs) if (s.card) s.card.tapped = false; break;
      // Untap (up to) N of your permanents of a kind, your choice (Frantic Search: untap up to three lands).
      case 'untapMany': for (const s of subs) if (s.player) {
        const pl = s.player; const k = this.amount(e.amount, ctx, s); if (k <= 0) continue;
        const opts = pl.battlefield.filter(c => c.tapped && this.matchesRestrict(c, e.restrict, pl)); if (!opts.length) continue;
        const nn = Math.min(k, opts.length); let picks;
        if (pl.ai) picks = opts.slice().sort((a, b) => (b.def.cmc || 0) - (a.def.cmc || 0)).slice(0, nn);
        else { const ids = yield { kind: 'choose', player: pl.idx, text: `${src.def.name}: untap ${e.upTo ? 'up to ' : ''}${nn} of your ${e.restrict?.types?.[0] ? e.restrict.types[0] + 's' : 'permanents'}`, options: opts.map(c => ({ id: c.id, label: c.def.name })), min: e.upTo ? 0 : nn, max: nn }; picks = (ids || []).map(id => this.card(id)).filter(c => c && opts.includes(c)).slice(0, nn); }
        for (const c of picks) c.tapped = false;
        if (picks.length) this.say(`${pl.name} untaps ${picks.map(c => c.def.name).join(', ')}.`);
      } break;
      // Recall: discard X cards, then return that many cards of your choice from your graveyard to your hand.
      case 'recall': for (const s of subs) if (s.player) {
        const pl = s.player; const k = Math.min(this.amount(e.amount, ctx, s), pl.hand.length); if (k <= 0) { this.say(`${pl.name} discards nothing.`); continue; }
        const before = pl.graveyard.length;
        if (pl.ai) this.discardCards(pl, pl.hand.slice().sort((a, b) => (isLand(a) ? 0 : a.def.cmc || 0) - (isLand(b) ? 0 : b.def.cmc || 0)).slice(0, k));
        else yield* this.discardChoice(pl, k, false, src);
        const n = Math.min(pl.graveyard.length - before, pl.graveyard.length); if (n <= 0) continue;
        const opts = pl.graveyard.filter(c => c !== src);
        let picks;
        if (pl.ai) picks = opts.slice().sort((a, b) => (b.def.cmc || 0) - (a.def.cmc || 0)).slice(0, n);
        else { const ids = yield { kind: 'choose', player: pl.idx, text: `${src.def.name}: return ${n} card${n > 1 ? 's' : ''} from your graveyard to your hand`, options: opts.map(c => ({ id: c.id, label: c.def.name })), min: Math.min(n, opts.length), max: Math.min(n, opts.length) }; picks = (ids || []).map(id => this.card(id)).filter(c => c && opts.includes(c)).slice(0, n); }
        for (const c of picks) this.moveTo(c, 'hand');
        if (picks.length) this.say(`${pl.name} returns ${picks.map(c => c.def.name).join(', ')} to hand.`);
      } break;
      case 'tapOrUntap': for (const s of subs) if (s.card) { if (s.card.tapped) s.card.tapped = false; else this.tap(s.card); } break;
      case 'tapAll': for (const pl of this.players) for (const c of pl.battlefield) if (this.matchesRestrict(c, e.restrict, p)) this.tap(c); break;
      case 'untapAll': for (const pl of this.players) for (const c of pl.battlefield) if (this.matchesRestrict(c, e.restrict, p)) c.tapped = false; break;
      case 'freeze': for (const s of subs) if (s.card) s.card.flags.add('frozen'); break;
      case 'sacrifice': for (const s of subs) if (s.player) { const did = yield* this.sacrificeChoice(s.player, e.what, e.other ? src : null); if (!did && e.orElse) yield* this.runEffects(e.orElse, ctx, false); } break;
      case 'sacrificeAll': for (const s of subs) if (s.player) for (const c of s.player.battlefield.filter(c => this.matchesRestrict(c, e.restrict, s.player))) this.sacrifice(c); break;
      case 'sacrificeSelf': ctx.did = src.zone === 'battlefield'; if (ctx.did) this.sacrifice(src); break;
      // Shuffle N cards from your hand into your library (Lat-Nam's Legacy); nothing to shuffle means "if you do" fails.
      case 'shuffleIn': for (const s of subs) if (s.player) {
        const pl = s.player; const k = Math.min(this.amount(e.amount, ctx, s), pl.hand.length); if (k <= 0) { ctx.did = false; continue; }
        let picks;
        if (pl.ai) picks = pl.hand.slice().sort((a, b) => (a.def.cmc || 0) - (b.def.cmc || 0)).slice(0, k);
        else { const ids = yield { kind: 'choose', player: pl.idx, text: `${src.def.name}: shuffle ${k} card${k > 1 ? 's' : ''} from your hand into your library`, options: pl.hand.map(c => ({ id: c.id, label: c.def.name })), min: k, max: k, secret: true }; picks = (ids || []).map(id => this.card(id)).filter(c => c && pl.hand.includes(c)).slice(0, k); }
        for (const c of picks) this.moveTo(c, 'library');
        shuffle(pl.library, this.rng); ctx.did = picks.length > 0; this.say(`${pl.name} shuffles ${picks.length} card${picks.length === 1 ? '' : 's'} into their library.`);
      } break;
      // Masticore: "sacrifice ~ unless you discard a card" — discard to keep it, otherwise the inner effect happens.
      case 'unlessDiscard': {
        let keep = false;
        if (p.hand.length) keep = p.ai ? true : yield { kind: 'yesno', player: p.idx, text: `${src.def.name}: discard a card to keep it?`, card: src.id, value: 'unlessDiscard' };
        if (keep) { yield* this.discardChoice(p, 1, false, p); this.say(`${p.name} discards a card for ${src.def.name}.`); }
        else yield* this.runEffects(e.effects, ctx, false);
        break;
      }
      case 'control': for (const s of subs) if (s.card) { if (e.until === 'eot' && s.card.controlUntilEot === null) s.card.controlUntilEot = s.card.controller; this.changeControl(s.card, p.idx); this.say(`${p.name} gains control of ${s.card.def.name}.`); } break;
      case 'counters': for (const s of subs) if (s.card) { s.card.counters[e.kind] = (s.card.counters[e.kind] || 0) + n; this.say(`${n} ${e.kind} counter${n > 1 ? 's' : ''} on ${s.card.def.name}.`); } break;
      case 'removeCounters': for (const s of subs) if (s.card) { s.card.counters['+1/+1'] = 0; s.card.counters['-1/-1'] = 0; } break;
      case 'regenerate': for (const s of subs) if (s.card) { s.card.regen++; this.say(`${s.card.def.name} gains a regeneration shield.`); } break;
      case 'fog': this.fog = true; this.say('All combat damage this turn is prevented.'); break;
      case 'addMana': { const times = e.times !== undefined ? this.amount(e.times, ctx) : 1; if (e.any) { const k = this.amount(e.any, ctx) * times; if (k > 0) { const col = p.ai ? (this.hooks.choose(this, { kind: 'color', player: p.idx }) || 'G') : yield { kind: 'color', player: p.idx, text: 'Choose a color' }; p.pool[col] += k; this.say(`${p.name} adds ${k} ${col}.`); } } else for (let i = 0; i < times; i++) for (const m of e.mana) p.pool[m]++; break; }
      case 'scry': yield* this.scry(p, n); break;
      case 'preventNext': for (const s of subs) { if (s.card) s.card.shield += n; else if (s.player) s.player.shield += n; this.say(`The next ${n} damage to ${s.card ? s.card.def.name : s.player.name} this turn will be prevented.`); } break;
      case 'copShield': for (const s of subs) if (s.player) { s.player.cop.push(e.from); this.say(`${s.player.name} is shielded from the next ${e.from === 'artifact' ? 'artifact' : e.from} source this turn.`); } break;
      case 'dmgRep': {
        const entry = { owner: p.idx, action: e.action, n: e.n, color: e.color, sourceType: e.sourceType, combatOnly: !!e.combat, gainLife: !!e.gainLife, oneShot: e.oneShot !== false, sourceExclude: src.id };
        if (e.to === 'targetCreature') { const c = subs.find(x => x.card)?.card; if (!c) break; entry.toCard = c.id; }
        else entry.toPlayer = (e.to === 'targetPlayer' && subs.find(x => x.player)) ? subs.find(x => x.player).player.idx : p.idx;
        this.damageReplacements.push(entry);
        this.say(`${this.players[entry.owner ?? p.idx].name} sets up damage prevention.`);
        break;
      }
      case 'delayedBounceSelf': if (src.zone === 'battlefield') this.delayed.push({ type: 'bounce', card: src.id }); break;
      case 'putBack': for (const who of (subs.length ? subs.filter(s => s.player).map(s => s.player) : [p])) {
        const k = Math.min(n, who.hand.length); if (!k) continue;
        const ids = yield { kind: 'choose', player: who.idx, text: `Put ${k} card${k > 1 ? 's' : ''} from your hand on top of your library (the first you choose ends up on top)`, options: who.hand.map(c => ({ id: c.id, label: c.def.name })), min: k, max: k, secret: true };
        const cards = (ids || []).map(id => this.card(id)).filter((c, i, a) => c && who.hand.includes(c) && a.indexOf(c) === i).slice(0, k);
        while (cards.length < k) cards.push(who.hand.find(c => !cards.includes(c)));
        for (const c of cards.slice().reverse()) { removeFrom(who.hand, c); c.zone = 'library'; who.library.push(c); }
        this.say(`${who.name} puts ${k} card${k > 1 ? 's' : ''} from hand on top of their library.`);
        break;
      }
      case 'peek': for (const s of subs) if (s.player) yield* this.peek(p, s.player, n, e.mode, e.mayShuffle); break;
      case 'extraTurn': this.extraTurns++; break;
      case 'skipTurn': { const pls = e.sel === 'each' ? this.players : e.sel === 'opponent' ? [this.opponentOf(p)] : subs.filter(s => s.player).map(s => s.player); (pls.length ? pls : [p]).forEach(pl => { pl.skipTurns = (pl.skipTurns || 0) + 1; }); this.say(`${(pls[0] || p).name} will skip a turn.`); break; }
      case 'token': { const cnt = this.amount(e.count ?? e.amount ?? 1, ctx) || 1; const spec = (typeof e.p === 'object' || typeof e.t === 'object') ? { ...e, p: this.amount(e.p, ctx), t: this.amount(e.t, ctx) } : e; for (let i = 0; i < cnt; i++) this.createToken(p, spec); break; }
      case 'exileGraveyard': { const pls = e.who === 'you' ? [p] : e.who === 'each' ? this.players : subs.filter(s => s.player).map(s => s.player); for (const pl of pls) for (const c of pl.graveyard.slice()) this.moveTo(c, 'exile'); break; }
      case 'poison': for (const s of subs) if (s.player) s.player.poison += this.amount(e.amount, ctx, s); break;
      case 'noop': break;
      case 'twister': {
        // Each player shuffles hand and graveyard into library, then draws seven. The spell itself is still on the stack.
        for (const pl of this.players) {
          for (const c of [...pl.hand, ...pl.graveyard]) { if (c === src) continue; this.moveTo(c, 'library'); }
          shuffle(pl.library, this.rng);
          this.drawCards(pl, 7, { silent: true });
          this.say(`${pl.name} shuffles and draws seven.`);
        }
        break;
      }
      case 'delayedDraw': this.delayed.push({ player: p.idx, type: 'draw', amount: e.amount || 1 }); break;
      case 'delayed': { const tid = this.prevCard(ctx)?.id; this.delayed.push({ kind: 'scheduled', when: e.when, effects: e.effects, source: src.id, targetId: tid, controller: p.idx, turn: this.turn, cond: e.cond || null }); break; }
      case 'unlessPay': {
        const who = e.payer === 'thatPlayer' && ctx.thatPlayer !== undefined ? this.players[ctx.thatPlayer] : p;
        const cost = e.cost?.calc ? { pips: [], generic: this.amount(e.cost, ctx), x: false } : e.cost;
        const can = e.life ? who.life > e.life : this.canPay(who, cost);
        let paid = false;
        if (can) { paid = yield { kind: 'yesno', player: who.idx, text: `${src.def.name}: pay ${e.life ? e.life + ' life' : costString(cost)} to avoid "${e.effects.map(x => x.type).join(', ')}"?`, card: src.id, value: 'unlessPay' }; }
        if (paid) { if (e.life) who.life -= e.life; else this.payMana(who, this.planPayment(who, cost)); this.say(`${who.name} pays for ${src.def.name}.`); }
        else yield* this.runEffects(e.effects, ctx, false);
        break;
      }
    }
  }
  *discardChoice(pl, n, random, by) {
    if (!pl.hand.length || n <= 0) return;
    n = Math.min(n, pl.hand.length);
    let cards;
    if (random) { const h = pl.hand.slice(); cards = []; for (let i = 0; i < n; i++) cards.push(h.splice(Math.floor(this.rng() * h.length), 1)[0]); }
    else { const ids = yield { kind: 'choose', player: pl.idx, text: `Discard ${n} card${n > 1 ? 's' : ''}`, options: pl.hand.map(c => ({ id: c.id, label: c.def.name })), min: n, max: n }; cards = (ids || []).map(id => this.card(id)).filter(c => c && pl.hand.includes(c)).slice(0, n); while (cards.length < n) cards.push(pl.hand.find(c => !cards.includes(c))); }
    this.discardCards(pl, cards.filter(Boolean));
  }
  *sacrificeChoice(pl, what, except = null) {
    const opts = pl.battlefield.filter(c => c !== except && (isType(c, what) || (what === 'creature' && isCreature(c))));
    if (!opts.length) return false;
    const ids = yield { kind: 'choose', player: pl.idx, text: `Sacrifice a ${what}`, options: opts.map(c => ({ id: c.id, label: c.def.name })), min: 1, max: 1 };
    const c = this.card((ids || [])[0]) || opts[0];
    this.sacrifice(c);
    return true;
  }
  *tutor(p, e) {
    const what = e.what.replace(/ cards?$/, '');
    const opts = p.library.filter(c => matchCardWhat(c, what));
    if (!opts.length) { this.say(`${p.name} finds nothing.`); shuffle(p.library, this.rng); return; }
    const max = Math.min(e.n || 1, opts.length);
    const ids = yield { kind: 'choose', player: p.idx, text: `Search your library for ${max > 1 ? `up to ${max} ${what} cards` : `a ${what}`}`, options: opts.map(c => ({ id: c.id, label: c.def.name })), min: 0, max, secret: true };
    const picked = (ids || []).map(id => this.card(id)).filter((c, i, a) => c && opts.includes(c) && a.indexOf(c) === i).slice(0, max);
    let c = picked[0] || null;
    for (const k of picked) {
      if (e.to === 'hand') this.moveTo(k, 'hand');
      else if (e.to === 'battlefield') { this.moveTo(k, 'battlefield'); if (e.tapped) k.tapped = true; }
      else if (e.to === 'graveyard') this.moveTo(k, 'graveyard');   // Buried Alive
      else if (e.to === 'top') { removeFrom(p.library, k); p.library.push(k); }
    }
    if (picked.length) this.say(`${p.name} searches for ${e.to === 'hand' ? (picked.length > 1 ? `${picked.length} cards` : 'a card') : picked.map(k => k.def.name).join(', ')}.`);
    shuffle(p.library, this.rng);
    if (e.to === 'top' && c) { removeFrom(p.library, c); p.library.push(c); }
  }
  // Look at the top n cards of `owner`'s library. mode: 'look' | 'reorder' (put back in any order) | 'bottom' (may put on the bottom).
  *peek(p, owner, n, mode = 'look', mayShuffle = false) {
    const top = owner.library.slice(-n).reverse(); // top card first
    if (!top.length) return;
    const whose = owner === p ? (p.ai ? 'their' : 'your') : `${owner.name}'s`;
    const opts = top.map(c => ({ id: c.id, label: c.def.name }));
    if (p.ai) this.say(`${p.name} looks at the top ${top.length} card${top.length > 1 ? 's' : ''} of ${whose} library.`);
    else this.say(`Top of ${whose} library: ${top.map(c => c.def.name).join(', ')}.`);
    if (mode === 'reorder') {
      const ids = yield { kind: 'order', player: p.idx, text: `Put the top ${top.length} cards of ${whose} library back in any order`, options: opts, secret: true };
      const order = (ids || []).map(id => this.card(id)).filter((c, i, a) => c && top.includes(c) && a.indexOf(c) === i);
      for (const c of top) if (!order.includes(c)) order.push(c);
      for (const c of top) removeFrom(owner.library, c);
      for (const c of order.slice().reverse()) owner.library.push(c);
    } else if (mode === 'bottom') {
      const ids = yield { kind: 'choose', player: p.idx, text: `Choose cards to put on the bottom of ${whose} library`, options: opts, min: 0, max: top.length, secret: true };
      for (const id of ids || []) { const c = this.card(id); if (c && top.includes(c)) { removeFrom(owner.library, c); owner.library.unshift(c); } }
    } else if (mode === 'handTop') {
      const pick = yield { kind: 'choose', player: p.idx, text: `Put one card from the top ${top.length} of ${whose} library into your hand; the rest go back on top`, options: opts, min: 1, max: 1, secret: true };
      const keep = this.card((pick || [])[0]) || top[0];
      const rest = top.filter(c => c !== keep);
      let order = rest;
      if (rest.length > 1) { const ids = yield { kind: 'order', player: p.idx, text: `Order the remaining ${rest.length} cards on top (first ends up on top)`, options: rest.map(c => ({ id: c.id, label: c.def.name })), secret: true }; const o = (ids || []).map(id => this.card(id)).filter((c, i, a) => c && rest.includes(c) && a.indexOf(c) === i); for (const c of rest) if (!o.includes(c)) o.push(c); order = o; }
      for (const c of top) removeFrom(owner.library, c);
      for (const c of order.slice().reverse()) owner.library.push(c);
      this.moveTo(keep, 'hand');
      this.say(`${p.name} takes one card and puts ${rest.length} back on top.`);
    } else if (mode === 'handBottom') {
      const pick = yield { kind: 'choose', player: p.idx, text: `Put one card from the top ${top.length} of ${whose} library into your hand; the rest go to the bottom`, options: opts, min: 1, max: 1, secret: true };
      const keep = this.card((pick || [])[0]) || top[0];
      const rest = top.filter(c => c !== keep);
      for (const c of rest) removeFrom(owner.library, c);
      for (const c of rest) owner.library.unshift(c);
      this.moveTo(keep, 'hand');
      this.say(`${p.name} takes one card and puts ${rest.length} on the bottom.`);
    } else if (mode === 'pick') {
      const ids = yield { kind: 'choose', player: p.idx, text: `Choose one card to put into your hand; the rest are exiled`, options: opts, min: 1, max: 1, secret: true };
      const keep = this.card((ids || [])[0]) || top[0];
      for (const c of top) this.moveTo(c, c === keep ? 'hand' : 'exile');
      this.say(`${p.name} keeps one card and exiles ${top.length - 1}.`);
    } else if (!p.ai) {
      yield { kind: 'look', player: p.idx, text: `Top of ${whose} library, top card first`, options: opts, secret: true };
    }
    if (mayShuffle) {
      const yes = p.ai ? false : yield { kind: 'yesno', player: p.idx, text: `Have ${owner === p ? 'yourself' : owner.name} shuffle?`, value: 'shuffle' };
      if (yes) { shuffle(owner.library, this.rng); this.say(`${owner.name}'s library is shuffled.`); }
    }
  }
  *scry(p, n) {
    const top = p.library.slice(-n).reverse();
    if (!top.length) return;
    const ids = yield { kind: 'choose', player: p.idx, text: `Scry ${n}: choose cards to put on the bottom`, options: top.map(c => ({ id: c.id, label: c.def.name })), min: 0, max: top.length, secret: true };
    for (const id of ids || []) { const c = this.card(id); if (c && top.includes(c)) { removeFrom(p.library, c); p.library.unshift(c); } }
  }

  // ---- zone changes -----------------------------------------------------------------
  moveTo(c, zone, opts = {}) {
    const from = c.zone;
    const owner = this.players[c.owner];
    const holder = this.players[c.controller];
    if (from === 'battlefield') {
      removeFrom(holder.battlefield, c);
      for (const a of this.permanents()) if (a.attachedTo === c) { a.attachedTo = null; if (a.def.abilities.some(ab => ab.type === 'triggered' && (ab.event === 'enchantedDies' || ab.event === 'enchantedLeaves'))) this.fireEvent({ type: 'enchantedGone', aura: a, host: c, died: zone === 'graveyard' }); }
      if (c.attachedTo) { const host = c.attachedTo; c.attachedTo = null; if (c.def.aura && c.def.abilities.some(ab => ab.kind === 'control') && host.controller !== host.owner) this.changeControl(host, host.owner); if (c.def.animateDead && host.zone === 'battlefield') { this.say(`${host.def.name} is sacrificed as ${c.def.name} leaves.`); this.sacrifice(host); } }
      removeFrom(this.attackers, c.id); delete this.blocks[c.id];
      for (const k of Object.keys(this.blocks)) this.blocks[k] = this.blocks[k].filter(id => id !== c.id);
      const counters = { ...c.counters };
      // Snapshot `damaged` too: moveTo resets it below, so triggers that read who dealt this
      // creature damage (e.g. Sengir Vampire's) must see the set as it was at death, not after.
      this.fireEvent({ type: zone === 'graveyard' ? 'dies' : 'leaves', card: c, counters, damaged: new Set(c.damaged), sacrificed: !!opts.sacrificed });
      if (zone === 'graveyard') this.fireEvent({ type: 'leaves', card: c });
      const onLeave = this.delayed.filter(d => d.kind === 'scheduled' && d.when === 'leaves' && d.targetId === c.id);
      if (onLeave.length) { this.delayed = this.delayed.filter(d => !onLeave.includes(d)); for (const item of onLeave) this.runDelayed(item); }
    } else if (from === 'hand') removeFrom(owner.hand, c);
    else if (from === 'graveyard') removeFrom(owner.graveyard, c);
    else if (from === 'library') removeFrom(owner.library, c);
    else if (from === 'exile') removeFrom(owner.exile, c);
    else if (from === 'sideboard') removeFrom(owner.sideboard || [], c);
    else if (from === 'stack') { const i = this.stack.findIndex(it => it.card === c); if (i >= 0) this.stack.splice(i, 1); }
    // reset state
    c.tapped = false; c.damage = 0; c.temp = { p: 0, t: 0, kw: [], flags: [], animate: null }; c.regen = 0; c.flags = new Set(); c.counters = {}; c.controlUntilEot = null; c.damaged = new Set(); c.attachedTo = null; c.shield = 0; c.linked = []; c.controlLink = null; c.animatePerm = null;
    if (zone !== 'battlefield') c.controller = c.owner;   // a card off the battlefield belongs to its owner again
    if (c.token && zone !== 'battlefield') { c.zone = 'gone'; return; }
    if (zone === 'battlefield' && c.def.entersSacrifice) {
      const es = c.def.entersSacrifice, ctrl = this.players[opts.controller ?? c.owner];
      const cand = ctrl.battlefield.filter(l => l !== c && isLand(l) && hasSubtype(l, es.land) && (!es.untapped || !l.tapped)).sort((a, b) => (a.tapped ? 0 : 1) - (b.tapped ? 0 : 1));
      if (!cand.length) { this.say(`${c.def.name} goes to the graveyard: no ${es.land} to sacrifice.`); zone = 'graveyard'; }
      else { this.say(`${ctrl.name} sacrifices ${cand[0].def.name} for ${c.def.name}.`); this.sacrifice(cand[0]); }
    }
    c.zone = zone;
    if (zone === 'battlefield') {
      c.controller = opts.controller ?? c.owner;
      const ctrl = this.players[c.controller];
      ctrl.battlefield.push(c);
      c.sick = true; c.enteredTurn = this.turn; c.echoPaid = false;
      if (c.def.entersTapped) c.tapped = true;
      if (!c.def.entersTapped && this.permanents().some(k => k !== c && k.controller !== c.controller && k.def.abilities.some(ab => ab.type === 'static' && ab.kind === 'oppEntersTapped'))) { c.tapped = true; this.say(`${c.def.name} enters tapped.`); }
      for (const ab of c.def.abilities) if (ab.kind === 'entersWithCounters') c.counters[ab.counter] = (c.counters[ab.counter] || 0) + ab.amount;
      const fading = c.def.keywords.find(k => k.k === 'Fading'); if (fading) c.counters.fade = fading.n;
      if (opts.kicked && c.def.kicked) for (const e of c.def.kicked) if (e.type === 'counters') c.counters[e.kind] = (c.counters[e.kind] || 0) + e.amount;
      if (opts.attachTo) c.attachedTo = opts.attachTo;
      this.refresh();
      this.fireEvent({ type: 'etb', card: c });
    } else if (zone === 'hand') owner.hand.push(c);
    else if (zone === 'graveyard') { owner.graveyard.push(c); if (from === 'library' && c.def.abilities.some(ab => ab.event === 'milled')) this.fireEvent({ type: 'milled', card: c }); }
    else if (zone === 'exile') owner.exile.push(c);
    else if (zone === 'library') owner.library.push(c);
    this.refresh();
  }
  returnFromGraveyard(c, counter) {
    if (c.zone !== 'graveyard') return;
    this.moveTo(c, 'battlefield'); c.counters[counter] = 1; this.say(`${c.def.name} returns to the battlefield.`);
  }
  changeControl(c, idx) {
    if (c.controller === idx) return;
    removeFrom(this.players[c.controller].battlefield, c);
    c.controller = idx; this.players[idx].battlefield.push(c); c.sick = true;
    removeFrom(this.attackers, c.id); delete this.blocks[c.id];
    this.refresh();
  }
  createToken(p, e) {
    const def = { name: e.name || `${e.subtypes.join(' ')} token`, id: null, image: null, typeLine: `Token ${e.types.map(cap).join(' ')} — ${e.subtypes.join(' ')}`, oracle: e.keywords.join(', '), colors: e.colors, cmc: 0, cost: { pips: [], generic: 0, x: false }, supertypes: [], types: e.types.map(cap), subtypes: e.subtypes, keywords: e.keywords.slice(), abilities: [], manaAbilities: [], spell: null, notes: [], produces: [], power: e.p, toughness: e.t, kind: 'creature', status: 'full', isPermanent: true, token: true };
    const c = this.instance(def, p.idx); c.token = true; c.zone = 'limbo';
    this.moveTo(c, 'battlefield', { controller: p.idx });
    this.say(`${p.name} creates a ${e.p}/${e.t} ${e.subtypes.join(' ')} token.`);
  }
  // Cards a draw names in the log: the viewer's own (others show only a count, so a hand stays hidden). With no
  // explicit viewer set, name the sole human's draws — the common single-player / playtest case.
  namesDrawFor(p) { return this.logViewer != null ? p.idx === this.logViewer : (!p.ai && this.players.filter(x => !x.ai).length === 1); }
  drawCards(p, n, { silent = false } = {}) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
      if (!p.library.length) { p.drewFromEmpty = true; break; }
      const c = p.library.pop(); c.zone = 'hand'; p.hand.push(c); drawn.push(c);
      this.fireEvent({ type: 'draws', player: p.idx });
    }
    if (!silent && drawn.length) {
      if (this.namesDrawFor(p)) this.say(`${p.name} draws ${drawn.map(c => c.def?.name || 'a card').join(', ')}.`);
      else this.say(`${p.name} draws ${drawn.length === 1 ? 'a card' : drawn.length + ' cards'}.`);
    }
    return drawn;
  }
  discardCards(p, cards) { for (const c of cards) if (c && p.hand.includes(c)) { this.moveTo(c, 'graveyard'); this.say(`${p.name} discards ${c.def.name}.`); } }
  tap(c) { if (c.tapped) return; c.tapped = true; this.fireEvent({ type: 'tapped', card: c }); }
  sacrifice(c) { if (!c || c.zone !== 'battlefield') return; this.say(`${this.players[c.controller].name} sacrifices ${c.def.name}.`); this.moveTo(c, 'graveyard', { sacrificed: true }); }
  destroy(c, noRegen) {
    if (!c || c.zone !== 'battlefield') return;
    if (has(c, 'Indestructible')) return;
    if (c.regen > 0 && !noRegen) { c.regen--; c.tapped = true; c.damage = 0; removeFrom(this.attackers, c.id); delete this.blocks[c.id]; for (const k of Object.keys(this.blocks)) this.blocks[k] = this.blocks[k].filter(id => id !== c.id); this.say(`${this.cname(c)} regenerates.`); return; }
    this.say(`${this.cname(c)} is destroyed.`);
    this.fx.push({ type: 'die', id: c.id, name: c.def.name, controller: c.controller });
    this.moveTo(c, 'graveyard');
  }
  counterItem(item) {
    const i = this.stack.indexOf(item); if (i < 0) return;
    this.stack.splice(i, 1);
    this.say(`${item.card.def.name} is countered.`);
    if (item.kind === 'spell') { item.card.zone = 'limbo'; if (item._toTop) { this.moveTo(item.card, 'library'); const ow = this.players[item.card.owner]; removeFrom(ow.library, item.card); ow.library.push(item.card); } else this.moveTo(item.card, item.flashback ? 'exile' : 'graveyard'); }
  }
  // Damage-replacement layer: prevent / redirect / reduce a damage instance (Pentagram, Jade Monolith,
  // Forcefield, Nova Pentacle, Reverse Damage, Al-abara's Carpet).
  matchDamageRep(source, target, opts) {
    for (const r of this.damageReplacements) {
      if (r.used) continue;
      if (r.owner === undefined) continue;
      if (source && (source.id === r.sourceExclude)) continue;
      if (target.def) { if (r.toCard !== target.id) continue; }
      else { if (r.toPlayer !== target.idx) continue; }
      if (r.combatOnly && !opts.combat) continue;
      if (r.color) { const cols = Array.isArray(r.color) ? r.color : [r.color]; if (!cols.some(c => (source.def?.colors || []).includes(c))) continue; }
      if (r.sourceType === 'unblockedCreature' && !(source.def && isCreature(source) && this.attackers.includes(source.id) && !(this.blocks[source.id] && this.blocks[source.id].length))) continue;
      if (r.sourceType === 'attackingNonFlyer' && !(source.def && isCreature(source) && this.attackers.includes(source.id) && !has(source, 'Flying'))) continue;
      return r;
    }
    return null;
  }
  applyDamageRep(r, source, target, n, opts) {
    if (r.oneShot !== false) r.used = true;
    const who = target.def ? target.def.name : target.name;
    if (r.action === 'prevent') { this.say(`Damage to ${who} is prevented.`); if (r.gainLife && this.gainLife(this.players[r.owner], n)) this.say(`${this.players[r.owner].name} gains ${n} life.`); return { done: true, dealt: 0 }; }
    if (r.action === 'reduceTo') { const keep = Math.min(n, r.n); if (keep < n) this.say(`All but ${r.n} damage to ${who} is prevented.`); if (keep <= 0) return { done: true, dealt: 0 }; return { done: false, n: keep }; }
    if (r.action === 'redirectToOwner') { this.say(`Damage is redirected to ${this.players[r.owner].name}.`); return { done: true, dealt: this.dealDamage(source, this.players[r.owner], n, { ...opts, _noReplace: true }) }; }
    if (r.action === 'redirectToCreature') {
      const opp = this.opponentOf(this.players[r.owner]);
      const pick = opp.battlefield.filter(c => isCreature(c)).sort((a, b) => toughness(a) - toughness(b))[0] || this.players[r.owner].battlefield.filter(c => isCreature(c))[0];
      if (!pick) { this.say(`Damage to ${who} is prevented (no creature to redirect to).`); return { done: true, dealt: 0 }; }
      this.say(`Damage is redirected to ${pick.def.name}.`); return { done: true, dealt: this.dealDamage(source, pick, n, { ...opts, _noReplace: true }) };
    }
    return { done: false, n };
  }
  dealDamage(source, target, n, opts = {}) {
    if (n <= 0) return 0;
    const noPrev = this.noPrevention;   // Flaring Pain: skip every prevention effect this turn (protection still applies)
    if (!opts._noReplace && !noPrev) { const rep = this.matchDamageRep(source, target, opts); if (rep) { const r = this.applyDamageRep(rep, source, target, n, opts); if (r.done) return r.dealt; n = r.n; } }
    if (target.def) { // creature
      if (this.protectedFrom(target, source)) { this.say(`${target.def.name} is protected from ${source.def.name}.`); return 0; }
      if (!noPrev && opts.combat && (this.fog || target.flags.has('noCombatDamage') || source.flags?.has('noCombatDamage') || target.cur?.flags.has('noCombatDamage') || source.cur?.flags.has('noCombatDamage') || source.flags?.has('dealsNoCombatDamage') || target.cur?.flags.has('noCombatDamageTo'))) return 0;
      if (!noPrev && (target.flags.has('noDamage') || source.flags?.has('dealsNoDamage'))) { this.say(`Damage to ${target.def.name} is prevented.`); return 0; }
      if (!noPrev && target.cur?.preventFrom && target.cur.preventFrom.some(f => f === 'artifact' ? isType(source, 'artifact') : (source.def?.colors || []).includes(f))) { this.say(`${target.def.name} is shielded from ${source.def.name}.`); return 0; }
      if (!noPrev && target.cur?.flags.has('phantom')) { if ((target.counters['+1/+1'] || 0) > 0) target.counters['+1/+1']--; this.say(`Damage to ${target.def.name} is prevented; it loses a +1/+1 counter.`); this.refresh(); return 0; }   // Phantom Nishoba
      if (!noPrev && target.shield > 0) { const used = Math.min(target.shield, n); target.shield -= used; n -= used; this.say(`${used} damage to ${target.def.name} is prevented.`); if (n <= 0) return 0; }
      if (has0(source.def, 'Wither') || has0(source.def, 'Infect') || has(source, 'Wither') || has(source, 'Infect')) target.counters['-1/-1'] = (target.counters['-1/-1'] || 0) + n;
      else target.damage += n;
      if (has(source, 'Deathtouch') && isCreature(source)) target.flags.add('deathtouched');
      target.damaged.add(source.id);
      this.say(`${this.cname(source)} deals ${n} damage to ${this.cname(target)}.`);
      this.fx.push({ type: 'damage', target: target.id, amount: n });
      if (has(source, 'Lifelink')) this.gainLife(this.players[source.controller], n);
      this.fireEvent({ type: 'damage', source, target, amount: n, combat: !!opts.combat });
      return n;
    }
    const pl = target;
    if (opts.combat && (this.fog || source.flags?.has('noCombatDamage') || source.cur?.flags.has('noCombatDamage') || source.flags?.has('dealsNoCombatDamage'))) return 0;
    if (source.flags?.has('dealsNoDamage')) return 0;
    const ci = noPrev ? -1 : pl.cop.findIndex(f => f === 'any' || (Array.isArray(f) ? f.some(x => (source.def?.colors || []).includes(x)) : f === 'artifact' ? isType(source, 'artifact') : (source.def?.colors || []).includes(f)));
    if (ci >= 0) { pl.cop.splice(ci, 1); this.say(`${pl.name}'s circle of protection prevents ${source.def.name}'s damage.`); return 0; }
    if (!noPrev && pl.shield > 0) { const used = Math.min(pl.shield, n); pl.shield -= used; n -= used; this.say(`${used} damage to ${pl.name} is prevented.`); if (n <= 0) return 0; }
    // Crumbling Sanctuary: the damage exiles cards from the top of the library instead of costing life.
    if (this.permanents().some(c => c.def.abilities.some(ab => ab.type === 'static' && ab.kind === 'damageToLibrary'))) {
      let k = 0; for (; k < n; k++) { const c = pl.library[pl.library.length - 1]; if (!c) break; this.moveTo(c, 'exile'); }
      this.say(`${this.cname(source)} would deal ${n} damage to ${pl.name}; ${k} card${k === 1 ? '' : 's'} are exiled from the top of their library instead.`);
      return n;
    }
    if (has(source, 'Infect') || has0(source.def, 'Infect')) pl.poison += n; else { if (pl.lifeFloor !== undefined && pl.life - n < pl.lifeFloor) n = Math.max(0, pl.life - pl.lifeFloor); pl.life -= n; if (n <= 0) return 0; }
    this.say(`${this.cname(source)} deals ${n} damage to ${pl.name}.`);
    this.fx.push({ type: 'damage', player: pl.idx, amount: n });
    if (has(source, 'Lifelink')) this.gainLife(this.players[source.controller], n);
    this.fireEvent({ type: 'damage', source, target: pl, amount: n, combat: !!opts.combat });
    return n;
  }

  // ---- combat ------------------------------------------------------------------------
  canAttack(c) {
    if (!isCreature(c) || c.tapped) return false;
    if (c.sick && !has(c, 'Haste')) return false;
    for (const b of this.permanents()) if (b.def.abilities.some(ab => ab.type === 'static' && ab.kind === 'bridge') && power(c) > this.players[b.controller].hand.length) return false;   // Ensnaring Bridge
    if ((has(c, 'Defender') && !c.cur.flags.has('canAttackWithDefender')) || c.cur.flags.has('cantAttack') || c.cur.flags.has('cantAttackOrBlock') || c.flags.has('cantAttack') || c.flags.has('cantAttackOrBlock')) return false;
    const need = c.cur.attackOnlyIfDefenderHas;
    if (need && !this.defender.battlefield.some(l => isLand(l) && hasSubtype(l, need))) return false;
    if (c.cur.cantAttackIfDefenderPower !== undefined && this.defender.battlefield.some(x => isCreature(x) && !x.tapped && power(x) >= c.cur.cantAttackIfDefenderPower)) return false;
    return true;
  }
  canBlock(b, a) {
    if (!isCreature(b) || b.tapped) return false;
    if (b.cur.flags.has('cantBlock') || b.cur.flags.has('cantAttackOrBlock') || b.flags.has('cantBlock') || b.flags.has('cantAttackOrBlock')) return false;
    if (a.flags.has('unblockable') || a.cur.flags.has('unblockable')) return false;
    if (has(a, 'Flying') && !(has(b, 'Flying') || has(b, 'Reach'))) return false;
    if (has(a, 'Shadow') !== has(b, 'Shadow')) return false;
    if (has(a, 'Horsemanship') && !has(b, 'Horsemanship')) return false;
    if (has(a, 'Fear') && !(isType(b, 'artifact') || b.def.colors.includes('B'))) return false;
    if (has(a, 'Intimidate') && !(isType(b, 'artifact') || b.def.colors.some(c => a.def.colors.includes(c)))) return false;
    if (b.cur.flags.has('blockOnlyFlying') && !has(a, 'Flying')) return false;
    if (b.cur.cantBlockPower !== undefined && power(a) >= b.cur.cantBlockPower) return false;
    for (const k of a.cur.kw) if (typeof k === 'object' && k.k === 'Landwalk' && !this.ignoreLandwalk.has('all') && !this.ignoreLandwalk.has(k.land) && this.players[b.controller].battlefield.some(l => isLand(l) && hasSubtype(l, k.land) && (!k.snow || l.def.supertypes.includes('Snow')))) return false;
    if (a.flags.has('cantBeBlockedByWalls') && hasSubtype(b, 'Wall')) return false;
    if (a.flags.has('blockableOnlyByWalls') && !hasSubtype(b, 'Wall')) return false;
    if (this.protectedFrom(a, b)) return false;
    for (const f of a.cur.cantBeBlockedBy || []) if (this.matchFilter(b, f)) return false;
    for (const f of a.cur.blockableOnlyBy || []) if (!this.matchFilter(b, f)) return false;
    return true;
  }
  validBlocks(blocks) {
    const def = this.defender, used = new Set();
    for (const [aid, bids] of Object.entries(blocks)) {
      const a = this.card(Number(aid)); if (!a || !this.attackers.includes(a.id)) return false;
      for (const bid of bids) { const b = def.battlefield.find(x => x.id === bid); if (!b || used.has(bid) || !this.canBlock(b, a)) return false; used.add(bid); }
      if (has(a, 'Menace') && bids.length === 1) return false;
    }
    return true;
  }
  *combatDamage(which) {
    const atk = this.activePlayer, def = this.defender;
    const first = c => has(c, 'First strike') || has(c, 'Double strike');
    const deals = c => which === 'first' ? first(c) : (!first(c) || has(c, 'Double strike'));
    this.fx.push({ type: 'strike', attackers: this.attackers.slice(), blocks: Object.fromEntries(Object.entries(this.blocks).map(([k, v]) => [k, v.slice()])) });
    for (const aid of this.attackers.slice()) {
      const a = atk.battlefield.find(x => x.id === aid); if (!a) continue;
      const blockers = (this.blocks[aid] || []).map(id => def.battlefield.find(x => x.id === id)).filter(Boolean);
      // Once blocked, always blocked: even if every blocker has left combat (regenerated, destroyed) the attacker
      // deals no damage to the defending player unless it has trample. Without trample and with no blockers left,
      // its combat damage simply goes nowhere.
      const wasBlocked = a.flags.has('blocked') || (this.blocks[aid] || []).length > 0;
      if (deals(a)) {
        let dmg = power(a);
        if (!wasBlocked) { this.dealDamage(a, def, dmg, { combat: true }); if (which !== 'first' || !has(a, 'Double strike')) this.fireEvent({ type: 'unblocked', card: a }); }
        else {
          const trample = has(a, 'Trample');
          const lethalOf = b => has(a, 'Deathtouch') ? 1 : Math.max(0, toughness(b) - b.damage);
          // Modern rules: the attacker divides its power freely among the blockers (no ordering). Without
          // Trample all of it must land on the blockers; with Trample, each blocker must be assigned lethal
          // before any spills over to the player. You choose the split for your own attacker; the AI (and
          // trivial single-outcome cases) auto-divide, killing the cheapest blockers first.
          let plan = null;   // { [blockerId]: amount, player?: amount }
          if (a.controller === 0 && blockers.length >= 2) {
            const ans = yield {
              kind: 'divide', player: 0, source: a.id, total: dmg, trample,
              note: `Divide ${a.def.name}'s ${dmg} damage among its blockers${trample ? ' — each needs lethal before you can trample the rest through' : ''}.`,
              targets: blockers.map(b => ({ id: b.id, label: `${b.def.name} (${power(b)}/${toughness(b) - b.damage})`, lethal: lethalOf(b) })),
            };
            if (ans && typeof ans === 'object') plan = ans;
          }
          if (!plan) {   // auto-divide: lethal to the cheapest blockers first, then spill (trample) or dump on the last
            plan = {}; let rem = dmg;
            const ordered = blockers.slice().sort((x, y) => lethalOf(x) - lethalOf(y));
            ordered.forEach((b, i) => {
              if (rem <= 0) return;
              let give = Math.min(rem, lethalOf(b));
              if (i === ordered.length - 1 && !trample) give = rem;   // last blocker soaks the remainder
              plan[b.id] = (plan[b.id] || 0) + give; rem -= give;
            });
            if (rem > 0 && trample) plan.player = rem;
          }
          // Apply the division (defensively clamped: never more than the attacker's power, trample only overflow).
          let spent = 0;
          for (const b of blockers) { const give = Math.max(0, Math.min(plan[b.id] || 0, dmg - spent)); if (give > 0) { this.dealDamage(a, b, give, { combat: true }); spent += give; } }
          if (trample && plan.player) { const over = Math.max(0, Math.min(plan.player, dmg - spent)); if (over > 0) this.dealDamage(a, def, over, { combat: true }); }
        }
      }
      for (const b of blockers) if (deals(b)) this.dealDamage(b, a, power(b), { combat: true });
    }
    this.sba();
  }

  // ---- statics and state ------------------------------------------------------------
  refresh() {
    const perms = this.permanents();
    // control from auras
    for (const c of perms) if (c.def.aura && c.attachedTo && c.def.abilities.some(ab => ab.kind === 'control') && c.attachedTo.controller !== c.controller) this.changeControlQuiet(c.attachedTo, c.controller);
    // Rubinia Soulsinger: control lasts while the source stays tapped and on the battlefield
    for (const c of perms) if (c.controlLink) { const s = this.card(c.controlLink.src); if (!s || s.zone !== 'battlefield' || !s.tapped) { const back = c.controlLink.back; c.controlLink = null; this.changeControlQuiet(c, back); } }
    const all = this.permanents();
    this.ignoreLandwalk = new Set();
    for (const pl of this.players) pl.lifeFloor = undefined;
    for (const c of perms) for (const ab of c.def.abilities) if (ab.type === 'static' && ab.kind === 'lifeFloor' && !(ab.condition && !this.conditionHolds(ab.condition, c))) { const pl = this.players[c.controller]; pl.lifeFloor = Math.max(pl.lifeFloor ?? -Infinity, ab.n); }
    for (const c of all) {
      const d = c.def;
      const cur = { p: d.power || 0, t: d.toughness || 0, kw: new Set(), flags: new Set(), types: new Set(d.types.map(t => t.toLowerCase())), cantBeBlockedBy: [], blockableOnlyBy: [], attackOnlyIfDefenderHas: null, lose: [], preventFrom: null, granted: [] };
      for (const f of c.temp.flags) if (typeof f === 'string' && f.startsWith('lose:')) cur.lose.push(f.slice(5));
      for (const k of d.keywords) if (typeof k === 'string' ? true : ['Protection', 'Landwalk', 'Rampage'].includes(k.k)) cur.kw.add(k);
      for (const k of c.temp.kw) cur.kw.add(k);
      const cda = d.abilities.find(ab => ab.kind === 'cda');
      if (cda) { const n = this.cdaCount(c, cda); if (cda.which !== 't') cur.p = n; if (cda.which !== 'p') cur.t = n + (cda.plusT || 0); }
      for (const [k, n] of Object.entries(c.counters)) { const mm = k.match(/^([+-]\d+)\/([+-]\d+)$/); if (mm && n > 0) { cur.p += Number(mm[1]) * n; cur.t += Number(mm[2]) * n; } }
      cur.p += c.temp.p; cur.t += c.temp.t;
      for (const a of [c.temp.animate, c.animatePerm]) if (a) { for (const t of a.types) cur.types.add(t); cur.p += a.p; cur.t += a.t; for (const k of a.kw || []) cur.kw.add(k); }   // manland animated (until end of turn, or for good: Stalking Stones)
      c.linked = c.linked.filter(l => { const s = this.card(l.src); return s && s.zone === 'battlefield' && s.tapped; });
      for (const l of c.linked) { cur.p += l.p; cur.t += l.t; }
      c.cur = cur;
    }
    const humility = all.some(h => h.def.abilities.some(ab => ab.type === 'static' && ab.kind === 'humility'));
    for (const src of all) for (const ab of src.def.abilities) {
      if (ab.type !== 'static') continue;
      if (humility && isCreature(src)) continue;   // creatures have no abilities under Humility
      if (ab.condition && !this.conditionHolds(ab.condition, src)) continue;
      if (ab.kind === 'ignoreLandwalk') { this.ignoreLandwalk.add(ab.land || 'all'); continue; }
      for (const c of all) {
        if (!this.inScope(ab.scope, src, c)) continue;
        switch (ab.kind) {
          case 'pt': c.cur.p += ab.p; c.cur.t += ab.t; break;
          case 'keyword': c.cur.kw.add(ab.keyword); break;
          case 'loseKeyword': c.cur.lose.push(ab.keyword); break;
          case 'grantAbility': c.cur.granted.push(ab.ability); break;
          case 'cantAttack': case 'cantBlock': case 'cantAttackOrBlock': case 'unblockable': case 'doesntUntap': case 'mustAttack': case 'blockOnlyFlying': case 'lure': case 'canAttackWithDefender': case 'noCombatDamage': case 'noCombatDamageTo': case 'noAuras': c.cur.flags.add(ab.kind); break;
          case 'cantBeBlockedBy': c.cur.cantBeBlockedBy.push(ab.filter); break;
          case 'cantBlockPowerGE': c.cur.cantBlockPower = Math.min(c.cur.cantBlockPower ?? 99, ab.n); break;
          case 'cantAttackIfDefenderPower': c.cur.cantAttackIfDefenderPower = Math.min(c.cur.cantAttackIfDefenderPower ?? 99, ab.n); break;
          case 'blockableOnlyBy': c.cur.blockableOnlyBy.push(ab.filter); break;
          case 'attackOnlyIfDefenderHas': c.cur.attackOnlyIfDefenderHas = ab.land; break;
          case 'animateLand': if (isLand(c)) { c.cur.types.add('creature'); c.cur.p += ab.p; c.cur.t += ab.t; } break;
          case 'preventFrom': (c.cur.preventFrom ||= []).push(ab.from); break;
          case 'phantom': c.cur.flags.add('phantom'); break;
        }
      }
    }
    // Humility: every creature is a vanilla 1/1 (counters and one-shot pumps still apply).
    if (humility) for (const c of all) if (isCreature(c)) {
      let cp = 1, ct = 1;
      for (const [k, n] of Object.entries(c.counters)) { const mm = k.match(/^([+-]\d+)\/([+-]\d+)$/); if (mm && n > 0) { cp += Number(mm[1]) * n; ct += Number(mm[2]) * n; } }
      c.cur.p = cp + c.temp.p; c.cur.t = ct + c.temp.t; c.cur.kw = new Set(); c.cur.granted = []; c.cur.flags.add('noAbilities');
    }
    for (const c of all) for (const lost of c.cur.lose) for (const k of [...c.cur.kw]) if ((typeof k === 'string' ? k : k.k) === lost) c.cur.kw.delete(k);
    for (const c of all) if (c.temp.flags?.includes('swapPT')) { const t = c.cur.p; c.cur.p = c.cur.t; c.cur.t = t; }
  }
  conditionHolds(cond, src) {
    const me = this.players[src.controller], opp = this.opponentOf(me);
    let ok = true;
    if (cond.landType && !me.battlefield.some(l => isLand(l) && hasSubtype(l, cond.landType))) ok = false;
    if (cond.snowLand && !me.battlefield.some(l => isLand(l) && l.def.supertypes.includes('Snow'))) ok = false;
    if (cond.selfUntapped && src.tapped) ok = false;
    if (cond.selfTapped && !src.tapped) ok = false;
    if (cond.hasCounter && !((src.counters[cond.hasCounter] || 0) > 0)) ok = false;
    if (cond.enchantedColor && !(src.attachedTo && src.attachedTo.def.colors.includes(cond.enchantedColor))) ok = false;
    if (cond.enchantedUntapped && !(src.attachedTo && !src.attachedTo.tapped)) ok = false;
    if (cond.oppControls && !opp.battlefield.some(c => this.matchesRestrict(c, cond.oppControls, opp))) ok = false;
    if (cond.youControlNone && me.battlefield.some(c => this.matchesRestrict(c, cond.youControlNone, me))) ok = false;
    if (cond.noCreatures && this.permanents().some(isCreature)) ok = false;
    if (cond.didntAttack && src.attackedThisTurn) ok = false;
    if (cond.attackedOrBlocked && !(src.attackedThisTurn || src.blockedThisTurn)) ok = false;
    if (cond.threshold && me.graveyard.length < 7) ok = false;
    if (cond.controlsCreature && !me.battlefield.some(isCreature)) ok = false;   // Worship
    // "if ~ is in your graveyard with N creature cards (directly) above it": later cards sit higher in the array.
    if (cond.gyAbove) {
      const gy = this.players[src.owner].graveyard, i = gy.indexOf(src);
      if (i < 0) ok = false;
      else { const above = gy.slice(i + 1); if (cond.directly ? !(above[0] && isCreatureDef(above[0])) : above.filter(isCreatureDef).length < cond.gyAbove) ok = false; }
    }
    return cond.negate ? !ok : ok;
  }
  changeControlQuiet(c, idx) { removeFrom(this.players[c.controller].battlefield, c); c.controller = idx; this.players[idx].battlefield.push(c); }
  inScope(scope, src, c) {
    if (!scope) return false;
    if (scope.who === 'self') return c === src;
    if (scope.who === 'enchanted') return !!src.attachedTo && c === src.attachedTo;
    if (scope.who === 'you' && c.controller !== src.controller) return false;
    if (scope.who === 'opp' && c.controller === src.controller) return false;
    if (scope.other && c === src) return false;
    if (scope.restrict) return this.matchesRestrict(c, scope.restrict, this.players[src.controller]);
    if (scope.types && !scope.types.some(t => c.cur.types.has(t))) return false;
    if (scope.subtype) { const st = scope.subtype === '$chosen' ? src.chosenType : scope.subtype; if (!st || !hasSubtype(c, st)) return false; }   // Engineered Plague reads the type chosen as it entered
    if (scope.color && !c.def.colors.includes(scope.color)) return false;
    if (scope.powerGE !== undefined && (c.cur ? c.cur.p : power(c)) < scope.powerGE) return false;
    return true;
  }
  cdaCount(c, cda) {
    const pl = this.players[c.controller];
    const w = cda.count;
    if (cda.restrict) return (cda.base || 0) + this.permanents().filter(x => !(cda.restrict.other && x === c) && this.matchesRestrict(x, cda.restrict, pl)).length;
    if (w === 'cards in hand') return pl.hand.length;
    if (w === 'cards in all hands') return this.players.reduce((a, x) => a + x.hand.length, 0);   // Multani
    if (w === 'creature cards in graveyards') return this.players.reduce((s, p) => s + p.graveyard.filter(isCreatureDef).length, 0);
    const m = w.match(/^(\w+?)s?$/);
    const sub = m ? cap(m[1]) : w;
    if (/^(plains|island|swamp|mountain|forest)/i.test(w)) return pl.battlefield.filter(l => isLand(l) && hasSubtype(l, cap(w.replace(/s$/, '')))).length;
    if (/^creatures?$/.test(w)) return pl.battlefield.filter(isCreature).length;
    if (/^lands?$/.test(w)) return pl.battlefield.filter(isLand).length;
    if (/^artifacts?$/.test(w)) return pl.battlefield.filter(x => isType(x, 'artifact')).length;
    return pl.battlefield.filter(x => hasSubtype(x, sub)).length;
  }
  sba() {
    if (this.winner !== null) return;
    let changed = true, guard = 0;
    while (changed && guard++ < 20) {
      changed = false;
      this.refresh();
      for (const p of this.players) for (const c of p.battlefield.slice()) {
        if (isCreature(c)) {
          if (toughness(c) <= 0) { this.say(`${c.def.name} dies.`); this.moveTo(c, 'graveyard'); changed = true; continue; }
          if (c.damage >= toughness(c) || c.flags.has('deathtouched')) { c.flags.delete('deathtouched'); const before = c.zone; this.destroy(c, false); if (c.zone !== before || c.regen === 0) changed = true; continue; }
        }
        if (c.def.animateDead && c.animatedOnce && !c.attachedTo) { this.say(`${c.def.name} is put into the graveyard.`); this.moveTo(c, 'graveyard'); changed = true; continue; }
        if (c.def.aura) {
          const host = c.attachedTo;
          if (!host || host.zone !== 'battlefield' || ((c.def.aura === 'creature' || c.def.aura === 'wall') && !isCreature(host)) || this.protectedFrom(host, c)) { this.say(`${c.def.name} is put into the graveyard.`); this.moveTo(c, 'graveyard'); changed = true; continue; }
        }
        if (c.def.equipment && c.attachedTo && (!isCreature(c.attachedTo) || c.attachedTo.controller !== c.controller)) { c.attachedTo = null; changed = true; }
        const need = c.def.abilities.find(ab => ab.kind === 'needsLand');
        if (need && !p.battlefield.some(l => isLand(l) && hasSubtype(l, need.land))) { this.say(`${c.def.name} is sacrificed: no ${need.land}.`); this.moveTo(c, 'graveyard'); changed = true; continue; }
        if ((c.counters['+1/+1'] || 0) > 0 && (c.counters['-1/-1'] || 0) > 0) { const m = Math.min(c.counters['+1/+1'], c.counters['-1/-1']); c.counters['+1/+1'] -= m; c.counters['-1/-1'] -= m; changed = true; }
      }
      // legend rule
      for (const p of this.players) {
        const seen = new Map();
        for (const c of p.battlefield.slice()) { if (!c.def.legendary) continue; if (seen.has(c.def.name)) { this.say(`Legend rule: ${c.def.name} is put into the graveyard.`); this.moveTo(c, 'graveyard'); changed = true; } else seen.set(c.def.name, c); }
      }
    }
    for (const p of this.players) {
      if (p.life <= 0) return this.end(1 - p.idx, `${p.name} is at ${p.life} life.`);
      if (p.poison >= 10) return this.end(1 - p.idx, `${p.name} has ten poison counters.`);
      if (p.drewFromEmpty) return this.end(1 - p.idx, `${p.name} has no cards left to draw.`);
    }
  }
}

// ---- helpers --------------------------------------------------------------------------
function removeFrom(arr, x) { const i = arr.indexOf(x); if (i >= 0) arr.splice(i, 1); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
export function has0(def, kw) { return def.keywords.some(k => (typeof k === 'string' ? k : k.k) === kw); }
export function isCreatureDef(c) { return c.def.types.includes('Creature'); }
export function sameRef(a, b) { return a && b && a.type === b.type && a.id === b.id && a.idx === b.idx; }
function addCosts(a, b) { return { pips: [...a.pips, ...(b.pips || [])], generic: (a.generic || 0) + (b.generic || 0), x: a.x || b.x }; }
function auraRestrict(what) {
  const r = {};
  if (what === 'creature') r.types = ['creature'];
  else if (what === 'wall') { r.types = ['creature']; r.subtypes = ['Wall']; }
  else if (what === 'land') r.types = ['land'];
  else if (what === 'artifact') r.types = ['artifact'];
  else if (what === 'enchantment') r.types = ['enchantment'];
  else if (what === 'creature you control') { r.types = ['creature']; r.control = 'you'; }
  else if (what === 'creature an opponent controls') { r.types = ['creature']; r.control = 'opp'; }
  else r.types = ['permanent'];
  return r;
}
const WHAT_COLORS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const WHAT_TYPES = new Set(['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'land', 'planeswalker', 'tribal']);
// One constraint phrase like "blue instant", "basic land" or "Goblin": every word must hold (colour AND type
// AND subtype), so tutors and graveyard filters honour colour and compound type restrictions.
function matchWhatPhrase(c, a) {
  if (a === 'basic land') return c.def.basic && isLand(c);
  const types = c.def.types.map(t => t.toLowerCase());
  const colors = c.def.colors || [];
  for (const word of a.split(/\s+/).filter(Boolean)) {
    if (word === 'basic') { if (!c.def.basic) return false; continue; }
    if (WHAT_COLORS[word]) { if (!colors.includes(WHAT_COLORS[word])) return false; continue; }
    if (word === 'colorless' || word === 'colourless') { if (colors.length) return false; continue; }
    if (word === 'multicolored' || word === 'multicoloured') { if (colors.length < 2) return false; continue; }
    if (word === 'nonland') { if (isLand(c)) return false; continue; }
    if (word === 'noncreature') { if (isCreatureDef(c)) return false; continue; }
    if (word === 'nonbasic') { if (c.def.basic) return false; continue; }
    if (word === 'creature') { if (!isCreatureDef(c)) return false; continue; }
    if (word === 'land') { if (!isLand(c)) return false; continue; }
    if (WHAT_TYPES.has(word)) { if (!types.includes(word)) return false; continue; }
    const cap = word.charAt(0).toUpperCase() + word.slice(1);   // otherwise a subtype (Goblin, Island, …)
    if (!c.def.subtypes.includes(cap)) return false;
  }
  return true;
}
function matchCardWhat(c, what) {
  const w = (what || 'card').toLowerCase().replace(/ cards?$/, '').trim();
  if (w === 'card' || w === 'any' || w === '') return true;
  // top-level alternatives split on "|" or " or " ("artifact or enchantment", "instant or sorcery")
  return w.split(/\s*\|\s*|\s+or\s+/).map(s => s.trim()).filter(Boolean).some(a => matchWhatPhrase(c, a));
}
export function describeTarget(e) {
  const r = e.restrict || {};
  const parts = [];
  if (r.not) parts.push(...r.not.map(n => 'non' + ({ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }[n] || n)));
  if (r.colors) parts.push(...r.colors.map(c => ({ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }[c])));
  if (r.state) parts.push(r.state === 'combat' ? 'attacking or blocking' : r.state);
  if (r.subtypes) parts.push(...r.subtypes);
  const what = e.sel === 'any' ? 'any target' : e.sel === 'creature' ? 'creature' : e.sel === 'permanent' ? (r.types || ['permanent']).join(' or ') : e.sel === 'player' ? 'player' : e.sel === 'opponent' ? 'opponent' : e.sel === 'spell' ? (r.spellKind || 'spell') + ' spell' : e.sel === 'card' ? (r.what || 'card') + ' in graveyard' : e.sel;
  let s = `Target ${parts.join(' ')} ${what}`.replace(/\s+/g, ' ');
  if (r.control === 'you') s += ' you control'; if (r.control === 'opp') s += ' an opponent controls';
  if (r.flying === true) s += ' with flying'; if (r.flying === false) s += ' without flying';
  return s;
}
export function costText(c) {
  const parts = [];
  if (c.mana && (c.mana.pips.length || c.mana.generic || c.mana.x)) { if (c.mana.x) parts.push('X'.repeat(c.mana.x)); if (c.mana.generic) parts.push(String(c.mana.generic)); parts.push(...c.mana.pips.map(p => p.join('/'))); }
  const s = parts.join('');
  const extra = [];
  if (c.tap) extra.push('T'); if (c.sacSelf) extra.push('sacrifice'); if (c.sacrifice) extra.push('sacrifice a ' + c.sacrifice); if (c.discard) extra.push('discard ' + c.discard); if (c.life) extra.push(c.life + ' life');
  return [s, ...extra].filter(Boolean).join(', ') || '0';
}
