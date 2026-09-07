// Demo duel engine. Two players, no stack: spells resolve on cast.
// Supports lands, creatures with common keywords, and a small set of spell effects.
// The real project swaps this for a full rules engine behind the same surface.

import { needsTarget } from './cards.js';

let uid = 1;

export function shuffle(a, rng = Math.random) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function has(c, kw) {
  return c.def.keywords?.includes(kw) || c.granted?.includes(kw);
}
export const power = c => Math.max(0, c.def.power + c.pump.p);
export const toughness = c => c.def.toughness + c.pump.t;
export const isCreature = c => c.def.kind === 'creature';
export const isLand = c => c.def.kind === 'land';

export class Duel {
  constructor({ player, ai, rng = Math.random, log = null }) {
    this.rng = rng;
    this.players = [this.makePlayer(player, 0), this.makePlayer(ai, 1)];
    this.turn = 0; this.active = 0; this.phase = 'setup';
    this.attackers = []; this.blocks = {}; // attackerId -> [blockerIds]
    this.log = log || []; this.winner = null; this.listeners = [];
    this.stepsDone = new Set();
  }

  makePlayer(p, idx) {
    const library = shuffle(p.deck.map(def => this.instance(def, idx)), this.rng);
    return { idx, name: p.name, life: p.life, library, hand: [], battlefield: [], graveyard: [], exile: [], landPlayed: false, ai: !!p.ai, portrait: p.portrait || null };
  }
  instance(def, controller) {
    return { id: uid++, def, controller, tapped: false, sick: true, damage: 0, pump: { p: 0, t: 0 }, granted: [], deathtouched: false };
  }

  say(msg) { this.log.push(msg); if (this.log.length > 300) this.log.shift(); }
  emit() { for (const l of this.listeners) l(this); }
  onChange(fn) { this.listeners.push(fn); }

  get activePlayer() { return this.players[this.active]; }
  get defender() { return this.players[1 - this.active]; }
  opponentOf(p) { return this.players[1 - p.idx]; }
  find(id) {
    for (const p of this.players) for (const zone of ['battlefield', 'hand', 'graveyard']) {
      const c = p[zone].find(x => x.id === id); if (c) return { card: c, zone, owner: p };
    }
    return null;
  }

  // ---- lifecycle -------------------------------------------------------------
  start() {
    for (const p of this.players) this.draw(p, 7);
    this.active = this.rng() < 0.5 ? 0 : 1;
    this.turn = 1;
    this.say(`${this.activePlayer.name} plays first.`);
    this.beginTurn(true);
  }
  beginTurn(first = false) {
    const p = this.activePlayer;
    p.landPlayed = false;
    for (const c of p.battlefield) { c.tapped = false; c.sick = false; }
    if (!first) this.draw(p, 1);
    this.phase = 'main1';
    this.say(`Turn ${this.turn}: ${p.name}.`);
    this.checkState();
    this.emit();
  }
  draw(p, n) {
    for (let i = 0; i < n; i++) {
      if (!p.library.length) { this.end(1 - p.idx, `${p.name} has no cards left to draw.`); return; }
      p.hand.push(p.library.pop());
    }
  }
  endTurn() {
    if (this.winner !== null) return;
    const p = this.activePlayer;
    // cleanup
    for (const pl of this.players) for (const c of pl.battlefield) { c.damage = 0; c.pump = { p: 0, t: 0 }; c.granted = []; c.deathtouched = false; }
    while (p.hand.length > 7) {
      const worst = p.hand.slice().sort((a, b) => b.def.cmc - a.def.cmc)[0];
      p.hand.splice(p.hand.indexOf(worst), 1); p.graveyard.push(worst);
      this.say(`${p.name} discards ${worst.def.name}.`);
    }
    this.attackers = []; this.blocks = {};
    this.active = 1 - this.active;
    if (this.active === 0) this.turn++;
    this.beginTurn();
  }
  end(winnerIdx, why) {
    if (this.winner !== null) return;
    this.winner = winnerIdx; this.phase = 'over';
    this.say(`${why} ${this.players[winnerIdx].name} wins!`);
    this.emit();
  }
  checkState() {
    if (this.winner !== null) return;
    for (const p of this.players) {
      for (const c of p.battlefield.slice()) {
        if (isCreature(c) && (c.damage >= toughness(c) || toughness(c) <= 0 || (c.deathtouched && c.damage > 0))) this.toGraveyard(c, 'dies');
      }
    }
    for (const p of this.players) if (p.life <= 0) return this.end(1 - p.idx, `${p.name} is reduced to ${p.life} life.`);
  }
  toGraveyard(c, verb = 'is destroyed') {
    const p = this.players[c.controller];
    p.battlefield = p.battlefield.filter(x => x !== c);
    c.tapped = false; c.damage = 0; c.pump = { p: 0, t: 0 }; c.granted = []; c.sick = true;
    p.graveyard.push(c);
    this.say(`${c.def.name} ${verb}.`);
    this.attackers = this.attackers.filter(id => id !== c.id);
    delete this.blocks[c.id];
    for (const k of Object.keys(this.blocks)) this.blocks[k] = this.blocks[k].filter(id => id !== c.id);
  }

