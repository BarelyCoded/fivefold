// Fivefold app controller: screens, world loop, persistence.
import { parseList, importNames, defOf, forgetDefs, loadArtIndex, artFor, artCount, hasOwnArt, hasServer } from './collection.js';
import { fetchCards, cacheSize, cached as cachedCard, allCached } from './scryfall.js';
import { COLORS, COLOR_NAME, manaHtml, statusLabel } from './cards.js';
import { generateWorld, drawWorld, drawMinimap, tileAt, inBounds, cityAt, linkAt, enemyAt, stepEnemies, BIOME, TILE, VIEW, placeDungeons, dungeonAt, placeLandmarks, landmarkAt, placeSpecials, specialAt } from './world.js';
import { Duel } from './engine.js';
import { mountDuel, cardHtml } from './duelview.js';
import { aiHooks } from './ai.js';
import { initPreview, hide as hidePreview } from './preview.js';
import { generateDungeon, drawDungeon, cellAtPixel, cellOf, linked, playerCell, remainingMonsters, makeRiddle, CANVAS as DCANVAS } from './dungeon.js';
import { loadAtlas, onAtlas, SPRITES, MONSTERS, DUNGEON_MONSTER } from './atlas.js';
import { unlock, sfx, music, toggleAudio, audioMuted } from './audio.js';
import { LESSONS, TUTORIAL_CARDS } from './tutorial.js';

