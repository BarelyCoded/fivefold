// Opponent AI for the demo engine. Greedy heuristics, no lookahead.
import { has, power, toughness, isCreature, isLand } from './engine.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const value = c => power(c) + toughness(c) + (has(c, 'Flying') ? 1.5 : 0) + (has(c, 'First strike') ? 1 : 0) + c.def.cmc * 0.25;

function chooseLand(p) {
  const lands = p.hand.filter(c => c.def.kind === 'land');
  if (!lands.length) return null;
  const need = {}, have = {};
  for (const c of p.hand) if (c.def.kind !== 'land') for (const pip of c.def.cost.pips) for (const col of pip) need[col] = (need[col] || 0) + 1 / pip.length;
  for (const c of p.battlefield) for (const col of c.def.produces || []) have[col] = (have[col] || 0) + 1;
  const score = l => l.def.produces.reduce((s, col) => s + (need[col] || 0) / (1 + (have[col] || 0)), 0) + l.def.produces.length * 0.1 - (l.def.entersTapped ? 0.4 : 0);
  return lands.sort((a, b) => score(b) - score(a))[0];
}

// Pick targets for every targeted effect of a spell, or null if it is not worth casting.
function chooseTargets(duel, p, card) {
  const opp = duel.opponentOf(p);
  const need = duel.targetsNeeded(card);
  const targets = [];
  for (const i of need) {
    const e = card.def.effects[i];
    const legal = duel.legalTargets(p, e);
    const oppCreatures = legal.filter(t => t.type === 'creature').map(t => duel.find(t.id).card).filter(c => c.controller === opp.idx);
    const ownCreatures = legal.filter(t => t.type === 'creature').map(t => duel.find(t.id).card).filter(c => c.controller === p.idx);
    let pick = null;
    if (e.type === 'damage') {
      const canFace = legal.some(t => t.type === 'player' && t.idx === opp.idx);
      if (canFace && opp.life <= e.amount) pick = { type: 'player', idx: opp.idx };
      else {
        const kill = oppCreatures.filter(c => toughness(c) - c.damage <= e.amount).sort((a, b) => value(b) - value(a))[0];
        if (kill && value(kill) >= 2.5) pick = { type: 'creature', id: kill.id };
        else if (canFace && opp.life <= 8 && !oppCreatures.length) pick = { type: 'player', idx: opp.idx };
      }
    } else if (['destroy', 'exile', 'bounce'].includes(e.type)) {
      const best = oppCreatures.sort((a, b) => value(b) - value(a))[0];
      if (best && value(best) >= 3) pick = { type: 'creature', id: best.id };
    } else if (e.type === 'pump' || e.type === 'grant') {
      // Only during combat, on an attacking creature that is blocked or unblocked and would benefit.
      const attackers = ownCreatures.filter(c => duel.attackers.includes(c.id));
      const blocked = attackers.filter(c => (duel.blocks[c.id] || []).length);
      const cand = (blocked.length ? blocked : attackers).sort((a, b) => value(b) - value(a))[0];
      if (cand && e.p >= 0) pick = { type: 'creature', id: cand.id };
      else if (e.p < 0) { const victim = oppCreatures.filter(c => toughness(c) + e.t <= 0).sort((a, b) => value(b) - value(a))[0]; if (victim) pick = { type: 'creature', id: victim.id }; }
    }
    if (!pick) return null;
    targets.push(pick);
  }
  return targets;
}

async function castLoop(duel, p, delay, combatOnly = false) {
  for (let guard = 0; guard < 12 && duel.winner === null; guard++) {
    const cands = p.hand.filter(c => c.def.kind !== 'land' && duel.canCast(p, c));
    if (!cands.length) return;
    let choice = null, targets = [];
    // 1. lethal burn or good removal
    for (const c of cands.filter(c => c.def.kind === 'spell')) {
      const t = chooseTargets(duel, p, c);
      const untargeted = !duel.targetsNeeded(c).length;
      if (t || untargeted) {
        const e = c.def.effects[0];
        if (combatOnly && !['pump', 'grant'].includes(e.type)) continue;
        if (!combatOnly && ['pump', 'grant'].includes(e.type)) continue;
        if (e.type === 'draw' && p.hand.length > 5) continue;
        if (e.type === 'gain' && p.life > 8) continue;
        if (e.type === 'regrowth' && !p.graveyard.some(isCreature)) continue;
        if (e.type === 'destroyLand' && duel.opponentOf(p).battlefield.filter(isLand).length > 4) continue;
        choice = c; targets = t || []; break;
      }
    }
    // 2. biggest creature
    if (!choice && !combatOnly) {
      choice = cands.filter(c => c.def.kind === 'creature').sort((a, b) => b.def.cmc - a.def.cmc || value(b) - value(a))[0] || null;
    }
    if (!choice) return;
    duel.cast(p, choice, targets);
    await sleep(delay);
  }
}

