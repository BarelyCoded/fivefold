// Duel screen for the rules core: renders state, drives the engine loop, collects human decisions,
// and plays the engine's visual-effect events (attacks, blocks, strikes, damage).
import { has, power, toughness, isCreature, isLand, isType, STEP_NAME, costText, abilitiesOf } from './engine.js';
import { artFor, hasOwnArt } from './collection.js';
import { costString, manaHtml, COLORS } from './cards.js';
import { spriteStyle, atlasReady } from './atlas.js';
import { onTokenArt } from './scryfall.js';
import { sfx } from './audio.js';
import { hintFor } from './tutorial.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const AUTOPASS_KEY = 'ff.autopass';
const getAutoPass = () => { try { return localStorage.getItem(AUTOPASS_KEY) === '1'; } catch { return false; } };
const setAutoPass = v => { try { localStorage.setItem(AUTOPASS_KEY, v ? '1' : '0'); } catch {} };
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
    <div class="card-top"><span class="card-name">${esc(def.name)}</span>${def.kind !== 'land' ? `<span class="card-cost">${manaHtml(def.cost)}</span>` : ''}</div>
    ${!art ? `<div class="card-body"><span class="card-type">${esc(def.typeLine)}</span></div>` : ''}
    ${hasOwnArt(def) ? '<span class="card-own" title="Your art">★</span>' : ''}
    ${pt ? `<div class="card-pt${opts.ptClass ? ' ' + opts.ptClass : ''}">${pt}</div>` : ''}
    ${opts.badge ? `<div class="card-badge">${esc(opts.badge)}</div>` : ''}
    ${opts.extra || ''}
  </div>`;
}

export function mountDuel(root, duel, { onEnd, ante, speed = 420, portraits = null, tutorial = false, localIdx = 0, input = null, allowMulligan = true, autoStart = true }) {
  // localIdx is which seat this client renders from (0 single-player/host, 1 guest). `input`, when given
  // (the guest), routes every action over the network instead of mutating the local mirror duel.
  const me = duel.players[localIdx], ai = duel.players[1 - localIdx];
  const act = input || {
    pass: () => duel.passFor(localIdx), endTurn: () => duel.endTurnFor(localIdx),
    cast: (c, o) => duel.castFor(localIdx, c, o), activate: (c, i, o) => duel.activateFor(localIdx, c, i, o),
    mana: (c, i, col) => duel.manaFor(localIdx, c, i, col), answer: v => duel.answerFor(localIdx, v),
    mulligan: () => duel.mulligan(localIdx), concede: () => duel.end(1 - localIdx, `${me.name} concedes.`),
  };
  const ui = { wizard: null, attackers: new Set(), blocks: {}, blocker: null, message: '', menu: null, viewer: null, choice: null, order: null };
  let finished = false, running = false;

  // Auto-pass: when the human holds priority but has no land to play, no spell to cast, and no
  // (non-mana) activated ability available, there is nothing to decide — skip the step for them.
  // Mana abilities alone don't count: adding mana with nothing to spend it on isn't a real play.
  function hasAnyPlay() {
    for (const c of me.hand) if (duel.canCast(me, c)) return true;
    for (const c of me.battlefield) { const abs = abilitiesOf(c); for (let i = 0; i < abs.length; i++) if (abs[i].type === 'activated' && duel.canActivate(me, c, i)) return true; }
    return false;
  }
  // Your creatures in combat that are about to take lethal damage and still have a usable ability to save
  // themselves (regenerate, a self-pump). Drives the "you can respond" nudge before combat damage lands.
  const firstStrikeC = c => has(c, 'First strike') || has(c, 'Double strike');
  function combatSavers() {
    if (!['attackers', 'blockers', 'firstStrike', 'damage'].includes(duel.step)) return [];
    if (duel.pending?.type !== 'priority' || duel.priority !== localIdx) return [];
    const out = [];
    for (const c of me.battlefield) {
      if (!isCreature(c)) continue;
      const isAtk = duel.attackers.includes(c.id);
      const isBlk = !isAtk && Object.values(duel.blocks).flat().includes(c.id);
      if (!isAtk && !isBlk) continue;
      let incoming = 0, foesFS = false;
      if (isAtk) { for (const id of (duel.blocks[c.id] || [])) { const b = cardOf(id); if (b) { incoming += power(b); foesFS = foesFS || firstStrikeC(b); } } }
      else { for (const [aid, bids] of Object.entries(duel.blocks)) if (bids.includes(c.id)) { const a = cardOf(aid); if (a) { incoming = Math.max(incoming, power(a)); foesFS = foesFS || firstStrikeC(a); } } }
      const left = toughness(c) - c.damage;
      if (left <= 0 || incoming < left) continue;                 // not lethal
      if (firstStrikeC(c) && !foesFS) continue;                   // it strikes first and likely wins — don't cry wolf
      if (abilitiesOf(c).some((ab, i) => ab.type === 'activated' && duel.canActivate(me, c, i))) out.push(c);
    }
    return out;
  }

  // ---- engine driver ----------------------------------------------------------------
  async function run() {
    if (running) return; running = true;
    try {
      if (input) {   // guest: never ticks. The host drives the authoritative game and streams snapshots;
        render(); const fxWait = playFx();   // we just render the mirror and surface the end of the game.
        if (duel.winner !== null && !finished) { finished = true; await sleep(Math.max(900, fxWait)); onEnd(duel.winner); }
        return;
      }
      for (let guard = 0; guard < 5000; guard++) {
        const r = duel.tick();
        render();
        const fxWait = playFx();
        if (r === 'over') { if (!finished) { finished = true; await sleep(Math.max(900, fxWait)); onEnd(duel.winner); } return; }
        if (r === 'wait') {
          if (getAutoPass() && duel.pending?.type === 'priority' && !ui.wizard && !ui.menu && !ui.paying && !hasAnyPlay() && act.pass()) continue;
          return;
        }
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
        case 'attack': for (const id of f.ids) elOf(id)?.classList.add('fx-attack'); sfx('attack'); wait = Math.max(wait, 450); break;
        case 'block': for (const id of f.blockers) elOf(id)?.classList.add('fx-block'); sfx('block'); wait = Math.max(wait, 450); break;
        case 'strike':
          for (const id of f.attackers) elOf(id)?.classList.add('fx-lunge');
          for (const ids of Object.values(f.blocks)) for (const id of ids) elOf(id)?.classList.add('fx-lunge');
          sfx('hit'); wait = Math.max(wait, 650); break;
        case 'damage': {
          const t = f.player !== undefined ? pboxOf(f.player) : elOf(f.target);
          if (t) { t.classList.add('fx-hit'); floatText(t, `-${f.amount}`, 'fx-dmg'); }
          if (f.player !== undefined) sfx('hit');
          wait = Math.max(wait, 750); break;
        }
        case 'cast': { const s = root.querySelector('.stack-item.top'); if (s) s.classList.add('fx-cast'); sfx('cast'); wait = Math.max(wait, 300); break; }
        case 'land': sfx('land'); break;
        case 'die': { const z = f.controller === 0 ? '.zone.mine .field' : '.zone.opp .field'; floatText(root.querySelector(z), `${f.name} ✝`, 'fx-die'); sfx('die'); wait = Math.max(wait, 500); break; }
        case 'chaosOrb': chaosConfetti(f.orb, f.victims); sfx('die'); wait = Math.max(wait, 1150); break;
      }
    }
    return wait;
  }
  // Chaos Orb: shower torn paper from the orb across the table, converging on the doomed permanents.
  function chaosConfetti(orbId, victimIds = []) {
    const table = root.querySelector('.table'); if (!table) return;
    const tr = table.getBoundingClientRect();
    const orbEl = elOf(orbId);
    const src = orbEl ? orbEl.getBoundingClientRect() : { left: tr.left + tr.width / 2, top: tr.top + tr.height / 2, width: 0, height: 0 };
    const sx = src.left - tr.left + src.width / 2, sy = src.top - tr.top + src.height / 2;
    const ends = [];
    for (const id of victimIds) { const el = elOf(id); if (el) { const r = el.getBoundingClientRect(); ends.push([r.left - tr.left + r.width / 2, r.top - tr.top + r.height / 2]); if (el.classList) el.classList.add('fx-hit'); } }
    const hue = ['#efe8d4', '#ddd0b0', '#c9a367', '#b8b3a5', '#e7d9b8'];
    const count = Math.max(14, ends.length * 4);
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      piece.className = 'fx-confetti';
      piece.style.left = sx + 'px'; piece.style.top = sy + 'px';
      piece.style.background = hue[i % hue.length];
      const end = (ends.length && i % 2 === 0) ? ends[i % ends.length] : [Math.random() * tr.width, Math.random() * tr.height];
      const dx = end[0] - sx + (Math.random() - 0.5) * 34, dy = end[1] - sy + (Math.random() - 0.5) * 34;
      const rot = (Math.random() * 720 - 360).toFixed(0);
      table.appendChild(piece);
      requestAnimationFrame(() => { piece.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${rot}deg)`; piece.style.opacity = '0'; });
      setTimeout(() => piece.remove(), 1250);
    }
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
    if (owner === me && duel.pending?.type === 'priority' && (abilitiesOf(c).some((ab, i) => ab.type === 'activated' && duel.canActivate(me, c, i)) || c.def.manaAbilities.length)) classes.push('usable');
    if (ui.paying && owner === me && !c.tapped && c.def.manaAbilities.length) classes.push('pay-source');
    let pt = '', ptClass = '';
    if (isCreature(c)) { pt = `${power(c)}/${toughness(c) - c.damage}`; if (c.damage || power(c) !== c.def.power || toughness(c) !== c.def.toughness) ptClass = 'mod'; }
    const kws = [...c.cur.kw].filter(k => typeof k === 'string' ? !['Changeling'].includes(k) : true);
    const badge = kws.length ? kws.map(KW_ABBR).join(' ') : '';
    let extra = '';
    const counters = Object.entries(c.counters).filter(([k, v]) => v > 0 && k !== 'age').map(([k, v]) => `${v}×${k}`);
    if (counters.length) extra += `<div class="card-counters">${esc(counters.join(' '))}</div>`;
    if (c.regen) extra += `<div class="card-regen">regen</div>`;
    if (c.shield) extra += `<div class="card-shield">shield ${c.shield}</div>`;
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
      ${portraitHtml(p)}
      <div class="pinfo">
      <div class="pname">${esc(p.name)}</div>
      <div class="plife">${p.life}</div>
      ${p.poison ? `<div class="ppoison">☠ ${p.poison}</div>` : ''}
      ${p.shield || p.cop?.length ? `<div class="pshield" title="Damage prevention this turn">🛡 ${[p.shield ? `${p.shield}` : '', ...(p.cop || []).map(f => f === 'artifact' ? 'artifact' : f)].filter(Boolean).join(' ')}</div>` : ''}
      ${gems(p)}
      <div class="pmeta"><span title="Hand">✋ ${p.hand.length}</span><span title="Library">▤ ${p.library.length}</span><span class="link" data-grave="${p.idx}" title="Graveyard">✝ ${p.graveyard.length}</span>${p.exile.length ? `<span title="Exile">◌ ${p.exile.length}</span>` : ''}</div>
      </div>
    </div>`;
  }
  function portraitHtml(p) {
    const pr = portraits && (p.idx === localIdx ? portraits.me : portraits.foe);
    if (!pr || !atlasReady()) return '';
    // Static portrait: always the first frame. The idle frame-swap animation is disabled because
    // frames of different sizes resized the portrait box and shifted the duel layout.
    return `<div class="portrait" data-portrait="${p.idx}" style="${spriteStyle(pr.frames[0], pr.scale || 2)}"></div>`;
  }
  function landStack(p) {
    const groups = new Map();
    // A land that is currently a creature (an animated manland like Mishra's Factory) shows in the
    // creature row instead, so it can be declared as an attacker/blocker — not twice here as well.
    for (const c of p.battlefield.filter(c => isLand(c) && !isCreature(c))) { const g = groups.get(c.def.name) || { name: c.def.name, def: c.def, all: [] }; g.all.push(c); groups.set(c.def.name, g); }
    const items = [...groups.values()].map(g => {
      const untapped = g.all.filter(c => !c.tapped);
      const first = untapped[0] || g.all[0];
      const cls = ['pill', `c-${g.def.produces?.[0] || 'C'}`];
      if (!untapped.length) cls.push('tapped');
      if (targeting() && g.all.some(c => isLegal({ type: 'perm', id: c.id }))) cls.push('targetable');
      const target = targeting() ? (g.all.find(c => isLegal({ type: 'perm', id: c.id })) || first) : first;
      if (p === me && duel.pending?.type === 'priority' && untapped.length) cls.push('usable');
      if (ui.paying && p === me && untapped.length && g.def.manaAbilities.length) cls.push('pay-source');
      return `<div class="${cls.join(' ')}" data-id="${target.id}" data-zone="bf" data-name="${esc(g.name)}"><i></i>${esc(g.name)}<b>${untapped.length}/${g.all.length}</b></div>`;
    });
    return `<div class="lands"><div class="lands-title">Lands</div>${items.join('') || '<div class="small">none</div>'}</div>`;
  }
  const notAttached = c => !c.attachedTo;
  const permsOf = p => p.battlefield.filter(c => !isCreature(c) && !isLand(c) && notAttached(c)).map(c => bfCard(c, p)).join('');
  const creaturesOf = p => p.battlefield.filter(isCreature).map(c => bfCard(c, p)).join('');

  function stackHtml() {
    if (!duel.stack.length) return '';
    const items = duel.stack.slice().reverse();
    return `<div class="stack"><div class="stack-title">Stack<span>${items.length}</span></div><div class="stack-tray">${items.map((it, i) => {
      const classes = ['stack-item'];
      if (i === 0) classes.push('top');
      if (targeting() && isLegal({ type: 'spell', id: it.id })) classes.push('targetable');
      if (it.controller === 1) classes.push('theirs');
      const kind = it.kind === 'spell' ? '' : it.kind === 'trigger' ? 'trigger' : 'ability';
      const html = cardHtml(it.card.def, { id: it.card.id, zone: 'stack', classes, badge: kind || undefined });
      return html.replace('<div class="card ', `<div data-stack="${it.id}" class="card `);
    }).join('')}</div></div>`;
  }

  // ---- targeting and combat arrows, drawn over the table after every render ----------------
  const ARROW_COLOR = { damage: '#ff5a3c', destroy: '#ff5a3c', exile: '#ff5a3c', bounce: '#ff9a3c', fight: '#ff5a3c', damageEqualPower: '#ff5a3c', tap: '#ffb347', freeze: '#ffb347', discard: '#ff9a3c', control: '#d060ff', counter: '#c070ff', pump: '#6fe08a', grant: '#6fe08a', regenerate: '#6fe08a', counters: '#6fe08a', untap: '#6fe08a', gain: '#6fe08a', draw: '#8fd0ff', fromGraveyard: '#8fd0ff', attack: '#ff8a3a', block: '#7fc4ff' };
  function targetEl(t) {
    if (!t) return null;
    if (t.type === 'player') return root.querySelector(`.pbox[data-player="${t.idx}"]`);
    if (t.type === 'perm') return root.querySelector(`[data-zone="bf"][data-id="${t.id}"]`);
    if (t.type === 'spell') return root.querySelector(`.stack-item[data-stack="${t.id}"]`);
    if (t.type === 'card') return root.querySelector(`.card[data-id="${t.id}"]`);
    return null;
  }
  function drawArrows() {
    const table = root.querySelector('.table'); if (!table) return;
    const old = table.querySelector('svg.arrows'); if (old) old.remove();
    const tr = table.getBoundingClientRect();
    const center = el => { const r = el.getBoundingClientRect(); return [r.left - tr.left + r.width / 2, r.top - tr.top + r.height / 2]; };
    const arrows = [];
    for (const it of duel.stack) {
      const from = root.querySelector(`.stack-item[data-stack="${it.id}"]`); if (!from) continue;
      const kind = (it.effects || []).find(e => e.type)?.type;
      for (const t of it.targets || []) { const to = targetEl(t); if (to) arrows.push({ from, to, color: ARROW_COLOR[kind] || '#e3c56a', width: 3 }); }
    }
    if (duel.attackers.length && ['attackers', 'blockers', 'firstStrike', 'damage'].includes(duel.step)) {
      const def = root.querySelector(`.pbox[data-player="${1 - duel.active}"]`);
      for (const id of duel.attackers) { const from = targetEl({ type: 'perm', id }); if (from && def && !(duel.blocks[id] || []).length) arrows.push({ from, to: def, color: ARROW_COLOR.attack, width: 2, dash: true }); }
      const blocks = Object.keys(duel.blocks).length ? duel.blocks : ui.blocks;
      for (const [aid, bids] of Object.entries(blocks)) for (const bid of bids) { const from = targetEl({ type: 'perm', id: Number(bid) }), to = targetEl({ type: 'perm', id: Number(aid) }); if (from && to) arrows.push({ from, to, color: ARROW_COLOR.block, width: 3 }); }
    }
    if (ui.wizard?.stage === 'targets') for (const t of ui.wizard.targets) { const from = root.querySelector(`.card[data-id="${ui.wizard.card.id}"]`), to = targetEl(t); if (from && to) arrows.push({ from, to, color: '#e3c56a', width: 2, dash: true }); }
    if (!arrows.length) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'arrows'); svg.setAttribute('width', tr.width); svg.setAttribute('height', tr.height);
    const defs = [];
    const paths = arrows.map((a, i) => {
      const [x1, y1] = center(a.from), [x2, y2] = center(a.to);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      // shorten so the head lands on the target's edge, and bow the curve sideways
      const ex = x2 - dx / len * 34, ey = y2 - dy / len * 34;
      const mx = (x1 + ex) / 2 - dy / len * Math.min(60, len * 0.25), my = (y1 + ey) / 2 + dx / len * Math.min(60, len * 0.25);
      defs.push(`<marker id="ah${i}" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,5 L0,10 z" fill="${a.color}"/></marker>`);
      return `<path d="M${x1},${y1} Q${mx},${my} ${ex},${ey}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="${a.width + 3}" stroke-linecap="round"/><path d="M${x1},${y1} Q${mx},${my} ${ex},${ey}" fill="none" stroke="${a.color}" stroke-width="${a.width}" stroke-linecap="round" ${a.dash ? 'stroke-dasharray="8 6"' : ''} marker-end="url(#ah${i})"/>`;
    });
    svg.innerHTML = `<defs>${defs.join('')}</defs>${paths.join('')}`;
    table.appendChild(svg);
  }
  function phaseStrip() {
    const cur = COMBAT_STEPS.has(duel.step) ? 'combat' : duel.step === 'cleanup' ? 'end' : duel.step;
    return `<div class="phases ${duel.active === 0 ? 'mine' : 'theirs'}"><div class="phases-who">${duel.active === 0 ? 'Your turn' : esc(ai.name)}</div>${PHASES.map(([k, label, icon]) => `<div class="phase${k === cur ? ' on' : ''}"><span class="ph-icon">${icon}</span><span class="ph-label">${label}</span></div>`).join('')}<div class="phases-step">${esc(STEP_NAME[duel.step] || duel.step)}</div></div>`;
  }

  function tutor() {
    if (!tutorial) return '';
    const h = hintFor(duel, me, ui);
    return h ? `<div class="tutor"><b>${esc(h.title)}</b><div>${esc(h.text)}</div></div>` : '';
  }
  function controls() {
    if (duel.winner !== null) return '';
    if (ui.paying) {
      const c = ui.paying.card;
      const poolStr = COLORS.concat('C').filter(col => me.pool[col] > 0).map(col => `${me.pool[col]}${col}`).join(' ') || 'nothing';
      const ready = duel.canCast(me, c, { ...ui.paying.opts, poolOnly: true });
      return `<div class="hint">Casting <b>${esc(c.def.name)}</b> ${manaHtml(c.def.cost)} — tap the glowing lands to pay it yourself.</div>
        <div class="msg">In your pool: ${poolStr}</div>
        ${ready ? '<button class="btn primary" id="b-pay-cast">Cast it</button>' : ''}
        <button class="btn ghost" id="b-pay-cancel">Cancel</button>`;
    }
    if (ui.menu) return `<div class="hint">${esc(ui.menu.title)}</div>${ui.menu.items.map((it, i) => `<button class="btn${it.primary ? ' primary' : ''}" data-menu="${i}" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}</button>`).join('')}<button class="btn ghost" data-menu="cancel">Cancel</button>`;
    if (ui.wizard) {
      const w = ui.wizard;
      if (w.stage === 'x') return `<div class="hint">Choose X for <b>${esc(w.card.def.name)}</b> (max ${w.maxX})</div><div class="xrow"><input id="xval" type="number" min="0" max="${w.maxX}" value="${w.maxX}"><button class="btn primary" data-wiz="x">OK</button></div><button class="btn ghost" data-wiz="cancel">Cancel</button>`;
      if (w.stage === 'targets') { const spec = w.specs[w.targets.length]; return `<div class="hint">${esc(spec.text)} for <b>${esc(w.card.def.name)}</b>. Click it on the table.</div>${spec.options.some(o => o.type === 'card') ? spec.options.map(o => `<button class="btn small" data-wizref="${o.type}:${o.id}">${esc(o.label)}</button>`).join('') : ''}<button class="btn ghost" data-wiz="cancel">Cancel</button>`; }
    }
    const pend = duel.pending;
    // On the guest's mirror, mpWaitingOn names who the host is waiting on; fall back to priority elsewhere.
    if (!pend) return `<div class="hint">${esc(duel.players[duel.mpWaitingOn ?? duel.priority]?.name || '')} is thinking…</div>`;
    if (pend.type === 'priority') {
      // In multiplayer the host holds the real pending even during the opponent's priority — show a
      // waiting hint (not an inert pass button) whenever it is not this seat's turn to act.
      if (duel.priority !== localIdx) return `<div class="hint waiting">${esc(duel.players[duel.priority]?.name || '')} is thinking…</div>`;
      const stackTop = duel.stack.length;
      const mine = duel.active === localIdx;
      const canAtk = mine && duel.step === 'main1' && me.battlefield.some(c => duel.canAttack(c));
      const passLabel = stackTop ? 'Pass (let it resolve)' : mine && duel.step === 'main1' ? (canAtk ? 'Go to combat' : 'Next phase') : mine && duel.step === 'main2' ? 'End turn' : 'Pass';
      const savers = combatSavers();
      const nudge = savers.length ? `<div class="msg combat-nudge">⚠ ${esc(savers.map(c => c.def.name).join(', '))} ${savers.length > 1 ? 'are' : 'is'} about to die in combat — click ${savers.length > 1 ? 'one' : 'it'} to use its ability before damage.</div>` : '';
      return `${nudge}<div class="hint">You have priority${stackTop ? ' — respond or pass' : ''}. Click a card in hand to cast it, or a permanent to use its abilities. Space passes.</div>
        <button id="b-pass" class="btn primary">${passLabel}</button><button id="b-endturn" class="btn" title="Pass priority automatically until the next turn begins">${mine ? 'Skip to end of turn' : 'Stop asking this turn'}</button>
        <label class="autopass" title="When you have no land, spell, or ability you could use, pass for you automatically"><input type="checkbox" id="cb-autopass" ${getAutoPass() ? 'checked' : ''}> Auto-pass empty steps</label>`;
    }
    const req = pend.req;
    if (req.player !== localIdx) return `<div class="hint waiting">${esc(duel.players[req.player]?.name || '')} is thinking…</div>`;
    switch (req.kind) {
      case 'attackers': return `<div class="hint">Declare attackers: click your creatures.${req.must.length ? ' Some must attack.' : ''}</div><button id="b-attack" class="btn primary">Confirm ${ui.attackers.size ? `(${ui.attackers.size})` : 'no attack'}</button><button id="b-attack-all" class="btn" title="Attack with every creature that can attack">Attack with all (${req.options.length})</button>`;
      case 'blockers': return `<div class="hint">Declare blockers: click one of your creatures, then the attacker it blocks. Click a blocker again to clear it.</div><button id="b-block" class="btn primary">Confirm blocks</button>`;
      case 'yesno': return `<div class="hint">${esc(req.text)}</div><button class="btn primary" data-answer="yes">Yes</button><button class="btn" data-answer="no">No</button>`;
      case 'color': return `<div class="hint">${esc(req.text)}</div>${COLORS.map(c => `<button class="btn" data-color="${c}">${c}</button>`).join('')}`;
      case 'target': return `<div class="hint">${esc(req.text)} — click it on the table.</div>${req.options.filter(o => o.type === 'card').map(o => `<button class="btn small" data-reqref="${o.type}:${o.id}">${esc(o.label)}</button>`).join('')}`;
      case 'look': return `<div class="hint">${esc(req.text)}.</div><div class="choices">${req.options.map((o, i) => `<div class="choice" data-preview="${esc(o.label)}">${i + 1}. ${esc(o.label)}</div>`).join('')}</div><button class="btn primary" id="b-look">OK</button>`;
      case 'order': {
        if (!ui.order || ui.order.length !== req.options.length || ui.order.some(id => !req.options.some(o => o.id === id))) ui.order = req.options.map(o => o.id);
        const label = id => req.options.find(o => o.id === id)?.label || '';
        return `<div class="hint">${esc(req.text)}. ${esc(req.note || 'The first card is drawn first.')}</div><div class="choices">${ui.order.map((id, i) => `<div class="choice" data-preview="${esc(label(id))}"><button class="btn small" data-order="up" data-idx="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button><button class="btn small" data-order="down" data-idx="${i}" ${i === ui.order.length - 1 ? 'disabled' : ''} title="Move down">▼</button> ${i + 1}. ${esc(label(id))}</div>`).join('')}</div><button class="btn primary" id="b-order">OK</button>`;
      }
      case 'choose': {
        if (cardChoiceActive()) return `<div class="hint">${esc(req.text)} — pick from the cards shown, then Confirm.</div>`;
        const sel = ui.choice || new Set();
        return `<div class="hint">${esc(req.text)}${req.min === req.max ? '' : ` (${req.min}–${req.max})`}</div><div class="choices">${req.options.map(o => `<label class="choice" data-preview="${esc(o.label)}"><input type="checkbox" data-choice="${o.id}" ${sel.has(o.id) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}</div><button class="btn primary" id="b-choose" ${sel.size < req.min || sel.size > req.max ? 'disabled' : ''}>OK</button>`;
      }
      case 'divide': {
        // Divide the attacker's power among its blockers (modern rules — no ordering). Default to lethal on
        // the cheapest blockers first so a straight "kill them" only needs a confirm.
        if (!ui.divide || ui.divide.reqId !== req.source || ui.divide.total !== req.total) {
          const map = {}; let rem = req.total;
          req.targets.slice().sort((a, b) => a.lethal - b.lethal).forEach((t, i, arr) => { if (rem <= 0) return; let give = Math.min(rem, t.lethal); if (i === arr.length - 1 && !req.trample) give = rem; map[t.id] = give; rem -= give; });
          ui.divide = { reqId: req.source, total: req.total, map, player: req.trample ? rem : 0 };
        }
        const d = ui.divide;
        const onBlockers = req.targets.reduce((s, t) => s + (d.map[t.id] || 0), 0);
        const assigned = onBlockers + (req.trample ? d.player : 0);
        const remaining = req.total - assigned;
        const allLethal = req.targets.every(t => (d.map[t.id] || 0) >= t.lethal);
        const legal = remaining === 0 && (!req.trample || d.player === 0 || allLethal);
        const oppName = duel.opponentOf(me).name;
        const row = (id, name, lethalTxt, val, plusOff) => `<div class="divrow"><span class="nm">${esc(name)}</span><span class="lth small">${lethalTxt}</span><span class="stp"><button class="btn tiny" data-div="${id}" data-dir="-1" ${val <= 0 ? 'disabled' : ''}>−</button><b>${val}</b><button class="btn tiny" data-div="${id}" data-dir="1" ${plusOff ? 'disabled' : ''}>+</button></span></div>`;
        return `<div class="hint">${esc(req.note)}</div>
          <div class="divlist">${req.targets.map(t => row(String(t.id), t.label, `lethal ${t.lethal}`, d.map[t.id] || 0, remaining <= 0)).join('')}
          ${req.trample ? row('player', `${oppName} (trample)`, allLethal ? 'ready' : 'lethal each blocker first', d.player, remaining <= 0 || !allLethal) : ''}</div>
          ${remaining !== 0 ? `<div class="msg">Remaining to assign: ${remaining}</div>` : req.trample && !legal ? '<div class="msg">Give each blocker lethal before trampling over.</div>' : '<div class="hint">All damage assigned.</div>'}
          <button class="btn primary" id="b-divide" ${legal ? '' : 'disabled'}>Deal damage</button>`;
      }
    }
    return '';
  }

  function template() {
    return `
    <div class="duel">
      <aside class="rail">${phaseStrip()}<div class="controls">${tutor()}${controls()}${ui.message ? `<div class="msg">${esc(ui.message)}</div>` : ''}</div></aside>
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
        <div class="log">${duel.log.slice(-18).map(l => `<div>${esc(l)}</div>`).join('')}</div>
        <button id="b-concede" class="btn small ghost">Concede</button>
      </aside>
      ${ui.viewer !== null ? viewerHtml() : ''}
      ${ui.mulligan ? mulliganHtml() : ''}
      ${cardChoiceActive() ? cardChoiceHtml() : ''}
    </div>`;
  }
  // A card-selection request (search your library, discard, sacrifice, scry…) shown like the graveyard:
  // the cards laid out in a row you scroll through and click, instead of a cramped checkbox list.
  function cardChoiceActive() {
    const req = duel.pending?.req;
    return !!(req && req.kind === 'choose' && req.options && req.options.length && req.options.every(o => o && o.id != null && cardOf(o.id)));
  }
  function cardChoiceHtml() {
    const req = duel.pending.req;
    if (ui.choice && [...ui.choice].some(id => !req.options.some(o => o.id === id))) ui.choice = null;   // stale from a prior request
    const sel = ui.choice || new Set();
    const cards = req.options.map(o => cardOf(o.id)).filter(Boolean);
    const rangeTxt = req.min === req.max ? (req.max === 1 ? 'Choose one' : `Choose ${req.max}`) : req.min === 0 ? `Choose up to ${req.max}` : `Choose ${req.min}–${req.max}`;
    const okN = sel.size >= req.min && sel.size <= req.max;
    return `<div class="overlay"><div class="modal wide pickmodal">
      <h3>${esc(req.text)}</h3>
      <div class="pickrow">${cards.length ? cards.map(c => cardHtml(c.def, { id: c.id, zone: 'pick', classes: sel.has(c.id) ? ['chosen'] : [] })).join('') : '<p class="small">No matching cards.</p>'}</div>
      <div class="pickfoot"><span class="small">${rangeTxt}${req.secret ? ' · shuffled afterward' : ''} · ${sel.size} selected</span>
        <button class="btn primary" id="b-choose" ${okN ? '' : 'disabled'}>${req.min === 0 && sel.size === 0 ? 'Take none' : 'Confirm'}</button></div>
    </div></div>`;
  }
  function mulliganHtml() {
    const lands = me.hand.filter(isLand).length;
    const canMull = lands <= 1;
    return `<div class="overlay"><div class="modal wide">
      <h3>Opening hand</h3>
      <p class="small">You drew <b>${lands} land${lands === 1 ? '' : 's'}</b> in ${me.hand.length} cards.${canMull ? ' A land-light hand — you may shuffle it back and redraw, free of charge.' : ' A workable hand.'}</p>
      <div class="viewer">${me.hand.map(c => cardHtml(c.def, { id: c.id, zone: 'mull' })).join('')}</div>
      <div class="btnrow"><button class="btn primary" id="b-mull-keep">Keep this hand</button><button class="btn" id="b-mull-again" ${canMull ? '' : 'disabled'}>Mulligan</button></div>
    </div></div>`;
  }
  function viewerHtml() {
    const p = duel.players[ui.viewer];
    return `<div class="overlay" data-close-viewer><div class="modal wide"><h3>${esc(p.name)}'s graveyard</h3><div class="viewer">${p.graveyard.length ? p.graveyard.slice().reverse().map(c => cardHtml(c.def, { id: c.id, zone: 'grave', classes: p === me && duel.canCast(me, c) ? ['castable'] : [] })).join('') : '<p class="small">Empty.</p>'}</div><button class="btn" data-close-viewer>Close</button></div></div>`;
  }
  function render() { root.innerHTML = template(); drawArrows(); }
  onTokenArt(() => { if (root.isConnected) render(); }); // a token's picture arrived: show it

  // ---- cast wizard -------------------------------------------------------------------
  function startCast(card, base = {}, auto = false) {
    const info = duel.castOptions(me, card);
    const w = { card, opts: { ...base }, info, stage: null, targets: [], specs: [], auto };
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
    finishCast(w);
  }
  // Double-click (auto): let the engine tap whatever it needs. Single-click (manual): pay from the pool
  // the player taps, so they choose which lands are used — casting the moment the pool covers the cost.
  function finishCast(w) {
    const { card, opts } = w;
    if (w.auto) {
      if (!act.cast(card, opts)) { ui.message = 'That could not be cast.'; render(); return; }
      run(); return;
    }
    if (duel.canCast(me, card, { ...opts, poolOnly: true })) { castPoolOnly(card, opts); return; }
    ui.paying = { card, opts }; ui.menu = null; render();
  }
  function castPoolOnly(card, opts) {
    ui.paying = null;
    if (!act.cast(card, { ...opts, poolOnly: true })) { ui.message = 'That could not be cast.'; render(); return; }
    run();
  }
  // Which colours / how much generic the current pool still can't cover (for glow + smart land tapping).
  function neededMana(card) {
    const cost = card.def.cost || { pips: [], generic: 0 };
    const pool = { ...me.pool };
    const colors = new Set();
    for (const pip of (cost.pips || [])) { const col = pip.find(c => pool[c] > 0); if (col) pool[col]--; else pip.forEach(c => colors.add(c)); }
    let generic = cost.generic || 0;
    let spare = Object.values(pool).reduce((a, b) => a + b, 0);
    generic = Math.max(0, generic - spare);
    return { colors, generic };
  }
  function tapToward(card) {
    if (!ui.paying) return;
    const need = neededMana(ui.paying.card);
    let choice = null;
    card.def.manaAbilities.forEach((ma, i) => { if (choice || (ma.cost.tap && card.tapped)) return; const col = ma.produces.find(c => need.colors.has(c)) || ma.produces[0]; choice = { i, col }; });
    if (!choice) return;
    act.mana(card, choice.i, choice.col);
    if (duel.canCast(me, ui.paying.card, { ...ui.paying.opts, poolOnly: true })) castPoolOnly(ui.paying.card, ui.paying.opts);
    else render();
  }
  // Single vs double click on a hand card. Auto (double) lets the engine pay; manual (single) makes you tap.
  function handClick(card, auto) {
    if (duel.pending?.type !== 'priority') return;
    const canCast = duel.canCast(me, card), canCycle = duel.canCast(me, card, { cycling: true });
    if (!canCast && !canCycle) { ui.message = card.def.kind === 'unsupported' ? 'This card is not supported by the engine yet.' : 'Cannot play that now.'; render(); return; }
    if (canCast && canCycle) {
      ui.menu = { title: card.def.name, items: [
        { label: card.def.kind === 'land' ? 'Play' : (auto ? 'Cast (auto-pay)' : 'Cast (tap your own mana)'), primary: true, action: () => { ui.menu = null; startCast(card, {}, auto); } },
        { label: 'Cycle', action: () => { ui.menu = null; act.cast(card, { cycling: true }); run(); } },
      ] }; render(); return;
    }
    if (canCast) { startCast(card, {}, auto); return; }
    act.cast(card, { cycling: true }); run();
  }
  // Double-click a permanent with exactly one unambiguous ability -> use it straight away (Vampire Bats,
  // Llanowar Elves). Anything more (a choice of colours or several abilities) still opens the menu.
  function permDblClick(card) {
    if (duel.pending?.type !== 'priority' || card.controller !== 0) return;
    const manas = []; card.def.manaAbilities.forEach((ma, i) => { if (!card.tapped || !ma.cost.tap) manas.push({ i, ma }); });
    const acts = []; abilitiesOf(card).forEach((ab, i) => { if (ab.type === 'activated' && duel.canActivate(me, card, i)) acts.push({ i, ab }); });
    if (acts.length === 1 && manas.length === 0) { startActivate(card, acts[0].i); return; }
    if (manas.length === 1 && acts.length === 0 && manas[0].ma.produces.length === 1) { act.mana(card, manas[0].i, manas[0].ma.produces[0]); render(); return; }
    permMenu(card);
  }
  // Distinguish a single click (menu / manual cast) from a double click (auto / one-shot ability).
  let clickTimer = null, clickId = null;
  function scheduleCardClick(card, z) {
    if (clickTimer && clickId === card.id) { clearTimeout(clickTimer); clickTimer = null; clickId = null; if (z === 'hand') handClick(card, true); else permDblClick(card); return; }
    if (clickTimer) clearTimeout(clickTimer);
    clickId = card.id;
    clickTimer = setTimeout(() => { clickTimer = null; clickId = null; if (!root.isConnected) return; if (z === 'hand') handClick(card, false); else permMenu(card); }, 230);
  }
  function startActivate(card, i) {
    const info = duel.activateOptions(me, card, i);
    const ab = abilitiesOf(card)[i];
    const w = { card, ability: i, info, opts: { targets: [] }, targets: [], specs: info.targets, stage: null };
    ui.wizard = w;
    const step = () => {
      if (info.x && !('x' in w.opts)) { let maxX = 0; for (let x = 20; x >= 0; x--) if (duel.canPay(me, ab.cost.mana, x)) { maxX = x; break; } w.maxX = maxX; w.stage = 'x'; w.onX = v => { w.opts.x = v; step(); }; render(); return; }
      if (info.sacrifice && !('sacrifice' in w.opts)) { ui.menu = { title: `Sacrifice a ${ab.cost.sacrifice}`, items: info.sacrifice.map(id => ({ label: duel.card(id).def.name, action: () => { w.opts.sacrifice = id; ui.menu = null; step(); } })) }; render(); return; }
      if (info.discard && !('discard' in w.opts)) { ui.menu = { title: 'Discard a card', items: info.discard.map(id => ({ label: duel.card(id).def.name, action: () => { w.opts.discard = [id]; ui.menu = null; step(); } })) }; render(); return; }
      if (w.targets.length < w.specs.length) { w.stage = 'targets'; render(); return; }
      w.opts.targets = w.targets; ui.wizard = null;
      if (!act.activate(card, i, w.opts)) { ui.message = 'That ability could not be activated.'; render(); return; }
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
    if (duel.pending?.req?.kind === 'target') { if (!isLegal(ref)) return; act.answer(ref); run(); }
  }
  // Menu label for an activated ability: cost, then the effect with ~ resolved to the card's own name
  // and a capital first letter — so "{b}: regenerate ~." reads as "Regenerate Drudge Skeletons ({B})".
  function abilityLabel(card, ab) {
    let body = (ab.text || '').split(': ').slice(1).join(': ').replace(/~/g, card.def.name).replace(/\s*\.\s*$/, '').trim();
    if (body) body = body.charAt(0).toUpperCase() + body.slice(1);
    return `${body || 'Ability'} (${costText(ab.cost)})`.slice(0, 90);
  }
  function permMenu(card) {
    const items = [];
    card.def.manaAbilities.forEach((ma, i) => { const ok = !card.tapped || !ma.cost.tap; for (const col of (ma.produces.length > 1 ? ma.produces : [ma.produces[0]])) items.push({ label: `Add ${ma.amount || 1} ${col} mana (${costText(ma.cost)})`, disabled: !ok, mana: true, action: () => { ui.menu = null; act.mana(card, i, col); render(); } }); });
    abilitiesOf(card).forEach((ab, i) => { if (ab.type !== 'activated') return; items.push({ label: abilityLabel(card, ab), disabled: !duel.canActivate(me, card, i), action: () => { ui.menu = null; startActivate(card, i); } }); });
    if (!items.length) return;
    // A land / mana rock with a single unambiguous mana ability: tap it straight for mana, no menu.
    const enabled = items.filter(it => !it.disabled);
    if (enabled.length === 1 && enabled[0].mana) { enabled[0].action(); return; }
    ui.menu = { title: card.def.name, items }; render();
  }
  function handMenu(card) {
    const items = [];
    if (duel.canCast(me, card)) items.push({ label: card.def.kind === 'land' ? 'Play' : 'Cast', primary: true, action: () => { ui.menu = null; startCast(card); } });
    if (duel.canCast(me, card, { cycling: true })) items.push({ label: 'Cycle', action: () => { ui.menu = null; act.cast(card, { cycling: true }); run(); } });
    if (!items.length) { ui.message = card.def.kind === 'unsupported' ? 'This card is not supported by the engine yet.' : 'Cannot play that now.'; render(); return; }
    if (items.length === 1) { items[0].action(); return; }
    ui.menu = { title: card.def.name, items }; render();
  }

  // ---- events --------------------------------------------------------------------------
  root.addEventListener('click', ev => {
    const btn = ev.target.closest('button, [data-grave], [data-close-viewer], .stack-item, .pbox, .card, .pill');
    if (!btn) return;
    if (ui.mulligan) {   // the opening-hand overlay swallows all other clicks
      if (btn.id === 'b-mull-keep') { ui.mulligan = false; render(); run(); }
      else if (btn.id === 'b-mull-again') { act.mulligan(); ui.mulligan = me.hand.filter(isLand).length <= 1; render(); if (!ui.mulligan) run(); }
      return;
    }
    if (ui.paying) {   // manual-mana mode: tap your own lands to pay for the pending spell
      if (btn.id === 'b-pay-cancel') { ui.paying = null; render(); return; }
      if (btn.id === 'b-pay-cast') { castPoolOnly(ui.paying.card, ui.paying.opts); return; }
      if ((btn.classList.contains('card') || btn.classList.contains('pill')) && btn.dataset.zone === 'bf') { const c = cardOf(btn.dataset.id); if (c && c.controller === 0 && !c.tapped && c.def.manaAbilities.length) tapToward(c); }
      return;
    }
    if (cardChoiceActive()) {   // card-picker overlay: click cards to select, then Confirm
      const req = duel.pending.req;
      if (btn.id === 'b-choose') { const sel = ui.choice || new Set(); if (sel.size >= req.min && sel.size <= req.max) { ui.choice = null; act.answer([...sel]); run(); } return; }
      if (btn.classList.contains('card') && btn.dataset.zone === 'pick') { const c = cardOf(btn.dataset.id); if (c) { ui.choice ||= new Set(); if (ui.choice.has(c.id)) ui.choice.delete(c.id); else if (req.max === 1) ui.choice = new Set([c.id]); else if (ui.choice.size < req.max) ui.choice.add(c.id); render(); } return; }
      return;
    }
    if (btn.dataset.menu !== undefined) { if (btn.dataset.menu === 'cancel') { ui.menu = null; ui.wizard = null; render(); } else { const it = ui.menu.items[Number(btn.dataset.menu)]; if (it && !it.disabled) it.action(); } return; }
    if (btn.dataset.wiz === 'cancel') { ui.wizard = null; ui.menu = null; render(); return; }
    if (btn.dataset.wiz === 'x') { const v = Math.max(0, Math.min(ui.wizard.maxX, Number(root.querySelector('#xval').value) || 0)); if (ui.wizard.ability !== undefined) ui.wizard.onX(v); else { ui.wizard.opts.x = v; next(ui.wizard); } return; }
    if (btn.dataset.wizref) { const [type, id] = btn.dataset.wizref.split(':'); pickRef({ type, id: Number(id) }); return; }
    if (btn.dataset.reqref) { const [type, id] = btn.dataset.reqref.split(':'); pickRef({ type, id: Number(id) }); return; }
    if (btn.dataset.answer) { act.answer(btn.dataset.answer === 'yes'); run(); return; }
    if (btn.dataset.order && ui.order) { const i = Number(btn.dataset.idx), j = btn.dataset.order === 'up' ? i - 1 : i + 1; if (j >= 0 && j < ui.order.length) { [ui.order[i], ui.order[j]] = [ui.order[j], ui.order[i]]; render(); } return; }
    if (btn.dataset.div && ui.divide) {
      const req = duel.pending?.req; if (!req || req.kind !== 'divide') return;
      const d = ui.divide, key = btn.dataset.div, dir = Number(btn.dataset.dir);
      const onBlockers = req.targets.reduce((s, t) => s + (d.map[t.id] || 0), 0);
      const remaining = req.total - onBlockers - (req.trample ? d.player : 0);
      if (dir > 0 && remaining <= 0) return;
      if (key === 'player') { if (dir > 0 && !req.targets.every(t => (d.map[t.id] || 0) >= t.lethal)) return; d.player = Math.max(0, d.player + dir); }
      else { const id = Number(key); d.map[id] = Math.max(0, (d.map[id] || 0) + dir); if (dir < 0 && req.trample && !req.targets.every(t => (d.map[t.id] || 0) >= t.lethal)) d.player = 0; }
      render(); return;
    }
    if (btn.dataset.color) { act.answer(btn.dataset.color); run(); return; }
    if (btn.hasAttribute('data-close-viewer') && (btn === ev.target || btn.tagName === 'BUTTON')) { ui.viewer = null; render(); return; }
    if (btn.dataset.grave !== undefined) { ui.viewer = Number(btn.dataset.grave); render(); return; }
    switch (btn.id) {
      case 'b-pass': act.pass(); run(); return;
      case 'b-endturn': act.endTurn(); run(); return;
      case 'b-attack': { const ids = [...ui.attackers]; ui.attackers = new Set(); act.answer(ids); run(); return; }
      case 'b-attack-all': { const req = duel.pending?.req; if (req?.kind !== 'attackers') return; ui.attackers = new Set(); act.answer(req.options.slice()); run(); return; }
      case 'b-block': { if (!duel.validBlocks(ui.blocks)) { ui.message = 'Those blocks are not legal.'; render(); return; } const b = ui.blocks; ui.blocks = {}; ui.blocker = null; ui.message = ''; act.answer(b); run(); return; }
      case 'b-choose': { const ids = [...(ui.choice || [])]; ui.choice = null; act.answer(ids); run(); return; }
      case 'b-order': { const ids = (ui.order || []).slice(); ui.order = null; act.answer(ids); run(); return; }
      case 'b-divide': { const d = ui.divide; if (!d) return; const plan = { ...d.map }; if (d.player) plan.player = d.player; ui.divide = null; act.answer(plan); run(); return; }
      case 'b-look': { act.answer(null); run(); return; }
      case 'b-concede': if (confirm(input ? 'Concede this duel?' : 'Concede this duel? You will lose your ante card.')) { act.concede(); run(); } return;
    }
    if (btn.classList.contains('stack-item')) { if (targeting()) pickRef({ type: 'spell', id: Number(btn.dataset.stack) }); return; }
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
    if (z === 'hand' && card.controller === 0) { scheduleCardClick(card, 'hand'); return; }
    if (z === 'grave' && card.owner === 0) { if (duel.canCast(me, card)) { ui.viewer = null; startCast(card); } return; }
    if (z === 'bf' && card.controller === 0) { scheduleCardClick(card, 'bf'); return; }
  });
  root.addEventListener('change', ev => {
    if (ev.target.id === 'cb-autopass') { setAutoPass(ev.target.checked); if (ev.target.checked) run(); return; }
    const cb = ev.target.closest('input[data-choice]'); if (!cb) return;
    ui.choice ||= new Set(); const id = Number(cb.dataset.choice);
    if (cb.checked) ui.choice.add(id); else ui.choice.delete(id);
    const req = duel.pending?.req; if (req && req.max === 1 && ui.choice.size > 1) ui.choice = new Set([id]);
    render();
  });
  document.addEventListener('keydown', function onKey(ev) {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (ev.key === 'Escape') { ui.wizard = null; ui.menu = null; ui.viewer = null; ui.paying = null; render(); }
    if (ev.key === ' ' && duel.pending?.type === 'priority' && !ui.wizard && !ui.menu && !ui.paying) { ev.preventDefault(); act.pass(); run(); }
  });

  duel.onChange(() => { ui.message = ''; render(); if (duel.winner !== null) run(); });
  if (autoStart) {
    duel.start();
    // Offer a free mulligan on a land-starved opening hand (one land or none); otherwise start ticking.
    const openingLands = () => me.hand.filter(isLand).length;
    if (!tutorial && allowMulligan && me.hand.length && openingLands() <= 1) { ui.mulligan = true; render(); }
    else run();
  } else render();   // guest: nothing to deal — the first snapshot will hydrate and render the board
  // The host resumes ticking here after applying a remote input; the guest re-renders on each snapshot.
  return { run, rerender: render, duel };
}
