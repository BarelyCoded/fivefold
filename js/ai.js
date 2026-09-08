// Opponent AI for the rules core: priority decisions and choice answers. Greedy, no lookahead.
import { has, power, toughness, isCreature, isLand, isType, has0, isCreatureDef } from './engine.js';
import { needsTarget } from './cards.js';

const value = c => power(c) + toughness(c) + (has(c, 'Flying') ? 1.5 : 0) + (has(c, 'First strike') ? 1 : 0) + (has(c, 'Trample') ? 0.5 : 0) + c.def.cmc * 0.25 + (c.def.abilities.length ? 0.75 : 0);
const cardValue = c => (isCreatureDef(c) ? c.def.power + c.def.toughness + 1 : 2) + c.def.cmc * 0.3;

// ---- targeting -----------------------------------------------------------------------
const HOSTILE = new Set(['damage', 'damageEqualPower', 'fight', 'destroy', 'exile', 'bounce', 'tap', 'freeze', 'control', 'flag', 'counter', 'lose', 'discard', 'mill', 'sacrifice', 'poison']);
const FRIENDLY = new Set(['pump', 'grant', 'regenerate', 'untap', 'gain', 'draw', 'fromGraveyard']);

function pickTarget(duel, p, e, options, x = 0) {
  const opp = duel.opponentOf(p);
  const perms = options.filter(o => o.type === 'perm').map(o => ({ o, c: duel.card(o.id) })).filter(t => t.c);
  const players = options.filter(o => o.type === 'player');
  const oppPerms = perms.filter(t => t.c.controller === opp.idx), mine = perms.filter(t => t.c.controller === p.idx);
  const best = list => list.sort((a, b) => value(b.c) - value(a.c))[0];
  if (e.type === 'damage' || e.type === 'damageEqualPower') {
    const n = e.type === 'damage' ? (e.amount === 'X' ? x : e.amount) : 0;
    const face = players.find(o => o.idx === opp.idx);
    if (face && n >= opp.life) return face;
    const kill = oppPerms.filter(t => isCreature(t.c) && toughness(t.c) - t.c.damage <= (n || power(duel.card(options.src) || t.c))).sort((a, b) => value(b.c) - value(a.c))[0];
    if (kill && value(kill.c) >= 2.5) return kill.o;
    if (face && (opp.life <= 10 || !oppPerms.length)) return face;
    return kill ? kill.o : face || null;
  }
  if (e.type === 'counters' && e.kind === '-1/-1') { const b = best(oppPerms.filter(t => isCreature(t.c))); return b ? b.o : null; }
  if (e.type === 'counters' && e.kind === '+1/+1') { const b = best(mine.filter(t => isCreature(t.c))); return b ? b.o : null; }
  if (HOSTILE.has(e.type)) {
    if (e.type === 'counter') { const s = options.find(o => o.type === 'spell' && duel.stack.find(i => i.id === o.id)?.controller !== p.idx); return s || null; }
    if (['lose', 'discard', 'mill', 'sacrifice', 'poison'].includes(e.type)) return players.find(o => o.idx === opp.idx) || null;
    const b = best(oppPerms.filter(t => isCreature(t.c) || !oppPerms.some(x => isCreature(x.c))));
    if (b && (value(b.c) >= 3 || e.type === 'tap' || e.type === 'freeze' || e.type === 'flag' || !isCreature(b.c))) return b.o;
    return null;
  }
  if (FRIENDLY.has(e.type)) {
    if (e.type === 'gain' || e.type === 'draw') return players.find(o => o.idx === p.idx) || null;
    if (e.type === 'fromGraveyard') { const cards = options.filter(o => o.type === 'card').map(o => ({ o, c: duel.card(o.id) })).filter(t => t.c && t.c.owner === p.idx); const b = cards.sort((a, b) => cardValue(b.c) - cardValue(a.c))[0]; return b ? b.o : null; }
    const b = best(mine.filter(t => isCreature(t.c)));
    return b ? b.o : null;
  }
  return options[0] || null;
}

