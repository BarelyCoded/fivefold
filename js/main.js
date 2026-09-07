// Fivefold app controller: screens, world loop, persistence.
import { parseList, importNames, defOf, forgetDefs, loadArtIndex, artFor, artCount, hasOwnArt } from './collection.js';
import { fetchCards, cacheSize } from './scryfall.js';
import { COLORS, COLOR_NAME, costString, statusLabel } from './cards.js';
import { generateWorld, drawWorld, tileAt, inBounds, cityAt, linkAt, enemyAt, stepEnemies, BIOME, TILE } from './world.js';
import { Duel } from './engine.js';
import { mountDuel, cardHtml } from './duelview.js';
import { initPreview, hide as hidePreview } from './preview.js';

const SAVE_KEY = 'ff.save.v1', COLL_KEY = 'ff.collection.v1';
const BASICS = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
const BASIC_NAMES = new Set(Object.values(BASICS));
const DIFF = {
  apprentice: { label: 'Apprentice', life: 20, enemyBonus: 0, gold: 30 },
  magician: { label: 'Magician', life: 15, enemyBonus: 0, gold: 20 },
  sorcerer: { label: 'Sorcerer', life: 12, enemyBonus: 4, gold: 12 },
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rnd = a => a[Math.floor(Math.random() * a.length)];

const app = document.getElementById('app');
const topbar = document.getElementById('topbar');
const S = { screen: 'title', game: null, collection: {}, content: null, ready: false, busy: null, report: null, modal: null, filter: 'all', deckFilter: '', cityStock: null, result: null, importText: '' };

// ---- persistence ----------------------------------------------------------------
function save() {
  try {
    if (S.game) localStorage.setItem(SAVE_KEY, JSON.stringify(S.game)); else localStorage.removeItem(SAVE_KEY);
    localStorage.setItem(COLL_KEY, JSON.stringify(S.collection));
  } catch (e) { console.warn(e); }
}
function load() {
  try { S.collection = JSON.parse(localStorage.getItem(COLL_KEY) || '{}'); } catch { S.collection = {}; }
  try { S.game = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { S.game = null; }
}
function addCards(coll, name, n = 1) { coll[name] = (coll[name] || 0) + n; if (coll[name] <= 0) delete coll[name]; }

// ---- content ----------------------------------------------------------------------
async function ensureContent() {
  if (S.ready) return;
  setBusy('Loading enemy roster…');
  const res = await fetch('content/enemies.json');
  S.content = await res.json();
  const names = new Set(Object.values(BASICS));
  for (const e of S.content.enemies) for (const n of Object.keys(e.deck)) names.add(n);
  setBusy('Fetching card data from Scryfall…');
  await fetchCards([...names], (done, total) => setBusy(`Fetching card data from Scryfall… ${done}/${total}`));
  forgetDefs();
  await loadArtIndex();
  S.ready = true; setBusy(null);
}
function setBusy(msg) { S.busy = msg; const el = document.getElementById('status'); if (el) { el.textContent = msg || ''; el.hidden = !msg; } }
function enemyById(id) { return S.content.enemies.find(e => e.id === id); }

// ---- deck helpers ---------------------------------------------------------------
function expandDeck(deckObj) {
  const out = [];
  for (const [name, n] of Object.entries(deckObj)) { const d = defOf(name); if (!d) continue; for (let i = 0; i < n; i++) out.push(d); }
  return out;
}
function deckSize(deckObj) { return Object.values(deckObj).reduce((a, b) => a + b, 0); }
function deckProblems(deckObj) {
  const p = [];
  const size = deckSize(deckObj);
  if (size < 40) p.push(`Deck has ${size} cards; it needs at least 40.`);
  for (const [name, n] of Object.entries(deckObj)) {
    const d = defOf(name);
    if (!d) { p.push(`${name}: card data not loaded.`); continue; }
    if (d.kind === 'unsupported') p.push(`${name}: not supported by the demo engine.`);
    if (!BASIC_NAMES.has(name) && (S.collection[name] || 0) < n) p.push(`${name}: you own ${S.collection[name] || 0}, deck uses ${n}.`);
  }
  return p;
}
function pickAnte(deckObj) {
  const names = [];
  for (const [name, n] of Object.entries(deckObj)) { const d = defOf(name); if (!d || d.kind === 'land') continue; for (let i = 0; i < n; i++) names.push(name); }
  return names.length ? rnd(names) : null;
}
function fillBasics(deckObj) {
  const pips = {};
  for (const [name, n] of Object.entries(deckObj)) { const d = defOf(name); if (!d || d.kind === 'land') continue; for (const pip of d.cost.pips) for (const c of pip) pips[c] = (pips[c] || 0) + n / pip.length; }
  const total = Object.values(pips).reduce((a, b) => a + b, 0) || 1;
  const spells = Object.entries(deckObj).filter(([n]) => defOf(n)?.kind !== 'land').reduce((a, [, n]) => a + n, 0);
  const lands = Object.entries(deckObj).filter(([n]) => defOf(n)?.kind === 'land').reduce((a, [, n]) => a + n, 0);
  const target = Math.max(40, spells + Math.round(spells * 17 / 23));
  let need = target - spells - lands;
  const colors = Object.keys(pips).filter(c => BASICS[c]);
  if (!colors.length) colors.push(S.game?.color || 'G');
  while (need > 0) {
    // add to the color with the largest deficit
    const counts = Object.fromEntries(colors.map(c => [c, deckObj[BASICS[c]] || 0]));
    const landsNow = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    const c = colors.sort((a, b) => ((pips[b] || 0) / total - counts[b] / landsNow) - ((pips[a] || 0) / total - counts[a] / landsNow))[0];
    addCards(deckObj, BASICS[c], 1); need--;
  }
}

// ---- game --------------------------------------------------------------------------
async function newGame({ name, color, difficulty }) {
  await ensureContent();
  const d = DIFF[difficulty];
  const starter = S.content.enemies.find(e => e.color === color && e.tier === 1);
  const deck = {};
  for (const [n, c] of Object.entries(starter.deck)) { deck[n] = c; if (!BASIC_NAMES.has(n)) addCards(S.collection, n, c); }
  const world = generateWorld(Math.random, S.content.enemies, color);
  S.game = {
    name: name || 'Wanderer', color, difficulty, deck, world,
    player: { x: world.start.x, y: world.start.y, life: d.life, maxLife: d.life, gold: d.gold, food: 40, day: 1, steps: 0 },
    boss: { links: 0 }, status: 'playing', wins: 0, losses: 0, cityStock: {},
  };
  save(); go('map');
}

function move(dx, dy) {
  const g = S.game; if (!g || g.status !== 'playing' || S.modal) return;
  const probs = deckProblems(g.deck);
  if (probs.length) { S.modal = { title: 'Your deck is not ready', body: `<ul>${probs.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`, buttons: [{ label: 'Open deck builder', action: () => { S.modal = null; go('deck'); } }, { label: 'Close', action: () => { S.modal = null; render(); } }] }; render(); return; }
  const nx = g.player.x + dx, ny = g.player.y + dy;
  if (!inBounds(g.world, nx, ny)) return;
  const enemy = enemyAt(g.world, nx, ny);
  if (enemy) { encounter(enemy); return; }
  if (g.world.castle.x === nx && g.world.castle.y === ny) { castlePrompt(); return; }
  g.player.x = nx; g.player.y = ny; g.player.steps++;
  if (g.player.food > 0) g.player.food--; else g.player.life = Math.max(1, g.player.life - 1);
  if (g.player.steps % 5 === 0) { g.player.day++; if (g.player.day % 30 === 0) bossLink(); }
  const link = linkAt(g.world, nx, ny);
  if (link && !link.taken) { link.taken = true; g.player.maxLife += 2; g.player.life += 2; toast(`Mana link claimed. Maximum life is now ${g.player.maxLife}.`); }
  stepEnemies(g.world, Math.random, g.player);
  save();
  const city = cityAt(g.world, nx, ny);
  if (city) { go('city'); return; }
  render();
}
function bossLink() {
  const g = S.game; g.boss.links++;
  if (g.boss.links >= 3) { g.status = 'lost'; save(); go('end'); return; }
  toast(`The Usurper has bound ${g.boss.links} of 3 mana links. Hurry.`);
}
function toast(msg) { S.toast = msg; render(); setTimeout(() => { if (S.toast === msg) { S.toast = null; render(); } }, 3500); }

function encounter(enemy) {
  const tpl = enemyById(enemy.template); const g = S.game;
  S.modal = {
    title: `${tpl.name} (tier ${tpl.tier}, ${COLOR_NAME[tpl.color]})`,
    body: `<p class="taunt">“${esc(tpl.taunt)}”</p><p>Life ${tpl.life + DIFF[g.difficulty].enemyBonus}. Win: ${tpl.gold} gold and their ante card. Lose: your ante card.</p>`,
    buttons: [
      { label: 'Duel', primary: true, action: () => { S.modal = null; startDuel(tpl, enemy.uid); } },
      { label: `Bribe (${tpl.bribe} gold)`, disabled: g.player.gold < tpl.bribe, action: () => { g.player.gold -= tpl.bribe; g.world.enemies = g.world.enemies.filter(e => e.uid !== enemy.uid); S.modal = null; save(); render(); } },
      { label: 'Back away', action: () => { S.modal = null; render(); } },
    ],
  };
  render();
}
function castlePrompt() {
  const boss = S.content.enemies.find(e => e.boss); const g = S.game;
  S.modal = {
    title: 'The Usurper’s castle',
    body: `<p class="taunt">“${esc(boss.taunt)}”</p><p>A five-color deck and ${boss.life + g.boss.links * 5} life. Claim mana links first to raise your own. This is the end of the road.</p>`,
    buttons: [{ label: 'Assault the castle', primary: true, action: () => { S.modal = null; startDuel(boss, null); } }, { label: 'Not yet', action: () => { S.modal = null; render(); } }],
  };
  render();
}

function startDuel(tpl, roamUid) {
  const g = S.game; const d = DIFF[g.difficulty];
  const ante = { mine: pickAnte(g.deck), theirs: pickAnte(tpl.deck) };
  const duel = new Duel({
    player: { name: g.name, deck: expandDeck(g.deck), life: g.player.life },
    ai: { name: tpl.name, deck: expandDeck(tpl.deck), life: tpl.life + d.enemyBonus + (tpl.boss ? g.boss.links * 5 : 0), ai: true },
  });
  S.duel = { duel, tpl, ante, roamUid };
  go('duel');
}
function finishDuel(winner) {
  const g = S.game; const { duel, tpl, ante, roamUid } = S.duel; S.duel = null;
  const lines = [];
  if (winner === 0) {
    g.wins++; g.player.gold += tpl.gold; lines.push(`You win ${tpl.gold} gold.`);
    if (ante.theirs) { addCards(S.collection, ante.theirs, 1); lines.push(`You take ${ante.theirs} as ante.`); }
    g.player.life = Math.max(duel.players[0].life, Math.ceil(g.player.maxLife / 2));
    if (roamUid != null) g.world.enemies = g.world.enemies.filter(e => e.uid !== roamUid);
    if (tpl.boss) { g.status = 'won'; save(); go('end'); return; }
  } else {
    g.losses++;
    if (ante.mine) { addCards(S.collection, ante.mine, -1); addCards(g.deck, ante.mine, -1); lines.push(`You lose ${ante.mine} as ante.`); }
    const lost = Math.floor(g.player.gold * 0.25); g.player.gold -= lost; if (lost) lines.push(`${lost} gold is taken from you.`);
    g.player.life = g.player.maxLife; lines.push('You wake up some time later, restored but poorer.');
    if (tpl.boss) { bossLink(); if (g.status !== 'playing') return; }
  }
  S.result = { won: winner === 0, tpl, lines };
  save(); go('result');
}

// ---- city ---------------------------------------------------------------------
function cityPool(color) {
  const names = new Set();
  for (const e of S.content.enemies) if (e.color === color) for (const n of Object.keys(e.deck)) { const d = defOf(n); if (d && d.kind !== 'land' && d.kind !== 'unsupported') names.add(n); }
  return [...names];
}
function cityStock(city) {
  const g = S.game; const key = city.color;
  const st = g.cityStock[key];
  if (st && g.player.day - st.day < 6) return st.items;
  const pool = cityPool(city.color); const items = [];
  for (let i = 0; i < 4 && pool.length; i++) { const n = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; items.push({ name: n, price: 3 + defOf(n).cmc * 2, sold: false }); }
  g.cityStock[key] = { day: g.player.day, items }; save();
  return items;
}

// ---- import ------------------------------------------------------------------------
async function doImport(text) {
  const entries = parseList(text);
  if (!entries.length) { S.report = { error: 'No card lines found.' }; render(); return; }
  setBusy(`Looking up ${entries.length} names…`);
  try {
    const rows = await importNames(entries, (d, t) => setBusy(`Fetching from Scryfall… ${d}/${t}`));
    let added = 0;
    for (const r of rows) if (r.def) { addCards(S.collection, r.canonical, r.count); added += r.count; }
    S.report = { rows, added };
    save();
  } catch (e) { S.report = { error: 'Import failed: ' + e.message }; }
  setBusy(null); render();
}

// ---- rendering --------------------------------------------------------------------
function go(screen) { S.screen = screen; S.modal = null; hidePreview(); window.scrollTo(0, 0); render(); }

function renderTop() {
  const g = S.game; const inDuel = S.screen === 'duel';
  const tabs = [['map', 'Map'], ['collection', 'Collection'], ['deck', 'Deck']];
  topbar.innerHTML = `<div class="brand" data-go="title">Fivefold <span>demo</span></div>
    <nav>${tabs.map(([k, l]) => `<button class="tab${S.screen === k ? ' on' : ''}" data-go="${k}" ${inDuel || (k !== 'collection' && !g) ? 'disabled' : ''}>${l}</button>`).join('')}</nav>
    ${g ? `<div class="stats"><span title="Life">♥ ${g.player.life}/${g.player.maxLife}</span><span title="Gold">◎ ${g.player.gold}</span><span title="Food">✦ ${g.player.food}</span><span title="Day">Day ${g.player.day}</span><span title="Usurper's links">Links ${g.boss.links}/3</span></div>` : ''}`;
}

function render() {
  renderTop();
  const views = { title, collection, deck, map, city, duel, result, end };
  app.innerHTML = '';
  (views[S.screen] || title)();
  if (S.modal) app.insertAdjacentHTML('beforeend', `<div class="overlay"><div class="modal"><h3>${S.modal.title}</h3><div class="mbody">${S.modal.body}</div><div class="mbtns">${S.modal.buttons.map((b, i) => `<button class="btn${b.primary ? ' primary' : ''}" data-modal="${i}" ${b.disabled ? 'disabled' : ''}>${esc(b.label)}</button>`).join('')}</div></div></div>`);
  if (S.toast) app.insertAdjacentHTML('beforeend', `<div class="toast">${esc(S.toast)}</div>`);
  setBusy(S.busy);
}

function title() {
  const g = S.game;
  app.innerHTML = `<section class="screen title">
    <h1>Fivefold</h1>
    <p class="lede">A Shandalar-inspired card adventure, built to be played with the cards you actually own. Walk a world where geography is color, duel the mages who roam it, wager cards you cannot buy back, and reach the Usurper's castle before the mana links are bound.</p>
    <div class="cols">
      <form id="newgame" class="box">
        <h2>New journey</h2>
        <label>Your name <input name="name" value="${esc(g?.name || '')}" placeholder="Wanderer"></label>
        <fieldset><legend>Starting color</legend>${COLORS.map(c => `<label class="radio"><input type="radio" name="color" value="${c}" ${c === 'G' ? 'checked' : ''}> <i class="dot c-${c}"></i>${COLOR_NAME[c]}</label>`).join('')}</fieldset>
        <label>Difficulty <select name="difficulty">${Object.entries(DIFF).map(([k, d]) => `<option value="${k}">${d.label} — ${d.life} life, ${d.gold} gold</option>`).join('')}</select></label>
        <button class="btn primary" type="submit">Begin</button>
        <p class="small">You start with a ready-made 40-card deck of your color. Import your own cards from the Collection tab at any time.</p>
      </form>
      <div class="box">
        <h2>${g ? 'Continue' : 'Your cards'}</h2>
        ${g ? `<p>${esc(g.name)}, day ${g.player.day}, ${g.wins} wins and ${g.losses} losses. ${g.status !== 'playing' ? 'This journey is over.' : ''}</p><button class="btn primary" data-go="${g.status === 'playing' ? 'map' : 'end'}">Continue</button>` : ''}
        <p>${Object.values(S.collection).reduce((a, b) => a + b, 0)} cards in your collection, ${artCount()} custom images in the art folder.</p>
        <button class="btn" data-go="collection">Manage collection</button>
      </div>
    </div>
    <footer class="legal">Unofficial fan project under the Wizards of the Coast Fan Content Policy. Not approved or endorsed by Wizards. Card data is fetched from Scryfall at runtime; nothing is bundled. Magic: The Gathering is a trademark of Wizards of the Coast.</footer>
  </section>`;
}

function collection() {
  const names = Object.keys(S.collection).sort();
  const rows = names.map(n => ({ n, q: S.collection[n], d: defOf(n) })).filter(r => S.filter === 'all' || (S.filter === 'unsupported' ? (!r.d || r.d.kind === 'unsupported') : r.d && r.d.kind !== 'unsupported'));
  const rep = S.report;
  app.innerHTML = `<section class="screen collection">
    <div class="cols">
      <div class="box">
        <h2>Import your cards</h2>
        <p class="small">Paste a list (one card per line, like <code>4 Lightning Bolt</code>) or put a <code>collection.csv</code> next to <code>server.js</code>. Rules text is fetched from Scryfall and cached in this browser.</p>
        <textarea id="imp" rows="7" placeholder="4 Lightning Bolt&#10;2 Serra Angel&#10;Grizzly Bears">${esc(S.importText)}</textarea>
        <div class="btnrow"><button class="btn primary" id="b-import">Import list</button><button class="btn" id="b-csv">Load collection.csv</button><button class="btn ghost" id="b-clear-coll">Clear collection</button></div>
        ${rep ? rep.error ? `<div class="msg">${esc(rep.error)}</div>` : `<div class="report"><b>Added ${rep.added} cards.</b>
          <table><tr><th>Card</th><th>Qty</th><th>Status</th><th>Notes</th></tr>${rep.rows.map(r => `<tr class="st-${r.def ? r.def.status : 'missing'}"><td>${esc(r.canonical || r.name)}</td><td>${r.count}</td><td>${statusLabel(r.def)}</td><td>${esc((r.def?.notes || []).join('; '))}</td></tr>`).join('')}</table></div>` : ''}
      </div>
      <div class="box">
        <h2>Your art</h2>
        <p class="small">${artCount()} images found in the <code>art/</code> folder. Name a file after the card, lowercase with dashes: <code>lightning-bolt.jpg</code>, <code>serra-angel.png</code>. A photo of your physical card works fine. Cards with your art show a ★.</p>
        <button class="btn" id="b-rescan">Rescan art folder</button>
        <h2 style="margin-top:18px">Engine support</h2>
        <p class="small"><b>ready</b>: fully playable. <b>approximated</b>: plays, but some abilities are ignored (the notes say which). <b>unsupported</b>: stays in your collection but cannot go in a deck yet. The demo engine knows lands, creatures with common keywords, and burn, removal, pump, bounce, draw and life-gain spells.</p>
      </div>
    </div>
    <div class="box">
      <div class="rowhead"><h2>Collection · ${names.length} distinct, ${Object.values(S.collection).reduce((a, b) => a + b, 0)} total</h2>
        <div class="seg">${['all', 'playable', 'unsupported'].map(f => `<button class="seg-b${S.filter === f ? ' on' : ''}" data-filter="${f}">${f}</button>`).join('')}</div></div>
      ${rows.length ? `<table class="coll"><tr><th></th><th>Card</th><th>Qty</th><th>Type</th><th>Cost</th><th>Status</th><th>Notes</th><th></th></tr>
      ${rows.map(r => `<tr class="st-${r.d ? r.d.status : 'missing'}"><td class="thumb">${r.d ? `<div class="mini${hasOwnArt(r.d) ? ' own' : ''}" data-preview="${esc(r.n)}" style="${artFor(r.d) ? `background-image:url('${artFor(r.d)}')` : ''}"></div>` : ''}</td><td data-preview="${esc(r.n)}">${esc(r.n)}</td><td>${r.q}</td><td>${esc(r.d?.typeLine || '')}</td><td>${r.d && r.d.kind !== 'land' ? esc(costString(r.d.cost)) : ''}</td><td>${statusLabel(r.d)}</td><td class="notes">${esc((r.d?.notes || []).join('; '))}</td><td><button class="btn tiny" data-dec="${esc(r.n)}">−1</button></td></tr>`).join('')}</table>` : '<p class="small">Nothing here yet. Import a list above, or start a new journey to receive a starter deck.</p>'}
    </div>
  </section>`;
}

function deck() {
  const g = S.game; if (!g) return title();
  const q = S.deckFilter.toLowerCase();
  const owned = Object.keys(S.collection).map(n => ({ n, q: S.collection[n], d: defOf(n) })).filter(r => r.d && r.d.kind !== 'unsupported' && (!q || r.n.toLowerCase().includes(q))).sort((a, b) => a.d.cmc - b.d.cmc || a.n.localeCompare(b.n));
  const inDeck = Object.entries(g.deck).map(([n, c]) => ({ n, c, d: defOf(n) })).sort((a, b) => (a.d?.kind === 'land') - (b.d?.kind === 'land') || (a.d?.cmc || 0) - (b.d?.cmc || 0) || a.n.localeCompare(b.n));
  const probs = deckProblems(g.deck);
  const size = deckSize(g.deck), lands = inDeck.filter(r => r.d?.kind === 'land').reduce((a, r) => a + r.c, 0);
  app.innerHTML = `<section class="screen deckb">
    <div class="cols wide">
      <div class="box">
        <div class="rowhead"><h2>Your cards</h2><input id="dfilter" placeholder="Filter…" value="${esc(S.deckFilter)}"></div>
        <table class="coll"><tr><th>Card</th><th>Cost</th><th>Own</th><th>In deck</th><th></th></tr>
        ${owned.map(r => { const used = g.deck[r.n] || 0; return `<tr><td data-preview="${esc(r.n)}">${esc(r.n)}<span class="small"> ${esc(r.d.typeLine)}</span></td><td>${r.d.kind === 'land' ? '' : esc(costString(r.d.cost))}</td><td>${r.q}</td><td>${used}</td><td><button class="btn tiny" data-add="${esc(r.n)}" ${used >= r.q ? 'disabled' : ''}>+</button></td></tr>`; }).join('')}</table>
      </div>
      <div class="box">
        <div class="rowhead"><h2>Deck · ${size} cards, ${lands} lands</h2><button class="btn" id="b-fill">Fill basics to 40</button></div>
        <div class="basics">${COLORS.map(c => `<span class="basic"><i class="dot c-${c}"></i>${BASICS[c]} <b>${g.deck[BASICS[c]] || 0}</b> <button class="btn tiny" data-rem="${BASICS[c]}">−</button><button class="btn tiny" data-add="${BASICS[c]}">+</button></span>`).join('')}</div>
        ${probs.length ? `<div class="msg">${probs.map(esc).join('<br>')}</div>` : '<div class="ok">Deck is ready.</div>'}
        <table class="coll"><tr><th>Card</th><th>Cost</th><th>Qty</th><th></th></tr>
        ${inDeck.map(r => `<tr class="st-${r.d?.status || 'missing'}"><td data-preview="${esc(r.n)}">${esc(r.n)}</td><td>${r.d && r.d.kind !== 'land' ? esc(costString(r.d.cost)) : ''}</td><td>${r.c}</td><td><button class="btn tiny" data-rem="${esc(r.n)}">−</button></td></tr>`).join('')}</table>
      </div>
    </div>
  </section>`;
}

function map() {
  const g = S.game; if (!g) return title();
  const here = tileAt(g.world, g.player.x, g.player.y);
  const near = g.world.enemies.filter(e => Math.abs(e.x - g.player.x) <= 1 && Math.abs(e.y - g.player.y) <= 1);
  app.innerHTML = `<section class="screen mapscreen">
    <div class="mapwrap"><canvas id="map"></canvas></div>
    <aside class="mappanel">
      <h2>${esc(g.name)}</h2>
      <p>Standing in the <b>${BIOME[here].name}</b> (${COLOR_NAME[here]}). ${near.length ? `<br>${near.map(e => enemyById(e.template).name).join(', ')} nearby.` : ''}</p>
      <p class="small">Move with WASD or the arrow keys, or click a neighbouring tile. Walking costs food. Diamonds are mana links (+2 life). Houses are cities. The dark tower is the Usurper.</p>
      <div class="btnrow"><button class="btn" id="b-rest" ${g.player.food < 3 || g.player.life >= g.player.maxLife ? 'disabled' : ''}>Rest (3 food, +5 life)</button><button class="btn ghost" data-go="title">Menu</button></div>
      <h3>Legend</h3>
      <div class="legend">${COLORS.map(c => `<span><i class="sw" style="background:${BIOME[c].fill}"></i>${BIOME[c].name}</span>`).join('')}</div>
    </aside>
  </section>`;
  const canvas = document.getElementById('map');
  const hl = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [g.player.x + dx, g.player.y + dy]).filter(([x, y]) => inBounds(g.world, x, y));
  drawWorld(canvas, g.world, g.player, { highlight: hl });
  canvas.onclick = ev => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) / r.width * g.world.w), y = Math.floor((ev.clientY - r.top) / r.height * g.world.h);
    const dx = x - g.player.x, dy = y - g.player.y;
    if (Math.abs(dx) + Math.abs(dy) === 1) move(dx, dy);
  };
}

