// Duel screen: renders engine state, handles human input, drives the AI.
import { aiMain1, aiMain2, chooseBlocks } from './ai.js';
import { has, power, toughness, isCreature, isLand } from './engine.js';
import { artFor, hasOwnArt } from './collection.js';
import { costString, COLORS } from './cards.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function cardHtml(def, opts = {}) {
  const art = artFor(def);
  const cls = ['card', `kind-${def.kind}`];
  if (opts.classes) cls.push(...opts.classes);
  const colorClass = def.colors?.length === 1 ? `c-${def.colors[0]}` : def.colors?.length > 1 ? 'c-M' : def.kind === 'land' ? `c-${def.produces?.[0] || 'C'}` : 'c-C';
  cls.push(colorClass);
  const style = art ? ` style="background-image:url('${art}')"` : '';
  const pt = opts.pt ?? (def.kind === 'creature' ? `${def.power}/${def.toughness}` : '');
  const ownArt = hasOwnArt(def);
  return `<div class="${cls.join(' ')}"${style} data-id="${opts.id ?? ''}" data-zone="${opts.zone ?? ''}" data-name="${esc(def.name)}" title="${esc(def.name)}">
    <div class="card-top"><span class="card-name">${esc(def.name)}</span>${def.kind !== 'land' ? `<span class="card-cost">${esc(costString(def.cost))}</span>` : ''}</div>
    ${!art ? `<div class="card-body"><span class="card-type">${esc(def.typeLine)}</span></div>` : ''}
    ${ownArt ? '<span class="card-own" title="Your art">★</span>' : ''}
    ${pt ? `<div class="card-pt${opts.ptClass ? ' ' + opts.ptClass : ''}">${pt}</div>` : ''}
    ${opts.badge ? `<div class="card-badge">${opts.badge}</div>` : ''}
  </div>`;
}