const SAVE_KEY = 'ff.save.v1', COLL_KEY = 'ff.collection.v1', TIER_KEY = 'ff.tierOverrides.v1';
const BOSS_LINKS = 5;   // mana links the Usurper must bind to win
loadAtlas();
const BASICS = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
const BASIC_NAMES = new Set(Object.values(BASICS));
const DIFF = {
  apprentice: { label: 'Apprentice', life: 20, enemyBonus: 0, gold: 30 },
  magician: { label: 'Magician', life: 15, enemyBonus: 0, gold: 20 },
  sorcerer: { label: 'Sorcerer', life: 12, enemyBonus: 4, gold: 12 },
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rnd = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// Riddles draw their question from every card the game has cached, not the small regional pool, so they range across the whole base.
function riddleDefs() {
  const out = [];
  for (const c of allCached()) { const d = defOf(c.name); if (d && d.kind !== 'unsupported' && d.kind !== 'land') out.push(d); }
  return out;
}
// Background: pull card data (no art) for the whole amulet catalogue so riddles cover the entire card base.
function prefetchCatalog() {
  if (!S.catalog || S._catalogPrefetched) return;
  S._catalogPrefetched = true;
  const names = [...new Set(Object.values(S.catalog).flat())].filter(n => !cachedCard(n));
  if (names.length) fetchCards(names, null, { skipArt: true }).then(() => forgetDefs()).catch(() => {});
}
// ---- amulets: a colored gem currency, earned from tough foes and lairs, spent on cards and world magic
const AMULET_HEX = { W: '#efe9cf', U: '#5e8cc9', B: '#7a6a95', R: '#d0604a', G: '#6a9a4a' };
const newAmulets = () => ({ W: 0, U: 0, B: 0, R: 0, G: 0 });
function giveAmulet(color, n = 1) { const g = S.game; if (!g) return; g.player.amulets ||= newAmulets(); g.player.amulets[color] = (g.player.amulets[color] || 0) + n; }
const amuletCount = color => (S.game?.player.amulets?.[color] || 0);
const totalAmulets = () => COLORS.reduce((a, c) => a + amuletCount(c), 0);
const amuletGems = (sel = '') => COLORS.map(c => `<span class="amu${amuletCount(c) ? '' : ' none'}${sel === c ? ' sel' : ''}" title="${COLOR_NAME[c]} amulet"><i style="background:${AMULET_HEX[c]}"></i>${amuletCount(c)}</span>`).join('');

const app = document.getElementById('app');
const topbar = document.getElementById('topbar');
const S = { screen: 'title', game: null, collection: {}, content: null, ready: false, busy: null, report: null, modal: null, filter: 'all', deckFilter: '', cityStock: null, result: null, importText: '', lesson: 0,
  tiers: undefined, tierOverrides: {}, tierSearch: '', tierType: '', tierSort: 'tier', tierSellOnly: true, tierCurOnly: false, tierHide: {}, tierPick: null };
const TIER_ORDER = ['S', 'A', 'B', 'C', 'D', 'E'];
const TIER_META = { S: ['Broken', 'format-warping'], A: ['Premium', 'top staple'], B: ['Strong', 'commonly played'], C: ['Solid', 'maindeckable'], D: ['Filler', 'marginal'], E: ['Weak', 'draft chaff'] };
// A card's effective tier = a local override if the player re-ranked it, else the shipped ranking.
const baseTierOf = name => S.tiers?.cards?.[name]?.tier || null;
const tierOf = name => (S.tierOverrides && S.tierOverrides[name]) || baseTierOf(name);
function setTier(name, tier) { S.tierOverrides ||= {}; if (tier === baseTierOf(name)) delete S.tierOverrides[name]; else S.tierOverrides[name] = tier; save(); }
async function ensureTiers() { if (S.tiers !== undefined) return S.tiers; try { S.tiers = await (await fetch('content/power-tiers.json')).json(); } catch { S.tiers = null; } return S.tiers; }

// ---- persistence ----------------------------------------------------------------
function save() {
  try {
    if (S.game) localStorage.setItem(SAVE_KEY, JSON.stringify(S.game)); else localStorage.removeItem(SAVE_KEY);
    localStorage.setItem(COLL_KEY, JSON.stringify(S.collection));
    localStorage.setItem(TIER_KEY, JSON.stringify(S.tierOverrides || {}));
  } catch (e) { console.warn(e); }
}
function load() {
  try { S.collection = JSON.parse(localStorage.getItem(COLL_KEY) || '{}'); } catch { S.collection = {}; }
  try { S.game = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { S.game = null; }
  try { S.tierOverrides = JSON.parse(localStorage.getItem(TIER_KEY) || '{}') || {}; } catch { S.tierOverrides = {}; }
}
function addCards(coll, name, n = 1) { coll[name] = (coll[name] || 0) + n; if (coll[name] <= 0) delete coll[name]; }

// ---- content ----------------------------------------------------------------------
async function ensureContent() {
  if (S.ready) return;
  setBusy('Loading enemy roster…');
  const res = await fetch('content/enemies.json');
  S.content = await res.json();
  S.dungeons = await (await fetch('content/dungeons.json')).json();
  S.shop = await (await fetch('content/shop.json')).json();
  try { S.catalog = await (await fetch('content/amulet-catalog.json')).json(); } catch { S.catalog = null; }
  await ensureTiers();
  const names = new Set(Object.values(BASICS));
  for (const n of S.shop.artifacts) names.add(n);
  for (const list of Object.values(S.shop.lands)) for (const n of list) names.add(n);
  for (const d of S.dungeons.dungeons) for (const n of d.treasure) names.add(n);
  for (const n of S.dungeons.artifacts) names.add(n);
  for (const n of Object.values(S.dungeons.walls)) names.add(n);
  for (const e of S.content.enemies) for (const n of Object.keys(e.deck)) names.add(n);
  for (const n of TUTORIAL_CARDS) names.add(n);
  for (const n of Object.keys(S.collection)) names.add(n);
  if (S.game) for (const n of Object.keys(S.game.deck)) names.add(n);
  setBusy('Fetching card data from Scryfall…');
  await fetchCards([...names], (done, total, phase) => setBusy(phase === 'art' ? `Finding original printings for art… ${done}/${total}` : `Fetching card data from Scryfall… ${done}/${total}`));
  forgetDefs();
  await loadArtIndex();
  S.ready = true; setBusy(null);
  if (S.game?.world) placeDungeons(S.game.world, Math.random, S.dungeons.dungeons);
}
function dungeonTemplate(id) { return S.dungeons.dungeons.find(d => d.id === id); }
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
  placeDungeons(world, Math.random, S.dungeons.dungeons);
  placeLandmarks(world, Math.random);
  placeSpecials(world, Math.random);
  S.game = {
    name: name || 'Wanderer', color, difficulty, deck, world,
    player: { x: world.start.x, y: world.start.y, life: d.life, maxLife: d.life, gold: d.gold, food: 60, day: 1, steps: 0, amulets: newAmulets() },
    boss: { links: 0 }, status: 'playing', wins: 0, losses: 0, cityStock: {}, quests: [], created: Date.now(),
  };
  save(); go('map');
}

function move(dx, dy) {
  const g = S.game; if (!g || g.status !== 'playing' || S.modal) return;
  let probs = deckProblems(g.deck);
  if (probs.length && probs.every(p => p.startsWith('Deck has'))) { fillBasics(g.deck); save(); probs = deckProblems(g.deck); toast('Your deck was short of 40 cards, so basic lands were added. You can change them in the deck builder.'); }
  if (probs.length) { S.modal = { title: 'Your deck is not ready', body: `<ul>${probs.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`, buttons: [{ label: 'Open deck builder', action: () => { S.modal = null; go('deck'); } }, { label: 'Close', action: () => { S.modal = null; render(); } }] }; render(); return; }
  const nx = g.player.x + dx, ny = g.player.y + dy;
  if (!inBounds(g.world, nx, ny)) return;
  const enemy = enemyAt(g.world, nx, ny);
  if (enemy) { encounter(enemy); return; }
  if (g.world.castle.x === nx && g.world.castle.y === ny) { castlePrompt(); return; }
  const dg = dungeonAt(g.world, nx, ny);
  if (dg && dg.revealed) { g.player.x = nx; g.player.y = ny; save(); dungeonPrompt(dg); return; }
  g.player.x = nx; g.player.y = ny; g.player.steps++; sfx('step');
  if (g.player.food > 0) g.player.food--;
  else if (g.player.steps % 2 === 0 && g.player.life > 1) { g.player.life--; toast('You are starving: 1 life lost. Buy food in any city.'); }
  if (g.player.steps % 5 === 0) { g.player.day++; if (g.player.day % 30 === 0) bossLink(); }
  const link = linkAt(g.world, nx, ny);
  if (link && !link.taken) { link.taken = true; g.player.maxLife += 2; g.player.life += 2; toast(`Mana link claimed. Maximum life is now ${g.player.maxLife}.`); }
  stepEnemies(g.world, Math.random, g.player);
  save();
  const city = cityAt(g.world, nx, ny);
  if (city) { go('city'); return; }
  const lm = landmarkAt(g.world, nx, ny);
  if (lm && !lm.used) { landmarkRiddle(lm); return; }
  const sp = specialAt(g.world, nx, ny);
  if (sp) { specialPrompt(sp); return; }
  render();
}
// ---- landmark riddles ---------------------------------------------------------------
const LANDMARK_TEXT = { well: 'An old well. A voice echoes up from the water', standingStone: 'A standing stone carved with runes', signpost: 'A signpost with a riddle scratched into it', tower: 'A watchtower. The lookout wants a password', pond: 'An oasis. Something under the water speaks', volcano: 'A volcano. A voice rumbles from the crater', cave: 'A cave mouth. Something inside asks a question', lavaVent: 'A lava vent hisses a question', skull: 'A skull on a pike. Its jaw moves', bones: 'Bones arranged into words', wreck: 'A wreck. A drowned sailor asks', seaRock: 'A rock in the surf. A siren sings a question' };
function landmarkRiddle(lm) {
  const g = S.game;
  const color = lm.color || tileAt(g.world, lm.x, lm.y);
  const pool = [...new Set([...cityPool(color), ...S.dungeons.dungeons.filter(d => d.color === color).flatMap(d => d.treasure)])].filter(n => { const d = defOf(n); return d && d.kind !== 'unsupported' && d.kind !== 'land'; });
  const qDefs = riddleDefs(); const r = makeRiddle(Math.random, qDefs.length >= 12 ? qDefs : pool.map(defOf));
  if (!r) { lm.used = true; save(); render(); return; }
  S.modal = {
    title: LANDMARK_TEXT[lm.kind] || 'A landmark',
    body: `<p class="taunt">${esc(r.q)}</p><p class="small">Answer right for a ${esc(COLOR_NAME[color] || '')} card. Answer wrong and it takes something from you.</p>`,
    buttons: r.options.map(o => ({ label: o, action: () => {
      S.modal = null; lm.used = true;
      let msg;
      if (o === r.answer) {
        const card = rnd(pool.filter(n => defOf(n).cmc <= 6)) || rnd(pool);
        addCards(S.collection, card, 1); msg = `Correct. You are given ${card}.`; sfx('right');
      } else {
        sfx('wrong');
        const roll = Math.random();
        const owned = Object.keys(S.collection).filter(n => !BASIC_NAMES.has(n) && S.collection[n] > 0);
        if (roll < 0.05 && owned.length) { const lost = rnd(owned); addCards(S.collection, lost, -1); if (g.deck[lost]) { addCards(g.deck, lost, -1); if (deckSize(g.deck) < 40) fillBasics(g.deck); } msg = `Wrong: it was ${r.answer}. ${lost} is taken from you.`; }
        else if (roll < 0.5) { const n = 1 + Math.floor(Math.random() * 3); g.player.life = Math.max(1, g.player.life - n); msg = `Wrong: it was ${r.answer}. You lose ${n} life.`; }
        else { const n = 2 + Math.floor(Math.random() * 4); g.player.food = Math.max(0, g.player.food - n); msg = `Wrong: it was ${r.answer}. ${n} food spoils in your pack.`; }
      }
      save(); toast(msg);
    } })),
  };
  render();
}
function bossLink() {
  const g = S.game; g.boss.links++;
  if (g.boss.links >= BOSS_LINKS) { g.status = 'lost'; save(); go('end'); return; }
  toast(`The Usurper has bound ${g.boss.links} of ${BOSS_LINKS} mana links. Hurry.`);
}
function toast(msg) { S.toast = msg; render(); setTimeout(() => { if (S.toast === msg) { S.toast = null; render(); } }, 3500); }

function specialPrompt(sp) {
  const g = S.game;
  if (sp.kind === 'gemcutter') {
    S.modal = {
      title: 'The Gem Cutter Guild',
      body: `<p class="taunt">Cut gems for the discerning wanderer. Two hundred gold the stone, any hue.</p><p>You hold ${g.player.gold} gold. Your amulets: <span class="amurow">${amuletGems()}</span></p>`,
      buttons: [...COLORS.map(c => ({ label: `Buy ${COLOR_NAME[c]} (200)`, disabled: g.player.gold < 200, action: () => { g.player.gold -= 200; giveAmulet(c); sfx('coin'); save(); specialPrompt(sp); } })), { label: 'Leave', primary: true, action: () => { S.modal = null; render(); } }],
    };
    render(); return;
  }
  if (sp.kind === 'lostcity') {
    if (!sp.used) {
      sp.used = true; for (const c of COLORS) giveAmulet(c); sfx('open'); save();
      S.modal = { title: 'The Lost City of El\u2019Arkan', body: '<p class="taunt">Sand parts over a ring of five altars. On each rests a single perfect amulet.</p><p>You take one amulet of every color.</p>', buttons: [{ label: 'Wondrous', primary: true, action: () => { S.modal = null; render(); } }] };
    } else {
      S.modal = { title: 'The Lost City of El\u2019Arkan', body: '<p>The altars are bare. You have already claimed the amulets of El\u2019Arkan.</p>', buttons: [{ label: 'Leave', primary: true, action: () => { S.modal = null; render(); } }] };
    }
    render(); return;
  }
  if (sp.kind === 'diamondmine') {
    const have = COLORS.filter(c => amuletCount(c) > 0);
    S.modal = {
      title: 'The Diamond Mine',
      body: `<p class="taunt">The miners trade in gems, not gold. One amulet, one card of its color.</p><p>Your amulets: <span class="amurow">${amuletGems()}</span></p>${have.length ? '' : '<p class="small">You have no amulets to trade.</p>'}`,
      buttons: [...have.map(c => ({ label: `Trade ${COLOR_NAME[c]} amulet`, action: () => { const pool = cityPool(c).filter(n => { const d = defOf(n); return d && d.kind !== 'unsupported'; }); const card = rnd(pool); if (card) { giveAmulet(c, -1); addCards(S.collection, card, 1); sfx('coin'); save(); toast(`The mine gives you ${card}.`); } S.modal = null; render(); } })), { label: 'Leave', primary: true, action: () => { S.modal = null; render(); } }],
    };
    render(); return;
  }
}
function encounter(enemy) {
  const tpl = enemyById(enemy.template); const g = S.game;
  S.modal = {
    title: `${tpl.name} (tier ${tpl.tier}, ${COLOR_NAME[tpl.color]})`,
    body: `<p class="taunt">“${esc(tpl.taunt)}”</p><p>Life ${tpl.life + DIFF[g.difficulty].enemyBonus}. Win: ${tpl.gold} gold and their ante card. Lose: your ante card.</p>`,
    buttons: [
      { label: 'Duel', primary: true, action: () => { S.modal = null; startDuel(tpl, enemy.uid); } },
      { label: `Bribe (${tpl.bribe} gold)`, disabled: g.player.gold < tpl.bribe, action: () => { g.player.gold -= tpl.bribe; g.world.enemies = g.world.enemies.filter(e => e.uid !== enemy.uid); if (g.quests) g.quests = g.quests.filter(q => q.enemyUid !== enemy.uid); S.modal = null; save(); render(); } },
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

function startDuel(tpl, roamUid, opts = {}) {
  const g = S.game; const d = DIFF[g.difficulty];
  const ante = opts.dungeon ? null : { mine: pickAnte(g.deck), theirs: pickAnte(tpl.deck) };
  const rules = opts.rules || {};
  const duel = new Duel({
    player: { name: g.name, deck: expandDeck(g.deck), life: g.player.life },
    ai: { name: opts.name || tpl.name, deck: expandDeck(tpl.deck), life: tpl.life + d.enemyBonus + (tpl.boss ? g.boss.links * 5 : 0) + (opts.lifeBonus || 0) + (rules.oppLife || 0), ai: true },
    hooks: aiHooks, rules,
  });
  S.duel = { duel, tpl, ante, roamUid, dungeon: opts.dungeon || null };
  go('duel');
}

// ---- dungeons ---------------------------------------------------------------------
function dungeonPrompt(dg) {
  const t = dungeonTemplate(dg.id); const rule = S.dungeons.rules[t.rule]; const g = S.game;
  const resume = !!dg.layout;
  S.modal = {
    title: t.name,
    body: `<p class="taunt">${esc(t.intro)}</p><p><b>${esc(rule.label)}:</b> ${esc(rule.text)} Your life carries from fight to fight. Monsters block the corridors until beaten; piles hold life, gold and cards; scrolls hold riddles. The guardian before the exit keeps the vault.</p><p>You have ${g.player.life} life.${dg.cleared ? ' The guardian is already dead; only leftovers remain.' : resume ? ' You have been here before, and the maze remembers.' : ''}</p>`,
    buttons: [{ label: resume ? 'Go back in' : 'Enter', primary: true, action: () => {
      S.modal = null;
      sfx('open');
      if (!dg.layout) dg.layout = generateDungeon(Math.random, t);
      dg.layout.px = dg.layout.entrance.x; dg.layout.py = dg.layout.entrance.y; dg.layout.status = 'First move';
      g.dungeon = { id: dg.id }; save(); go('dungeon');
    } }, { label: 'Not now', action: () => { S.modal = null; render(); } }],
  };
  render();
}
function currentDungeon() {
  const g = S.game; if (!g?.dungeon) return null;
  const dg = (g.world.dungeons || []).find(d => d.id === g.dungeon.id);
  return dg?.layout ? { dg, layout: dg.layout, tpl: dungeonTemplate(dg.id) } : null;
}
function dungeonMove(cell) {
  const cur = currentDungeon(); if (!cur || S.modal) return;
  const { layout } = cur;
  const here = playerCell(layout);
  if (!cell || !linked(layout, here, cell)) return;
  if (cell.type === 'monster' && !cell.done) { dungeonFightPrompt(cell); return; }
  layout.px = cell.x; layout.py = cell.y;
  if (cell.type === 'treasure' && !cell.done) dungeonLoot(cell);
  else if (cell.type === 'riddle' && !cell.done) { save(); dungeonRiddle(cell); return; }
  else if (cell.type === 'exit') { save(); dungeonExitPrompt(false); return; }
  else if (cell.type === 'entrance') { save(); dungeonExitPrompt(true); return; }
  save(); render();
}
function dungeonFightPrompt(cell) {
  const { tpl } = currentDungeon(); const g = S.game;
  const guardian = !!cell.payload.guardian;
  S.modal = {
    title: guardian ? `The Guardian of the ${tpl.name}` : `A ${COLOR_NAME[tpl.color].toLowerCase()} mage bars the way`,
    body: `<p>${guardian ? 'It has grown fat on what it guards. Beat it and the vault is yours.' : `Tier ${cell.payload.tier}. It will not move until it is beaten.`}</p><p>You have ${g.player.life} life. There is no ante here.</p>`,
    buttons: [{ label: 'Fight', primary: true, action: () => { S.modal = null; dungeonFight(cell); } }, { label: 'Step back', action: () => { S.modal = null; render(); } }],
  };
  render();
}
function dungeonFight(cell) {
  const { tpl, dg } = currentDungeon(); const rule = S.dungeons.rules[tpl.rule];
  const pool = S.content.enemies.filter(e => e.color === tpl.color && !e.boss);
  const guardian = !!cell.payload.guardian;
  const etpl = (guardian ? pool.find(e => e.tier === 2) : pool.find(e => e.tier === cell.payload.tier)) || pool[0];
  const rules = { handSize: rule.handSize, upkeepDamage: rule.upkeepDamage, oppLife: rule.oppLife };
  if (rule.wall) { const wd = defOf(S.dungeons.walls[tpl.color]); if (wd && wd.kind !== 'unsupported') rules.oppStart = [wd]; }
  startDuel(etpl, null, { dungeon: { id: dg.id, cell: { x: cell.x, y: cell.y } }, rules, name: guardian ? `Guardian of the ${tpl.name}` : `${etpl.name} of the ${tpl.name}`, lifeBonus: guardian ? 4 : 0 });
}
function dungeonLoot(cell) {
  const g = S.game; const { tpl, layout } = currentDungeon();
  const kind = cell.payload.kind; let msg;
  const pick = list => rnd(list.filter(n => defOf(n) && defOf(n).kind !== 'unsupported')) || rnd(list);
  switch (kind) {
    case 'gold': { const n = 10 + Math.floor(Math.random() * 21); g.player.gold += n; msg = `A pile of ${n} gold.`; break; }
    case 'life': { const before = g.player.life; g.player.life = Math.min(g.player.maxLife, g.player.life + 6); msg = `A healing draught: ${g.player.life - before} life restored.`; break; }
    case 'card': { const c = pick(tpl.treasure); addCards(S.collection, c, 1); msg = `A card in the dust: ${c}.`; break; }
    case 'amulet': { g.player.maxLife += 1; g.player.life += 1; msg = 'An old amulet: maximum life +1.'; break; }
    default: { const n = 20 + Math.floor(Math.random() * 11); g.player.gold += n; const c = pick(tpl.treasure); addCards(S.collection, c, 1); msg = `A chest: ${n} gold and ${c}.`; }
  }
  cell.done = true; layout.status = msg; save(); toast(msg);
}
function dungeonRiddle(cell) {
  const g = S.game; const { tpl, layout } = currentDungeon();
  const names = [...tpl.treasure, ...S.content.enemies.filter(e => e.color === tpl.color).flatMap(e => Object.keys(e.deck))].filter(n => !BASIC_NAMES.has(n));
  const qDefs = riddleDefs(); const r = makeRiddle(Math.random, qDefs.length >= 12 ? qDefs : [...new Set(names)].map(defOf));
  if (!r) { cell.done = true; save(); render(); return; }
  S.modal = {
    title: 'A scroll, pinned to the wall',
    body: `<p class="taunt">${esc(r.q)}</p>`,
    buttons: r.options.map(o => ({ label: o, primary: false, action: () => {
      S.modal = null; cell.done = true;
      let msg;
      if (o === r.answer) { const c = rnd(tpl.treasure.filter(n => defOf(n) && defOf(n).kind !== 'unsupported')) || rnd(tpl.treasure); addCards(S.collection, c, 1); g.player.gold += 10; msg = `Correct. The scroll unrolls into ${c} and 10 gold.`; sfx('right'); }
      else { sfx('wrong'); g.player.life = Math.max(1, g.player.life - 3); msg = `Wrong: it was ${r.answer}. The scroll burns your hand for 3 life.`; }
      layout.status = msg; save(); toast(msg);
    } })),
  };
  render();
}
function dungeonExitPrompt(atEntrance) {
  const { layout, dg, tpl } = currentDungeon(); const g = S.game;
  const left = remainingMonsters(layout);
  S.modal = {
    title: atEntrance ? 'Back to the surface?' : 'The way out',
    body: `<p>${left ? `${left} monster${left > 1 ? 's' : ''} still lurk${left > 1 ? '' : 's'} in the ${tpl.name}.` : 'The halls are quiet.'} You keep whatever you found and your ${g.player.life} life. The maze stays as you left it.</p>`,
    buttons: [{ label: 'Leave', primary: true, action: () => { S.modal = null; g.dungeon = null; save(); go('map'); } }, { label: 'Stay', action: () => { S.modal = null; render(); } }],
  };
  render();
}
function dungeonTreasureDrop() {
  const g = S.game; const { tpl, dg } = currentDungeon();
  const lines = [];
  const card = rnd(tpl.treasure.filter(n => defOf(n) && defOf(n).kind !== 'unsupported')) || rnd(tpl.treasure);
  addCards(S.collection, card, 1); lines.push(`The vault holds ${card}.`);
  if (Math.random() < 0.5) { const art = rnd(S.dungeons.artifacts.filter(n => defOf(n) && defOf(n).kind !== 'unsupported')); if (art) { addCards(S.collection, art, 1); lines.push(`A relic: ${art}.`); } }
  const gold = 20 + Math.floor(Math.random() * 21); g.player.gold += gold; lines.push(`${gold} gold in an old chest.`); sfx('coin');
  giveAmulet(tpl.color); lines.push(`The Guardian's ${COLOR_NAME[tpl.color]} amulet is yours.`);
  dg.cleared = true;
  S.result = { won: true, tpl: { name: tpl.name }, lines, title: 'The vault is yours', flavour: `The Guardian of the ${tpl.name} is dead. The exit is open.`, back: 'dungeon' };
  save(); go('result');
}
function revealClue(color) {
  const g = S.game; const hidden = (g.world.dungeons || []).filter(d => !d.revealed);
  if (!hidden.length) return null;
  const dg = hidden.find(d => d.color === color) || rnd(hidden);
  dg.revealed = true;
  const t = dungeonTemplate(dg.id);
  const dx = dg.x - g.player.x, dy = dg.y - g.player.y;
  const dir = (Math.abs(dy) > Math.abs(dx) / 2 ? (dy < 0 ? 'north' : 'south') : '') + (Math.abs(dx) > Math.abs(dy) / 2 ? (dx < 0 ? 'west' : 'east') : '');
  return `Your beaten foe buys mercy with a clue: the ${t.name} lies to the ${dir}, about ${Math.max(Math.abs(dx), Math.abs(dy))} days' walk. It is marked on your map.`;
}
function finishDuel(winner) {
  const g = S.game; const { duel, tpl, ante, roamUid, dungeon, tutorial } = S.duel; S.duel = null;
  sfx(winner === 0 ? 'win' : 'lose');
  if (tutorial) {
    go('title');
    S.modal = {
      title: winner === 0 ? 'You won the practice duel' : 'You lost the practice duel',
      body: `<p>${winner === 0 ? `${esc(tpl.name)} is at 0 life. That is the whole game: lands, creatures, attacks, and knowing when to hold back.` : `${esc(tpl.name)} got you to 0 life. Nothing is lost in practice. Keep a blocker back, attack when their creatures cannot kill yours, and cast a creature every turn you can.`}</p><p>Ready for the real thing? Start a new journey below. The hints stay off in real duels, but every screen works the same way.</p>`,
      buttons: [{ label: 'Practice again', primary: winner !== 0, action: () => { S.modal = null; startTutorialDuel(); } }, { label: 'Back to the lessons', action: () => { S.modal = null; go('tutorial'); } }, { label: 'Back to the title', primary: winner === 0, action: () => { S.modal = null; render(); } }],
    };
    render(); return;
  }
  const lines = [];
  if (dungeon) {
    const cur = currentDungeon();
    if (winner === 0) {
      g.wins++; g.player.life = Math.max(1, duel.players[0].life);
      const cell = cur && cellOf(cur.layout, dungeon.cell.x, dungeon.cell.y);
      if (cell) { cell.done = true; cur.layout.px = cell.x; cur.layout.py = cell.y; cur.layout.status = `${tpl.name} falls. ${g.player.life} life left.`; }
      if (cell?.payload?.guardian) { dungeonTreasureDrop(); return; }
      save(); go('dungeon'); return;
    }
    g.losses++; g.dungeon = null;
    const lost = Math.floor(g.player.gold * 0.25); g.player.gold -= lost; if (lost) lines.push(`${lost} gold is taken from you.`);
    g.player.life = g.player.maxLife; lines.push('You are dragged out of the dark and left on the road, restored but poorer. The maze remembers what you cleared.');
    S.result = { won: false, tpl, lines }; save(); go('result'); return;
  }
  if (winner === 0) {
    g.wins++; g.player.gold += tpl.gold; g.player.food += 5; lines.push(`You win ${tpl.gold} gold and take 5 food from their pack.`);
    if (ante.theirs) { addCards(S.collection, ante.theirs, 1); lines.push(`You take ${ante.theirs} as ante.`); }
    g.player.life = Math.max(duel.players[0].life, Math.ceil(g.player.maxLife / 2));
    if (roamUid != null) { g.world.enemies = g.world.enemies.filter(e => e.uid !== roamUid); if (Math.random() < 0.45) { const clue = revealClue(tpl.color); if (clue) lines.push(clue); } }
    // Tough foes drop amulets; a matching bounty pays one too.
    const dropChance = tpl.boss ? 1 : tpl.tier >= 2 ? 0.4 : 0.12;
    if (Math.random() < dropChance) { const col = tpl.boss ? rnd(COLORS) : tpl.color; giveAmulet(col); lines.push(`You pry a ${COLOR_NAME[col]} amulet from your fallen foe.`); }
    if (roamUid != null && g.quests?.length) { const q = g.quests.find(q => q.enemyUid === roamUid); if (q) { giveAmulet(q.color); g.quests = g.quests.filter(x => x !== q); lines.push(`Bounty claimed: ${q.city} rewards you a ${COLOR_NAME[q.color]} amulet.`); } }
    if (tpl.boss) { g.status = 'won'; save(); go('end'); return; }
  } else {
    g.losses++;
    if (ante.mine) { addCards(S.collection, ante.mine, -1); addCards(g.deck, ante.mine, -1); lines.push(`You lose ${ante.mine} as ante.`); if (deckSize(g.deck) < 40) { fillBasics(g.deck); lines.push('A basic land fills the gap so your deck stays at 40 cards.'); } }
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
  // Occasional artifacts and special lands. Unsupported cards never appear.
  const ok = n => { const d = defOf(n); return d && d.kind !== 'unsupported'; };
  if (Math.random() < 0.6) { const a = rnd(S.shop.artifacts.filter(ok)); if (a) items.push({ name: a, price: 6 + defOf(a).cmc * 4 + (S.shop.rareArtifacts.includes(a) ? 12 : 0), sold: false, special: 'artifact' }); }
  if (Math.random() < 0.55) {
    const list = [...(S.shop.lands[city.color] || []), ...S.shop.lands.any].filter(ok);
    const l = rnd(list);
    if (l) { const d = defOf(l); const dual = d.subtypes.length >= 2; const price = dual ? 30 : d.produces.length >= 2 ? 18 : 14; items.push({ name: l, price, sold: false, special: 'land' }); }
  }
  g.cityStock[key] = { day: g.player.day, items }; save();
  return items;
}
// Amulet card shop. Every known card is buyable with amulets; rarer / costlier cards cost more amulets.
// A city's shop lists cards of its own color; artifacts are colorless and buyable with any amulets anywhere.
function knownCardNames() {
  const names = new Set();
  for (const e of S.content?.enemies || []) for (const n of Object.keys(e.deck)) names.add(n);
  for (const n of S.shop?.artifacts || []) names.add(n);
  for (const list of Object.values(S.shop?.lands || {})) for (const n of list) names.add(n);
  for (const d of S.dungeons?.dungeons || []) for (const n of d.treasure) names.add(n);
  for (const n of S.dungeons?.artifacts || []) names.add(n);
  for (const n of Object.keys(S.collection)) names.add(n);
  return [...names];
}
// The Power Nine and a few other game-warpers are premium-priced, overriding the formula.
const PREMIUM_AMULETS = {
  'Black Lotus': 8,
  'Mox Pearl': 5, 'Mox Sapphire': 5, 'Mox Jet': 5, 'Mox Ruby': 5, 'Mox Emerald': 5,
  'Ancestral Recall': 7, 'Time Walk': 7, 'Timetwister': 7,
};
function amuletPrice(name) {
  if (PREMIUM_AMULETS[name]) return PREMIUM_AMULETS[name];
  const d = defOf(name); if (!d) return 3;
  let cost = 1 + Math.floor((d.cmc || 0) / 2);         // mana value as the quality proxy
  const rar = cachedCard(name)?.rarity;
  if (rar === 'mythic' || rar === 'rare') cost += 2;
  else if (rar === 'uncommon') cost += 1;
  if (d.kind === 'artifact' || d.legendary) cost += 1;
  return Math.max(1, Math.min(7, cost));
}
const SHOP_CAP = 80;
function shopNames(color) {
  const cat = (S.catalog?.[color] || []).slice(0, SHOP_CAP);
  const own = knownCardNames().filter(n => { const d = defOf(n); return d && d.kind !== 'unsupported' && d.kind !== 'land' && !d.types.includes('Artifact') && d.colors?.includes(color); });
  return [...new Set([...cat, ...own])];
}
function artifactNames() {
  const cat = (S.catalog?.artifact || []).slice(0, SHOP_CAP);
  const own = knownCardNames().filter(n => { const d = defOf(n); return d && d.kind !== 'unsupported' && d.types.includes('Artifact') && d.colors?.length === 0; });
  return [...new Set([...cat, ...own])];
}
// Engine-ignored (unsupported) cards can't go in a deck, so they're never offered for sale.
const shopSellable = n => { const d = defOf(n); return d && d.kind !== 'unsupported' && d.kind !== 'land'; };
function amuletShopPool(color) {
  return shopNames(color).filter(shopSellable).sort((a, b) => (defOf(a).cmc - defOf(b).cmc) || a.localeCompare(b));
}
// A shop shows a random 15 that stays put until the player wins or loses a battle (wins+losses is the nonce).
function amuletStockNames(city) {
  const g = S.game; const color = city.color; const bc = g.wins + g.losses;
  g.amuletStock ||= {};
  const st = g.amuletStock[color];
  if (st && st.bc === bc && st.names && st.names.length) return st.names.filter(n => { const d = defOf(n); return d && d.kind !== 'unsupported'; });
  if (S.shopFetching === color) return null;                 // still loading; don't lock in a thin stock
  const pool = [...amuletShopPool(color), ...artifactShopPool()];
  if (!pool.length) return null;
  const names = shuffle(pool.slice()).slice(0, 15).sort((a, b) => (amuletPrice(a) - amuletPrice(b)) || a.localeCompare(b));
  g.amuletStock[color] = { bc, names };
  save();
  return names;
}
const isColorlessArtifact = n => { const d = defOf(n); return !!d && d.types.includes('Artifact') && (!d.colors || d.colors.length === 0); };
function artifactShopPool() {
  return artifactNames().filter(n => { const d = defOf(n); return d && d.kind !== 'unsupported'; }).sort((a, b) => (defOf(a).cmc - defOf(b).cmc) || a.localeCompare(b));
}
// On opening a city, pull card data (not the slow era-art) for that color's shelf, then re-render.
function stockAmuletShop(color) {
  const want = [...shopNames(color), ...artifactNames()];
  const uncached = want.filter(n => !cachedCard(n));
  if (!uncached.length || S.shopFetching) return;
  S.shopFetching = color;
  fetchCards(uncached, null, { skipArt: true }).then(() => { S.shopFetching = null; forgetDefs(); if (S.screen === 'city') render(); }).catch(() => { S.shopFetching = null; });
}
// Spend `cost` amulets: a single color for colored cards, or across any colors (largest first) for artifacts.
function spendAmulets(cost, color) {
  const g = S.game;
  if (color) { if (amuletCount(color) < cost) return false; g.player.amulets[color] -= cost; return true; }
  if (totalAmulets() < cost) return false;
  let left = cost;
  for (const c of COLORS.slice().sort((a, b) => amuletCount(b) - amuletCount(a))) { const take = Math.min(left, amuletCount(c)); g.player.amulets[c] -= take; left -= take; if (left <= 0) break; }
  return true;
}
function amuletRow(name, payColor) {
  const d = defOf(name); const cost = amuletPrice(name);
  const afford = payColor ? amuletCount(payColor) >= cost : totalAmulets() >= cost;
  const gem = payColor ? AMULET_HEX[payColor] : '#cbd5e1';
  return `<div class="amushop-row"><span class="mini" data-preview="${esc(name)}" style="${artFor(d) ? `background-image:url('${artFor(d)}')` : ''}"></span><span class="nm" data-preview="${esc(name)}">${esc(name)} ${tierChip(name)}<i>${esc(d.typeLine)}</i></span><span class="cost">${cost}<i class="amu-chip" style="background:${gem}"></i></span><button class="btn small" data-amshop="${esc(name)}" data-amcolor="${payColor || ''}" ${afford ? '' : 'disabled'}>Buy</button></div>`;
}
// A bounty: defeat a specific roaming foe near this city for an amulet of its color.
// The nearest un-bountied foe a city will post a bounty on (deterministic, so the offer is stable on a visit).
function cityBountyOffer(city) {
  const g = S.game;
  const cand = g.world.enemies
    .filter(e => !e.bounty && !g.quests.some(q => q.enemyUid === e.uid) && Math.abs(e.x - city.x) <= 9 && Math.abs(e.y - city.y) <= 9)
    .sort((a, b) => (Math.abs(a.x - city.x) + Math.abs(a.y - city.y)) - (Math.abs(b.x - city.x) + Math.abs(b.y - city.y)));
  return cand[0] || null;
}
function bearing(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  return (Math.abs(dy) > Math.abs(dx) / 2 ? (dy < 0 ? 'north' : 'south') : '') + (Math.abs(dx) > Math.abs(dy) / 2 ? (dx < 0 ? 'west' : 'east') : '') || 'nearby';
}
function acceptBounty(city) {
  const g = S.game; const e = cityBountyOffer(city); if (!e) { toast('No worthy foe roams near this city right now.'); return; }
  const tpl = enemyById(e.template);
  e.bounty = true;
  g.quests.push({ enemyUid: e.uid, color: tpl.color, city: city.name, enemyName: tpl.name });
  sfx('coin'); save(); render();
}

// ---- import ------------------------------------------------------------------------
async function doImport(text) {
  const entries = parseList(text);
  if (!entries.length) { S.report = { error: 'No card lines found.' }; render(); return; }
  setBusy(`Looking up ${entries.length} names…`);
  try {
    const rows = await importNames(entries, (d, t, phase) => setBusy(phase === 'art' ? `Finding original printings for art… ${d}/${t}` : `Fetching from Scryfall… ${d}/${t}`));
    let added = 0;
    for (const r of rows) if (r.def) { addCards(S.collection, r.canonical, r.count); added += r.count; }
    S.report = { rows, added };
    save();
  } catch (e) { S.report = { error: 'Import failed: ' + e.message }; }
  setBusy(null); render();
}

// ---- rendering --------------------------------------------------------------------
onAtlas(() => { if (S.screen === 'map' || S.screen === 'dungeon') render(); });
function go(screen) { S.screen = screen; S.modal = null; hidePreview(); window.scrollTo(0, 0); render(); }

function renderTop() {
  const g = S.game; const inDuel = S.screen === 'duel';
  const tabs = [['map', 'Map'], ['collection', 'Collection'], ['deck', 'Deck']];
  topbar.innerHTML = `<div class="brand" data-go="title">Fivefold <span>demo</span></div>
    <nav>${tabs.map(([k, l]) => `<button class="tab${S.screen === k ? ' on' : ''}" data-go="${k}" ${inDuel || (k !== 'collection' && !g) ? 'disabled' : ''}>${l}</button>`).join('')}</nav>
    ${g ? `<div class="stats"><span title="Life">♥ ${g.player.life}/${g.player.maxLife}</span><span title="Gold">◎ ${g.player.gold}</span><span title="Food" class="${g.player.food === 0 ? 'starving' : ''}">✦ ${g.player.food}${g.player.food === 0 ? ' STARVING' : ''}</span><span title="Day">Day ${g.player.day}</span><span title="Usurper's links">Links ${g.boss.links}/${BOSS_LINKS}</span></div>${g && totalAmulets() ? `<div class="amurow" title="Amulets">${amuletGems()}</div>` : ''}` : ''}
    <button class="tab audio${g ? '' : ' solo'}" data-audio title="${audioMuted() ? 'Sound is off. Click to turn it on.' : 'Sound is on. Click to mute.'}">${audioMuted() ? '🔇' : '🔊'}</button>`;
}

function render() {
  app.classList.toggle('full', S.screen === 'duel');
  renderTop();
  const views = { title, collection, deck, map, city, duel, result, end, dungeon, tutorial, tiers };
  music({ title: 'title', tutorial: 'title', collection: 'map', deck: 'map', map: 'map', result: 'map', end: 'title', city: 'city', duel: 'duel', dungeon: 'dungeon' }[S.screen] || 'title');
  // The map keeps its canvas between steps (re-creating a full-size canvas every keypress is what made walking feel slow).
  const keepMap = S.screen === 'map' && !!app.querySelector('.mapscreen #map');
  if (keepMap) { for (const el of app.querySelectorAll('.overlay, .toast')) el.remove(); } else app.innerHTML = '';
  (views[S.screen] || title)();
  if (S.modal) app.insertAdjacentHTML('beforeend', `<div class="overlay"><div class="modal"><h3>${S.modal.title}</h3><div class="mbody">${S.modal.body}</div><div class="mbtns">${S.modal.buttons.map((b, i) => `<button class="btn${b.primary ? ' primary' : ''}" data-modal="${i}" ${b.disabled ? 'disabled' : ''}>${esc(b.label)}</button>`).join('')}</div></div></div>`);
  if (S.toast) app.insertAdjacentHTML('beforeend', `<div class="toast">${esc(S.toast)}</div>`);
  setBusy(S.busy);
}

function title() {
  const g = S.game;
  app.innerHTML = `<section class="screen title">
    <h1>Fivefold</h1>
    <p class="lede">A generation ago a wandering mage with a weak deck broke five corrupt guilds and drove a planeswalker back beyond the barrier. The barrier healed crooked. Mana pools and drains in tides now, the five Orders hoard the links that pin the cracks shut, and something that came through before the seal closed has spent thirty years whispering to their Wardens. The old Wanderer is dying. The letter, and the title, are yours.</p>
    <p class="lede small">Walk a world where geography is color. Duel the mages who roam it with the cards you actually own. Wager cards you cannot buy back. Find which Warden the Usurper is wearing before the Sealing completes.</p>
    <div class="box learn">
      <div><h2>New to Magic?</h2><p>Eight short lessons cover everything a duel needs: lands, mana, creatures, combat and spells. Then fight a practice duel with hints that read the table and tell you what to do next.</p></div>
      <div class="btnrow"><button class="btn primary" data-go="tutorial">Learn to play</button><button class="btn" id="b-practice">Practice duel</button></div>
    </div>
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
        ${g ? `<p>${esc(g.name)}, day ${g.player.day}, ${g.wins} wins and ${g.losses} losses.${g.created ? ` Journey begun ${new Date(g.created).toLocaleDateString()}.` : ''} ${g.status !== 'playing' ? 'This journey is over.' : ''}</p><button class="btn primary" data-go="${g.status === 'playing' ? 'map' : 'end'}">Continue</button>` : ''}
        <p>${Object.values(S.collection).reduce((a, b) => a + b, 0)} cards in your collection${hasServer() ? `, ${artCount()} custom images in the art folder` : ''}.</p>
        <div class="btnrow"><button class="btn" data-go="collection">Manage collection</button><button class="btn" data-go="tiers">Card power tiers</button><button class="btn ghost" id="b-reset-all">Reset everything</button></div>
        <p class="small">Reset everything wipes your current journey and your whole collection, so a New journey starts truly fresh.</p>
      </div>
    </div>
    <footer class="legal">Unofficial fan project under the Wizards of the Coast Fan Content Policy. Not approved or endorsed by Wizards. Card data is fetched from Scryfall at runtime; nothing is bundled. Magic: The Gathering is a trademark of Wizards of the Coast.</footer>
  </section>`;
}

function tutorial() {
  const i = Math.max(0, Math.min(LESSONS.length - 1, S.lesson)); S.lesson = i;
  const l = LESSONS[i]; const last = i === LESSONS.length - 1;
  app.innerHTML = `<section class="screen lessonscreen">
    <aside class="box lessonnav">
      <h2>Learn to play</h2>
      <ol>${LESSONS.map((x, k) => `<li class="${k === i ? 'on' : ''}${k < i ? ' done' : ''}"><button class="linkbtn" data-lesson="${k}">${esc(x.title)}</button></li>`).join('')}</ol>
      <p class="small">Hover a green card name to see the card. Nothing here touches your collection or save.</p>
      <button class="btn" data-go="title">Back to the title</button>
    </aside>
    <div class="box lesson">
      <div class="small">Lesson ${i + 1} of ${LESSONS.length}</div>
      <h2>${esc(l.title)}</h2>
      ${l.html}
      <div class="btnrow lessonbtns">
        <button class="btn" data-lesson="${i - 1}" ${i === 0 ? 'disabled' : ''}>Previous</button>
        ${last ? '<button class="btn primary" id="b-practice">Start the practice duel</button>' : `<button class="btn primary" data-lesson="${i + 1}">Next</button>`}
        ${last ? '' : '<button class="btn ghost" id="b-practice">Skip to the practice duel</button>'}
      </div>
    </div>
  </section>`;
}
// A duel outside the journey: the green starter deck against the weakest enemy, 20 life each, no ante, with hints.
async function startTutorialDuel() {
  await ensureContent();
  const starter = S.content.enemies.find(e => e.color === 'G' && e.tier === 1);
  const tpl = S.content.enemies.find(e => e.color === 'W' && e.tier === 1) || S.content.enemies.find(e => e.tier === 1);
  const duel = new Duel({
    player: { name: S.game?.name || 'Apprentice', deck: expandDeck({ ...starter.deck }), life: 20 },
    ai: { name: tpl.name, deck: expandDeck({ ...tpl.deck }), life: 20, ai: true },
    hooks: aiHooks, rules: {},
  });
  S.duel = { duel, tpl, ante: null, roamUid: null, dungeon: null, tutorial: true };
  setBusy(null); go('duel');
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
        <div class="btnrow"><button class="btn primary" id="b-import">Import list</button>${hasServer() ? '<button class="btn" id="b-csv">Load collection.csv</button>' : ''}<button class="btn ghost" id="b-clear-coll">Clear collection</button></div>
        ${rep ? rep.error ? `<div class="msg">${esc(rep.error)}</div>` : `<div class="report"><b>Added ${rep.added} cards.</b>
          <table><tr><th>Card</th><th>Qty</th><th>Status</th><th>Notes</th></tr>${rep.rows.map(r => `<tr class="st-${r.def ? r.def.status : 'missing'}"><td>${esc(r.canonical || r.name)}</td><td>${r.count}</td><td>${statusLabel(r.def)}</td><td>${esc((r.def?.notes || []).join('; '))}</td></tr>`).join('')}</table></div>` : ''}
      </div>
      <div class="box">
        <h2>Your art</h2>
        ${hasServer() ? `<p class="small">${artCount()} images found in the <code>art/</code> folder. Name a file after the card, lowercase with dashes: <code>lightning-bolt.jpg</code>, <code>serra-angel.png</code>. A photo of your physical card works fine. Cards with your art show a ★.</p>
        <button class="btn" id="b-rescan">Rescan art folder</button>` : `<p class="small">Custom art and <code>collection.csv</code> work when the game runs from its own folder with <code>node server.js</code>. On the web version, card images come from Scryfall.</p>`}
        <h2 style="margin-top:18px">Engine support</h2>
        <p class="small"><b>ready</b>: fully playable. <b>approximated</b>: plays, but some abilities are ignored (the notes say which). <b>unsupported</b>: stays in your collection but cannot go in a deck yet. The demo engine knows lands, creatures with common keywords, and burn, removal, pump, bounce, draw and life-gain spells.</p>
      </div>
    </div>
    <div class="box">
      <div class="rowhead"><h2>Collection · ${names.length} distinct, ${Object.values(S.collection).reduce((a, b) => a + b, 0)} total</h2>
        <div class="seg">${['all', 'playable', 'unsupported'].map(f => `<button class="seg-b${S.filter === f ? ' on' : ''}" data-filter="${f}">${f}</button>`).join('')}</div>
        <button class="btn tiny" data-go="tiers" title="Browse and tweak card power tiers">Power tiers ›</button></div>
      ${rows.length ? `<table class="coll"><tr><th></th><th>Card</th><th>Qty</th><th>Type</th><th>Cost</th><th>Art</th><th>Status</th><th>Notes</th><th></th></tr>
      ${rows.map(r => { const raw = r.d ? cachedCard(r.n) : null; const art = r.d && hasOwnArt(r.d) ? 'yours' : raw?.art_set ? `${raw.art_set.toUpperCase()} ${raw.art_year || ''}` : ''; return `<tr class="st-${r.d ? r.d.status : 'missing'}"><td class="thumb">${r.d ? `<div class="mini${hasOwnArt(r.d) ? ' own' : ''}" data-preview="${esc(r.n)}" style="${artFor(r.d) ? `background-image:url('${artFor(r.d)}')` : ''}"></div>` : ''}</td><td data-preview="${esc(r.n)}">${esc(r.n)} ${tierChip(r.n)}</td><td>${r.q}</td><td>${esc(r.d?.typeLine || '')}</td><td>${r.d && r.d.kind !== 'land' ? manaHtml(r.d.cost) : ''}</td><td class="small">${esc(art)}</td><td>${statusLabel(r.d)}</td><td class="notes">${esc((r.d?.notes || []).join('; '))}</td><td><button class="btn tiny" data-dec="${esc(r.n)}">−1</button></td></tr>`; }).join('')}</table>` : '<p class="small">Nothing here yet. Import a list above, or start a new journey to receive a starter deck.</p>'}
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
  // Mana curve: nonland spells bucketed by mana value (0..6, 7+).
  const curve = new Array(8).fill(0); let spells = 0, cmcSum = 0;
  for (const r of inDeck) { if (!r.d || r.d.kind === 'land') continue; const cv = Math.min(7, r.d.cmc || 0); curve[cv] += r.c; spells += r.c; cmcSum += (r.d.cmc || 0) * r.c; }
  const maxC = Math.max(1, ...curve), avg = spells ? (cmcSum / spells) : 0, BH = 78;
  const curveHtml = `<div class="curve">
    <div class="curve-head"><span>Mana curve</span><span class="small">${spells} spell${spells === 1 ? '' : 's'}${spells ? ` · avg ${avg.toFixed(1)}` : ''}</span></div>
    ${spells ? `<div class="curve-plot">${curve.map((n, i) => `<div class="curve-col"><span class="curve-n">${n || ''}</span><div class="curve-bar" style="height:${n ? Math.max(4, Math.round(n / maxC * BH)) : 0}px" title="${n} spell${n === 1 ? '' : 's'} at ${i === 7 ? '7+' : i} mana"></div></div>`).join('')}</div>
    <div class="curve-axis">${curve.map((n, i) => `<span>${i === 7 ? '7+' : i}</span>`).join('')}</div>`
    : '<p class="small" style="margin:6px 0 0">Add some nonland cards to see the curve.</p>'}
  </div>`;
  app.innerHTML = `<section class="screen deckb">
    <div class="cols wide">
      <div class="box">
        <div class="rowhead"><h2>Your cards</h2><span class="rowtools"><button class="btn tiny" id="b-addall">Add all</button><input id="dfilter" placeholder="Filter…" value="${esc(S.deckFilter)}"></span></div>
        <table class="coll"><tr><th>Card</th><th>Cost</th><th>Own</th><th>In deck</th><th></th></tr>
        ${owned.map(r => { const used = g.deck[r.n] || 0; return `<tr><td data-preview="${esc(r.n)}">${esc(r.n)}<span class="small"> ${esc(r.d.typeLine)}</span></td><td>${r.d.kind === 'land' ? '' : manaHtml(r.d.cost)}</td><td>${r.q}</td><td>${used}</td><td><button class="btn tiny" data-add="${esc(r.n)}" ${used >= r.q ? 'disabled' : ''}>+</button></td></tr>`; }).join('')}</table>
      </div>
      <div class="box">
        <div class="rowhead"><h2>Deck · ${size} cards, ${lands} lands</h2><span class="rowtools"><button class="btn" id="b-fill">Fill basics to 40</button><button class="btn" id="b-clear-deck"${size ? '' : ' disabled'}>Remove all</button></span></div>
        ${curveHtml}
        <div class="basics">${COLORS.map(c => `<span class="basic"><i class="dot c-${c}"></i>${BASICS[c]} <b>${g.deck[BASICS[c]] || 0}</b> <button class="btn tiny" data-rem="${BASICS[c]}">−</button><button class="btn tiny" data-add="${BASICS[c]}">+</button></span>`).join('')}</div>
        ${probs.length ? `<div class="msg">${probs.map(esc).join('<br>')}</div>` : '<div class="ok">Deck is ready.</div>'}
        <table class="coll"><tr><th>Card</th><th>Cost</th><th>Qty</th><th></th></tr>
        ${inDeck.map(r => `<tr class="st-${r.d?.status || 'missing'}"><td data-preview="${esc(r.n)}">${esc(r.n)}</td><td>${r.d && r.d.kind !== 'land' ? manaHtml(r.d.cost) : ''}</td><td>${r.c}</td><td><button class="btn tiny" data-rem="${esc(r.n)}">−</button></td></tr>`).join('')}</table>
      </div>
    </div>
  </section>`;
}

// Small tier chip for inline use on cards elsewhere (collection, shops).
function tierChip(name) { const t = tierOf(name); return t ? `<span class="ptb tiny pt-${t}" title="${TIER_META[t][0]} tier">${t}</span>` : ''; }

function tiers() {
  if (S.tiers === undefined) { ensureTiers().then(render); app.innerHTML = `<section class="screen"><div class="box"><p class="small">Loading power tiers…</p></div></section>`; return; }
  if (!S.tiers || !S.tiers.cards) { app.innerHTML = `<section class="screen"><div class="box"><h2>Card power tiers</h2><p class="small">Ranking data is unavailable.</p><button class="btn" data-go="${S.game ? 'map' : 'title'}">Back</button></div></section>`; return; }
  const cards = S.tiers.cards, price = S.tiers.price || { S: 8, A: 6, B: 4, C: 3, D: 2, E: 1 };
  const names = Object.keys(cards);
  const counts = {}, sell = {}; for (const t of TIER_ORDER) { counts[t] = 0; sell[t] = 0; }
  for (const n of names) { const t = tierOf(n); if (!t) continue; counts[t]++; if (cards[n].sell) sell[t]++; }
  const maxSell = Math.max(1, ...TIER_ORDER.map(t => sell[t]));
  const q = S.tierSearch.toLowerCase(), hidden = S.tierHide || {};
  const rows = names.filter(n => {
    const c = cards[n], t = tierOf(n);
    if (hidden[t]) return false;
    if (S.tierSellOnly && !c.sell) return false;
    if (S.tierCurOnly && c.src !== 'curated' && !S.tierOverrides[n]) return false;
    if (S.tierType && !c.type.includes(S.tierType)) return false;
    if (q && !n.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => {
    const s = S.tierSort;
    if (s === 'name') return a.localeCompare(b);
    if (s === 'cmc') return (cards[a].cmc - cards[b].cmc) || a.localeCompare(b);
    if (s === 'rarity') { const R = { rare: 0, uncommon: 1, common: 2 }; return ((R[cards[a].rar] ?? 3) - (R[cards[b].rar] ?? 3)) || a.localeCompare(b); }
    return (TIER_ORDER.indexOf(tierOf(a)) - TIER_ORDER.indexOf(tierOf(b))) || (cards[b].cmc - cards[a].cmc) || a.localeCompare(b);
  });
  const changeN = Object.keys(S.tierOverrides).length;
  app.innerHTML = `<section class="screen tierscreen">
    <div class="box">
      <div class="rowhead"><h2>Card power tiers</h2><button class="btn ghost" data-go="${S.game ? 'map' : 'title'}">Back</button></div>
      <p class="small">How good each Alpha&ndash;Alliances card is in play, strongest to weakest. Tap a tier badge to re-rank a card &mdash; your changes save on this device and collect below to hand back.${changeN ? ` <b>${changeN} re-ranked.</b>` : ''}</p>
      <div class="tsummary">${TIER_ORDER.map(t => `
        <button class="tsum${hidden[t] ? ' off' : ''}" data-tier-toggle="${t}" title="${hidden[t] ? 'Show' : 'Hide'} this tier">
          <span class="ptb pt-${t}">${t}</span>
          <span class="tsum-main"><b>${TIER_META[t][0]}</b><span class="small">${price[t]} amulets</span></span>
          <span class="tsum-n">${sell[t]}<span class="small">/${counts[t]}</span></span>
          <span class="tsum-bar"><i class="pt-bg-${t}" style="width:${Math.round(sell[t] / maxSell * 100)}%"></i></span>
        </button>`).join('')}</div>
    </div>
    <div class="box">
      <div class="tctrls">
        <input id="tier-q" placeholder="Search cards&hellip;" value="${esc(S.tierSearch)}" autocomplete="off">
        <select id="tier-type">${['', 'Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land'].map(t => `<option value="${t}" ${S.tierType === t ? 'selected' : ''}>${t || 'All types'}</option>`).join('')}</select>
        <select id="tier-sort">${[['tier', 'Tier'], ['name', 'Name'], ['cmc', 'Mana value'], ['rarity', 'Rarity']].map(([v, l]) => `<option value="${v}" ${S.tierSort === v ? 'selected' : ''}>Sort: ${l}</option>`).join('')}</select>
        <label class="tchk"><input type="checkbox" id="tier-sell" ${S.tierSellOnly ? 'checked' : ''}> Sellable only</label>
        <label class="tchk"><input type="checkbox" id="tier-cur" ${S.tierCurOnly ? 'checked' : ''}> Curated only</label>
        <span class="small tcount">${rows.length} of ${names.length}</span>
      </div>
      ${changeN ? `<div class="tchanges"><b>${changeN} card${changeN > 1 ? 's' : ''} re-ranked.</b> <button class="btn tiny" id="tier-copy">Copy changes (JSON)</button> <button class="btn tiny ghost" id="tier-clear">Reset all</button></div>` : ''}
      <div class="tlist">${rows.length ? rows.map(n => tierRow(n, cards[n])).join('') : '<p class="small" style="padding:14px">No cards match these filters.</p>'}</div>
    </div>
  </section>`;
}
function tierRow(n, c) {
  const t = tierOf(n), moved = !!S.tierOverrides[n], picking = S.tierPick === n;
  return `<div class="trow${picking ? ' picking' : ''}">
    <button class="ptb pt-${t}${moved ? ' moved' : ''}" data-tier-pick="${esc(n)}" title="Re-rank ${esc(n)}">${t}</button>
    <span class="trow-n" data-preview="${esc(n)}">${esc(n)}${c.src === 'curated' ? ' <span class="tstar" title="Hand-ranked">★</span>' : ''}</span>
    <span class="trow-t small">${esc(c.type)}</span>
    <span class="trow-c">${c.pt ? esc(c.pt) : '◇' + c.cmc}</span>
    <span class="trow-r small r-${c.rar}">${c.rar || ''}</span>
    ${picking ? `<span class="tpick">${TIER_ORDER.map(x => `<button class="ptb pt-${x}${x === t ? ' cur' : ''}" data-tier-set="${x}">${x}</button>`).join('')}</span>` : ''}
  </div>`;
}

function map() {
  const g = S.game; if (!g) return title();
  const here = tileAt(g.world, g.player.x, g.player.y);
  const near = g.world.enemies.filter(e => Math.abs(e.x - g.player.x) <= 1 && Math.abs(e.y - g.player.y) <= 1);
  const panel = `<canvas id="minimap" class="minimap"></canvas>
      <h2>${esc(g.name)}</h2>
      <p>Standing in the <b>${BIOME[here].name}</b> (${COLOR_NAME[here]}). ${near.length ? `<br>${near.map(e => enemyById(e.template).name).join(', ')} nearby.` : ''}</p>
      <p class="small">Move with WASD or the arrow keys, or click a neighbouring tile. Walking costs food. Blue crystals are mana links (+2 life). Landmarks marked ? ask a riddle about a card: answer right for a card of that region's color, wrong and you lose life, food or, rarely, a card. Pits with a torch are dungeons: revealed by clues from beaten foes, fought room by room with your life carried over. The dark fortress is the Usurper.</p>
      ${(g.world.dungeons || []).some(d => d.revealed) ? `<p class="small">Known dungeons: ${g.world.dungeons.filter(d => d.revealed).map(d => `${dungeonTemplate(d.id).name}${d.cleared ? ' (cleared)' : ''}`).join(', ')}.</p>` : ''}
      <div class="btnrow"><button class="btn" id="b-rest" ${g.player.food < 3 || g.player.life >= g.player.maxLife ? 'disabled' : ''}>Rest (3 food, +5 life)</button><button class="btn ghost" data-go="title">Menu</button></div>
      ${amuletCount('R') ? `<h3>World magic</h3><p class="small">Staff of Thunder: spend a red amulet to scatter every monster within three tiles.</p><div class="btnrow"><button class="btn" id="b-worldmagic">Staff of Thunder (1 <i class="amu-chip" style="background:${AMULET_HEX.R}"></i>)</button></div>` : ''}
      <h3>Legend</h3>
      <div class="legend">${COLORS.map(c => `<span><i class="sw" style="background:${BIOME[c].fill}"></i>${BIOME[c].name}</span>`).join('')}</div>`;
  let canvas = app.querySelector('.mapscreen #map');
  if (canvas) app.querySelector('.mappanel').innerHTML = panel;
  else {
    app.innerHTML = `<section class="screen mapscreen"><div class="mapwrap"><canvas id="map"></canvas></div><aside class="mappanel">${panel}</aside></section>`;
    canvas = document.getElementById('map');
  }
  if (!g.world.landmarks) { placeLandmarks(g.world, Math.random); save(); }
  if (!g.world.specials) { placeSpecials(g.world, Math.random); save(); }
  if (!g.player.amulets) { g.player.amulets = newAmulets(); g.quests ||= []; save(); }
  const hl = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [g.player.x + dx, g.player.y + dy]).filter(([x, y]) => inBounds(g.world, x, y));
  const cam = drawWorld(canvas, g.world, g.player, { highlight: hl });
  drawMinimap(document.getElementById('minimap'), g.world, g.player, cam);
  canvas.onclick = ev => {
    const r = canvas.getBoundingClientRect();
    const x = cam.x + Math.floor((ev.clientX - r.left) / r.width * VIEW.w), y = cam.y + Math.floor((ev.clientY - r.top) / r.height * VIEW.h);
    const dx = x - g.player.x, dy = y - g.player.y;
    if (Math.abs(dx) + Math.abs(dy) === 1) move(dx, dy);
  };
}

function city() {
  const g = S.game; const c = cityAt(g.world, g.player.x, g.player.y); if (!c) return map();
  const stock = cityStock(c);
  stockAmuletShop(c.color);
  app.innerHTML = `<section class="screen cityscreen">
    <div class="box">
      <h2>${esc(c.name)} <span class="small">· a ${COLOR_NAME[c.color].toLowerCase()} city in the ${BIOME[c.color].name.toLowerCase()}</span></h2>
      <div class="btnrow">
        <button class="btn" id="b-inn" ${g.player.life >= g.player.maxLife ? 'disabled' : ''}>Rest at the inn (free, full life)</button>
        <button class="btn" id="b-food" ${g.player.gold < 2 ? 'disabled' : ''}>Buy 20 food (2 gold)</button>
        <button class="btn primary" id="b-leave">Leave</button>
      </div>
      <h3>Market</h3>
      <div class="market">${stock.map((it, i) => { const d = defOf(it.name); return `<div class="stall${it.sold ? ' sold' : ''}">${cardHtml(d)}<div class="price">${it.sold ? 'Sold' : `${it.price} gold`}</div><button class="btn small" data-buy="${i}" ${it.sold || g.player.gold < it.price ? 'disabled' : ''}>Buy</button></div>`; }).join('')}</div>
      <p class="small">Stock changes every few days. Artifacts and rare lands pass through now and then. Bought cards go to your collection; add them to your deck from the Deck tab.</p>
      <h3>Amulet exchange <span class="amurow small">${amuletGems()}</span></h3>
      ${(() => {
        const stock = amuletStockNames(c);
        if (!stock) return '<p class="small">The trader is laying out wares\u2026</p>';
        return `<p class="small">Fifteen wares are on offer today. ${COLOR_NAME[c.color]} cards cost ${COLOR_NAME[c.color]} amulets; artifacts take amulets of any color. Rarer, costlier cards ask more. The selection changes after your next battle.</p>
        <div class="amushop"><div class="amushop-list">${stock.map(n => amuletRow(n, isColorlessArtifact(n) ? null : c.color)).join('')}</div></div>`;
      })()}
      <h3>Bounty board</h3>
      ${(() => {
        const q = g.quests.find(q => q.city === c.name);
        if (q) return `<p class="small">Active bounty: defeat <b>${esc(q.enemyName)}</b> for a ${COLOR_NAME[q.color]} amulet. They are marked with a <span style="color:#ffd54a">\u2605</span> on the map.</p>`;
        const offer = cityBountyOffer(c);
        if (!offer) return '<p class="small">The watch has no bounty to offer right now; no foe roams nearby.</p>';
        const tpl = enemyById(offer.template);
        return `<p class="small">The town watch will pay a ${COLOR_NAME[tpl.color]} amulet for the head of <b>${esc(tpl.name)}</b>, a ${COLOR_NAME[tpl.color].toLowerCase()} mage roaming to the ${bearing(c, offer)}.</p><div class="btnrow"><button class="btn" id="b-bounty">Accept the bounty</button></div>`;
      })()}
    </div>
  </section>`;
}

function duel() {
  const d = S.duel;
  // Mount once per duel; a re-render (toast, stats) must not restart the game.
  if (!d.root) {
    d.root = document.createElement('div'); d.root.id = 'duelroot';
    // portraits scale with the window so the table fits without scrolling
    const ph = Math.max(80, Math.min(150, Math.round((window.innerHeight - 700) * 0.2 + 110)));
    const portrait = frames => { frames = frames.filter(Boolean); return { frames, scale: Math.min(2.6, ph / Math.max(...frames.map(f => f[3]))) }; };
    const mageFrames = (color, tier) => { const c = SPRITES.mage[color] ? color : 'M'; return [SPRITES.mage[c][tier >= 2 ? 1 : 0], SPRITES[`mage-${c}-${tier >= 2 ? 2 : 1}-alt`]]; };
    const foe = d.tpl.boss ? portrait(MONSTERS.dragon.idle) : d.dungeon ? portrait(MONSTERS[DUNGEON_MONSTER[d.tpl.color] || 'skeleton'].idle) : portrait(mageFrames(d.tpl.color, d.tpl.tier));
    mountDuel(d.root, d.duel, { ante: d.ante ? { mine: d.ante.mine || '—', theirs: d.ante.theirs || '—' } : null, onEnd: finishDuel, portraits: { me: portrait([SPRITES.hero, SPRITES['hero-alt']]), foe }, tutorial: !!d.tutorial });
  }
  app.innerHTML = '';
  const sec = document.createElement('section'); sec.className = 'screen duelscreen';
  sec.appendChild(d.root); app.appendChild(sec);
}

function dungeon() {
  const cur = currentDungeon(); if (!cur) return map();
  const g = S.game; const { layout, tpl } = cur; const rule = S.dungeons.rules[tpl.rule];
  app.innerHTML = `<section class="screen dungeonscreen">
    <div class="dwrap"><canvas id="dungeon"></canvas></div>
    <aside class="mappanel">
      <h2>${esc(tpl.name)}</h2>
      <p class="taunt">${esc(rule.label)}: ${esc(rule.text)}</p>
      <p>Life <b>${g.player.life}</b>/${g.player.maxLife} · Gold ${g.player.gold} · Monsters left ${remainingMonsters(layout)}</p>
      <p class="small">Click a neighbouring cell or use WASD / the arrow keys. Monsters block the way until beaten and your life carries between fights. Chests hold life, gold and cards. Scrolls ask riddles. Leave by the entrance or the exit door.</p>
      <div class="btnrow"><button class="btn" id="b-dleave">Leave the dungeon</button></div>
    </aside>
  </section>`;
  const canvas = document.getElementById('dungeon');
  drawDungeon(canvas, layout, tpl);
  canvas.onclick = ev => {
    const r = canvas.getBoundingClientRect();
    const cx = (ev.clientX - r.left) / r.width * DCANVAS.w, cy = (ev.clientY - r.top) / r.height * DCANVAS.h;
    dungeonMove(cellAtPixel(layout, cx, cy));
  };
}

function result() {
  const r = S.result; if (!r) return map();
  app.innerHTML = `<section class="screen resultscreen"><div class="box center">
    <h2>${r.title || (r.won ? 'Victory' : 'Defeat')}</h2>
    <p>${r.flavour || (r.won ? `${esc(r.tpl.name)} yields.` : `${esc(r.tpl.name)} stands over you.`)}</p>
    <ul class="plain">${r.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <button class="btn primary" data-go="${r.back || 'map'}">${r.back === 'dungeon' ? 'Back into the dungeon' : 'Back to the map'}</button>
  </div></section>`;
}
function end() {
  const g = S.game;
  app.innerHTML = `<section class="screen resultscreen"><div class="box center">
    <h2>${g.status === 'won' ? 'The Usurper falls' : 'The Spell of Dominion is cast'}</h2>
    <p>${g.status === 'won' ? `${esc(g.name)} unbinds the mana links on day ${g.player.day} after ${g.wins} victories. The plane is free, for now.` : `On day ${g.player.day} the Usurper binds the final link. The world dims. Your collection survives; your journey does not.`}</p>
    <button class="btn primary" id="b-newgame">Start a new journey</button>
  </div></section>`;
}

// ---- events -----------------------------------------------------------------------
app.addEventListener('submit', ev => {
  if (ev.target.id === 'newgame') { ev.preventDefault(); const f = new FormData(ev.target); newGame({ name: f.get('name').trim(), color: f.get('color'), difficulty: f.get('difficulty') }); }
});
document.addEventListener('click', ev => {
  if (ev.target.closest('.btn, .tab, .linkbtn')) sfx('click');
  const t = ev.target.closest('[data-go],[data-modal],[data-filter],[data-add],[data-rem],[data-dec],[data-buy],[data-amshop],[data-audio],[data-lesson],#b-import,#b-csv,#b-rescan,#b-clear-coll,#b-fill,#b-addall,#b-clear-deck,#b-rest,#b-inn,#b-food,#b-leave,#b-newgame,#b-dleave,#b-practice,#b-bounty,#b-worldmagic,#b-reset-all');
  if (!t) return;
  const g = S.game;
  if ('audio' in t.dataset) { toggleAudio(); renderTop(); return; }
  if (t.dataset.lesson != null) { if (!t.disabled) { S.lesson = Number(t.dataset.lesson); go('tutorial'); } return; }
  if (t.dataset.go) { if (!t.disabled) { if (t.dataset.go === 'map' && g?.status !== 'playing' && g) go('end'); else if (t.dataset.go === 'dungeon' && !currentDungeon()) go('map'); else go(t.dataset.go); } return; }
  if (t.dataset.modal != null) { const b = S.modal?.buttons[Number(t.dataset.modal)]; if (b && !b.disabled) b.action(); return; }
  if (t.dataset.filter) { S.filter = t.dataset.filter; render(); return; }
  if (t.dataset.add) { addCards(g.deck, t.dataset.add, 1); save(); render(); return; }
  if (t.dataset.rem) { addCards(g.deck, t.dataset.rem, -1); save(); render(); return; }
  if (t.dataset.dec) { addCards(S.collection, t.dataset.dec, -1); if (g && g.deck[t.dataset.dec] > (S.collection[t.dataset.dec] || 0)) addCards(g.deck, t.dataset.dec, -1); save(); render(); return; }
  if (t.dataset.buy != null) { const c = cityAt(g.world, g.player.x, g.player.y); const it = cityStock(c)[Number(t.dataset.buy)]; if (it && !it.sold && g.player.gold >= it.price) { g.player.gold -= it.price; it.sold = true; addCards(S.collection, it.name, 1); sfx('coin'); save(); render(); } return; }
  if (t.dataset.amshop != null) { const name = t.dataset.amshop; const color = t.dataset.amcolor || null; const cost = amuletPrice(name); if (spendAmulets(cost, color)) { addCards(S.collection, name, 1); sfx('coin'); save(); render(); toast(`${name} bought for ${cost} amulet${cost > 1 ? 's' : ''}.`); } return; }
  switch (t.id) {
    case 'b-import': S.importText = document.getElementById('imp').value; doImport(S.importText); break;
    case 'b-csv': fetch('api/collection').then(r => r.ok ? r.text() : Promise.reject(new Error('collection.csv not found next to server.js'))).then(txt => { S.importText = txt; doImport(txt); }).catch(e => { S.report = { error: e.message }; render(); }); break;
    case 'b-rescan': loadArtIndex().then(render); break;
    case 'b-clear-coll': if (confirm('Remove every card from your collection? Your deck will need rebuilding.')) { S.collection = {}; if (g) g.deck = {}; save(); render(); } break;
    case 'b-fill': fillBasics(g.deck); save(); render(); break;
    case 'b-addall': { const q = S.deckFilter.toLowerCase(); for (const n of Object.keys(S.collection)) { const d = defOf(n); if (!d || d.kind === 'unsupported') continue; if (q && !n.toLowerCase().includes(q)) continue; const want = S.collection[n] - (g.deck[n] || 0); if (want > 0) addCards(g.deck, n, want); } save(); render(); break; }
    case 'b-clear-deck': if (deckSize(g.deck) && confirm('Remove every card from your deck?')) { g.deck = {}; save(); render(); } break;
    case 'b-rest': if (g.player.food >= 3) { g.player.food -= 3; g.player.life = Math.min(g.player.maxLife, g.player.life + 5); g.player.day++; if (g.player.day % 30 === 0) bossLink(); stepEnemies(g.world, Math.random, g.player); save(); render(); } break;
    case 'b-inn': g.player.life = g.player.maxLife; save(); render(); break;
    case 'b-food': if (g.player.gold >= 2) { g.player.gold -= 2; g.player.food += 20; save(); render(); } break;
    case 'b-leave': go('map'); break;
    case 'b-newgame': S.game = null; save(); go('title'); break;
    case 'b-dleave': dungeonExitPrompt(false); break;
    case 'b-practice': startTutorialDuel().catch(e => setBusy('Could not load card data: ' + e.message)); break;
    case 'b-bounty': { const c = cityAt(g.world, g.player.x, g.player.y); if (c) acceptBounty(c); break; }
    case 'b-reset-all': if (confirm('Wipe your current journey AND your entire collection so you can start completely fresh? This cannot be undone.')) { S.game = null; S.collection = {}; S.filter = 'all'; S.report = null; save(); go('title'); toast('Everything wiped. Begin a new journey with an empty collection.'); } break;
    case 'b-worldmagic': {
      if (amuletCount('R') < 1) break;
      const before = g.world.enemies.length;
      g.world.enemies = g.world.enemies.filter(e => Math.abs(e.x - g.player.x) > 3 || Math.abs(e.y - g.player.y) > 3);
      const cleared = before - g.world.enemies.length;
      giveAmulet('R', -1); sfx('cast'); save();
      toast(cleared ? `Thunder scatters ${cleared} monster${cleared > 1 ? 's' : ''}.` : 'Thunder rolls, but no monster stood near.');
      break;
    }
  }
});
document.addEventListener('input', ev => { if (ev.target.id === 'dfilter') { S.deckFilter = ev.target.value; deck(); document.getElementById('dfilter').focus(); const el = document.getElementById('dfilter'); el.setSelectionRange(el.value.length, el.value.length); } });
// ---- power-tier screen: re-ranking, filters, export ----
document.addEventListener('input', ev => { if (ev.target.id === 'tier-q') { S.tierSearch = ev.target.value; tiers(); const el = document.getElementById('tier-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
document.addEventListener('change', ev => {
  const id = ev.target.id;
  if (id === 'tier-type') { S.tierType = ev.target.value; tiers(); }
  else if (id === 'tier-sort') { S.tierSort = ev.target.value; tiers(); }
  else if (id === 'tier-sell') { S.tierSellOnly = ev.target.checked; tiers(); }
  else if (id === 'tier-cur') { S.tierCurOnly = ev.target.checked; tiers(); }
});
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-tier-pick],[data-tier-set],[data-tier-toggle],#tier-copy,#tier-clear');
  if (!el) { if (S.tierPick && S.screen === 'tiers' && !ev.target.closest('.tpick,[data-tier-pick]')) { S.tierPick = null; tiers(); } return; }
  if (el.dataset.tierPick != null) { const n = el.dataset.tierPick; S.tierPick = S.tierPick === n ? null : n; tiers(); return; }
  if (el.dataset.tierSet != null) { if (S.tierPick) { setTier(S.tierPick, el.dataset.tierSet); S.tierPick = null; tiers(); } return; }
  if (el.dataset.tierToggle != null) { const t = el.dataset.tierToggle; S.tierHide[t] = !S.tierHide[t]; tiers(); return; }
  if (el.id === 'tier-copy') { const json = JSON.stringify(S.tierOverrides, null, 2); navigator.clipboard?.writeText(json).then(() => toast('Tier changes copied to clipboard.')).catch(() => toast('Could not copy.')); return; }
  if (el.id === 'tier-clear') { if (confirm('Reset all your tier changes back to the shipped ranking?')) { S.tierOverrides = {}; S.tierPick = null; save(); tiers(); } return; }
});
// Web Audio starts only after a gesture; the first click or key unlocks it and starts the score for the current screen.
document.addEventListener('pointerdown', () => unlock(), { capture: true });
document.addEventListener('keydown', () => unlock(), { capture: true });
document.addEventListener('keydown', ev => {
  if (S.screen === 'dungeon' && !S.modal) {
    const k = ev.key.toLowerCase();
    const d = { w: [0, -1], arrowup: [0, -1], a: [-1, 0], arrowleft: [-1, 0], s: [0, 1], arrowdown: [0, 1], d: [1, 0], arrowright: [1, 0] }[k];
    const cur = currentDungeon();
    if (d && cur) { ev.preventDefault(); dungeonMove(cellOf(cur.layout, cur.layout.px + d[0], cur.layout.py + d[1])); }
    return;
  }
  if (S.screen !== 'map' || S.modal) return;
  const k = ev.key.toLowerCase();
  const d = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] }[k];
  if (d) { ev.preventDefault(); move(d[0], d[1]); }
});

// ---- boot -----------------------------------------------------------------------
// Debug handle for the console and for automated tests: window.ff.S is the app state.
window.ff = { S, defOf, save, render, startDuel, enemyById, startTutorialDuel, riddleDefs, makeRiddle, amuletShopPool, artifactShopPool, cityPool };
initPreview();
load();
render();
ensureContent().then(() => { if (S.game && S.game.status === 'playing') go(S.game.dungeon ? 'dungeon' : 'map'); else render(); prefetchCatalog(); }).catch(e => { setBusy('Could not load card data: ' + e.message + ' (is the internet reachable?)'); });
