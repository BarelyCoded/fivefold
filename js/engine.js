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

export class Duel {
  constructor({ player, ai, rng = Math.random, hooks = null, rules = {} }) {
    this.rng = rng; this.hooks = hooks; this.rules = rules;
    this.players = [this.makePlayer(player, 0), this.makePlayer(ai, 1)];
    this.turn = 0; this.active = 0; this.priority = 0; this.passes = 0; this.step = 'setup'; this.stepIndex = -1;
    this.stack = []; this.jobs = []; this.events = []; this.pending = null; this.winner = null;
    this.log = []; this.listeners = []; this.attackers = []; this.blocks = {}; this.fog = false; this.extraTurns = 0;
    this.firstPlayer = 0; this.stepCount = 0; this.delayed = []; this.fx = [];
  }
  makePlayer(p, idx) {
    const library = shuffle(p.deck.map(def => this.instance(def, idx)), this.rng);
    return { idx, name: p.name, life: p.life, poison: 0, library, hand: [], battlefield: [], graveyard: [], exile: [], landPlayed: 0, ai: !!p.ai, pool: emptyPool(), skipToEnd: false, portrait: p.portrait || null };
  }
  instance(def, owner) {
    return { id: uid++, def, owner, controller: owner, zone: 'library', tapped: false, sick: true, damage: 0, counters: {}, temp: { p: 0, t: 0, kw: [], flags: [] }, attachedTo: null, regen: 0, flags: new Set(), controlUntilEot: null, token: false, cur: null, damaged: new Set(), attackedThisTurn: false, enteredTurn: 0, onceUsed: 0, chosenColor: null };
  }
  say(msg) { this.log.push(msg); if (this.log.length > 400) this.log.shift(); }
  emit() { for (const l of this.listeners) l(this); }
  onChange(fn) { this.listeners.push(fn); }
  get activePlayer() { return this.players[this.active]; }
  get defender() { return this.players[1 - this.active]; }
  opponentOf(p) { return this.players[1 - p.idx]; }
  find(id) {
    for (const p of this.players) for (const zone of ['battlefield', 'hand', 'graveyard', 'library', 'exile']) {
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
    for (const p of this.players) this.drawCards(p, p.idx === 0 ? (this.rules.handSize || 7) : 7);
    for (const [idx, defs] of [[0, this.rules.playerStart], [1, this.rules.oppStart]]) for (const def of defs || []) { const c = this.instance(def, idx); c.zone = 'limbo'; this.moveTo(c, 'battlefield', { controller: idx }); c.sick = false; }
    this.events.length = 0;
    this.active = this.rng() < 0.5 ? 0 : 1; this.firstPlayer = this.active;
    this.turn = 1; this.stepIndex = -1; this.step = 'setup';
    this.say(`${this.activePlayer.name} plays first.`);
    this.jobs.push({ gen: this.nextStep() });
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
  // human entry points
  humanPass() { const p = this.players[0]; if (this.pending?.type !== 'priority') return false; this.pending = null; this.pass(p); this.refresh(); return true; }
  humanEndTurn() { const p = this.players[0]; if (this.pending?.type !== 'priority') return false; p.skipToEnd = true; return this.humanPass(); }
  humanCast(card, opts) { if (this.pending?.type !== 'priority') return false; const ok = this.cast(this.players[0], card, opts); if (ok) { this.pending = null; } this.refresh(); return ok; }
  humanActivate(card, i, opts) { if (this.pending?.type !== 'priority') return false; const ok = this.activate(this.players[0], card, i, opts); if (ok) this.pending = null; this.refresh(); return ok; }
  humanMana(card, i, color) { if (this.pending?.type !== 'priority') return false; const ok = this.activateMana(this.players[0], card, i, color); this.refresh(); return ok; }
  humanAnswer(value) { if (this.pending?.type !== 'request') return false; this.pending.job.answer = value; this.pending = null; return true; }

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
    return false;
  }
  hasInstantAction(p) {
    for (const c of p.hand) if ((c.def.kind === 'instant' || has0(c.def, 'Flash') || c.def.keywords.some(k => k.k === 'Cycling')) && this.canCast(p, c)) return true;
    for (const c of p.battlefield) for (let i = 0; i < c.def.abilities.length; i++) if (c.def.abilities[i].type === 'activated' && c.def.abilities[i].timing === 'instant' && this.canActivate(p, c, i)) return true;
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
          for (const c of ap.battlefield) {
            c.sick = false; c.attackedThisTurn = false;
            if (c.flags.has('frozen')) { c.flags.delete('frozen'); continue; }
            if (c.cur?.flags.has('doesntUntap')) continue;
            if (c.tapped) c.tapped = false;
          }
          priority = false; break;
        }
        case 'upkeep': {
          this.say(`Turn ${this.turn}: ${ap.name}.`);
          for (const d of this.delayed.splice(0)) if (d.type === 'draw') { this.drawCards(this.players[d.player], 1); this.say(`${this.players[d.player].name} draws a card.`); }
          if (this.rules.upkeepDamage && ap.idx === 0 && this.turn > 1) { ap.life -= this.rules.upkeepDamage; this.say(`The miasma drains ${this.rules.upkeepDamage} life from ${ap.name}.`); }
          this.fireEvent({ type: 'upkeep', player: ap.idx });
          yield* this.upkeepCosts(ap);
          break;
        }
        case 'draw': {
          if (!(this.turn === 1)) this.drawCards(ap, 1);
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
          this.say(`${ap.name} attacks with ${ids.map(id => this.card(id).def.name).join(', ')}.`);
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
          const names = Object.entries(this.blocks).map(([aid, bids]) => `${bids.map(id => this.card(id).def.name).join(' + ')} blocks ${this.card(Number(aid)).def.name}`);
          this.say(names.length ? names.join('; ') + '.' : `${def.name} does not block.`);
          for (const [aid, bids] of Object.entries(this.blocks)) this.fx.push({ type: 'block', attacker: Number(aid), blockers: bids.slice() });
          for (const [aid, bids] of Object.entries(this.blocks)) {
            const a = this.card(Number(aid));
            this.fireEvent({ type: 'becomesBlocked', card: a, by: bids.map(id => this.card(id)) });
            const ramp = a.def.keywords.find(k => k.k === 'Rampage');
            if (ramp && bids.length > 1) { const n = ramp.n * (bids.length - 1); a.temp.p += n; a.temp.t += n; this.say(`${a.def.name} rampages +${n}/+${n}.`); }
            for (const bid of bids) {
              const b = this.card(bid);
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
          this.combatDamage('first'); break;
        }
        case 'damage': this.combatDamage('regular'); break;
        case 'endCombat': {
          this.fireEvent({ type: 'endCombat' });
          for (const c of this.permanents()) if (c.flags.has('destroyAtEndOfCombat')) { c.flags.delete('destroyAtEndOfCombat'); this.destroy(c, false); }
          this.attackers = []; this.blocks = {}; priority = false; break;
        }
        case 'end': {
          this.fireEvent({ type: 'endstep', player: ap.idx });
          for (const c of this.permanents()) if (c.flags.has('sacrificeAtEnd')) this.sacrifice(c);
          break;
        }
        case 'cleanup': {
          if (ap.hand.length > 7) {
            const n = ap.hand.length - 7;
            const ids = yield { kind: 'choose', player: ap.idx, text: `Discard down to seven: choose ${n} card${n > 1 ? 's' : ''}`, options: ap.hand.map(c => ({ id: c.id, label: c.def.name })), min: n, max: n };
            this.discardCards(ap, (ids || []).map(id => this.card(id)).filter(Boolean).slice(0, n));
            while (ap.hand.length > 7) this.discardCards(ap, [ap.hand[ap.hand.length - 1]]);
          }
          this.endOfTurnCleanup();
          priority = false; break;
        }
      }
      if (priority) { this.priority = this.active; this.passes = 0; this.refresh(); this.emit(); return; }
      if (this.events.length) { this.priority = this.active; this.passes = 0; return; } // triggers will be processed, then priority
    }
  }
  newTurn() {
    if (this.extraTurns > 0) { this.extraTurns--; this.say(`${this.activePlayer.name} takes an extra turn.`); }
    else this.active = 1 - this.active;
    this.turn++;
    this.stepIndex = 0;
    this.fog = false;
  }
  endOfTurnCleanup() {
    for (const p of this.players) for (const c of p.battlefield) {
      c.damage = 0; c.temp = { p: 0, t: 0, kw: [], flags: [] }; c.damaged = new Set();
      for (const f of ['cantBlock', 'cantAttack', 'cantAttackOrBlock', 'unblockable', 'noCombatDamage']) c.flags.delete(f);
      if (c.controlUntilEot !== null) { const orig = c.controlUntilEot; c.controlUntilEot = null; this.changeControl(c, orig); }
    }
    this.fog = false;
  }
  *upkeepCosts(ap) {
    for (const c of ap.battlefield.slice()) {
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
      for (const c of this.permanents()) for (const ab of c.def.abilities) if (ab.type === 'triggered' && this.triggerMatches(c, ab, ev)) triggers.push({ source: c, ab, ev });
      // dies triggers of the card that died (it is in the graveyard now)
      if (ev.type === 'dies' || ev.type === 'leaves') for (const ab of ev.card.def.abilities) if (ab.type === 'triggered' && ab.event === ev.type) triggers.push({ source: ev.card, ab, ev });
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
      case 'becomesBlocked': return ev.type === 'becomesBlocked' && ev.card === c;
      case 'attacksOrBlocks': return (ev.type === 'attacks' || ev.type === 'blocks') && ev.card === c;
      case 'blocksOrBlockedBy': return (ev.type === 'blocks' && ev.card === c && this.matchFilter(ev.attacker, ab.filter)) || (ev.type === 'becomesBlocked' && ev.card === c && ev.by.some(b => this.matchFilter(b, ab.filter)));
      case 'combatDamagePlayer': return ev.type === 'damage' && ev.source === c && ev.combat && ev.target.idx !== undefined;
      case 'damagePlayer': return ev.type === 'damage' && ev.source === c && ev.target.idx !== undefined;
      case 'combatDamageCreature': return ev.type === 'damage' && ev.source === c && ev.combat && ev.target.def;
      case 'dealsDamage': return ev.type === 'damage' && ev.source === c;
      case 'becomesTapped': return ev.type === 'tapped' && ev.card === c;
      case 'targeted': return ev.type === 'targeted' && ev.card === c;
      case 'anyCreatureDies': return ev.type === 'dies' && isCreatureDef(ev.card) && (!ab.other || ev.card !== c);
      case 'damagedByDies': return ev.type === 'dies' && ev.card.damaged.has(c.id);
      case 'anyCreatureEtb': return ev.type === 'etb' && isCreatureDef(ev.card) && (!ab.yours || ev.card.controller === c.controller) && (!ab.other || ev.card !== c);
      case 'enchantedDealsDamage': return ev.type === 'damage' && ev.source === c.attachedTo && !!c.attachedTo;
      case 'enchantedDies': return ev.type === 'dies' && ev.card === c.attachedTo;
      case 'enchantedAttacks': return ev.type === 'attacks' && ev.card === c.attachedTo;
      case 'upkeep': return ev.type === 'upkeep' && (ab.who === 'each' || (ab.who === 'you' && ev.player === c.controller) || (ab.who === 'enchantedController' && c.attachedTo && ev.player === c.attachedTo.controller));
      case 'endstep': return ev.type === 'endstep' && (ab.who === 'each' || ev.player === c.controller);
      case 'drawstep': return ev.type === 'drawstep' && (ab.who === 'each' || ev.player === c.controller);
      case 'beginCombat': return ev.type === 'beginCombat' && ev.player === c.controller;
      case 'youCast': return ev.type === 'cast' && ev.player === c.controller && (ab.kind === 'any' || (ab.kind === 'creature') === isCreatureDef(ev.card));
      case 'anyCast': return ev.type === 'cast';
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
    if (ab.condition) {
      if (ab.condition.selfUntapped && source.tapped) return;
      if (ab.condition.didntAttack && source.attackedThisTurn) return;
    }
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
    if (ev.type === 'blocks') fixed = ev.attacker; else if (ev.type === 'becomesBlocked') fixed = ev.by?.[0] || null;
    this.pushTrigger(source, ab, { targets, ev, fixed });
  }
  pushTrigger(source, ab, extra = {}) {
    const item = { id: uid++, kind: 'trigger', card: source, controller: source.controller, targets: extra.targets || [], effects: ab.effects, optional: ab.optional, text: ab.text || '', ev: extra.ev, fixed: extra.fixed || null, thatPlayer: extra.ev?.player ?? (extra.ev?.target?.idx) };
    this.stack.push(item);
    this.say(`${source.def.name} triggers.`);
  }

  // ---- mana --------------------------------------------------------------------
  manaSources(p) {
    const out = [];
    for (const c of p.battlefield) {
      if (c.tapped) continue;
      if (isCreature(c) && c.sick && !has(c, 'Haste')) continue;
      c.def.manaAbilities.forEach((ma, i) => { if (ma.cost.tap && !ma.cost.sacSelf && !ma.cost.sacrifice && !ma.cost.life && !ma.cost.mana.pips.length && !ma.cost.mana.generic) out.push({ card: c, index: i, produces: ma.produces, amount: ma.amount || 1 }); });
    }
    return out;
  }
  totalMana(p) { return Object.values(p.pool).reduce((a, b) => a + b, 0) + this.manaSources(p).reduce((s, x) => s + x.amount, 0); }
  // Returns a payment plan {pool:{...}, taps:[{src,color}]} or null
  planPayment(p, cost, x = 0) {
    const pips = (cost.pips || []).slice().sort((a, b) => a.length - b.length);
    let generic = (cost.generic || 0) + (cost.x ? x : 0);
    const pool = { ...p.pool };
    const usePool = {};
    const rem = [];
    for (const pip of pips) { const col = pip.find(c => pool[c] > 0); if (col) { pool[col]--; usePool[col] = (usePool[col] || 0) + 1; } else rem.push(pip); }
    const sources = this.manaSources(p);
    const used = new Array(sources.length).fill(null); // color chosen
    const left = sources.map(s => s.amount);
    const assign = (i) => {
      if (i === rem.length) return true;
      for (let s = 0; s < sources.length; s++) {
        const col = rem[i].find(c => sources[s].produces.includes(c));
        if (!col) continue;
        if (used[s] && used[s] !== col) continue;
        if (left[s] <= 0) continue;
        const prev = used[s]; used[s] = col; left[s]--;
        if (assign(i + 1)) return true;
        used[s] = prev; left[s]++;
      }
      return false;
    };
    if (!assign(0)) return null;
    let genericAvail = Object.values(pool).reduce((a, b) => a + b, 0) + left.reduce((a, b) => a + b, 0);
    if (genericAvail < generic) return null;
    // consume generic: pool first, then leftover units on already-tapped sources, then new sources (fewest colours first)
    for (const col of ['C', 'W', 'U', 'B', 'R', 'G']) while (generic > 0 && pool[col] > 0) { pool[col]--; usePool[col] = (usePool[col] || 0) + 1; generic--; }
    const order = sources.map((s, i) => i).sort((a, b) => (used[a] ? -1 : 0) - (used[b] ? -1 : 0) || sources[a].produces.length - sources[b].produces.length || (isLand(sources[a].card) ? -1 : 1) - (isLand(sources[b].card) ? -1 : 1));
    for (const i of order) { while (generic > 0 && left[i] > 0) { if (!used[i]) used[i] = sources[i].produces[0]; left[i]--; generic--; } if (generic <= 0) break; }
    const taps = sources.map((s, i) => used[i] ? { src: s, color: used[i], spare: left[i] } : null).filter(Boolean);
    return { usePool, taps };
  }
  canPay(p, cost, x = 0) { return !!this.planPayment(p, cost, x); }
  payMana(p, plan) {
    if (!plan) return;
    for (const [col, n] of Object.entries(plan.usePool)) p.pool[col] -= n;
    for (const t of plan.taps) { this.tap(t.src.card); if (t.spare > 0) p.pool[t.color] += t.spare; }
  }
  activateMana(p, card, i, color) {
    const ma = card.def.manaAbilities[i]; if (!ma || card.controller !== p.idx || card.zone !== 'battlefield') return false;
    if (ma.cost.tap && (card.tapped || (isCreature(card) && card.sick && !has(card, 'Haste')))) return false;
    if (ma.cost.mana.pips.length || ma.cost.mana.generic) { const plan = this.planPayment(p, ma.cost.mana); if (!plan) return false; this.payMana(p, plan); }
    if (ma.cost.tap) this.tap(card);
    if (ma.cost.sacSelf) this.sacrifice(card);
    if (ma.cost.sacrifice) { const opts = p.battlefield.filter(c => isType(c, ma.cost.sacrifice) && c !== card); if (!opts.length) return false; this.sacrifice(opts.sort((a, b) => a.def.cmc - b.def.cmc)[0]); }
    if (ma.cost.life) p.life -= ma.cost.life;
    const col = ma.produces.includes(color) ? color : ma.produces[0];
    p.pool[col] += ma.amount || 1;
    this.say(`${p.name} adds ${(ma.amount || 1)} ${col} mana.`);
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
    if (d.kind === 'land') return this.sorcerySpeed(p) && p.landPlayed < 1;
    const instantSpeed = d.kind === 'instant' || has0(d, 'Flash');
    if (!instantSpeed && !this.sorcerySpeed(p)) return false;
    let cost = fromGrave ? d.keywords.find(k => k.k === 'Flashback').cost : d.cost;
    if (opts.kicked) { const k = d.keywords.find(k => k.k === 'Kicker'); if (!k) return false; cost = addCosts(cost, k.cost); }
    if (opts.buyback) { const k = d.keywords.find(k => k.k === 'Buyback'); if (!k) return false; cost = addCosts(cost, k.cost); }
    if (opts.pitch !== undefined && d.spell?.alternativeCost?.pitch) {
      const pc = this.card(opts.pitch); if (!pc || !p.hand.includes(pc) || pc === card || !pc.def.colors.includes(d.spell.alternativeCost.pitch)) return false;
    } else if (!this.canPay(p, cost, opts.x || 0)) return false;
    const add = d.spell?.additionalCost || d.additionalCost;
    if (add) {
      if (add.sacrifice && !p.battlefield.some(c => isType(c, add.sacrifice))) return false;
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
    const out = { targets: [], x: !!d.cost.x, kicker: d.keywords.find(k => k.k === 'Kicker')?.cost || null, buyback: d.keywords.find(k => k.k === 'Buyback')?.cost || null, modes: null, additional: d.spell?.additionalCost || d.additionalCost || null, pitch: d.spell?.alternativeCost?.pitch || null, flashback: card.zone === 'graveyard', cycling: d.keywords.find(k => k.k === 'Cycling')?.cost || null };
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
      this.passes = 0; this.priority = p.idx; this.emit(); return true;
    }
    if (d.kind === 'land') {
      p.landPlayed++; this.moveTo(card, 'battlefield'); this.say(`${p.name} plays ${d.name}.`);
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
    if (opts.pitch !== undefined && d.spell?.alternativeCost?.pitch) { const pc = this.card(opts.pitch); this.moveTo(pc, 'exile'); p.life -= d.spell.alternativeCost.life || 0; this.say(`${p.name} exiles ${pc.def.name} from hand.`); }
    else this.payMana(p, this.planPayment(p, cost, opts.x || 0));
    const add = d.spell?.additionalCost || d.additionalCost;
    if (add) {
      if (add.sacrifice) { const c = this.card(opts.sacrifice) || p.battlefield.filter(x => isType(x, add.sacrifice)).sort((a, b) => a.def.cmc - b.def.cmc)[0]; if (c) this.sacrifice(c); }
      if (add.discard) { const cs = (opts.discard || []).map(id => this.card(id)).filter(c => c && p.hand.includes(c) && c !== card); while (cs.length < add.discard) { const c = p.hand.find(x => x !== card && !cs.includes(x)); if (!c) break; cs.push(c); } this.discardCards(p, cs); }
      if (add.life) p.life -= add.life;
    }
    card.zone = 'stack'; removeFrom(p.hand, card); removeFrom(p.graveyard, card);
    const item = { id: uid++, kind: 'spell', card, controller: p.idx, targets, x: opts.x || 0, modes: opts.modes || null, kicked: !!opts.kicked, buyback: !!opts.buyback, flashback: fromGrave, effects: this.spellEffects(d, opts) };
    this.stack.push(item);
    this.say(`${p.name} casts ${d.name}${opts.x ? ` (X=${opts.x})` : ''}${opts.kicked ? ' with kicker' : ''}.`);
    this.fx.push({ type: 'cast', id: card.id, controller: p.idx });
    for (const t of targets) if (t.type === 'perm') this.fireEvent({ type: 'targeted', card: this.card(t.id) });
    this.fireEvent({ type: 'cast', player: p.idx, card });
    for (const c of p.battlefield) if (has(c, 'Prowess') && !isCreatureDef(card)) this.pushTrigger(c, { effects: [{ type: 'pump', p: 1, t: 1, sel: 'self' }], text: 'Prowess' });
    this.passes = 0; this.priority = p.idx; this.emit(); return true;
  }

  // ---- activated abilities -----------------------------------------------------------
  canActivate(p, card, i, opts = {}) {
    if (this.winner !== null || this.priority !== p.idx) return false;
    const ab = card.def.abilities[i]; if (!ab || ab.type !== 'activated') return false;
    if (card.zone !== 'battlefield' || card.controller !== p.idx) return false;
    if (ab.timing === 'sorcery' && !this.sorcerySpeed(p)) return false;
    if (ab.once && card.onceUsed === this.stepCount) return false;
    const c = ab.cost;
    if (c.tap && (card.tapped || (isCreature(card) && card.sick && !has(card, 'Haste')))) return false;
    if (c.untap && !card.tapped) return false;
    if (c.life && p.life <= c.life) return false;
    if (c.discard && p.hand.length < c.discard) return false;
    if (c.sacrifice && !p.battlefield.some(x => isType(x, c.sacrifice) && x !== card)) return false;
    if (c.removeCounter && !((card.counters[c.removeCounter.kind] || 0) >= c.removeCounter.n)) return false;
    if (ab.timing === 'upkeep' && !(this.step === 'upkeep' && this.active === p.idx)) return false;
    if (c.tapCreature && !p.battlefield.some(x => isCreature(x) && !x.tapped && x !== card)) return false;
    if ((c.mana.pips.length || c.mana.generic || c.mana.x) && !this.canPay(p, c.mana, opts.x || 0)) return false;
    for (const e of ab.effects) if (needsTarget(e) && !this.legalTargets(p, e, card).length) return false;
    return true;
  }
  activateOptions(p, card, i) {
    const ab = card.def.abilities[i];
    return { x: !!ab.cost.mana.x, targets: ab.effects.filter(needsTarget).map(e => ({ text: describeTarget(e), options: this.legalTargets(p, e, card), effect: e })), sacrifice: ab.cost.sacrifice ? p.battlefield.filter(x => isType(x, ab.cost.sacrifice) && x !== card).map(x => x.id) : null, discard: ab.cost.discard ? p.hand.map(x => x.id) : null };
  }
  activate(p, card, i, opts = {}) {
    if (!this.canActivate(p, card, i, opts)) return false;
    const ab = card.def.abilities[i]; const c = ab.cost;
    const specs = ab.effects.filter(needsTarget);
    const targets = opts.targets || [];
    for (let k = 0; k < specs.length; k++) { const legal = this.legalTargets(p, specs[k], card); if (!targets[k] || !legal.some(l => sameRef(l, targets[k]))) return false; }
    if (c.mana.pips.length || c.mana.generic || c.mana.x) this.payMana(p, this.planPayment(p, c.mana, opts.x || 0));
    if (c.tap) this.tap(card);
    if (c.untap) card.tapped = false;
    if (c.life) p.life -= c.life;
    if (c.sacSelf) this.sacrifice(card);
    if (c.sacrifice) { const s = this.card(opts.sacrifice) || p.battlefield.filter(x => isType(x, c.sacrifice) && x !== card).sort((a, b) => a.def.cmc - b.def.cmc)[0]; this.sacrifice(s); }
    if (c.discard) { const cs = (opts.discard || []).map(id => this.card(id)).filter(x => x && p.hand.includes(x)); while (cs.length < c.discard) { const x = p.hand.find(h => !cs.includes(h)); if (!x) break; cs.push(x); } this.discardCards(p, cs); }
    if (c.removeCounter) card.counters[c.removeCounter.kind] -= c.removeCounter.n;
    if (c.tapCreature) { const t = this.card(opts.tapCreature) || p.battlefield.find(x => isCreature(x) && !x.tapped && x !== card); if (t) this.tap(t); }
    if (ab.once) card.onceUsed = this.stepCount;
    const item = { id: uid++, kind: 'ability', card, controller: p.idx, targets, x: opts.x || 0, effects: ab.effects, optional: ab.optional, text: ab.text };
    this.stack.push(item);
    this.say(`${p.name} activates ${card.def.name}.`);
    for (const t of targets) if (t.type === 'perm') this.fireEvent({ type: 'targeted', card: this.card(t.id) });
    this.passes = 0; this.priority = p.idx; this.emit(); return true;
  }

  // ---- targets ----------------------------------------------------------------------
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
      if (card.zone === 'stack') this.moveTo(card, item.flashback ? 'exile' : item.buyback ? 'hand' : 'graveyard');
      this.afterResolve(); return;
    }
    // ability or trigger
    if (item.optional) {
      const yes = yield { kind: 'yesno', player: p.idx, text: `${card.def.name}: ${item.text || 'use this ability'}?`, card: card.id, value: 'optional' };
      if (!yes) { this.afterResolve(); return; }
    }
    const specs = item.effects.filter(needsTarget);
    const legal = specs.map((e, i) => item.targets[i] && this.refIsLegal(p, e, item.targets[i], card));
    if (specs.length && !legal.some(Boolean)) { this.say(`${card.def.name}'s ability fizzles.`); this.afterResolve(); return; }
    const ctx = { p, source: card, targets: item.targets.slice(), ti: 0, x: item.x, prev: item.fixed ? { type: 'perm', id: item.fixed.id } : null, legal, item, thatPlayer: item.thatPlayer };
    yield* this.runEffects(item.effects, ctx, false);
    this.afterResolve();
  }
  afterResolve() { this.priority = this.active; this.passes = 0; this.refresh(); this.emit(); }