  // ---- mana --------------------------------------------------------------------
  manaSources(p) {
    return p.battlefield.filter(c => !c.tapped && c.def.produces?.length && (isLand(c) || !c.sick));
  }
  // Returns list of sources to tap, or null.
  planPayment(p, cost) {
    const sources = this.manaSources(p);
    const pips = cost.pips.slice().sort((a, b) => a.length - b.length);
    if (sources.length < pips.length + cost.generic) return null;
    const used = new Array(sources.length).fill(false);
    const assign = (i) => {
      if (i === pips.length) return true;
      for (let s = 0; s < sources.length; s++) {
        if (used[s]) continue;
        if (pips[i].some(col => sources[s].def.produces.includes(col))) {
          used[s] = true; if (assign(i + 1)) return true; used[s] = false;
        }
      }
      return false;
    };
    if (!assign(0)) return null;
    // generic: prefer sources with fewest colours (keep flexible ones)
    const rest = sources.map((s, i) => ({ s, i })).filter(x => !used[x.i])
      .sort((a, b) => a.s.def.produces.length - b.s.def.produces.length || (isLand(b.s) ? 1 : 0) - (isLand(a.s) ? 1 : 0));
    if (rest.length < cost.generic) return null;
    for (let g = 0; g < cost.generic; g++) used[rest[g].i] = true;
    return sources.filter((s, i) => used[i]);
  }
  canPay(p, cost) { return !!this.planPayment(p, cost); }

  // ---- timing ------------------------------------------------------------------
  canAct(p) { return this.winner === null && p.idx === this.active; }
  canCast(p, card) {
    if (!this.canAct(p) || !p.hand.includes(card)) return false;
    const d = card.def;
    if (d.kind === 'unsupported') return false;
    if (d.kind === 'land') return ['main1', 'main2'].includes(this.phase) && !p.landPlayed;
    const sorcerySpeed = ['main1', 'main2'].includes(this.phase) && this.attackers.length === 0;
    if (d.kind === 'creature' || d.timing === 'sorcery') { if (!sorcerySpeed) return false; }
    else if (!['main1', 'main2', 'attack', 'block', 'damage'].includes(this.phase)) return false;
    if (!this.canPay(p, d.cost)) return false;
    if (d.kind === 'spell') {
      for (const e of d.effects) if (needsTarget(e) && !this.legalTargets(p, e).length) return false;
    }
    return true;
  }

  // ---- targets -----------------------------------------------------------------
  legalTargets(p, e) {
    const out = [];
    const creatures = (owner) => owner.battlefield.filter(isCreature).filter(c => this.matchesRestrict(c, e.restrict));
    if (e.sel === 'any' || e.sel === 'creature') for (const pl of this.players) for (const c of creatures(pl)) out.push({ type: 'creature', id: c.id });
    if (e.sel === 'any' || e.sel === 'player') for (const pl of this.players) out.push({ type: 'player', idx: pl.idx });
    if (e.sel === 'opponent') out.push({ type: 'player', idx: 1 - p.idx });
    return out;
  }
  matchesRestrict(c, r) {
    if (!r) return true;
    const colorMap = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
    for (const n of r.not || []) {
      if (n === 'artifact') { if (/artifact/i.test(c.def.typeLine)) return false; }
      else if (c.def.colors.includes(colorMap[n])) return false;
    }
    if (r.state === 'attacking' && !this.attackers.includes(c.id)) return false;
    if (r.state === 'blocking' && !Object.values(this.blocks).some(b => b.includes(c.id))) return false;
    if (r.state === 'tapped' && !c.tapped) return false;
    if (r.state === 'untapped' && c.tapped) return false;
    return true;
  }
  targetsNeeded(card) {
    if (card.def.kind !== 'spell') return [];
    return card.def.effects.map((e, i) => needsTarget(e) ? i : -1).filter(i => i >= 0);
  }