function buildCastOpts(duel, p, card) {
  const info = duel.castOptions(p, card);
  const opts = {};
  const d = card.def;
  if (info.pitch && !duel.canPay(p, d.cost)) { const pc = p.hand.find(c => c !== card && c.def.colors.includes(info.pitch) && cardValue(c) < 6); if (pc) opts.pitch = pc.id; }
  if (info.x) {
    const spend = maxX(duel, p, d.cost);
    if (spend <= 0) return null;
    opts.x = spend;
  }
  if (info.kicker && duel.canCast(p, card, { ...opts, kicked: true })) opts.kicked = true;
  if (info.modes) { const m = info.modes.options[0]; if (!m) return null; opts.modes = [m.index]; }
  if (info.additional) {
    if (info.additional.sacrifice) { const s = p.battlefield.filter(c => isType(c, info.additional.sacrifice)).sort((a, b) => value(a) - value(b))[0]; if (!s || value(s) > 4) return null; opts.sacrifice = s.id; }
    if (info.additional.discard) { const cs = p.hand.filter(c => c !== card).sort((a, b) => cardValue(a) - cardValue(b)).slice(0, info.additional.discard); opts.discard = cs.map(c => c.id); }
  }
  const specs = duel.targetSpecs(p, card, opts);
  opts.targets = [];
  for (const s of specs) {
    const legal = duel.legalTargets(p, s.effect, card);
    let t;
    if (d.aura) { // aura: buff on own creature, curse on the opponent's
      const hostile = d.abilities.some(ab => ab.kind === 'pt' ? ab.p < 0 : ['cantAttack', 'cantBlock', 'cantAttackOrBlock', 'doesntUntap', 'control'].includes(ab.kind));
      t = pickTarget(duel, p, { type: hostile ? 'destroy' : 'pump', sel: 'creature' }, legal);
    } else t = pickTarget(duel, p, s.effect, legal, opts.x || 0);
    if (!t) return null;
    opts.targets.push(t);
  }
  return opts;
}
function maxX(duel, p, cost) {
  for (let x = 12; x >= 0; x--) if (duel.canPay(p, cost, x)) return x;
  return 0;
}
function chooseLand(p) {
  const lands = p.hand.filter(c => c.def.kind === 'land');
  if (!lands.length) return null;
  const need = {}, have = {};
  for (const c of p.hand) if (c.def.kind !== 'land') for (const pip of c.def.cost.pips) for (const col of pip) need[col] = (need[col] || 0) + 1 / pip.length;
  for (const c of p.battlefield) for (const col of c.def.produces || []) have[col] = (have[col] || 0) + 1;
  const score = l => l.def.produces.reduce((s, col) => s + (need[col] || 0) / (1 + (have[col] || 0)), 0) + l.def.produces.length * 0.1 - (l.def.entersTapped ? 0.4 : 0);
  return lands.sort((a, b) => score(b) - score(a))[0];
}

// Is this spell/ability worth casting right now (sorcery timing)?
function worth(duel, p, card, opts) {
  const d = card.def, opp = duel.opponentOf(p);
  if (d.kind === 'creature' || d.kind === 'artifact' || d.kind === 'enchantment') return true;
  const effs = duel.spellEffects(d, opts);
  const e = effs[0]; if (!e) return false;
  switch (e.type) {
    case 'draw': return p.hand.length <= 5;
    case 'gain': return p.life <= 10;
    case 'tutor': return true;
    case 'addMana': return false;
    case 'fog': case 'pump': case 'grant': case 'regenerate': case 'counter': case 'flag': return false; // instant-speed or combat use only
    case 'destroyAll': { const mine = p.battlefield.filter(c => duel.matchesRestrict(c, e.restrict, p)).reduce((s, c) => s + value(c), 0); const theirs = opp.battlefield.filter(c => duel.matchesRestrict(c, e.restrict, p)).reduce((s, c) => s + value(c), 0); return theirs >= mine + 4; }
    case 'discard': return opp.hand.length >= 2;
    case 'mill': return false;
    case 'token': return true;
    case 'extraTurn': return true;
    case 'sacrifice': return opp.battlefield.some(isCreature);
    case 'damage': if (e.sel === 'each') { const mine = p.battlefield.filter(isCreature).filter(c => toughness(c) <= (e.amount === 'X' ? opts.x : e.amount)).length; const theirs = opp.battlefield.filter(isCreature).filter(c => toughness(c) <= (e.amount === 'X' ? opts.x : e.amount)).length; return theirs > mine; } return true;
    default: return true;
  }
}