function chooseAttackers(duel, p) {
  const opp = duel.opponentOf(p);
  const mine = p.battlefield.filter(c => duel.canAttack(c));
  const blockers = opp.battlefield.filter(c => isCreature(c) && !c.tapped);
  const total = mine.reduce((s, c) => s + power(c), 0);
  if (mine.length && total >= opp.life && blockers.length < mine.length) return mine.map(c => c.id); // alpha strike
  const out = [];
  for (const a of mine) {
    const legal = blockers.filter(b => duel.canBlock(b, a));
    const killedBy = legal.filter(b => (power(b) >= toughness(a) || has(b, 'Deathtouch')) && !(has(a, 'First strike') && power(a) >= toughness(b) && !has(b, 'First strike')));
    const survivesAndKills = killedBy.filter(b => toughness(b) > power(a) || has(b, 'First strike') && power(b) >= toughness(a));
    if (!legal.length) out.push(a.id);
    else if (!killedBy.length) out.push(a.id);
    else if (!survivesAndKills.length && value(a) <= 3) out.push(a.id); // happy to trade small stuff
    else if (opp.life <= power(a) * 2 && killedBy.length <= 1) out.push(a.id);
  }
  return out;
}

export function chooseBlocks(duel) {
  const def = duel.defender, atk = duel.activePlayer;
  const attackers = duel.attackers.map(id => atk.battlefield.find(c => c.id === id)).filter(Boolean).sort((a, b) => power(b) - power(a));
  const free = def.battlefield.filter(c => isCreature(c) && !c.tapped);
  const blocks = {};
  const incoming = attackers.reduce((s, a) => s + power(a), 0);
  const lethal = incoming >= def.life;
  let unblockedDamage = incoming;
  for (const a of attackers) {
    const cands = free.filter(b => duel.canBlock(b, a) && !(has(a, 'Menace')));
    if (!cands.length) continue;
    const kills = b => power(b) >= toughness(a) || has(b, 'Deathtouch');
    const dies = b => power(a) >= toughness(b) || has(a, 'Deathtouch');
    let pick = cands.filter(b => kills(b) && !dies(b)).sort((x, y) => value(x) - value(y))[0];
    if (!pick) pick = cands.filter(b => kills(b) && dies(b) && value(a) >= value(b)).sort((x, y) => value(x) - value(y))[0];
    if (!pick && !dies(cands[0])) pick = cands.filter(b => !dies(b)).sort((x, y) => value(x) - value(y))[0]; // free wall
    if (!pick && (lethal || unblockedDamage >= def.life - 2)) pick = cands.sort((x, y) => value(x) - value(y))[0]; // chump
    if (pick) { blocks[a.id] = [pick.id]; free.splice(free.indexOf(pick), 1); unblockedDamage -= power(a); }
  }
  return blocks;
}

export async function aiMain1(duel, delay = 500) {
  const p = duel.activePlayer;
  const land = chooseLand(p);
  if (land && duel.canCast(p, land)) { duel.cast(p, land); await sleep(delay); }
  await castLoop(duel, p, delay);
  if (duel.winner !== null) return;
  const ids = chooseAttackers(duel, p);
  duel.goToCombat(p);
  await sleep(delay / 2);
  duel.declareAttackers(p, ids);
}

export async function aiMain2(duel, delay = 500) {
  const p = duel.activePlayer;
  const land = chooseLand(p);
  if (land && duel.canCast(p, land)) { duel.cast(p, land); await sleep(delay); }
  await castLoop(duel, p, delay);
  if (duel.winner !== null) return;
  await sleep(delay / 2);
  duel.finishTurn(p);
}