function city() {
  const g = S.game; const c = cityAt(g.world, g.player.x, g.player.y); if (!c) return map();
  const stock = cityStock(c);
  app.innerHTML = `<section class="screen cityscreen">
    <div class="box">
      <h2>${esc(c.name)} <span class="small">· a ${COLOR_NAME[c.color].toLowerCase()} city in the ${BIOME[c.color].name.toLowerCase()}</span></h2>
      <div class="btnrow">
        <button class="btn" id="b-inn" ${g.player.life >= g.player.maxLife ? 'disabled' : ''}>Rest at the inn (free, full life)</button>
        <button class="btn" id="b-food" ${g.player.gold < 2 ? 'disabled' : ''}>Buy 10 food (2 gold)</button>
        <button class="btn primary" id="b-leave">Leave</button>
      </div>
      <h3>Market</h3>
      <div class="market">${stock.map((it, i) => { const d = defOf(it.name); return `<div class="stall${it.sold ? ' sold' : ''}">${cardHtml(d)}<div class="price">${it.sold ? 'Sold' : `${it.price} gold`}</div><button class="btn small" data-buy="${i}" ${it.sold || g.player.gold < it.price ? 'disabled' : ''}>Buy</button></div>`; }).join('')}</div>
      <p class="small">Stock changes every few days. Bought cards go to your collection; add them to your deck from the Deck tab.</p>
    </div>
  </section>`;
}