function mainPhaseAction(duel, p) {
  const land = chooseLand(p);
  if (land && duel.canCast(p, land)) return { type: 'cast', card: land };
  const cands = [];
  for (const c of [...p.hand, ...p.graveyard]) {
    if (c.def.kind === 'land' || c.def.kind === 'unsupported') continue;
    if (c.zone === 'graveyard' && !c.def.keywords.some(k => k.k === 'Flashback')) continue;
    if (!duel.canCast(p, c)) continue;
    const opts = buildCastOpts(duel, p, c); if (!opts) continue;
    if (!duel.canCast(p, c, opts)) continue;
    if (!worth(duel, p, c, opts)) continue;
    let score = c.def.cmc + (c.def.kind === 'creature' ? 2 : 0) + (opts.kicked ? 1 : 0) + (opts.x || 0);
    if (c.def.aura) score += 1;
    cands.push({ c, opts, score });
  }
  cands.sort((a, b) => b.score - a.score);
  if (cands.length) return { type: 'cast', card: cands[0].c, opts: cands[0].opts };
  // sorcery-speed abilities: equip, tutor-ish, token makers
  for (const c of p.battlefield) c.def.abilities.forEach((ab, i) => { if (cands.length) return; if (ab.type !== 'activated') return; if (!['token', 'tutor', 'draw', 'counters'].includes(ab.effects[0]?.type)) return; if (ab.cost.sacSelf || ab.cost.sacrifice) return; if (!duel.canActivate(p, c, i)) return; const o = abilityOpts(duel, p, c, i); if (o) cands.push({ act: { type: 'activate', card: c, index: i, opts: o } }); });
  if (cands.length) return cands[0].act;
  // cycling dead cards
  for (const c of p.hand) if (c.def.keywords.some(k => k.k === 'Cycling') && c.def.kind === 'land' && p.battlefield.filter(isLand).length >= 6 && duel.canCast(p, c, { cycling: true })) return { type: 'cast', card: c, opts: { cycling: true } };
  return null;
}
function abilityOpts(duel, p, c, i) {
  const ab = c.def.abilities[i]; const info = duel.activateOptions(p, c, i);
  const opts = { targets: [] };
  if (info.x) { opts.x = maxX(duel, p, ab.cost.mana); if (!opts.x) return null; }
  if (info.sacrifice) { const s = info.sacrifice.map(id => duel.card(id)).sort((a, b) => value(a) - value(b))[0]; if (!s) return null; opts.sacrifice = s.id; }
  if (info.discard) { opts.discard = p.hand.slice().sort((a, b) => cardValue(a) - cardValue(b)).slice(0, ab.cost.discard).map(c => c.id); }
  for (const t of info.targets) { const pick = pickTarget(duel, p, t.effect, t.options, opts.x || 0); if (!pick) return null; opts.targets.push(pick); }
  return opts;
}