  // ---- actions -----------------------------------------------------------------
  // targets: array aligned with targetsNeeded(card): {type:'creature',id} | {type:'player',idx}
  cast(p, card, targets = []) {
    if (!this.canCast(p, card)) return false;
    const d = card.def;
    if (d.kind === 'land') {
      p.hand.splice(p.hand.indexOf(card), 1);
      card.tapped = !!d.entersTapped; card.sick = false;
      p.battlefield.push(card); p.landPlayed = true;
      this.say(`${p.name} plays ${d.name}.`);
      this.emit(); return true;
    }
    const pay = this.planPayment(p, d.cost);
    if (!pay) return false;
    const need = this.targetsNeeded(card);
    for (let i = 0; i < need.length; i++) {
      const legal = this.legalTargets(p, d.effects[need[i]]);
      const t = targets[i];
      if (!t || !legal.some(l => l.type === t.type && (l.id === t.id) && (l.idx === t.idx))) return false;
    }
    for (const s of pay) s.tapped = true;
    p.hand.splice(p.hand.indexOf(card), 1);
    if (d.kind === 'creature') {
      card.sick = true; card.tapped = false; p.battlefield.push(card);
      this.say(`${p.name} casts ${d.name}.`);
    } else {
      this.say(`${p.name} casts ${d.name}.`);
      let ti = 0;
      for (let i = 0; i < d.effects.length; i++) {
        const e = d.effects[i];
        const t = needsTarget(e) ? targets[ti++] : null;
        this.resolve(p, e, t);
      }
      p.graveyard.push(card);
    }
    this.checkState();
    this.emit(); return true;
  }

  resolve(p, e, t) {
    const opp = this.opponentOf(p);
    const creatureOf = t => t && t.type === 'creature' ? this.find(t.id)?.card : null;
    const damage = (target, n) => {
      if (target.type === 'player') { const pl = this.players[target.idx]; pl.life -= n; this.say(`${n} damage to ${pl.name}.`); }
      else { const c = creatureOf(target); if (c && this.find(c.id)?.zone === 'battlefield') { c.damage += n; this.say(`${n} damage to ${c.def.name}.`); } }
    };
    switch (e.type) {
      case 'damage':
        if (e.sel === 'eachCreature') for (const pl of this.players) for (const c of pl.battlefield.filter(isCreature)) c.damage += e.amount;
        else if (e.sel === 'eachPlayer') for (const pl of this.players) pl.life -= e.amount;
        else if (e.sel === 'opponent' && e.auto) damage({ type: 'player', idx: opp.idx }, e.amount);
        else damage(t, e.amount);
        break;
      case 'destroy': { const c = creatureOf(t); if (c) this.toGraveyard(c); break; }
      case 'exile': { const c = creatureOf(t); if (c) { const pl = this.players[c.controller]; pl.battlefield = pl.battlefield.filter(x => x !== c); pl.exile.push(c); this.say(`${c.def.name} is exiled.`); } break; }
      case 'bounce': { const c = creatureOf(t); if (c) { const pl = this.players[c.controller]; pl.battlefield = pl.battlefield.filter(x => x !== c); c.tapped = false; c.damage = 0; c.pump = { p: 0, t: 0 }; c.granted = []; pl.hand.push(c); this.say(`${c.def.name} returns to hand.`); } break; }
      case 'pump': { const c = creatureOf(t); if (c) { c.pump.p += e.p; c.pump.t += e.t; this.say(`${c.def.name} gets ${e.p >= 0 ? '+' : ''}${e.p}/${e.t >= 0 ? '+' : ''}${e.t}.`); } break; }
      case 'grant': { const c = creatureOf(t); if (c) { c.granted.push(e.keyword); this.say(`${c.def.name} gains ${e.keyword.toLowerCase()}.`); } break; }
      case 'draw': this.draw(p, e.amount); this.say(`${p.name} draws ${e.amount}.`); break;
      case 'gain': p.life += e.amount; this.say(`${p.name} gains ${e.amount} life.`); break;
      case 'regrowth': {
        const best = p.graveyard.filter(isCreature).sort((a, b) => b.def.cmc - a.def.cmc)[0];
        if (best) { p.graveyard.splice(p.graveyard.indexOf(best), 1); p.hand.push(best); this.say(`${best.def.name} returns to ${p.name}'s hand.`); }
        break;
      }
      case 'destroyLand': {
        const land = opp.battlefield.filter(isLand).sort((a, b) => b.def.produces.length - a.def.produces.length)[0];
        if (land) this.toGraveyard(land);
        break;
      }
    }
  }