function duel() {
  const d = S.duel;
  // Mount once per duel; a re-render (toast, stats) must not restart the game.
  if (!d.root) {
    d.root = document.createElement('div'); d.root.id = 'duelroot';
    mountDuel(d.root, d.duel, { ante: { mine: d.ante.mine || '—', theirs: d.ante.theirs || '—' }, onEnd: finishDuel });
  }
  app.innerHTML = '';
  const sec = document.createElement('section'); sec.className = 'screen duelscreen';
  sec.appendChild(d.root); app.appendChild(sec);
}

function result() {
  const r = S.result; if (!r) return map();
  app.innerHTML = `<section class="screen resultscreen"><div class="box center">
    <h2>${r.won ? 'Victory' : 'Defeat'}</h2>
    <p>${r.won ? `${esc(r.tpl.name)} yields.` : `${esc(r.tpl.name)} stands over you.`}</p>
    <ul class="plain">${r.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <button class="btn primary" data-go="map">Back to the map</button>
  </div></section>`;
}
function end() {
  const g = S.game;
  app.innerHTML = `<section class="screen resultscreen"><div class="box center">
    <h2>${g.status === 'won' ? 'The Usurper falls' : 'The Spell of Dominion is cast'}</h2>
    <p>${g.status === 'won' ? `${esc(g.name)} unbinds the mana links on day ${g.player.day} after ${g.wins} victories. The plane is free, for now.` : `On day ${g.player.day} the Usurper binds the third link. The world dims. Your collection survives; your journey does not.`}</p>
    <button class="btn primary" id="b-newgame">Start a new journey</button>
  </div></section>`;
}