function instantAction(duel, p) {
  const opp = duel.opponentOf(p);
  const top = duel.stack[duel.stack.length - 1];
  // Respond: counter or save a creature
  if (top && top.controller !== p.idx) {
    for (const c of p.hand) {
      const e = c.def.spell?.effects[0];
      if (e?.type === 'counter' && duel.canCast(p, c)) {
        const threat = top.kind === 'spell' ? (top.card.def.cmc >= 3 || isHostileToMe(duel, p, top)) : isHostileToMe(duel, p, top);
        if (threat) { const opts = buildCastOpts(duel, p, c); if (opts && duel.canCast(p, c, opts)) return { type: 'cast', card: c, opts }; }
      }
    }
    // regenerate a creature targeted by destruction
    const victims = (top.targets || []).filter(t => t.type === 'perm').map(t => duel.card(t.id)).filter(c => c && c.controller === p.idx);
    if (victims.length && (top.effects || []).some(e => e.type === 'destroy' || e.type === 'damage')) {
      for (const v of victims) { const i = v.def.abilities.findIndex(ab => ab.type === 'activated' && ab.effects[0]?.type === 'regenerate'); if (i >= 0 && v.regen === 0 && duel.canActivate(p, v, i)) return { type: 'activate', card: v, index: i, opts: { targets: [] } }; }
      for (const c of p.hand) { const e = c.def.spell?.effects[0]; if (e?.type === 'pump' && e.t > 0 && duel.canCast(p, c)) { const dmg = top.effects.find(x => x.type === 'damage'); if (dmg && victims.some(v => toughness(v) - v.damage <= dmg.amount && toughness(v) - v.damage + e.t > dmg.amount)) { const v = victims[0]; return { type: 'cast', card: c, opts: { targets: [{ type: 'perm', id: v.id }] } }; } } }
    }
    return null;
  }
  if (top) return null;
  const step = duel.step;
  const inCombat = step === 'blockers' && duel.attackers.length;
  if (inCombat) {
    // Pump to win a fight
    const fights = [];
    for (const [aid, bids] of Object.entries(duel.blocks)) {
      const a = duel.card(Number(aid)); if (!a) continue;
      for (const bid of bids) { const b = duel.card(bid); if (b) fights.push({ a, b }); }
    }
    for (const c of p.hand) {
      const e = c.def.spell?.effects[0]; if (!e || (e.type !== 'pump' && e.type !== 'grant') || !duel.canCast(p, c)) continue;
      for (const f of fights) {
        const mine = f.a.controller === p.idx ? f.a : f.b.controller === p.idx ? f.b : null; if (!mine) continue;
        const other = mine === f.a ? f.b : f.a;
        const dp = e.type === 'pump' ? e.p : 0, dt = e.type === 'pump' ? e.t : 0;
        const winsNow = power(mine) >= toughness(other) - other.damage && toughness(mine) - mine.damage > power(other);
        const winsAfter = power(mine) + dp >= toughness(other) - other.damage && toughness(mine) + dt - mine.damage > power(other);
        if (!winsNow && winsAfter && duel.legalTargets(p, e, c).some(t => t.id === mine.id)) return { type: 'cast', card: c, opts: { targets: [{ type: 'perm', id: mine.id }] } };
      }
    }
    // Regenerate a blocked/blocking creature about to die
    for (const f of fights) { const mine = f.a.controller === p.idx ? f.a : f.b.controller === p.idx ? f.b : null; if (!mine) continue; const other = mine === f.a ? f.b : f.a; if (power(other) >= toughness(mine) - mine.damage && mine.regen === 0) { const i = mine.def.abilities.findIndex(ab => ab.type === 'activated' && ab.effects[0]?.type === 'regenerate'); if (i >= 0 && duel.canActivate(p, mine, i)) return { type: 'activate', card: mine, index: i, opts: { targets: [] } }; } }
    // Fog when lethal
    if (duel.active !== p.idx) { const incoming = duel.attackers.map(id => duel.card(id)).filter(Boolean).filter(a => !(duel.blocks[a.id] || []).length).reduce((s, a) => s + power(a), 0); if (incoming >= p.life) for (const c of p.hand) if (c.def.spell?.effects[0]?.type === 'fog' && duel.canCast(p, c)) return { type: 'cast', card: c, opts: { targets: [] } }; }
  }
  // Opponent's end step or their attackers step: use tap abilities and instant burn
  if (duel.active !== p.idx && (step === 'end' || step === 'attackers' || step === 'blockers' || step === 'beginCombat')) {
    for (const c of p.battlefield) c.def.abilities.forEach((ab, i) => { if (ab.type !== 'activated' || ab.cost.sacSelf || ab.cost.sacrifice || ab.cost.life) return; const e = ab.effects[0]; if (!e || !['damage', 'tap', 'destroy', 'freeze'].includes(e.type)) return; if (e.type === 'tap' && step !== 'beginCombat' && step !== 'attackers') return; if (!duel.canActivate(p, c, i)) return; const o = abilityOpts(duel, p, c, i); if (o && !found) found = { type: 'activate', card: c, index: i, opts: o }; });
    var found; if (found) return found;
    if (step === 'end') for (const c of p.hand) { const e = c.def.spell?.effects[0]; if (!e || c.def.kind !== 'instant' || !['damage', 'destroy', 'draw', 'bounce'].includes(e.type) || !duel.canCast(p, c)) continue; const opts = buildCastOpts(duel, p, c); if (!opts || !duel.canCast(p, c, opts)) continue; if (e.type === 'draw' && p.hand.length > 5) continue; if (e.type === 'damage' && opts.targets[0]?.type === 'player' && opp.life > (e.amount === 'X' ? opts.x : e.amount) && opp.life > 8) continue; return { type: 'cast', card: c, opts }; }
  }
  return null;
}
function isHostileToMe(duel, p, item) {
  return (item.targets || []).some(t => (t.type === 'perm' && duel.card(t.id)?.controller === p.idx) || (t.type === 'player' && t.idx === p.idx)) || (item.effects || []).some(e => e.type === 'destroyAll' || (e.sel === 'each' && e.type === 'damage'));
}

