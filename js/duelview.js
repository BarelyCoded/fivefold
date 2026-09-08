// Duel screen for the rules core: renders state, drives the engine loop, collects human decisions,
// and plays the engine's visual-effect events (attacks, blocks, strikes, damage).
import { has, power, toughness, isCreature, isLand, isType, STEP_NAME, costText } from './engine.js';
import { artFor, hasOwnArt } from './collection.js';
import { costString, COLORS } from './cards.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KW_ABBR = k => (typeof k === 'string' ? k : k.k === 'Protection' ? 'Pro ' + k.from : k.k === 'Landwalk' ? k.land + 'walk' : k.k).split(' ').map(w => w[0]).join('');
const PHASES = [['untap', 'Untap', '↻'], ['upkeep', 'Upkeep', '☼'], ['draw', 'Draw', '▤'], ['main1', 'Main', '✦'], ['combat', 'Combat', '⚔'], ['main2', 'Main 2', '✦'], ['end', 'End', '◗']];
const COMBAT_STEPS = new Set(['beginCombat', 'attackers', 'blockers', 'firstStrike', 'damage', 'endCombat']);

export function cardHtml(def, opts = {}) {
  const art = artFor(def);
  const cls = ['card', `kind-${def.kind}`];
  if (opts.classes) cls.push(...opts.classes);
  const colorClass = def.colors?.length === 1 ? `c-${def.colors[0]}` : def.colors?.length > 1 ? 'c-M' : def.kind === 'land' ? `c-${def.produces?.[0] || 'C'}` : 'c-C';
  cls.push(colorClass);
  const style = art ? ` style="background-image:url('${art}')"` : '';
  const pt = opts.pt ?? (def.kind === 'creature' ? `${def.power}/${def.toughness}` : '');
  return `<div class="${cls.join(' ')}"${style} data-id="${opts.id ?? ''}" data-zone="${opts.zone ?? ''}" data-name="${esc(def.name)}" title="${esc(def.name)}">
    <div class="card-top"><span class="card-name">${esc(def.name)}</span>${def.kind !== 'land' ? `<span class="card-cost">${esc(costString(def.cost))}</span>` : ''}</div>
    ${!art ? `<div class="card-body"><span class="card-type">${esc(def.typeLine)}</span></div>` : ''}
    ${hasOwnArt(def) ? '<span class="card-own" title="Your art">★</span>' : ''}
    ${pt ? `<div class="card-pt${opts.ptClass ? ' ' + opts.ptClass : ''}">${pt}</div>` : ''}
    ${opts.badge ? `<div class="card-badge">${esc(opts.badge)}</div>` : ''}
    ${opts.extra || ''}
  </div>`;
}