  *runEffects(effects, ctx, optionalAll) {
    if (optionalAll && !ctx.p.ai) { const yes = yield { kind: 'yesno', player: ctx.p.idx, text: `${ctx.source.def.name}: apply the effect?`, value: 'optional' }; if (!yes) return; }
    for (const e of effects) {
      yield* this.applyEffect(e, ctx);
      this.sba();
      if (this.winner !== null) return;
    }
  }
  amount(v, ctx) { return v === 'X' ? ctx.x : v === '-X' ? -ctx.x : v; }
  // Resolve the "subject" of an effect into a list of {card} / {player} objects.
  *subjects(e, ctx) {
    const p = ctx.p;
    switch (e.sel) {
      case 'you': return [{ player: p }];
      case 'self': return ctx.source.zone === 'battlefield' || ctx.source.zone === 'stack' ? [{ card: ctx.source }] : [];
      case 'enchanted': return ctx.source.attachedTo ? [{ card: ctx.source.attachedTo }] : [];
      case 'fixed': return ctx.item?.fixed ? [{ card: ctx.item.fixed }] : [];
      case 'thatPlayer': return ctx.thatPlayer !== undefined ? [{ player: this.players[ctx.thatPlayer] }] : [];
      case 'prev': return ctx.prev ? [this.deref(ctx.prev)].filter(Boolean) : (ctx.item?.fixed ? [{ card: ctx.item.fixed }] : []);
      case 'each': {
        const r = e.restrict || {}; const out = [];
        if (r.types) for (const pl of this.players) for (const c of pl.battlefield.slice()) if (this.matchesRestrict(c, r, p)) out.push({ card: c });
        if (r.players === 'all') for (const pl of this.players) out.push({ player: pl });
        if (r.players === 'opp') out.push({ player: this.opponentOf(p) });
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
      case 'damage': for (const s of subs) { if (s.card) this.dealDamage(src, s.card, n); else if (s.player) this.dealDamage(src, s.player, n); } break;
      case 'damageEqualPower': for (const s of subs) if (s.card) this.dealDamage(src, s.card, power(src)); else if (s.player) this.dealDamage(src, s.player, power(src)); break;
      case 'fight': for (const s of subs) if (s.card) { this.dealDamage(src, s.card, power(src)); this.dealDamage(s.card, src, power(s.card)); } break;
      case 'destroy': for (const s of subs) if (s.card) this.destroy(s.card, !!e.noRegen); break;
      case 'destroyAll': for (const pl of this.players) for (const c of pl.battlefield.slice()) if (this.matchesRestrict(c, e.restrict, p)) this.destroy(c, true); break;
      case 'exile': for (const s of subs) if (s.card) this.moveTo(s.card, 'exile'); break;
      case 'exileAll': for (const pl of this.players) for (const c of pl.battlefield.slice()) if (this.matchesRestrict(c, e.restrict, p)) this.moveTo(c, 'exile'); break;
      case 'bounce': for (const s of subs) if (s.card) this.moveTo(s.card, 'hand'); break;
      case 'bounceSelf': if (src.zone === 'battlefield' || src.zone === 'stack') this.moveTo(src, 'hand'); break;
      case 'fromGraveyard': for (const s of subs) if (s.card && s.card.zone === 'graveyard') { this.moveTo(s.card, e.to === 'hand' ? 'hand' : 'battlefield', { controller: p.idx }); if (e.tapped) s.card.tapped = true; } break;
      case 'pump': { const dp = this.amount(e.p, ctx), dt = this.amount(e.t, ctx); for (const s of subs) if (s.card && isCreature(s.card)) { s.card.temp.p += dp; s.card.temp.t += dt; this.say(`${s.card.def.name} gets ${dp >= 0 ? '+' : ''}${dp}/${dt >= 0 ? '+' : ''}${dt}.`); } break; }
      case 'grant': for (const s of subs) if (s.card) { s.card.temp.kw.push(e.keyword); this.say(`${s.card.def.name} gains ${kwName(e.keyword).toLowerCase()}.`); } break;
      case 'flag': for (const s of subs) if (s.card) s.card.flags.add(e.flag); break;
      case 'draw': for (const s of subs) if (s.player) { this.drawCards(s.player, n); this.say(`${s.player.name} draws ${n}.`); } break;
      case 'discard': for (const s of subs) if (s.player) yield* this.discardChoice(s.player, e.all ? s.player.hand.length : n, e.random, p); break;
      case 'gain': for (const s of subs) if (s.player) { s.player.life += n; this.say(`${s.player.name} gains ${n} life.`); } break;
      case 'lose': for (const s of subs) if (s.player) { s.player.life -= n; this.say(`${s.player.name} loses ${n} life.`); } break;
      case 'gainEqualPower': for (const s of subs) if (s.card) { const pl = this.players[s.card.controller]; pl.life += power(s.card); } break;
      case 'gainEqualPrev': { const s = ctx.prev ? this.deref(ctx.prev) : null; if (s?.card) p.life += power(s.card); else if (ctx.lastDamage) p.life += ctx.lastDamage; break; }
      case 'mill': for (const s of subs) if (s.player) for (let i = 0; i < n; i++) { const c = s.player.library.pop(); if (c) this.moveTo(c, 'graveyard'); } break;
      case 'counter': for (const s of subs) if (s.item) {
        const ctrl = this.players[s.item.controller];
        if (e.unlessPay) { const pay = this.amount(e.unlessPay, ctx); const cost = { pips: [], generic: pay, x: false }; if (this.canPay(ctrl, cost)) { const yes = yield { kind: 'yesno', player: ctrl.idx, text: `Pay {${pay}} to stop ${s.item.card.def.name} from being countered?`, value: 'pay' }; if (yes) { this.payMana(ctrl, this.planPayment(ctrl, cost)); this.say(`${ctrl.name} pays ${pay}.`); continue; } } }
        this.counterItem(s.item);
      } break;
      case 'tutor': yield* this.tutor(p, e); break;
      case 'tap': for (const s of subs) if (s.card) this.tap(s.card); break;
      case 'untap': for (const s of subs) if (s.card) s.card.tapped = false; break;
      case 'tapOrUntap': for (const s of subs) if (s.card) { if (s.card.tapped) s.card.tapped = false; else this.tap(s.card); } break;
      case 'tapAll': for (const pl of this.players) for (const c of pl.battlefield) if (this.matchesRestrict(c, e.restrict, p)) this.tap(c); break;
      case 'untapAll': for (const pl of this.players) for (const c of pl.battlefield) if (this.matchesRestrict(c, e.restrict, p)) c.tapped = false; break;
      case 'freeze': for (const s of subs) if (s.card) s.card.flags.add('frozen'); break;
      case 'sacrifice': for (const s of subs) if (s.player) yield* this.sacrificeChoice(s.player, e.what); break;
      case 'sacrificeSelf': if (src.zone === 'battlefield') this.sacrifice(src); break;
      case 'control': for (const s of subs) if (s.card) { if (e.until === 'eot' && s.card.controlUntilEot === null) s.card.controlUntilEot = s.card.controller; this.changeControl(s.card, p.idx); this.say(`${p.name} gains control of ${s.card.def.name}.`); } break;
      case 'counters': for (const s of subs) if (s.card) { s.card.counters[e.kind] = (s.card.counters[e.kind] || 0) + n; this.say(`${n} ${e.kind} counter${n > 1 ? 's' : ''} on ${s.card.def.name}.`); } break;
      case 'removeCounters': for (const s of subs) if (s.card) { s.card.counters['+1/+1'] = 0; s.card.counters['-1/-1'] = 0; } break;
      case 'regenerate': for (const s of subs) if (s.card) { s.card.regen++; this.say(`${s.card.def.name} gains a regeneration shield.`); } break;
      case 'fog': this.fog = true; this.say('All combat damage this turn is prevented.'); break;
      case 'addMana': if (e.any) { const col = p.ai ? (this.hooks.choose(this, { kind: 'color', player: p.idx }) || 'G') : yield { kind: 'color', player: p.idx, text: 'Choose a color' }; p.pool[col] += e.any; } else for (const m of e.mana) p.pool[m]++; break;
      case 'scry': yield* this.scry(p, n); break;
      case 'extraTurn': this.extraTurns++; break;
      case 'token': for (let i = 0; i < n; i++) this.createToken(p, e); break;
      case 'exileGraveyard': { const pls = e.who === 'you' ? [p] : e.who === 'each' ? this.players : subs.filter(s => s.player).map(s => s.player); for (const pl of pls) for (const c of pl.graveyard.slice()) this.moveTo(c, 'exile'); break; }
      case 'poison': for (const s of subs) if (s.player) s.player.poison += n; break;
      case 'noop': break;
      case 'delayedDraw': this.delayed.push({ player: p.idx, type: 'draw' }); break;
      case 'unlessPay': {
        const can = this.canPay(p, e.cost);
        let paid = false;
        if (can) { paid = yield { kind: 'yesno', player: p.idx, text: `${src.def.name}: pay ${costString(e.cost)} to avoid "${e.effects.map(x => x.type).join(', ')}"?`, card: src.id, value: 'unlessPay' }; }
        if (paid) { this.payMana(p, this.planPayment(p, e.cost)); this.say(`${p.name} pays for ${src.def.name}.`); }
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
  *sacrificeChoice(pl, what) {
    const opts = pl.battlefield.filter(c => isType(c, what) || (what === 'creature' && isCreature(c)));
    if (!opts.length) return;
    const ids = yield { kind: 'choose', player: pl.idx, text: `Sacrifice a ${what}`, options: opts.map(c => ({ id: c.id, label: c.def.name })), min: 1, max: 1 };
    const c = this.card((ids || [])[0]) || opts[0];
    this.sacrifice(c);
  }
  *tutor(p, e) {
    const what = e.what.replace(/ cards?$/, '');
    const opts = p.library.filter(c => matchCardWhat(c, what));
    if (!opts.length) { this.say(`${p.name} finds nothing.`); shuffle(p.library, this.rng); return; }
    const ids = yield { kind: 'choose', player: p.idx, text: `Search your library for a ${what}`, options: opts.map(c => ({ id: c.id, label: c.def.name })), min: 0, max: 1, secret: true };
    const c = this.card((ids || [])[0]);
    if (c) {
      if (e.to === 'hand') this.moveTo(c, 'hand');
      else if (e.to === 'battlefield') { this.moveTo(c, 'battlefield'); if (e.tapped) c.tapped = true; }
      else if (e.to === 'top') { removeFrom(p.library, c); p.library.push(c); }
      this.say(`${p.name} searches for ${e.to === 'hand' ? 'a card' : c.def.name}.`);
    }
    shuffle(p.library, this.rng);
    if (e.to === 'top' && c) { removeFrom(p.library, c); p.library.push(c); }
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
      for (const a of this.permanents()) if (a.attachedTo === c) a.attachedTo = null;
      if (c.attachedTo) { const host = c.attachedTo; c.attachedTo = null; if (c.def.aura && c.def.abilities.some(ab => ab.kind === 'control') && host.controller !== host.owner) this.changeControl(host, host.owner); }
      removeFrom(this.attackers, c.id); delete this.blocks[c.id];
      for (const k of Object.keys(this.blocks)) this.blocks[k] = this.blocks[k].filter(id => id !== c.id);
      const counters = { ...c.counters };
      this.fireEvent({ type: zone === 'graveyard' ? 'dies' : 'leaves', card: c, counters });
      if (zone === 'graveyard') this.fireEvent({ type: 'leaves', card: c });
    } else if (from === 'hand') removeFrom(owner.hand, c);
    else if (from === 'graveyard') removeFrom(owner.graveyard, c);
    else if (from === 'library') removeFrom(owner.library, c);
    else if (from === 'exile') removeFrom(owner.exile, c);
    else if (from === 'stack') { const i = this.stack.findIndex(it => it.card === c); if (i >= 0) this.stack.splice(i, 1); }
    // reset state
    c.tapped = false; c.damage = 0; c.temp = { p: 0, t: 0, kw: [], flags: [] }; c.regen = 0; c.flags = new Set(); c.counters = {}; c.controlUntilEot = null; c.damaged = new Set(); c.attachedTo = null;
    if (c.token && zone !== 'battlefield') { c.zone = 'gone'; return; }
    c.zone = zone;
    if (zone === 'battlefield') {
      c.controller = opts.controller ?? c.owner;
      const ctrl = this.players[c.controller];
      ctrl.battlefield.push(c);
      c.sick = true; c.enteredTurn = this.turn; c.echoPaid = false;
      if (c.def.entersTapped) c.tapped = true;
      for (const ab of c.def.abilities) if (ab.kind === 'entersWithCounters') c.counters[ab.counter] = (c.counters[ab.counter] || 0) + ab.amount;
      if (opts.kicked && c.def.kicked) for (const e of c.def.kicked) if (e.type === 'counters') c.counters[e.kind] = (c.counters[e.kind] || 0) + e.amount;
      if (opts.attachTo) c.attachedTo = opts.attachTo;
      this.refresh();
      this.fireEvent({ type: 'etb', card: c });
    } else if (zone === 'hand') owner.hand.push(c);
    else if (zone === 'graveyard') owner.graveyard.push(c);
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
  drawCards(p, n) {
    for (let i = 0; i < n; i++) {
      if (!p.library.length) { p.drewFromEmpty = true; return; }
      const c = p.library.pop(); c.zone = 'hand'; p.hand.push(c);
    }
  }
  discardCards(p, cards) { for (const c of cards) if (c && p.hand.includes(c)) { this.moveTo(c, 'graveyard'); this.say(`${p.name} discards ${c.def.name}.`); } }
  tap(c) { if (c.tapped) return; c.tapped = true; this.fireEvent({ type: 'tapped', card: c }); }
  sacrifice(c) { if (!c || c.zone !== 'battlefield') return; this.say(`${this.players[c.controller].name} sacrifices ${c.def.name}.`); this.moveTo(c, 'graveyard'); }
  destroy(c, noRegen) {
    if (!c || c.zone !== 'battlefield') return;
    if (has(c, 'Indestructible')) return;
    if (c.regen > 0 && !noRegen) { c.regen--; c.tapped = true; c.damage = 0; removeFrom(this.attackers, c.id); delete this.blocks[c.id]; for (const k of Object.keys(this.blocks)) this.blocks[k] = this.blocks[k].filter(id => id !== c.id); this.say(`${c.def.name} regenerates.`); return; }
    this.say(`${c.def.name} is destroyed.`);
    this.fx.push({ type: 'die', id: c.id, name: c.def.name, controller: c.controller });
    this.moveTo(c, 'graveyard');
  }
  counterItem(item) {
    const i = this.stack.indexOf(item); if (i < 0) return;
    this.stack.splice(i, 1);
    this.say(`${item.card.def.name} is countered.`);
    if (item.kind === 'spell') { item.card.zone = 'limbo'; this.moveTo(item.card, item.flashback ? 'exile' : 'graveyard'); }
  }
  dealDamage(source, target, n, opts = {}) {
    if (n <= 0) return 0;
    if (target.def) { // creature
      if (this.protectedFrom(target, source)) { this.say(`${target.def.name} is protected from ${source.def.name}.`); return 0; }
      if (opts.combat && (this.fog || target.flags.has('noCombatDamage') || source.flags?.has('noCombatDamage'))) return 0;
      if (has0(source.def, 'Wither') || has0(source.def, 'Infect') || has(source, 'Wither') || has(source, 'Infect')) target.counters['-1/-1'] = (target.counters['-1/-1'] || 0) + n;
      else target.damage += n;
      if (has(source, 'Deathtouch') && isCreature(source)) target.flags.add('deathtouched');
      target.damaged.add(source.id);
      this.say(`${source.def.name} deals ${n} damage to ${target.def.name}.`);
      this.fx.push({ type: 'damage', target: target.id, amount: n });
      if (has(source, 'Lifelink')) this.players[source.controller].life += n;
      this.fireEvent({ type: 'damage', source, target, amount: n, combat: !!opts.combat });
      return n;
    }
    const pl = target;
    if (opts.combat && (this.fog || source.flags?.has('noCombatDamage'))) return 0;
    if (has(source, 'Infect') || has0(source.def, 'Infect')) pl.poison += n; else pl.life -= n;
    this.say(`${source.def.name} deals ${n} damage to ${pl.name}.`);
    this.fx.push({ type: 'damage', player: pl.idx, amount: n });
    if (has(source, 'Lifelink')) this.players[source.controller].life += n;
    this.fireEvent({ type: 'damage', source, target: pl, amount: n, combat: !!opts.combat });
    return n;
  }

  // ---- combat ------------------------------------------------------------------------
  canAttack(c) {
    if (!isCreature(c) || c.tapped) return false;
    if (c.sick && !has(c, 'Haste')) return false;
    if (has(c, 'Defender') || c.cur.flags.has('cantAttack') || c.cur.flags.has('cantAttackOrBlock') || c.flags.has('cantAttack') || c.flags.has('cantAttackOrBlock')) return false;
    const need = c.cur.attackOnlyIfDefenderHas;
    if (need && !this.defender.battlefield.some(l => isLand(l) && hasSubtype(l, need))) return false;
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
    for (const k of a.cur.kw) if (typeof k === 'object' && k.k === 'Landwalk' && this.players[b.controller].battlefield.some(l => isLand(l) && hasSubtype(l, k.land))) return false;
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
  combatDamage(which) {
    const atk = this.activePlayer, def = this.defender;
    const first = c => has(c, 'First strike') || has(c, 'Double strike');
    const deals = c => which === 'first' ? first(c) : (!first(c) || has(c, 'Double strike'));
    this.fx.push({ type: 'strike', attackers: this.attackers.slice(), blocks: Object.fromEntries(Object.entries(this.blocks).map(([k, v]) => [k, v.slice()])) });
    for (const aid of this.attackers.slice()) {
      const a = atk.battlefield.find(x => x.id === aid); if (!a) continue;
      const blockers = (this.blocks[aid] || []).map(id => def.battlefield.find(x => x.id === id)).filter(Boolean);
      const wasBlocked = (this.blocks[aid] || []).length > 0;
      if (deals(a)) {
        let dmg = power(a);
        if (!wasBlocked) { this.dealDamage(a, def, dmg, { combat: true }); if (which !== 'first' || !has(a, 'Double strike')) this.fireEvent({ type: 'unblocked', card: a }); }
        else {
          const trample = has(a, 'Trample');
          blockers.forEach((b, i) => {
            if (dmg <= 0) return;
            const lethal = has(a, 'Deathtouch') ? 1 : Math.max(0, toughness(b) - b.damage);
            let give = Math.min(dmg, lethal);
            if (i === blockers.length - 1 && !trample) give = dmg;
            this.dealDamage(a, b, give, { combat: true }); dmg -= give;
          });
          if (dmg > 0 && trample) this.dealDamage(a, def, dmg, { combat: true });
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
    const all = this.permanents();
    for (const c of all) {
      const d = c.def;
      const cur = { p: d.power || 0, t: d.toughness || 0, kw: new Set(), flags: new Set(), types: new Set(d.types.map(t => t.toLowerCase())), cantBeBlockedBy: [], blockableOnlyBy: [], attackOnlyIfDefenderHas: null };
      for (const k of d.keywords) if (typeof k === 'string' ? true : ['Protection', 'Landwalk', 'Rampage'].includes(k.k)) cur.kw.add(k);
      for (const k of c.temp.kw) cur.kw.add(k);
      const cda = d.abilities.find(ab => ab.kind === 'cda');
      if (cda) { const n = this.cdaCount(c, cda); cur.p = n; cur.t = n + (cda.plusT || 0); }
      for (const [k, n] of Object.entries(c.counters)) { const mm = k.match(/^([+-]\d+)\/([+-]\d+)$/); if (mm && n > 0) { cur.p += Number(mm[1]) * n; cur.t += Number(mm[2]) * n; } }
      cur.p += c.temp.p; cur.t += c.temp.t;
      c.cur = cur;
    }
    for (const src of all) for (const ab of src.def.abilities) {
      if (ab.type !== 'static') continue;
      if (ab.condition) {
        if (ab.condition.landType && !this.players[src.controller].battlefield.some(l => isLand(l) && hasSubtype(l, ab.condition.landType))) continue;
        if (ab.condition.selfUntapped && src.tapped) continue;
      }
      for (const c of all) {
        if (!this.inScope(ab.scope, src, c)) continue;
        switch (ab.kind) {
          case 'pt': c.cur.p += ab.p; c.cur.t += ab.t; break;
          case 'keyword': c.cur.kw.add(ab.keyword); break;
          case 'cantAttack': case 'cantBlock': case 'cantAttackOrBlock': case 'unblockable': case 'doesntUntap': case 'mustAttack': case 'blockOnlyFlying': case 'lure': c.cur.flags.add(ab.kind); break;
          case 'cantBeBlockedBy': c.cur.cantBeBlockedBy.push(ab.filter); break;
          case 'cantBlockPowerGE': c.cur.cantBlockPower = Math.min(c.cur.cantBlockPower ?? 99, ab.n); break;
          case 'blockableOnlyBy': c.cur.blockableOnlyBy.push(ab.filter); break;
          case 'attackOnlyIfDefenderHas': c.cur.attackOnlyIfDefenderHas = ab.land; break;
        }
      }
    }
  }
  changeControlQuiet(c, idx) { removeFrom(this.players[c.controller].battlefield, c); c.controller = idx; this.players[idx].battlefield.push(c); }
  inScope(scope, src, c) {
    if (!scope) return false;
    if (scope.who === 'self') return c === src;
    if (scope.who === 'enchanted') return !!src.attachedTo && c === src.attachedTo;
    if (scope.who === 'you' && c.controller !== src.controller) return false;
    if (scope.who === 'opp' && c.controller === src.controller) return false;
    if (scope.other && c === src) return false;
    if (scope.types && !scope.types.some(t => c.cur.types.has(t))) return false;
    if (scope.subtype && !hasSubtype(c, scope.subtype)) return false;
    if (scope.color && !c.def.colors.includes(scope.color)) return false;
    return true;
  }
  cdaCount(c, cda) {
    const pl = this.players[c.controller];
    const w = cda.count;
    if (w === 'cards in hand') return pl.hand.length;
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
        if (c.def.aura) {
          const host = c.attachedTo;
          if (!host || host.zone !== 'battlefield' || (c.def.aura === 'creature' && !isCreature(host)) || this.protectedFrom(host, c)) { this.say(`${c.def.name} is put into the graveyard.`); this.moveTo(c, 'graveyard'); changed = true; continue; }
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
  else if (what === 'land') r.types = ['land'];
  else if (what === 'artifact') r.types = ['artifact'];
  else if (what === 'enchantment') r.types = ['enchantment'];
  else if (what === 'creature you control') { r.types = ['creature']; r.control = 'you'; }
  else if (what === 'creature an opponent controls') { r.types = ['creature']; r.control = 'opp'; }
  else r.types = ['permanent'];
  return r;
}
function matchCardWhat(c, what) {
  const w = (what || 'card').toLowerCase().replace(/ cards?$/, '');
  if (w === 'card' || w === 'any' || w === '') return true;
  const alts = w.split('|').map(s => s.trim());
  return alts.some(a => {
    if (a === 'basic land') return c.def.basic && isLand(c);
    if (a === 'land') return isLand(c);
    if (a === 'creature') return isCreatureDef(c);
    if (a === 'artifact' || a === 'enchantment' || a === 'instant' || a === 'sorcery') return c.def.types.map(t => t.toLowerCase()).includes(a);
    if (a === 'instant or sorcery') return c.def.kind === 'instant' || c.def.kind === 'sorcery';
    const cap1 = a.charAt(0).toUpperCase() + a.slice(1);
    if (['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(cap1)) return c.def.subtypes.includes(cap1);
    return c.def.subtypes.includes(cap1);
  });
}
export function describeTarget(e) {
  const r = e.restrict || {};
  const parts = [];
  if (r.not) parts.push(...r.not.map(n => 'non' + ({ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }[n] || n)));
  if (r.colors) parts.push(...r.colors.map(c => ({ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }[c])));
  if (r.state) parts.push(r.state);
  if (r.subtypes) parts.push(...r.subtypes);
  const what = e.sel === 'any' ? 'any target' : e.sel === 'creature' ? 'creature' : e.sel === 'permanent' ? (r.types || ['permanent']).join(' or ') : e.sel === 'player' ? 'player' : e.sel === 'opponent' ? 'opponent' : e.sel === 'spell' ? (r.spellKind || 'spell') + ' spell' : e.sel === 'card' ? (r.what || 'card') + ' in graveyard' : e.sel;
  let s = `Target ${parts.join(' ')} ${what}`.replace(/\s+/g, ' ');
  if (r.control === 'you') s += ' you control'; if (r.control === 'opp') s += ' an opponent controls';
  if (r.flying === true) s += ' with flying'; if (r.flying === false) s += ' without flying';
  return s;
}
export function costText(c) {
  const parts = [];
  if (c.mana && (c.mana.pips.length || c.mana.generic || c.mana.x)) { if (c.mana.x) parts.push('X'); if (c.mana.generic) parts.push(String(c.mana.generic)); parts.push(...c.mana.pips.map(p => p.join('/'))); }
  const s = parts.join('');
  const extra = [];
  if (c.tap) extra.push('T'); if (c.sacSelf) extra.push('sacrifice'); if (c.sacrifice) extra.push('sacrifice a ' + c.sacrifice); if (c.discard) extra.push('discard ' + c.discard); if (c.life) extra.push(c.life + ' life');
  return [s, ...extra].filter(Boolean).join(', ') || '0';
}