function chooseAttackers(duel, p) {
  const opp = duel.opponentOf(p);
  const mine = p.battlefield.filter(c => duel.canAttack(c));
  const blockers = opp.battlefield.filter(c => isCreature(c) && !c.tapped);
  const total = mine.reduce((s, c) => s + power(c), 0);
  if (mine.length && total >= opp.life && blockers.length < mine.length) return mine.map(c => c.id);
  const out = [];
  for (const a of mine) {
    if (a.cur.flags.has('mustAttack')) { out.push(a.id); continue; }
    const legal = blockers.filter(b => duel.canBlock(b, a));
    const killedBy = legal.filter(b => (power(b) >= toughness(a) || has(b, 'Deathtouch')) && !(has(a, 'First strike') && !has(b, 'First strike') && power(a) >= toughness(b)));
    const survivesAndKills = killedBy.filter(b => toughness(b) > power(a) || (has(b, 'First strike') && !has(a, 'First strike') && power(b) >= toughness(a)));
    if (!legal.length || !killedBy.length) out.push(a.id);
    else if (!survivesAndKills.length && value(a) <= 3.5) out.push(a.id);
    else if (opp.life <= power(a) * 2 && killedBy.length <= 1) out.push(a.id);
  }
  return out;
}
function chooseBlocks(duel, p) {
  const atk = duel.activePlayer;
  const attackers = duel.attackers.map(id => atk.battlefield.find(c => c.id === id)).filter(Boolean).sort((a, b) => power(b) - power(a));
  const free = p.battlefield.filter(c => isCreature(c) && !c.tapped);
  const blocks = {};
  const incoming = attackers.reduce((s, a) => s + power(a), 0);
  let unblocked = incoming;
  // Lure: must block that creature with everything able
  const lure = attackers.find(a => a.cur.flags.has('lure'));
  if (lure) { const bs = free.filter(b => duel.canBlock(b, lure)); if (bs.length) { blocks[lure.id] = bs.map(b => b.id); for (const b of bs) free.splice(free.indexOf(b), 1); } }
  for (const a of attackers) {
    if (blocks[a.id]) continue;
    const cands = free.filter(b => duel.canBlock(b, a));
    if (!cands.length) continue;
    const kills = b => power(b) >= toughness(a) - a.damage || has(b, 'Deathtouch');
    const dies = b => (power(a) >= toughness(b) || has(a, 'Deathtouch')) && !(has(b, 'First strike') && !has(a, 'First strike') && kills(b));
    let pick = cands.filter(b => kills(b) && !dies(b)).sort((x, y) => value(x) - value(y))[0];
    if (!pick) pick = cands.filter(b => kills(b) && dies(b) && value(a) >= value(b)).sort((x, y) => value(x) - value(y))[0];
    if (!pick) pick = cands.filter(b => !dies(b)).sort((x, y) => value(x) - value(y))[0];
    if (!pick && unblocked >= p.life) pick = cands.sort((x, y) => value(x) - value(y))[0];
    if (pick) {
      if (has(a, 'Menace')) { const second = cands.find(b => b !== pick); if (!second) continue; blocks[a.id] = [pick.id, second.id]; free.splice(free.indexOf(second), 1); }
      else blocks[a.id] = [pick.id];
      free.splice(free.indexOf(pick), 1); unblocked -= power(a);
    }
  }
  return blocks;
}