export function mountDuel(root, duel, { onEnd, ante, speed = 420 }) {
  const me = duel.players[0], ai = duel.players[1];
  const ui = { wizard: null, attackers: new Set(), blocks: {}, blocker: null, message: '', menu: null, viewer: null, choice: null };
  let finished = false, running = false;

  // ---- engine driver ----------------------------------------------------------------
  async function run() {
    if (running) return; running = true;
    try {
      for (let guard = 0; guard < 5000; guard++) {
        const r = duel.tick();
        render();
        const fxWait = playFx();
        if (r === 'over') { if (!finished) { finished = true; await sleep(Math.max(900, fxWait)); onEnd(duel.winner); } return; }
        if (r === 'wait') return;
        if (document.hidden) continue; // background tabs throttle timers; keep the engine moving
        if (r === 'ai') await sleep(Math.max(speed, fxWait));
        else if (fxWait) await sleep(fxWait);
        else if (r === 'job') await sleep(60);
      }
      console.warn('engine loop guard hit');
    } finally { running = false; }
  }

  // ---- visual effects ---------------------------------------------------------------
  const elOf = id => root.querySelector(`[data-zone="bf"][data-id="${id}"]`);
  const pboxOf = idx => root.querySelector(`.pbox[data-player="${idx}"]`);
  function floatText(target, text, cls) {
    if (!target) return;
    const table = root.querySelector('.table'); if (!table) return;
    const tr = table.getBoundingClientRect(), r = target.getBoundingClientRect();
    const d = document.createElement('div');
    d.className = 'fx-float ' + cls; d.textContent = text;
    d.style.left = (r.left - tr.left + r.width / 2) + 'px'; d.style.top = (r.top - tr.top + r.height / 3) + 'px';
    table.appendChild(d);
  }
  function playFx() {
    const fx = duel.fx.splice(0);
    if (document.hidden) return 0;
    let wait = 0;
    for (const f of fx) {
      switch (f.type) {
        case 'attack': for (const id of f.ids) elOf(id)?.classList.add('fx-attack'); wait = Math.max(wait, 450); break;
        case 'block': for (const id of f.blockers) elOf(id)?.classList.add('fx-block'); wait = Math.max(wait, 450); break;
        case 'strike':
          for (const id of f.attackers) elOf(id)?.classList.add('fx-lunge');
          for (const ids of Object.values(f.blocks)) for (const id of ids) elOf(id)?.classList.add('fx-lunge');
          wait = Math.max(wait, 650); break;
        case 'damage': {
          const t = f.player !== undefined ? pboxOf(f.player) : elOf(f.target);
          if (t) { t.classList.add('fx-hit'); floatText(t, `-${f.amount}`, 'fx-dmg'); }
          wait = Math.max(wait, 750); break;
        }
        case 'cast': { const s = root.querySelector(`.stack-item[data-stack]`); if (s) s.classList.add('fx-cast'); wait = Math.max(wait, 250); break; }
        case 'die': { const z = f.controller === 0 ? '.zone.mine .field' : '.zone.opp .field'; floatText(root.querySelector(z), `${f.name} ✝`, 'fx-die'); wait = Math.max(wait, 500); break; }
      }
    }
    return wait;
  }

  // ---- rendering ---------------------------------------------------------------------
  const cardOf = id => duel.card(Number(id));
  const targeting = () => ui.wizard?.stage === 'targets' || duel.pending?.req?.kind === 'target';
  function legalNow() {
    if (ui.wizard?.stage === 'targets') return ui.wizard.specs[ui.wizard.targets.length].options;
    if (duel.pending?.req?.kind === 'target') return duel.pending.req.options;
    return [];
  }
  const isLegal = ref => legalNow().some(l => l.type === ref.type && l.id === ref.id && l.idx === ref.idx);

  function bfCard(c, owner) {
    const classes = [];
    if (c.tapped) classes.push('tapped');
    if (c.sick && isCreature(c) && !has(c, 'Haste')) classes.push('sick');
    if (duel.attackers.includes(c.id) || ui.attackers.has(c.id)) classes.push('attacking');
    if (Object.values(duel.blocks).flat().includes(c.id) || Object.values(ui.blocks).flat().includes(c.id)) classes.push('blocking');
    if (ui.blocker === c.id) classes.push('selected');
    if (targeting() && isLegal({ type: 'perm', id: c.id })) classes.push('targetable');
    const req = duel.pending?.req;
    if (req?.kind === 'attackers' && owner === me && req.options.includes(c.id)) classes.push('can-attack');
    if (req?.kind === 'blockers' && owner === me && isCreature(c) && !c.tapped) classes.push('can-block');
    if (owner === me && duel.pending?.type === 'priority' && (c.def.abilities.some((ab, i) => ab.type === 'activated' && duel.canActivate(me, c, i)) || c.def.manaAbilities.length)) classes.push('usable');
    let pt = '', ptClass = '';
    if (isCreature(c)) { pt = `${power(c)}/${toughness(c) - c.damage}`; if (c.damage || power(c) !== c.def.power || toughness(c) !== c.def.toughness) ptClass = 'mod'; }
    const kws = [...c.cur.kw].filter(k => typeof k === 'string' ? !['Changeling'].includes(k) : true);
    const badge = kws.length ? kws.map(KW_ABBR).join(' ') : '';
    let extra = '';
    const counters = Object.entries(c.counters).filter(([k, v]) => v > 0 && k !== 'age').map(([k, v]) => `${v}×${k}`);
    if (counters.length) extra += `<div class="card-counters">${esc(counters.join(' '))}</div>`;
    if (c.regen) extra += `<div class="card-regen">regen</div>`;
    const attached = duel.permanents().filter(a => a.attachedTo === c);
    if (attached.length) extra += `<div class="card-attach">${attached.map(a => esc(a.def.name)).join(', ')}</div>`;
    if (c.attachedTo) extra += `<div class="card-attachedto">on ${esc(c.attachedTo.def.name)}</div>`;
    const blockedBy = ui.blocks[c.id] || duel.blocks[c.id];
    if (blockedBy && blockedBy.length) extra += `<div class="card-blocked">blocked</div>`;
    return cardHtml(c.def, { id: c.id, zone: 'bf', classes, pt, ptClass, badge, extra });
  }
  function handCard(c) {
    const classes = [];
    if (duel.pending?.type === 'priority' && !ui.wizard && (duel.canCast(me, c) || duel.canCast(me, c, { cycling: true }))) classes.push('castable');
    if (c.def.kind === 'unsupported') classes.push('dead');
    if (ui.wizard?.stage === 'targets' && ui.wizard.card === c) classes.push('selected');
    return cardHtml(c.def, { id: c.id, zone: 'hand', classes });
  }
  function gems(p) {
    const out = [];
    for (const col of [...COLORS, 'C']) if (p.pool[col] > 0) out.push(`<span class="gem g-${col}" title="${p.pool[col]} ${col} mana in pool">${p.pool[col]}</span>`);
    const avail = duel.manaSources(p).reduce((s, x) => s + x.amount, 0);
    return `<div class="gems">${out.join('')}<span class="gem g-avail" title="Untapped mana sources">${avail}</span></div>`;
  }
  function playerBox(p) {
    const targetable = targeting() && isLegal({ type: 'player', idx: p.idx }) ? ' targetable' : '';
    const turn = duel.active === p.idx ? ' active' : '';
    return `<div class="pbox${targetable}${turn}${duel.priority === p.idx && !duel.pending ? ' thinking' : ''}" data-player="${p.idx}">
      <div class="pname">${esc(p.name)}</div>
      <div class="plife">${p.life}</div>
      ${p.poison ? `<div class="ppoison">☠ ${p.poison}</div>` : ''}
      ${gems(p)}
      <div class="pmeta"><span title="Hand">✋ ${p.hand.length}</span><span title="Library">▤ ${p.library.length}</span><span class="link" data-grave="${p.idx}" title="Graveyard">✝ ${p.graveyard.length}</span>${p.exile.length ? `<span title="Exile">◌ ${p.exile.length}</span>` : ''}</div>
    </div>`;
  }
  function landStack(p) {
    const groups = new Map();
    for (const c of p.battlefield.filter(isLand)) { const g = groups.get(c.def.name) || { name: c.def.name, def: c.def, all: [] }; g.all.push(c); groups.set(c.def.name, g); }
    const items = [...groups.values()].map(g => {
      const untapped = g.all.filter(c => !c.tapped);
      const first = untapped[0] || g.all[0];
      const cls = ['pill', `c-${g.def.produces?.[0] || 'C'}`];
      if (!untapped.length) cls.push('tapped');
      if (targeting() && g.all.some(c => isLegal({ type: 'perm', id: c.id }))) cls.push('targetable');
      const target = targeting() ? (g.all.find(c => isLegal({ type: 'perm', id: c.id })) || first) : first;
      if (p === me && duel.pending?.type === 'priority' && untapped.length) cls.push('usable');
      return `<div class="${cls.join(' ')}" data-id="${target.id}" data-zone="bf" data-name="${esc(g.name)}"><i></i>${esc(g.name)}<b>${untapped.length}/${g.all.length}</b></div>`;
    });
    return `<div class="lands"><div class="lands-title">Lands</div>${items.join('') || '<div class="small">none</div>'}</div>`;
  }
  const notAttached = c => !c.attachedTo;
  const permsOf = p => p.battlefield.filter(c => !isCreature(c) && !isLand(c) && notAttached(c)).map(c => bfCard(c, p)).join('');
  const creaturesOf = p => p.battlefield.filter(isCreature).map(c => bfCard(c, p)).join('');

  function stackHtml() {
    if (!duel.stack.length) return '';
    return `<div class="stack"><div class="stack-title">Stack</div>${duel.stack.slice().reverse().map(it => {
      const tgts = (it.targets || []).map(t => t.type === 'player' ? duel.players[t.idx].name : (duel.card(t.id)?.def.name || duel.stack.find(s => s.id === t.id)?.card.def.name || '?')).join(', ');
      const targetable = targeting() && isLegal({ type: 'spell', id: it.id }) ? ' targetable' : '';
      return `<div class="stack-item${targetable}" data-stack="${it.id}" data-preview="${esc(it.card.def.name)}"><b>${esc(it.card.def.name)}</b> <span>${it.kind === 'spell' ? '' : it.kind === 'trigger' ? 'trigger' : 'ability'} · ${esc(duel.players[it.controller].name)}</span>${tgts ? `<div class="stack-tgt">→ ${esc(tgts)}</div>` : ''}</div>`;
    }).join('')}</div>`;
  }
  function phaseStrip() {
    const cur = COMBAT_STEPS.has(duel.step) ? 'combat' : duel.step === 'cleanup' ? 'end' : duel.step;
    return `<div class="phases ${duel.active === 0 ? 'mine' : 'theirs'}"><div class="phases-who">${duel.active === 0 ? 'Your turn' : esc(ai.name)}</div>${PHASES.map(([k, label, icon]) => `<div class="phase${k === cur ? ' on' : ''}"><span class="ph-icon">${icon}</span><span class="ph-label">${label}</span></div>`).join('')}<div class="phases-step">${esc(STEP_NAME[duel.step] || duel.step)}</div></div>`;
  }

  function controls() {
    if (duel.winner !== null) return '';
    if (ui.menu) return `<div class="hint">${esc(ui.menu.title)}</div>${ui.menu.items.map((it, i) => `<button class="btn${it.primary ? ' primary' : ''}" data-menu="${i}" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}</button>`).join('')}<button class="btn ghost" data-menu="cancel">Cancel</button>`;
    if (ui.wizard) {
      const w = ui.wizard;
      if (w.stage === 'x') return `<div class="hint">Choose X for <b>${esc(w.card.def.name)}</b> (max ${w.maxX})</div><div class="xrow"><input id="xval" type="number" min="0" max="${w.maxX}" value="${w.maxX}"><button class="btn primary" data-wiz="x">OK</button></div><button class="btn ghost" data-wiz="cancel">Cancel</button>`;
      if (w.stage === 'targets') { const spec = w.specs[w.targets.length]; return `<div class="hint">${esc(spec.text)} for <b>${esc(w.card.def.name)}</b>. Click it on the table.</div>${spec.options.some(o => o.type === 'card') ? spec.options.map(o => `<button class="btn small" data-wizref="${o.type}:${o.id}">${esc(o.label)}</button>`).join('') : ''}<button class="btn ghost" data-wiz="cancel">Cancel</button>`; }
    }
    const pend = duel.pending;
    if (!pend) return `<div class="hint">${esc(duel.players[duel.priority].name)} is thinking…</div>`;
    if (pend.type === 'priority') {
      const stackTop = duel.stack.length;
      const mine = duel.active === 0;
      const canAtk = mine && duel.step === 'main1' && me.battlefield.some(c => duel.canAttack(c));
      const passLabel = stackTop ? 'Pass (let it resolve)' : mine && duel.step === 'main1' ? (canAtk ? 'Go to combat' : 'Next phase') : mine && duel.step === 'main2' ? 'End turn' : 'Pass';
      return `<div class="hint">You have priority${stackTop ? ' — respond or pass' : ''}. Click a card in hand to cast it, or a permanent to use its abilities. Space passes.</div>
        <button id="b-pass" class="btn primary">${passLabel}</button><button id="b-endturn" class="btn" title="Pass priority automatically until the next turn begins">${mine ? 'Skip to end of turn' : 'Stop asking this turn'}</button>`;
    }
    const req = pend.req;
    switch (req.kind) {
      case 'attackers': return `<div class="hint">Declare attackers: click your creatures.${req.must.length ? ' Some must attack.' : ''}</div><button id="b-attack" class="btn primary">Confirm ${ui.attackers.size ? `(${ui.attackers.size})` : 'no attack'}</button>`;
      case 'blockers': return `<div class="hint">Declare blockers: click one of your creatures, then the attacker it blocks. Click a blocker again to clear it.</div><button id="b-block" class="btn primary">Confirm blocks</button>`;
      case 'yesno': return `<div class="hint">${esc(req.text)}</div><button class="btn primary" data-answer="yes">Yes</button><button class="btn" data-answer="no">No</button>`;
      case 'color': return `<div class="hint">${esc(req.text)}</div>${COLORS.map(c => `<button class="btn" data-color="${c}">${c}</button>`).join('')}`;
      case 'target': return `<div class="hint">${esc(req.text)} — click it on the table.</div>${req.options.filter(o => o.type === 'card').map(o => `<button class="btn small" data-reqref="${o.type}:${o.id}">${esc(o.label)}</button>`).join('')}`;
      case 'choose': {
        const sel = ui.choice || new Set();
        return `<div class="hint">${esc(req.text)}${req.min === req.max ? '' : ` (${req.min}–${req.max})`}</div><div class="choices">${req.options.map(o => `<label class="choice" data-preview="${esc(o.label)}"><input type="checkbox" data-choice="${o.id}" ${sel.has(o.id) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}</div><button class="btn primary" id="b-choose" ${sel.size < req.min || sel.size > req.max ? 'disabled' : ''}>OK</button>`;
      }
    }
    return '';
  }

  function template() {
    return `
    <div class="duel">
      <aside class="rail">${phaseStrip()}</aside>
      <div class="table">
        <section class="zone opp">
          ${playerBox(ai)}
          <div class="field"><div class="row perms">${permsOf(ai)}</div><div class="row creatures">${creaturesOf(ai)}</div></div>
          ${landStack(ai)}
        </section>
        <div class="divider"><span class="div-turn">Turn ${duel.turn}</span>${stackHtml()}${ante ? `<span class="ante">Ante: ${esc(ante.mine)} vs ${esc(ante.theirs)}</span>` : ''}</div>
        <section class="zone mine">
          ${playerBox(me)}
          <div class="field"><div class="row creatures">${creaturesOf(me)}</div><div class="row perms">${permsOf(me)}</div></div>
          ${landStack(me)}
        </section>
        <section class="hand">${me.hand.map(handCard).join('')}</section>
      </div>
      <aside class="panel">
        <div class="controls">${controls()}${ui.message ? `<div class="msg">${esc(ui.message)}</div>` : ''}</div>
        <div class="log">${duel.log.slice(-18).map(l => `<div>${esc(l)}</div>`).join('')}</div>
        <button id="b-concede" class="btn small ghost">Concede</button>
      </aside>
      ${ui.viewer !== null ? viewerHtml() : ''}
    </div>`;
  }
  function viewerHtml() {
    const p = duel.players[ui.viewer];
    return `<div class="overlay" data-close-viewer><div class="modal wide"><h3>${esc(p.name)}'s graveyard</h3><div class="viewer">${p.graveyard.length ? p.graveyard.slice().reverse().map(c => cardHtml(c.def, { id: c.id, zone: 'grave', classes: p === me && duel.canCast(me, c) ? ['castable'] : [] })).join('') : '<p class="small">Empty.</p>'}</div><button class="btn" data-close-viewer>Close</button></div></div>`;
  }
  function render() { root.innerHTML = template(); }

  // ---- cast wizard -------------------------------------------------------------------
  function startCast(card, base = {}) {
    const info = duel.castOptions(me, card);
    const w = { card, opts: { ...base }, info, stage: null, targets: [], specs: [] };
    ui.wizard = w; ui.message = '';
    next(w);
  }
  function next(w) {
    const { card, info, opts } = w;
    if (!('modes' in opts) && info.modes) { ui.menu = { title: `${card.def.name}: choose a mode`, items: info.modes.options.map(m => ({ label: m.text, action: () => { opts.modes = [m.index]; ui.menu = null; next(w); } })) }; render(); return; }
    if (info.kicker && !('kicked' in opts)) {
      if (duel.canCast(me, card, { ...opts, kicked: true })) { ui.menu = { title: `Pay kicker ${costString(info.kicker)} for ${card.def.name}?`, items: [{ label: 'Kick it', primary: true, action: () => { opts.kicked = true; ui.menu = null; next(w); } }, { label: 'No kicker', action: () => { opts.kicked = false; ui.menu = null; next(w); } }] }; render(); return; }
      opts.kicked = false;
    }
    if (info.buyback && !('buyback' in opts)) {
      if (duel.canCast(me, card, { ...opts, buyback: true })) { ui.menu = { title: `Pay buyback ${costString(info.buyback)}?`, items: [{ label: 'Buyback', primary: true, action: () => { opts.buyback = true; ui.menu = null; next(w); } }, { label: 'No', action: () => { opts.buyback = false; ui.menu = null; next(w); } }] }; render(); return; }
      opts.buyback = false;
    }
    if (info.pitch && !('pitch' in opts) && !duel.canPay(me, card.def.cost)) {
      const cands = me.hand.filter(c => c !== card && c.def.colors.includes(info.pitch));
      if (cands.length) { ui.menu = { title: `Exile a ${info.pitch} card instead of paying?`, items: [...cands.map(c => ({ label: c.def.name, action: () => { opts.pitch = c.id; ui.menu = null; next(w); } })), { label: 'Pay mana instead', action: () => { opts.pitch = undefined; ui.menu = null; next(w); } }] }; render(); return; }
    }
    if (info.x && !('x' in opts)) { let maxX = 0; for (let x = 20; x >= 0; x--) if (duel.canPay(me, card.def.cost, x)) { maxX = x; break; } w.maxX = maxX; w.stage = 'x'; render(); return; }
    if (info.additional && !w.extraDone) {
      const a = info.additional;
      if (a.sacrifice && !('sacrifice' in opts)) { const cands = me.battlefield.filter(c => isType(c, a.sacrifice)); ui.menu = { title: `Sacrifice a ${a.sacrifice}`, items: cands.map(c => ({ label: c.def.name, action: () => { opts.sacrifice = c.id; ui.menu = null; next(w); } })) }; render(); return; }
      if (a.discard && !('discard' in opts)) { const cands = me.hand.filter(c => c !== card); ui.menu = { title: `Discard a card`, items: cands.map(c => ({ label: c.def.name, action: () => { opts.discard = [c.id]; ui.menu = null; next(w); } })) }; render(); return; }
      w.extraDone = true;
    }
    if (!w.specs.length) w.specs = duel.targetSpecs(me, card, opts).map(s => ({ ...s, options: duel.legalTargets(me, s.effect, card) }));
    if (w.targets.length < w.specs.length) { w.stage = 'targets'; render(); return; }
    opts.targets = w.targets;
    ui.wizard = null;
    if (!duel.humanCast(card, opts)) { ui.message = 'That could not be cast.'; render(); return; }
    run();
  }
  function startActivate(card, i) {
    const info = duel.activateOptions(me, card, i);
    const ab = card.def.abilities[i];
    const w = { card, ability: i, info, opts: { targets: [] }, targets: [], specs: info.targets, stage: null };
    ui.wizard = w;
    const step = () => {
      if (info.x && !('x' in w.opts)) { let maxX = 0; for (let x = 20; x >= 0; x--) if (duel.canPay(me, ab.cost.mana, x)) { maxX = x; break; } w.maxX = maxX; w.stage = 'x'; w.onX = v => { w.opts.x = v; step(); }; render(); return; }
      if (info.sacrifice && !('sacrifice' in w.opts)) { ui.menu = { title: `Sacrifice a ${ab.cost.sacrifice}`, items: info.sacrifice.map(id => ({ label: duel.card(id).def.name, action: () => { w.opts.sacrifice = id; ui.menu = null; step(); } })) }; render(); return; }
      if (info.discard && !('discard' in w.opts)) { ui.menu = { title: 'Discard a card', items: info.discard.map(id => ({ label: duel.card(id).def.name, action: () => { w.opts.discard = [id]; ui.menu = null; step(); } })) }; render(); return; }
      if (w.targets.length < w.specs.length) { w.stage = 'targets'; render(); return; }
      w.opts.targets = w.targets; ui.wizard = null;
      if (!duel.humanActivate(card, i, w.opts)) { ui.message = 'That ability could not be activated.'; render(); return; }
      run();
    };
    w.step = step; step();
  }
  function pickRef(ref) {
    if (ui.wizard?.stage === 'targets') {
      const w = ui.wizard; if (!isLegal(ref)) return;
      w.targets.push(ref);
      if (w.ability !== undefined) w.step(); else next(w);
      return;
    }
    if (duel.pending?.req?.kind === 'target') { if (!isLegal(ref)) return; duel.humanAnswer(ref); run(); }
  }
  function permMenu(card) {
    const items = [];
    card.def.manaAbilities.forEach((ma, i) => { const ok = !card.tapped || !ma.cost.tap; for (const col of (ma.produces.length > 1 ? ma.produces : [ma.produces[0]])) items.push({ label: `Add ${ma.amount || 1} ${col} mana (${costText(ma.cost)})`, disabled: !ok, action: () => { ui.menu = null; duel.humanMana(card, i, col); render(); } }); });
    card.def.abilities.forEach((ab, i) => { if (ab.type !== 'activated') return; items.push({ label: `${costText(ab.cost)}: ${ab.text.split(': ').slice(1).join(': ').slice(0, 60) || 'ability'}`, disabled: !duel.canActivate(me, card, i), action: () => { ui.menu = null; startActivate(card, i); } }); });
    if (!items.length) return;
    ui.menu = { title: card.def.name, items }; render();
  }
  function handMenu(card) {
    const items = [];
    if (duel.canCast(me, card)) items.push({ label: card.def.kind === 'land' ? 'Play' : 'Cast', primary: true, action: () => { ui.menu = null; startCast(card); } });
    if (duel.canCast(me, card, { cycling: true })) items.push({ label: 'Cycle', action: () => { ui.menu = null; duel.humanCast(card, { cycling: true }); run(); } });
    if (!items.length) { ui.message = card.def.kind === 'unsupported' ? 'This card is not supported by the engine yet.' : 'Cannot play that now.'; render(); return; }
    if (items.length === 1) { items[0].action(); return; }
    ui.menu = { title: card.def.name, items }; render();
  }

  // ---- events --------------------------------------------------------------------------
  root.addEventListener('click', ev => {
    const btn = ev.target.closest('button, [data-grave], [data-close-viewer], .stack-item, .pbox, .card, .pill');
    if (!btn) return;
    if (btn.dataset.menu !== undefined) { if (btn.dataset.menu === 'cancel') { ui.menu = null; ui.wizard = null; render(); } else { const it = ui.menu.items[Number(btn.dataset.menu)]; if (it && !it.disabled) it.action(); } return; }
    if (btn.dataset.wiz === 'cancel') { ui.wizard = null; ui.menu = null; render(); return; }
    if (btn.dataset.wiz === 'x') { const v = Math.max(0, Math.min(ui.wizard.maxX, Number(root.querySelector('#xval').value) || 0)); if (ui.wizard.ability !== undefined) ui.wizard.onX(v); else { ui.wizard.opts.x = v; next(ui.wizard); } return; }
    if (btn.dataset.wizref) { const [type, id] = btn.dataset.wizref.split(':'); pickRef({ type, id: Number(id) }); return; }
    if (btn.dataset.reqref) { const [type, id] = btn.dataset.reqref.split(':'); pickRef({ type, id: Number(id) }); return; }
    if (btn.dataset.answer) { duel.humanAnswer(btn.dataset.answer === 'yes'); run(); return; }
    if (btn.dataset.color) { duel.humanAnswer(btn.dataset.color); run(); return; }
    if (btn.hasAttribute('data-close-viewer') && (btn === ev.target || btn.tagName === 'BUTTON')) { ui.viewer = null; render(); return; }
    if (btn.dataset.grave !== undefined) { ui.viewer = Number(btn.dataset.grave); render(); return; }
    switch (btn.id) {
      case 'b-pass': duel.humanPass(); run(); return;
      case 'b-endturn': duel.humanEndTurn(); run(); return;
      case 'b-attack': { const ids = [...ui.attackers]; ui.attackers = new Set(); duel.humanAnswer(ids); run(); return; }
      case 'b-block': { if (!duel.validBlocks(ui.blocks)) { ui.message = 'Those blocks are not legal.'; render(); return; } const b = ui.blocks; ui.blocks = {}; ui.blocker = null; ui.message = ''; duel.humanAnswer(b); run(); return; }
      case 'b-choose': { const ids = [...(ui.choice || [])]; ui.choice = null; duel.humanAnswer(ids); run(); return; }
      case 'b-concede': if (confirm('Concede this duel? You will lose your ante card.')) { duel.end(1, `${me.name} concedes.`); run(); } return;
    }
    if (btn.classList.contains('stack-item')) { pickRef({ type: 'spell', id: Number(btn.dataset.stack) }); return; }
    if (btn.classList.contains('pbox')) { pickRef({ type: 'player', idx: Number(btn.dataset.player) }); return; }
    if (!btn.classList.contains('card') && !btn.classList.contains('pill')) return;
    const card = cardOf(btn.dataset.id); if (!card) return;
    const z = btn.dataset.zone;
    if (targeting()) { if (z === 'bf') pickRef({ type: 'perm', id: card.id }); else if (z === 'grave') pickRef({ type: 'card', id: card.id }); return; }
    if (ui.menu) return;
    const req = duel.pending?.req;
    if (req?.kind === 'attackers' && z === 'bf' && card.controller === 0) { if (!req.options.includes(card.id)) return; if (ui.attackers.has(card.id)) ui.attackers.delete(card.id); else ui.attackers.add(card.id); render(); return; }
    if (req?.kind === 'blockers' && z === 'bf') {
      if (card.controller === 0) {
        if (!isCreature(card) || card.tapped) return;
        for (const k of Object.keys(ui.blocks)) if (ui.blocks[k].includes(card.id)) { ui.blocks[k] = ui.blocks[k].filter(id => id !== card.id); if (!ui.blocks[k].length) delete ui.blocks[k]; ui.blocker = null; render(); return; }
        ui.blocker = ui.blocker === card.id ? null : card.id; render(); return;
      }
      if (duel.attackers.includes(card.id) && ui.blocker != null) {
        const b = cardOf(ui.blocker);
        if (!duel.canBlock(b, card)) { ui.message = `${b.def.name} cannot block ${card.def.name}.`; render(); return; }
        (ui.blocks[card.id] ||= []).push(ui.blocker); ui.blocker = null; ui.message = ''; render(); return;
      }
      return;
    }
    if (duel.pending?.type !== 'priority') return;
    if (z === 'hand' && card.controller === 0) { handMenu(card); return; }
    if (z === 'grave' && card.owner === 0) { if (duel.canCast(me, card)) { ui.viewer = null; startCast(card); } return; }
    if (z === 'bf' && card.controller === 0) { permMenu(card); return; }
  });
  root.addEventListener('change', ev => {
    const cb = ev.target.closest('input[data-choice]'); if (!cb) return;
    ui.choice ||= new Set(); const id = Number(cb.dataset.choice);
    if (cb.checked) ui.choice.add(id); else ui.choice.delete(id);
    const req = duel.pending?.req; if (req && req.max === 1 && ui.choice.size > 1) ui.choice = new Set([id]);
    render();
  });
  document.addEventListener('keydown', function onKey(ev) {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (ev.key === 'Escape') { ui.wizard = null; ui.menu = null; ui.viewer = null; render(); }
    if (ev.key === ' ' && duel.pending?.type === 'priority' && !ui.wizard && !ui.menu) { ev.preventDefault(); duel.humanPass(); run(); }
  });

  duel.onChange(() => { ui.message = ''; render(); });
  duel.start();
  run();
}