// ---- events -----------------------------------------------------------------------
app.addEventListener('submit', ev => {
  if (ev.target.id === 'newgame') { ev.preventDefault(); const f = new FormData(ev.target); newGame({ name: f.get('name').trim(), color: f.get('color'), difficulty: f.get('difficulty') }); }
});
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-go],[data-modal],[data-filter],[data-add],[data-rem],[data-dec],[data-buy],#b-import,#b-csv,#b-rescan,#b-clear-coll,#b-fill,#b-rest,#b-inn,#b-food,#b-leave,#b-newgame');
  if (!t) return;
  const g = S.game;
  if (t.dataset.go) { if (!t.disabled) { if (t.dataset.go === 'map' && g?.status !== 'playing' && g) go('end'); else go(t.dataset.go); } return; }
  if (t.dataset.modal != null) { const b = S.modal?.buttons[Number(t.dataset.modal)]; if (b && !b.disabled) b.action(); return; }
  if (t.dataset.filter) { S.filter = t.dataset.filter; render(); return; }
  if (t.dataset.add) { addCards(g.deck, t.dataset.add, 1); save(); render(); return; }
  if (t.dataset.rem) { addCards(g.deck, t.dataset.rem, -1); save(); render(); return; }
  if (t.dataset.dec) { addCards(S.collection, t.dataset.dec, -1); if (g && g.deck[t.dataset.dec] > (S.collection[t.dataset.dec] || 0)) addCards(g.deck, t.dataset.dec, -1); save(); render(); return; }
  if (t.dataset.buy != null) { const c = cityAt(g.world, g.player.x, g.player.y); const it = cityStock(c)[Number(t.dataset.buy)]; if (it && !it.sold && g.player.gold >= it.price) { g.player.gold -= it.price; it.sold = true; addCards(S.collection, it.name, 1); save(); render(); } return; }
  switch (t.id) {
    case 'b-import': S.importText = document.getElementById('imp').value; doImport(S.importText); break;
    case 'b-csv': fetch('/api/collection').then(r => r.ok ? r.text() : Promise.reject(new Error('collection.csv not found next to server.js'))).then(txt => { S.importText = txt; doImport(txt); }).catch(e => { S.report = { error: e.message }; render(); }); break;
    case 'b-rescan': loadArtIndex().then(render); break;
    case 'b-clear-coll': if (confirm('Remove every card from your collection? Your deck will need rebuilding.')) { S.collection = {}; if (g) g.deck = {}; save(); render(); } break;
    case 'b-fill': fillBasics(g.deck); save(); render(); break;
    case 'b-rest': if (g.player.food >= 3) { g.player.food -= 3; g.player.life = Math.min(g.player.maxLife, g.player.life + 5); g.player.day++; if (g.player.day % 30 === 0) bossLink(); stepEnemies(g.world, Math.random, g.player); save(); render(); } break;
    case 'b-inn': g.player.life = g.player.maxLife; save(); render(); break;
    case 'b-food': if (g.player.gold >= 2) { g.player.gold -= 2; g.player.food += 10; save(); render(); } break;
    case 'b-leave': go('map'); break;
    case 'b-newgame': S.game = null; save(); go('title'); break;
  }
});
document.addEventListener('input', ev => { if (ev.target.id === 'dfilter') { S.deckFilter = ev.target.value; deck(); document.getElementById('dfilter').focus(); const el = document.getElementById('dfilter'); el.setSelectionRange(el.value.length, el.value.length); } });
document.addEventListener('keydown', ev => {
  if (S.screen !== 'map' || S.modal) return;
  const k = ev.key.toLowerCase();
  const d = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] }[k];
  if (d) { ev.preventDefault(); move(d[0], d[1]); }
});

// ---- boot -----------------------------------------------------------------------
// Debug handle for the console and for automated tests: window.ff.S is the app state.
window.ff = { S, defOf, save, render, startDuel, enemyById };
initPreview();
load();
render();
ensureContent().then(() => { if (S.game && S.game.status === 'playing') go('map'); else render(); }).catch(e => { setBusy('Could not load card data: ' + e.message + ' (is the internet reachable?)'); });