  // ---- combat ------------------------------------------------------------------
  canAttack(c) { return isCreature(c) && !c.tapped && (!c.sick || has(c, 'Haste')) && !has(c, 'Defender'); }
  canBlock(blocker, attacker) {
    if (!isCreature(blocker) || blocker.tapped) return false;
    if (has(attacker, 'Flying') && !(has(blocker, 'Flying') || has(blocker, 'Reach'))) return false;
    return true;
  }
  goToCombat(p) {
    if (!this.canAct(p) || this.phase !== 'main1') return false;
    this.phase = 'attack'; this.attackers = []; this.emit(); return true;
  }
  declareAttackers(p, ids) {
    if (!this.canAct(p) || this.phase !== 'attack') return false;
    const legal = ids.filter(id => { const c = p.battlefield.find(x => x.id === id); return c && this.canAttack(c); });
    this.attackers = legal;
    for (const id of legal) { const c = p.battlefield.find(x => x.id === id); if (!has(c, 'Vigilance')) c.tapped = true; }
    if (!legal.length) { this.phase = 'main2'; this.say(`${p.name} does not attack.`); this.emit(); return true; }
    this.say(`${p.name} attacks with ${legal.map(id => p.battlefield.find(x => x.id === id).def.name).join(', ')}.`);
    this.blocks = {}; this.phase = 'block'; this.emit(); return true;
  }
  validBlocks(blocks) {
    const def = this.defender;
    const used = new Set();
    for (const [aid, bids] of Object.entries(blocks)) {
      const a = this.activePlayer.battlefield.find(x => x.id === Number(aid));
      if (!a || !this.attackers.includes(a.id)) return false;
      for (const bid of bids) {
        const b = def.battlefield.find(x => x.id === bid);
        if (!b || used.has(bid) || !this.canBlock(b, a)) return false;
        used.add(bid);
      }
      if (has(a, 'Menace') && bids.length === 1) return false;
    }
    return true;
  }
  declareBlockers(blocks) {
    if (this.phase !== 'block') return false;
    if (!this.validBlocks(blocks)) return false;
    this.blocks = {};
    for (const [aid, bids] of Object.entries(blocks)) if (bids.length) this.blocks[Number(aid)] = bids.slice();
    const names = Object.entries(this.blocks).map(([aid, bids]) => {
      const a = this.find(Number(aid)).card; return `${bids.map(id => this.find(id).card.def.name).join(' + ')} blocks ${a.def.name}`;
    });
    this.say(names.length ? names.join('; ') + '.' : `${this.defender.name} does not block.`);
    this.phase = 'damage';
    this.resolveCombat();
    return true;
  }
  resolveCombat() {
    const atk = this.activePlayer, def = this.defender;
    const first = c => has(c, 'First strike') || has(c, 'Double strike');
    const anyFirst = this.attackers.some(id => { const c = this.find(id)?.card; return c && first(c); })
      || Object.values(this.blocks).flat().some(id => { const c = this.find(id)?.card; return c && first(c); });
    const step = (which) => {
      for (const aid of this.attackers.slice()) {
        const a = atk.battlefield.find(x => x.id === aid); if (!a) continue;
        const aDeals = which === 'first' ? first(a) : (!first(a) || has(a, 'Double strike'));
        const blockers = (this.blocks[aid] || []).map(id => def.battlefield.find(x => x.id === id)).filter(Boolean);
        const wasBlocked = (this.blocks[aid] || []).length > 0;
        if (aDeals) {
          let dmg = power(a);
          if (!wasBlocked) { def.life -= dmg; if (has(a, 'Lifelink')) atk.life += dmg; if (dmg) this.say(`${a.def.name} hits ${def.name} for ${dmg}.`); }
          else {
            const trample = has(a, 'Trample');
            blockers.forEach((b, i) => {
              if (dmg <= 0) return;
              const lethal = has(a, 'Deathtouch') ? 1 : Math.max(0, toughness(b) - b.damage);
              let give = Math.min(dmg, lethal);
              if (i === blockers.length - 1 && !trample) give = dmg; // dump the rest on the last blocker
              b.damage += give; if (has(a, 'Deathtouch') && give > 0) b.deathtouched = true;
              dmg -= give;
            });
            if (dmg > 0 && trample) { def.life -= dmg; this.say(`${a.def.name} tramples over for ${dmg}.`); }
            if (has(a, 'Lifelink')) atk.life += power(a);
          }
        }
        for (const b of blockers) {
          const bDeals = which === 'first' ? first(b) : (!first(b) || has(b, 'Double strike'));
          if (!bDeals) continue;
          a.damage += power(b); if (has(b, 'Deathtouch') && power(b) > 0) a.deathtouched = true;
          if (has(b, 'Lifelink')) def.life += power(b);
        }
      }
      this.checkState();
    };
    if (anyFirst) step('first');
    if (this.winner === null) step('regular');
    this.attackers = []; this.blocks = {};
    if (this.winner === null) { this.phase = 'main2'; this.emit(); }
  }
  skipCombat(p) {
    if (!this.canAct(p) || !['main1', 'attack'].includes(this.phase)) return false;
    this.phase = 'main2'; this.attackers = []; this.emit(); return true;
  }
  finishTurn(p) {
    if (!this.canAct(p) || !['main1', 'main2', 'attack'].includes(this.phase)) return false;
    this.endTurn(); return true;
  }
}