export function mountDuel(root, duel, { onEnd, ante, speed = 450 }) {
  const me = duel.players[0], ai = duel.players[1];
  const ui = { targeting: null, attackers: new Set(), blocks: {}, blocker: null, message: '' };
  const aiKeys = new Set();
  let finished = false;

  function cardOf(id) { return duel.find(Number(id))?.card || null; }
  function legalNow() {
    if (!ui.targeting) return [];
    const e = ui.targeting.card.def.effects[ui.targeting.need[ui.targeting.targets.length]];
    return duel.legalTargets(me, e);
  }
  function isLegal(t) { return legalNow().some(l => l.type === t.type && l.id === t.id && l.idx === t.idx); }

  function bfCard(c, owner) {
    const classes = [];
    if (c.tapped) classes.push('tapped');
    if (c.sick && isCreature(c) && !has(c, 'Haste')) classes.push('sick');
    if (duel.attackers.includes(c.id) || ui.attackers.has(c.id)) classes.push('attacking');
    if (Object.values(duel.blocks).flat().includes(c.id) || Object.values(ui.blocks).flat().includes(c.id)) classes.push('blocking');
    if (ui.blocker === c.id) classes.push('selected');
    if (ui.targeting && isLegal({ type: 'creature', id: c.id })) classes.push('targetable');
    if (duel.phase === 'attack' && duel.active === 0 && owner === me && duel.canAttack(c)) classes.push('can-attack');
    if (duel.phase === 'block' && duel.active === 1 && owner === me && isCreature(c) && !c.tapped) classes.push('can-block');
    let pt = '', ptClass = '';
    if (isCreature(c)) { pt = `${power(c)}/${toughness(c) - c.damage}`; if (c.damage || c.pump.p || c.pump.t) ptClass = 'mod'; }
    const kws = [...(c.def.keywords || []), ...c.granted];
    const badge = kws.length ? kws.map(k => k.split(' ').map(w => w[0]).join('')).join(' ') : '';
    let blockTag = '';
    const blockedBy = ui.blocks[c.id] || duel.blocks[c.id];
    if (blockedBy && blockedBy.length) blockTag = `<div class="card-blocked">blocked</div>`;
    return cardHtml(c.def, { id: c.id, zone: 'bf', classes, pt, ptClass, badge }).replace('</div>\n  </div>', '</div>' + blockTag + '</div>');
  }
  function handCard(c) {
    const classes = [];
    if (duel.canCast(me, c) && !ui.targeting) classes.push('castable');
    if (c.def.kind === 'unsupported') classes.push('dead');
    return cardHtml(c.def, { id: c.id, zone: 'hand', classes });
  }
  function playerBox(p, isMe) {
    const targetable = ui.targeting && isLegal({ type: 'player', idx: p.idx }) ? ' targetable' : '';
    const turn = duel.active === p.idx ? ' active' : '';
    return `<div class="pbox${targetable}${turn}" data-player="${p.idx}">
      <div class="pname">${esc(p.name)}</div>
      <div class="plife">${p.life}</div>
      <div class="pmeta">Hand ${p.hand.length} · Library ${p.library.length} · Grave ${p.graveyard.length}</div>
    </div>`;
  }
  function zone(p, pred) { return p.battlefield.filter(pred).map(c => bfCard(c, p)).join(''); }

  function buttons() {
    if (duel.winner !== null) return '';
    if (ui.targeting) return `<div class="hint">Choose a target for <b>${esc(ui.targeting.card.def.name)}</b></div><button id="b-cancel" class="btn">Cancel</button>`;
    if (duel.active === 0) {
      if (duel.phase === 'main1') {
        const can = me.battlefield.some(c => duel.canAttack(c));
        return `<button id="b-combat" class="btn primary" ${can ? '' : 'disabled'}>Attack…</button><button id="b-end" class="btn">End turn</button>`;
      }
      if (duel.phase === 'attack') return `<div class="hint">Click creatures to attack with.</div><button id="b-attack" class="btn primary">Confirm ${ui.attackers.size ? `(${ui.attackers.size})` : 'no attack'}</button>`;
      if (duel.phase === 'main2') return `<button id="b-end" class="btn primary">End turn</button>`;
    } else if (duel.phase === 'block') {
      return `<div class="hint">Click one of your creatures, then the attacker it blocks. Click a blocker again to clear it.</div><button id="b-block" class="btn primary">Confirm blocks</button>`;
    }
    return `<div class="hint">${esc(ai.name)} is thinking…</div>`;
  }

  function template() {
    const phaseName = { main1: 'Main phase', attack: 'Declare attackers', block: 'Declare blockers', damage: 'Combat damage', main2: 'Second main', over: 'Duel over' }[duel.phase] || duel.phase;
    return `
    <div class="duel">
      <div class="table">
        <section class="side opp">
          ${playerBox(ai, false)}
          <div class="rows">
            <div class="row lands">${zone(ai, isLand)}</div>
            <div class="row creatures">${zone(ai, isCreature)}</div>
          </div>
        </section>
        <div class="midline"><span>Turn ${duel.turn} · ${duel.activePlayer.name} · ${phaseName}</span>${ante ? `<span class="ante">Ante: ${esc(ante.mine)} vs ${esc(ante.theirs)}</span>` : ''}</div>
        <section class="side mine">
          <div class="rows">
            <div class="row creatures">${zone(me, isCreature)}</div>
            <div class="row lands">${zone(me, isLand)}</div>
          </div>
          ${playerBox(me, true)}
        </section>
        <section class="hand">${me.hand.map(handCard).join('')}</section>
      </div>
      <aside class="panel">
        <div class="controls">${buttons()}${ui.message ? `<div class="msg">${esc(ui.message)}</div>` : ''}</div>
        <div class="log">${duel.log.slice(-14).map(l => `<div>${esc(l)}</div>`).join('')}</div>
        <div id="preview" class="preview"></div>
        <button id="b-concede" class="btn small ghost">Concede</button>
      </aside>
    </div>`;
  }

  function showPreview(def, inst) {
    const el = root.querySelector('#preview'); if (!el || !def) return;
    const kws = inst ? [...(def.keywords || []), ...inst.granted] : (def.keywords || []);
    el.innerHTML = `<div class="pv-name">${esc(def.name)} <span class="pv-cost">${def.kind === 'land' ? '' : esc(costString(def.cost))}</span></div>
      <div class="pv-type">${esc(def.typeLine)}</div>
      <div class="pv-text">${esc(def.oracle || '').replace(/\n/g, '<br>')}</div>
      ${def.kind === 'creature' ? `<div class="pv-pt">${def.power}/${def.toughness}${kws.length ? ' · ' + kws.join(', ') : ''}</div>` : ''}
      ${def.notes?.length ? `<div class="pv-notes">Demo engine: ${def.notes.map(esc).join('; ')}</div>` : ''}`;
  }

  function render() { root.innerHTML = template(); }

  function tryCast(card) {
    if (!duel.canCast(me, card)) { ui.message = card.def.kind === 'unsupported' ? 'This card is not supported by the demo engine.' : 'Cannot cast that now.'; render(); return; }
    const need = duel.targetsNeeded(card);
    ui.message = '';
    if (!need.length) { duel.cast(me, card); return; }
    ui.targeting = { card, need, targets: [] };
    render();
  }
  function pickTarget(t) {
    if (!ui.targeting || !isLegal(t)) return;
    ui.targeting.targets.push(t);
    if (ui.targeting.targets.length === ui.targeting.need.length) {
      const { card, targets } = ui.targeting; ui.targeting = null;
      if (!duel.cast(me, card, targets)) { ui.message = 'That spell could not be cast.'; render(); }
    } else render();
  }

  root.addEventListener('click', ev => {
    const btn = ev.target.closest('button');
    if (btn) {
      switch (btn.id) {
        case 'b-combat': ui.attackers = new Set(); duel.goToCombat(me); break;
        case 'b-attack': { const ids = [...ui.attackers]; ui.attackers = new Set(); duel.declareAttackers(me, ids); break; }
        case 'b-end': ui.attackers = new Set(); duel.finishTurn(me); break;
        case 'b-block': {
          if (!duel.validBlocks(ui.blocks)) { ui.message = 'Those blocks are not legal (menace needs two blockers; flyers need flying or reach).'; render(); return; }
          const b = ui.blocks; ui.blocks = {}; ui.blocker = null; ui.message = ''; duel.declareBlockers(b); break;
        }
        case 'b-cancel': ui.targeting = null; ui.message = ''; render(); break;
        case 'b-concede': if (confirm('Concede this duel? You will lose your ante card.')) duel.end(1, `${me.name} concedes.`); break;
      }
      return;
    }
    const pb = ev.target.closest('.pbox');
    if (pb && ui.targeting) { pickTarget({ type: 'player', idx: Number(pb.dataset.player) }); return; }
    const el = ev.target.closest('.card'); if (!el) return;
    const card = cardOf(el.dataset.id); if (!card) return;
    const zoneName = el.dataset.zone;
    if (ui.targeting) { if (zoneName === 'bf') pickTarget({ type: 'creature', id: card.id }); return; }
    if (zoneName === 'hand' && card.controller === 0) { tryCast(card); return; }
    if (zoneName !== 'bf') return;
    if (duel.active === 0 && duel.phase === 'attack' && card.controller === 0) {
      if (!duel.canAttack(card)) return;
      if (ui.attackers.has(card.id)) ui.attackers.delete(card.id); else ui.attackers.add(card.id);
      render(); return;
    }
    if (duel.active === 1 && duel.phase === 'block') {
      if (card.controller === 0) {
        if (!isCreature(card) || card.tapped) return;
        // clicking an assigned blocker clears it
        for (const k of Object.keys(ui.blocks)) if (ui.blocks[k].includes(card.id)) { ui.blocks[k] = ui.blocks[k].filter(id => id !== card.id); if (!ui.blocks[k].length) delete ui.blocks[k]; ui.blocker = null; render(); return; }
        ui.blocker = ui.blocker === card.id ? null : card.id; render(); return;
      }
      if (card.controller === 1 && duel.attackers.includes(card.id) && ui.blocker != null) {
        const b = cardOf(ui.blocker);
        if (!duel.canBlock(b, card)) { ui.message = `${b.def.name} cannot block ${card.def.name}.`; render(); return; }
        (ui.blocks[card.id] ||= []).push(ui.blocker); ui.blocker = null; ui.message = ''; render(); return;
      }
    }
  });
  root.addEventListener('mouseover', ev => {
    const el = ev.target.closest('.card'); if (!el) return;
    const card = cardOf(el.dataset.id); if (card) showPreview(card.def, card);
  });
  document.addEventListener('keydown', function onKey(ev) {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (ev.key === 'Escape' && ui.targeting) { ui.targeting = null; render(); }
  });

  async function drive() {
    if (duel.winner !== null) {
      if (!finished) { finished = true; await sleep(900); onEnd(duel.winner); }
      return;
    }
    const key = `${duel.turn}:${duel.active}:${duel.phase}`;
    if (aiKeys.has(key)) return;
    if (duel.active === 1 && (duel.phase === 'main1' || duel.phase === 'main2')) {
      aiKeys.add(key);
      await sleep(speed);
      await (duel.phase === 'main1' ? aiMain1 : aiMain2)(duel, speed);
    } else if (duel.active === 0 && duel.phase === 'block') {
      aiKeys.add(key);
      await sleep(speed);
      duel.declareBlockers(chooseBlocks(duel));
    }
  }

  duel.onChange(() => { ui.message = ''; render(); drive(); });
  duel.start();
}