export const aiHooks = {
  decide(duel, p) {
    if (duel.stack.length) return instantAction(duel, p) || { type: 'pass' };
    if (duel.active === p.idx && (duel.step === 'main1' || duel.step === 'main2')) {
      const act = mainPhaseAction(duel, p);
      if (act) return act;
    }
    return instantAction(duel, p) || { type: 'pass' };
  },
  choose(duel, req) {
    const p = duel.players[req.player];
    switch (req.kind) {
      case 'attackers': return chooseAttackers(duel, p);
      case 'blockers': return chooseBlocks(duel, p);
      case 'yesno': {
        if (req.value === 'upkeep') { const c = duel.card(req.card); return c ? value(c) >= 3.5 : false; }
        if (req.value === 'unlessPay') { const c = duel.card(req.card); return c ? value(c) >= 3 || !isCreature(c) : true; }
        return true;
      }
      case 'color': { const need = {}; for (const c of p.hand) for (const pip of c.def.cost.pips) for (const col of pip) need[col] = (need[col] || 0) + 1; return Object.entries(need).sort((a, b) => b[1] - a[1])[0]?.[0] || 'G'; }
      case 'target': return pickTarget(duel, p, req.effect, req.options);
      case 'choose': {
        const cards = req.options.map(o => ({ o, c: duel.card(o.id) })).filter(t => t.c);
        const text = req.text.toLowerCase();
        if (text.startsWith('discard')) { const lands = p.battlefield.filter(isLand).length; const sorted = cards.sort((a, b) => ((isLand(a.c) && lands >= 5) ? -1 : 0) - ((isLand(b.c) && lands >= 5) ? -1 : 0) || cardValue(a.c) - cardValue(b.c)); return sorted.slice(0, req.min).map(t => t.o.id); }
        if (text.startsWith('sacrifice')) return cards.sort((a, b) => value(a.c) - value(b.c)).slice(0, req.min).map(t => t.o.id);
        if (text.startsWith('search')) { const lands = p.battlefield.filter(isLand).length; const pick = cards.sort((a, b) => ((isLand(a.c) && lands < 5) ? -1 : 0) - ((isLand(b.c) && lands < 5) ? -1 : 0) || cardValue(b.c) - cardValue(a.c))[0]; return pick ? [pick.o.id] : []; }
        if (text.startsWith('scry')) { const lands = p.battlefield.filter(isLand).length; return cards.filter(t => isLand(t.c) && lands >= 5).map(t => t.o.id); }
        return cards.slice(0, Math.max(req.min, 0)).map(t => t.o.id);
      }
    }
    return null;
  },
};
