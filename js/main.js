// Fivefold app controller: screens, world loop, persistence.
import { parseList, importNames, defOf, forgetDefs, loadArtIndex, artFor, artCount, hasOwnArt, hasServer } from './collection.js';
import { fetchCards, cacheSize, cached as cachedCard, allCached } from './scryfall.js';
import { COLORS, COLOR_NAME, manaHtml, statusLabel } from './cards.js';
import { generateWorld, drawWorld, drawMinimap, tileAt, inBounds, cityAt, linkAt, enemyAt, stepEnemies, BIOME, TILE, VIEW, placeDungeons, dungeonAt, relocateDungeon, placeLandmarks, landmarkAt, placeSpecials, specialAt, placeMotes, moteAt, spawnMote, castleAt, WARDEN_HOLD, roadAt, ensureRoads } from './world.js';
import { Duel } from './engine.js';
import { mountDuel, cardHtml } from './duelview.js';
import { Net } from './net.js';
import { makeMirror, hydrate, guestInput, applyRemoteInput } from './mp.js';
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
  apprentice: { label: 'Apprentice', life: 20, enemyBonus: 0, gold: 30, colors: 1 },
  magician: { label: 'Magician', life: 15, enemyBonus: 0, gold: 20, colors: 2 },
  sorcerer: { label: 'Sorcerer', life: 12, enemyBonus: 4, gold: 12, colors: 3 },
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rnd = a => a[Math.floor(Math.random() * a.length)];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
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
// World magic: one map-wide spell per colour, each costing a single amulet of that colour.
const WORLD_MAGIC = [
  { c: 'W', id: 'wm-heal', name: 'Healing Light', desc: 'restore your life to full' },
  { c: 'U', id: 'wm-blink', name: 'Blink', desc: 'teleport to the nearest city' },
  { c: 'B', id: 'wm-cloak', name: 'Shadow Cloak', desc: 'walk unseen for 8 steps — no pursuit' },
  { c: 'R', id: 'wm-thunder', name: 'Staff of Thunder', desc: 'scatter every monster within 3 tiles' },
  { c: 'G', id: 'wm-sight', name: 'Sylvan Sight', desc: 'reveal every dungeon on the map' },
];
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
// Deck rule: at most four of any one card, but basic lands are unlimited.
const MAX_COPIES = 4;
const copyCap = name => BASIC_NAMES.has(name) ? Infinity : MAX_COPIES;
// How many more of `name` the deck may hold: limited by copies owned and the 4-of rule.
function deckRoom(name, deck = S.game?.deck || {}, collection = S.collection) {
  const owned = BASIC_NAMES.has(name) ? Infinity : (collection[name] || 0);
  return Math.max(0, Math.min(owned, copyCap(name)) - (deck[name] || 0));
}
// ---- town treasuries: each city keeps a fluctuating gold reserve. Buying refills it, selling drains it.
const TOWN_GOLD_CAP = 300, TOWN_GOLD_START = 150;
function townGold(color) { const g = S.game; g.cityGold ||= {}; if (g.cityGold[color] == null) g.cityGold[color] = TOWN_GOLD_START; return g.cityGold[color]; }
function addTownGold(color, delta) { const g = S.game; g.cityGold ||= {}; g.cityGold[color] = Math.max(0, Math.min(TOWN_GOLD_CAP, townGold(color) + delta)); }

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
  for (const n of POWER_NINE) names.add(n);   // pre-cache the ultra-rares so a dungeon vault can grant them
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
function deckProblems(deckObj, collection = S.collection) {
  const p = [];
  const size = deckSize(deckObj);
  if (size < 40) p.push(`Deck has ${size} cards; it needs at least 40.`);
  for (const [name, n] of Object.entries(deckObj)) {
    const d = defOf(name);
    if (!d) { p.push(`${name}: card data not loaded.`); continue; }
    if (d.kind === 'unsupported') p.push(`${name}: not supported by the demo engine.`);
    if (!BASIC_NAMES.has(name) && (collection[name] || 0) < n) p.push(`${name}: you own ${collection[name] || 0}, deck uses ${n}.`);
    if (!BASIC_NAMES.has(name) && n > MAX_COPIES) p.push(`${name}: ${n} copies; at most ${MAX_COPIES} of a card are allowed.`);
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
// Starting-deck card pools, one per colour, in the spirit of MicroProse Shandalar's starters: cheap
// creatures many, a couple of fatties, a little removal. Every card here is drawn from the roaming
// mages' own decks, so it is always supported and pre-cached. Weights are copies in a 28-card bag; a
// mono starter draws 23 of them, so each new game's list is slightly different — as Shandalar's were.
const START_POOLS = {
  W: [['Savannah Lions', 4], ['Tundra Wolves', 3], ['White Knight', 3], ['Pearled Unicorn', 3], ['Mesa Pegasus', 3], ['Wild Griffin', 3], ['Angelic Page', 3], ['Longbow Archer', 2], ['Swords to Plowshares', 3], ['Serra Angel', 1]],
  U: [['Merfolk of the Pearl Trident', 4], ['Coral Merfolk', 3], ['Sage Owl', 3], ['Wind Drake', 3], ['Horned Turtle', 3], ['Giant Octopus', 2], ['Phantom Monster', 2], ['Air Elemental', 1], ['Unsummon', 4], ['Divination', 3]],
  B: [['Scathe Zombies', 4], ['Bog Imp', 3], ['Drudge Skeletons', 3], ['Vampire Bats', 3], ['Black Knight', 3], ['Bog Wraith', 2], ['Gravedigger', 2], ['Hypnotic Specter', 1], ['Sengir Vampire', 1], ['Terror', 3], ['Raise Dead', 3]],
  R: [["Mons's Goblin Raiders", 4], ['Raging Goblin', 3], ['Gray Ogre', 3], ['Hurloon Minotaur', 3], ['Hill Giant', 3], ['Balduvian Barbarians', 2], ['Earth Elemental', 1], ['Shock', 3], ['Lightning Bolt', 2], ['Volcanic Hammer', 2], ['Incinerate', 2]],
  G: [['Llanowar Elves', 4], ['Grizzly Bears', 4], ['Scryb Sprites', 3], ['Elvish Archers', 3], ['Giant Spider', 3], ['Trained Armodon', 3], ['War Mammoth', 2], ['Ironroot Treefolk', 2], ['Craw Wurm', 1], ['Giant Growth', 3]],
};
// How the 23 nonland spells and 17 lands split across the deck's colours (primary always dominant),
// keyed by number of colours: 1 (Apprentice), 2 (Magician), 3 (Sorcerer).
const SPELL_SPLIT = { 1: [23], 2: [15, 8], 3: [13, 6, 4] };
const LAND_SPLIT = { 1: [17], 2: [11, 6], 3: [9, 5, 3] };
function shuffleInPlace(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// Draw n nonland cards from a colour's pool, weighted by the bag and randomised each time.
function pickColorCards(color, n, rng) {
  const bag = [];
  for (const [name, w] of START_POOLS[color]) for (let i = 0; i < w; i++) bag.push(name);
  shuffleInPlace(bag, rng);
  const out = {};
  for (let i = 0; i < n && i < bag.length; i++) out[bag[i]] = (out[bag[i]] || 0) + 1;
  return out;
}
// Build a fresh 40-card starting deck for a colour and difficulty (1/2/3 colours). The chosen colour
// leads; any extra colours are picked at random, so decks vary from game to game like Shandalar's.
function buildStartDeck(primary, colorCount, rng = Math.random) {
  const secondaries = shuffleInPlace(COLORS.filter(c => c !== primary), rng).slice(0, colorCount - 1);
  const colors = [primary, ...secondaries];
  const spells = SPELL_SPLIT[colorCount], lands = LAND_SPLIT[colorCount];
  const deck = {};
  colors.forEach((col, i) => {
    for (const [name, c] of Object.entries(pickColorCards(col, spells[i], rng))) deck[name] = (deck[name] || 0) + c;
    deck[BASICS[col]] = (deck[BASICS[col]] || 0) + lands[i];
  });
  return deck;
}
async function newGame({ name, color, difficulty }) {
  await ensureContent();
  const d = DIFF[difficulty];
  const deck = buildStartDeck(color, d.colors, Math.random);
  for (const [n, c] of Object.entries(deck)) if (!BASIC_NAMES.has(n)) addCards(S.collection, n, c);
  const world = generateWorld(Math.random, S.content.enemies, color);
  placeDungeons(world, Math.random, S.dungeons.dungeons);
  placeLandmarks(world, Math.random);
  placeSpecials(world, Math.random);
  placeMotes(world, Math.random);
  S.game = {
    name: name || 'Wanderer', color, difficulty, deck, world,
    player: { x: world.start.x, y: world.start.y, life: d.life, maxLife: d.life, gold: d.gold, food: 60, day: 1, steps: 0, amulets: newAmulets() },
    boss: { links: 0 }, status: 'playing', wins: 0, losses: 0, cityStock: {}, quests: [], created: Date.now(),
    usurper: rnd(COLORS),   // which Warden the Usurper hides behind, revealed only when that castle falls
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
  const cst = castleAt(g.world, nx, ny);
  if (cst) { castlePrompt(cst); return; }
  const dg = dungeonAt(g.world, nx, ny);
  if (dg && dg.revealed) { g.player.x = nx; g.player.y = ny; save(); dungeonPrompt(dg); return; }
  g.player.x = nx; g.player.y = ny; g.player.steps++; sfx('step');
  if (g.player.cloak > 0) g.player.cloak--;
  if (g.player.food > 0) g.player.food--;
  else if (g.player.steps % 2 === 0 && g.player.life > 1) { g.player.life--; toast('You are starving: 1 life lost. Buy food in any city.'); }
  if (g.player.steps % 5 === 0) { g.player.day++; advanceSieges(g); if (g.status !== 'playing') return; if (g.player.day % 30 === 0) bossLink(); if (g.status !== 'playing') return; }
  const link = linkAt(g.world, nx, ny);
  if (link && !link.taken) { link.taken = true; g.player.maxLife += 2; g.player.life += 2; toast(`Mana link claimed. Maximum life is now ${g.player.maxLife}.`); }
  const mote = moteAt(g.world, nx, ny);
  if (mote) {
    g.world.motes = g.world.motes.filter(m => m !== mote);
    if (mote.ambush) { save(); ambushFromMote(mote); return; }   // some sparks are lures — a foe springs out
    collectMote(mote);
  }
  const onRoad = roadAt(g.world, nx, ny);                       // roads let you outpace pursuit, as in the old overland
  const caught = stepEnemies(g.world, Math.random, g.player, onRoad);   // roaming foes give chase and may catch you
  if (Math.random() < 0.1) spawnMote(g.world, Math.random, g.player);   // the world keeps seeding fresh motes
  save();
  if (caught) { encounter(caught); return; }
  const city = cityAt(g.world, nx, ny);
  if (city) { if (city.siege || city.captured) { const was = city.captured; city.siege = 0; city.captured = false; save(); toast(was ? `You break the siege and reclaim ${city.name}.` : `Your arrival scatters the besiegers of ${city.name}.`); } enterCity(); return; }
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
  if (g.boss.links >= BOSS_LINKS) { g.status = 'lost'; g.lostBy = 'seal'; save(); go('end'); return; }
  toast(`The Usurper has bound ${g.boss.links} of ${BOSS_LINKS} mana links. Hurry.`);
}
// How many cities the Wardens may besiege at once. Just one for the opening fortnight so the early
// overland isn't swarmed; the war then widens as days pass, but never beyond the Wardens still standing.
function maxSieges(day) {
  if (day < 20) return 1;
  if (day < 45) return 2;
  if (day < 75) return 3;
  return 4;
}
// The surviving Wardens march on your cities. A besieged city, unrelieved, is captured; lose four
// and the realm collapses. Visiting a city drives the besiegers off and reclaims it.
function advanceSieges(g) {
  const w = g.world;
  const aliveWardens = COLORS.filter(col => !(w.castles || []).find(c => c.color === col)?.fallen).length;
  if (!aliveWardens || Math.random() > 0.26) return;   // a Warden makes a move every few days
  const besieged = w.cities.filter(c => c.siege > 0 && !c.captured);
  const open = w.cities.filter(c => !c.siege && !c.captured);
  const cap = Math.min(maxSieges(g.player.day), aliveWardens);   // clearing guilds also eases the pressure
  // At the cap the Wardens can only press the sieges already under way; below it they may open a new front.
  let target;
  if (besieged.length >= cap) target = besieged.length ? rnd(besieged) : null;
  else if (!besieged.length) target = open.length ? rnd(open) : null;
  else target = (Math.random() < 0.55 && open.length) ? rnd(open) : rnd(besieged);
  if (!target) return;
  target.siege = (target.siege || 0) + 1;
  if (target.siege >= 3) { target.siege = 3; target.captured = true; toast(`${target.name} falls to a Warden's siege! Reclaim it before the realm collapses.`); sfx('lose'); }
  else toast(`A Warden's host besieges ${target.name} (${target.siege}/3). Relieve it before it falls.`);
  if (w.cities.filter(c => c.captured).length >= 4) { g.status = 'lost'; g.lostBy = 'siege'; save(); go('end'); }
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
// ---- roaming mage levels ------------------------------------------------------------
// A roaming mage's power scales with its level (1..5). Higher levels field a stronger base deck salted
// with more of their colour's best cards, carry more life, and pay out more gold. Built on encounter so
// the injected bombs reflect the current card pool.
const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4, E: 5 };
const WARDEN_BOMBS = { W: 'Serra Angel', U: 'Air Elemental', B: 'Sengir Vampire', R: 'Lightning Bolt', G: 'Craw Wurm' };
function colorBombs(color, n) {
  if (n <= 0) return [];
  const rank = name => TIER_RANK[tierOf(name)] ?? 3.5;
  const pool = (S.catalog?.[color] || []).filter(name => { const d = defOf(name); return d && d.kind !== 'unsupported' && d.kind !== 'land' && shopOk(name); });
  pool.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const out = pool.slice(0, n);
  while (out.length < n && WARDEN_BOMBS[color]) out.push(WARDEN_BOMBS[color]);   // guaranteed fallback bomb
  return out;
}
function trimWeakest(deck, k) {
  const rank = name => TIER_RANK[tierOf(name)] ?? 3.5;
  const nonland = Object.keys(deck).filter(n => { const d = defOf(n); return d && d.kind !== 'land'; }).sort((a, b) => rank(b) - rank(a));
  for (const name of nonland) { if (k <= 0) break; const take = Math.min(k, deck[name]); deck[name] -= take; if (deck[name] <= 0) delete deck[name]; k -= take; }
}
function leveledEnemy(color, level) {
  level = Math.max(1, Math.min(5, level | 0));
  const baseTier = level >= 3 ? 2 : 1;
  const base = S.content.enemies.find(e => e.color === color && e.tier === baseTier) || S.content.enemies.find(e => e.color === color && !e.boss) || S.content.enemies.find(e => e.color === color);
  const deck = { ...base.deck };
  const bombs = colorBombs(color, level - 1);        // 0..4 of the colour's best cards mixed in
  if (bombs.length) { trimWeakest(deck, bombs.length); for (const b of bombs) deck[b] = (deck[b] || 0) + 1; }
  return { id: `${color}-L${level}`, name: base.name, color, level, tier: baseTier, life: 8 + level * 3, gold: 5 + level * 5, bribe: 4 + level * 2, taunt: base.taunt, deck };
}
const roamLevel = e => e.level || e.tier || 1;
const roamTemplate = e => leveledEnemy(e.color || enemyById(e.template)?.color || 'B', roamLevel(e));
function encounter(enemy) {
  const tpl = roamTemplate(enemy); const g = S.game;
  S.modal = {
    title: `${tpl.name} — level ${tpl.level} ${COLOR_NAME[tpl.color]} mage`,
    body: `<p class="taunt">“${esc(tpl.taunt)}”</p><p>Life ${tpl.life + DIFF[g.difficulty].enemyBonus}. Win: ${tpl.gold} gold and their ante card${tpl.level >= 3 ? ' — higher mages carry stronger cards' : ''}. Lose: your ante card.</p>`,
    buttons: [
      { label: 'Duel', primary: true, action: () => { S.modal = null; startDuel(tpl, enemy.uid); } },
      { label: `Bribe (${tpl.bribe} gold)`, disabled: g.player.gold < tpl.bribe, action: () => { g.player.gold -= tpl.bribe; g.world.enemies = g.world.enemies.filter(e => e.uid !== enemy.uid); if (g.quests) g.quests = g.quests.filter(q => q.enemyUid !== enemy.uid); S.modal = null; save(); render(); } },
      { label: 'Back away', action: () => { S.modal = null; render(); } },
    ],
  };
  render();
}
// A collected mote pays out one of several ways — mostly gold, sometimes an amulet or provisions,
// and now and then a rich vein worth both. Keeps foraging the overland varied rather than rote.
function collectMote(mote) {
  const g = S.game; const r = Math.random();
  if (r < 0.10) { const gold = 30 + Math.floor(Math.random() * 26); g.player.gold += gold; giveAmulet(mote.color); toast(`A rich mana vein: ${gold} gold and a ${COLOR_NAME[mote.color]} amulet.`); }
  else if (r < 0.34) { giveAmulet(mote.color); toast(`A mana mote yields a ${COLOR_NAME[mote.color]} amulet.`); }
  else if (r < 0.56) { const food = 4 + Math.floor(Math.random() * 5); g.player.food += food; toast(`A cache of provisions: ${food} food.`); }
  else { const gold = 8 + Math.floor(Math.random() * 14); g.player.gold += gold; toast(`A mana mote scatters into ${gold} gold.`); }
  sfx('coin');
}
// An ambush mote: a lurking foe of that region springs out. Tougher the farther from home you strayed.
function ambushFromMote(mote) {
  const g = S.game;
  const dx = mote.x - g.world.start.x, dy = mote.y - g.world.start.y;
  const far = Math.hypot(dx, dy), span = Math.max(g.world.w, g.world.h);
  const level = Math.max(1, Math.min(5, 1 + Math.floor((far / (span * 0.7)) * 5)));   // as tough as its region
  if (!S.content.enemies.some(e => e.color === mote.color && !e.boss)) { collectMote(mote); return; }
  toast('The spark was a lure — an ambush!'); sfx('lose');
  encounter({ color: mote.color, level, uid: null });
}
const WARDEN_NAME = { W: 'the Warden of Light', U: 'the Warden of Tides', B: 'the Warden of the Grave', R: 'the Warden of Cinders', G: 'the Warden of the Wilds' };
// A Warden fights their guild's honed mono-colour deck at boss stature. One is the Usurper in disguise.
function wardenOf(color) {
  const base = S.content.enemies.find(e => e.color === color && e.tier === 2) || S.content.enemies.find(e => e.color === color);
  const deck = { ...base.deck };
  const bombs = { W: 'Serra Angel', U: 'Air Elemental', B: 'Sengir Vampire', R: 'Lightning Bolt', G: 'Craw Wurm' };
  if (bombs[color]) deck[bombs[color]] = (deck[bombs[color]] || 0) + 2;
  return { id: color + '-warden', name: WARDEN_NAME[color], color, tier: 4, life: 20, bribe: 0, gold: 80, boss: true, warden: color, taunt: base.taunt, deck };
}
function castlePrompt(castle) {
  const g = S.game;
  if (castle.fallen) { S.modal = { title: castle.name, body: `<p>The gates hang broken and cold. ${WARDEN_NAME[castle.color]} is dead; nothing stirs within.</p>`, buttons: [{ label: 'Leave', primary: true, action: () => { S.modal = null; render(); } }] }; render(); return; }
  const w = wardenOf(castle.color);
  const standing = (g.world.castles || []).filter(c => !c.fallen).length;
  S.modal = {
    title: castle.name,
    body: `<p class="taunt">“${esc(w.taunt)}”</p><p>${cap(WARDEN_NAME[castle.color])} holds this ${COLOR_NAME[castle.color]} stronghold with ${w.life + g.boss.links * 5} life and a honed deck. One of the five Wardens is the Usurper wearing a stolen face — ${standing === 1 ? 'and this is the last one standing.' : 'is it this one?'} Storm the gate to find out.</p>`,
    buttons: [{ label: 'Storm the castle', primary: true, action: () => { S.modal = null; startDuel(w, null); } }, { label: 'Not yet', action: () => { S.modal = null; render(); } }],
  };
  render();
}
// Old saves predate the five castles: place one Warden hold in each colour region.
function migrateCastles(g) {
  const w = g.world;
  const occ = new Set([...w.cities.map(c => `${c.x},${c.y}`), ...w.links.map(l => `${l.x},${l.y}`), ...(w.dungeons || []).map(d => `${d.x},${d.y}`), ...(w.landmarks || []).map(l => `${l.x},${l.y}`), ...(w.specials || []).map(s => `${s.x},${s.y}`), ...w.enemies.map(e => `${e.x},${e.y}`)]);
  const far = (x, y) => Math.abs(x - w.start.x) + Math.abs(y - w.start.y);
  w.castles = [];
  for (const cc of COLORS) {
    let p = null;
    for (let i = 0; i < 800 && !p; i++) { const x = Math.floor(Math.random() * w.w), y = Math.floor(Math.random() * w.h); if (occ.has(`${x},${y}`) || tileAt(w, x, y) !== cc || far(x, y) < 6 || w.cities.some(c => Math.abs(c.x - x) + Math.abs(c.y - y) < 3)) continue; p = { x, y }; }
    for (let i = 0; i < 800 && !p; i++) { const x = Math.floor(Math.random() * w.w), y = Math.floor(Math.random() * w.h); if (occ.has(`${x},${y}`) || w.cities.some(c => Math.abs(c.x - x) + Math.abs(c.y - y) < 2)) continue; p = { x, y }; }
    if (p) { w.castles.push({ x: p.x, y: p.y, color: cc, name: WARDEN_HOLD[cc] }); occ.add(`${p.x},${p.y}`); }
  }
  delete w.castle;
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
    body: `<p class="taunt">${esc(t.intro)}</p><p><b>${esc(rule.label)}:</b> ${esc(rule.text)} Your life carries from fight to fight. Monsters block the corridors until beaten; piles hold life, gold and cards; scrolls hold riddles. The guardian before the exit keeps the vault.</p><p class="small">A lair of ${esc(dungeonArchetype(t))}.${knownPrizes(dg, t).length ? ` Prizes glimpsed by your clues: ${knownPrizes(dg, t).map(esc).join(', ')}${(dg.intel || 0) < FIND_CLUES ? ' …' : ''}.` : ''}</p><p>You have ${g.player.life} life.${dg.cleared ? ' The guardian is already dead; only leftovers remain.' : resume ? ' You have been here before, and the maze remembers.' : ''}</p>`,
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
  // Leaving a dungeon you have not fully cleared makes it sink and resurface elsewhere: its exact
  // spot is lost (re-find it with fresh clues) but what you cleared and learned is kept.
  const willMove = !dg.cleared;
  const leave = () => {
    S.modal = null; g.dungeon = null;
    if (willMove) { relocateDungeon(g.world, Math.random, dg); toast(`As you climb out, the ${tpl.name} sinks into the earth and surfaces somewhere new. Fresh clues will find it again — what you cleared and learned is kept.`); }
    save(); go('map');
  };
  S.modal = {
    title: atEntrance ? 'Back to the surface?' : 'The way out',
    body: `<p>${left ? `${left} monster${left > 1 ? 's' : ''} still lurk${left > 1 ? '' : 's'} in the ${tpl.name}.` : 'The halls are quiet.'} You keep whatever you found and your ${g.player.life} life.</p>${willMove ? `<p class="small warn">The vault is not yet claimed — leave now and the ${tpl.name} will vanish and move. Your cleared rooms and intel survive, but you must locate it anew.</p>` : '<p class="small">Its vault is emptied; it will stay where it is.</p>'}`,
    buttons: [{ label: 'Leave', primary: true, action: leave }, { label: 'Stay', action: () => { S.modal = null; render(); } }],
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
  // The rarest relics in the world are hidden nowhere else: a slim chance the vault holds one.
  if (!dg.cleared && Math.random() < 0.16) { const p9 = rnd([...POWER_NINE].filter(n => defOf(n))); if (p9) { addCards(S.collection, p9, 1); lines.push(`Something older gleams beneath the coins — <b>${p9}</b>. No shop has ever sold its like.`); sfx('open'); } }
  dg.cleared = true;
  S.result = { won: true, tpl: { name: tpl.name }, lines, title: 'The vault is yours', flavour: `The Guardian of the ${tpl.name} is dead. The exit is open.`, back: 'dungeon' };
  save(); go('result');
}
// ---- dungeon clues & intel --------------------------------------------------------
const FIND_CLUES = 3;   // location clues needed to pinpoint a dungeon's exact tile
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
// A one-line read on the foes waiting inside, derived from the colour's enemy decks.
function dungeonArchetype(t) {
  const col = COLOR_NAME[t.color].toLowerCase();
  const creatures = S.content.enemies.filter(e => e.color === t.color && !e.boss).flatMap(e => Object.keys(e.deck)).map(defOf).filter(d => d && d.power != null);
  const avg = creatures.length ? creatures.reduce((s, d) => s + (d.cmc || 0), 0) / creatures.length : 3;
  const size = avg < 2.6 ? 'small' : avg < 4 ? 'seasoned' : 'towering';
  return `${size} ${col} creatures`;
}
// How many prize cards the gathered intel has named so far.
function knownPrizes(dg, t) { return t.treasure.slice(0, dg.intel >= FIND_CLUES ? t.treasure.length : dg.intel * 2); }
// Which not-yet-cleared dungeon a fresh clue should advance: prefer one of the foe's colour that still
// needs locating, then the least-located, then anything incomplete.
function clueTarget(color) {
  const dgs = (S.game.world.dungeons || []).filter(d => !d.cleared);
  if (!dgs.length) return null;
  const unlocated = dgs.filter(d => !d.revealed);
  return unlocated.find(d => d.color === color) || unlocated.sort((a, b) => (b.locClues || 0) - (a.locClues || 0))[0] || dgs.find(d => d.color === color) || dgs.sort((a, b) => (a.intel || 0) - (b.intel || 0))[0];
}
// Advance a dungeon's intel and location by one clue; returns a plain-text report of what it told you.
function addClue(color) {
  const g = S.game; const dg = clueTarget(color); if (!dg) return null;
  const t = dungeonTemplate(dg.id), w = g.world;
  const first = (dg.intel || 0) === 0 && (dg.locClues || 0) === 0;
  dg.intel = Math.min(FIND_CLUES, (dg.intel || 0) + 1);
  let loc;
  if (dg.revealed) loc = `Its mouth is already marked — ${compassTo(g, dg)}.`;
  else {
    dg.locClues = (dg.locClues || 0) + 1; dg.sensed = true;
    if (dg.locClues >= FIND_CLUES) { dg.revealed = true; dg.hint = null; loc = `Its exact mouth is now marked on your map — ${compassTo(g, dg)}.`; }
    else {
      const r = (FIND_CLUES - dg.locClues) * 3;   // 6 tiles, then 3
      const jit = Math.max(0, r - 2);
      dg.hint = { x: Math.max(0, Math.min(w.w - 1, dg.x + randInt(-jit, jit))), y: Math.max(0, Math.min(w.h - 1, dg.y + randInt(-jit, jit))), r };
      loc = `${first ? 'A dungeon surfaces' : 'It draws closer'}: sensed ${compassTo(g, dg.hint)}, somewhere within ${r} tiles.`;
    }
  }
  const prizes = knownPrizes(dg, t);
  const rule = S.dungeons.rules[t.rule];
  const intelLine = `It is a lair of ${dungeonArchetype(t)}. ${rule.label}: ${rule.text}`;
  const prizeLine = prizes.length ? ` Rumoured to hoard: ${prizes.join(', ')}${dg.intel < FIND_CLUES ? ', and more' : ''}.` : '';
  return `Clue to the ${t.name} (intel ${dg.intel}/${FIND_CLUES}). ${loc} ${intelLine}${prizeLine}`;
}
// The outcome of an ordinary roaming-mage duel, shown as a compact popup over the map rather than a
// full-screen result page (that heavier page is kept for dungeons and the endgame).
function roamResult(tpl, won, lines) {
  S.screen = 'map';   // the duel view is gone; the modal overlays the map
  S.modal = {
    title: won ? 'The mage yields' : 'You are bested',
    body: `<p class="taunt">${won ? `${esc(tpl.name)} falls before you.` : `${esc(tpl.name)} stands over you.`}</p>${lines.length ? `<ul class="plain">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}`,
    buttons: [{ label: won ? 'Onward' : 'Pick yourself up', primary: true, action: () => { S.modal = null; go('map'); } }],
  };
  save(); render();
}
// Offer a beaten roamer's spoils as a choice: their card, or a dungeon clue. Finalises to a popup outcome.
function roamSpoils(tpl, ante, lines) {
  const finish = extra => roamResult(tpl, true, [...lines, extra]);
  S.screen = 'map';   // the duel view is gone; overlay the choice on a real screen so render() has something to draw
  S.modal = {
    title: 'Spoils of victory',
    body: `<p class="taunt">“Spare me — I can give you the card from my deck, or tell you what I know of the dark places.”</p>
      <p>Take <b>${esc(ante.theirs)}</b> for your collection, or wring out a <b>dungeon clue</b>. Clues surface a hidden dungeon, and — gathered — pinpoint it and lay bare its foes, its rules and its prizes.</p>`,
    buttons: [
      { label: `Take ${ante.theirs}`, primary: true, action: () => { addCards(S.collection, ante.theirs, 1); finish(`You take ${ante.theirs} as ante.`); } },
      { label: 'Wring out a clue', action: () => { const c = addClue(tpl.color); finish(c || 'They knew nothing of any dungeon — you take their card instead.' + (ante.theirs ? (addCards(S.collection, ante.theirs, 1), ` (${ante.theirs})`) : '')); } },
    ],
  };
  render();
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
  // A Chaos Orb you flipped is torn up for good — remove each one you used from your collection and deck.
  const chaosUsed = duel.chaosFlips ? (duel.chaosFlips[0] || 0) : 0;
  if (chaosUsed > 0) {
    let removed = 0;
    for (let k = 0; k < chaosUsed && (S.collection['Chaos Orb'] || 0) > 0; k++) {
      addCards(S.collection, 'Chaos Orb', -1); removed++;
      if (g.deck['Chaos Orb']) addCards(g.deck, 'Chaos Orb', -1);
    }
    if (removed > 0) {
      if (deckSize(g.deck) < 40) fillBasics(g.deck);
      toast(removed > 1 ? `${removed} Chaos Orbs are torn beyond repair — gone from your collection.` : 'Your Chaos Orb is torn beyond repair — gone from your collection.');
    }
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
    g.player.life = Math.max(duel.players[0].life, Math.ceil(g.player.maxLife / 2));
    if (roamUid != null) g.world.enemies = g.world.enemies.filter(e => e.uid !== roamUid);
    // Tougher mages drop amulets more often, and a high-level foe may also cough up a spare card from
    // its deck — so seeking out level 2-3+ mages pays off. A matching bounty pays an amulet too.
    const lvl = tpl.level || (tpl.tier >= 2 ? 2 : 1);
    const dropChance = tpl.boss ? 1 : Math.min(0.85, 0.06 + lvl * 0.12);
    if (Math.random() < dropChance) { const col = tpl.boss ? rnd(COLORS) : tpl.color; giveAmulet(col); lines.push(`You pry a ${COLOR_NAME[col]} amulet from your fallen foe.`); }
    if (!tpl.boss && lvl >= 2 && Math.random() < (lvl - 1) * 0.18) {
      const loot = Object.keys(tpl.deck).filter(n => !BASIC_NAMES.has(n) && defOf(n) && shopOk(n));
      if (loot.length) { const c = rnd(loot); addCards(S.collection, c, 1); lines.push(`You loot a spare ${c} from their satchel.`); }
    }
    if (roamUid != null && g.quests?.length) { const q = g.quests.find(q => q.enemyUid === roamUid); if (q) { giveAmulet(q.color); g.quests = g.quests.filter(x => x !== q); lines.push(`Bounty claimed: ${q.city} rewards you a ${COLOR_NAME[q.color]} amulet.`); } }
    if (tpl.warden) {
      const castle = (g.world.castles || []).find(c => c.color === tpl.warden); if (castle) castle.fallen = true;
      if (ante.theirs) { addCards(S.collection, ante.theirs, 1); lines.push(`You take ${ante.theirs} as ante.`); }
      if (tpl.warden === g.usurper) { lines.push('You tear the Warden’s mask away — and the Usurper’s own face stares back. The masquerade ends here.'); g.status = 'won'; save(); go('end'); return; }
      lines.push(`${cap(WARDEN_NAME[tpl.warden])} falls — but the face beneath is a true Warden, not the impostor. The guild is broken; its sieges end. A ${COLOR_NAME[tpl.warden]} amulet is your spoil.`);
      giveAmulet(tpl.warden);
    } else if (tpl.boss) { if (ante.theirs) { addCards(S.collection, ante.theirs, 1); lines.push(`You take ${ante.theirs} as ante.`); } g.status = 'won'; save(); go('end'); return; }
    // An ordinary roamer: choose their ante card, or wring out a dungeon clue.
    else if (roamUid != null && ante.theirs && (g.world.dungeons || []).some(d => !d.cleared)) { save(); return roamSpoils(tpl, ante, lines); }
    else if (ante.theirs) { addCards(S.collection, ante.theirs, 1); lines.push(`You take ${ante.theirs} as ante.`); }
  } else {
    g.losses++;
    if (ante.mine) { addCards(S.collection, ante.mine, -1); addCards(g.deck, ante.mine, -1); lines.push(`You lose ${ante.mine} as ante.`); if (deckSize(g.deck) < 40) { fillBasics(g.deck); lines.push('A basic land fills the gap so your deck stays at 40 cards.'); } }
    const lost = Math.floor(g.player.gold * 0.25); g.player.gold -= lost; if (lost) lines.push(`${lost} gold is taken from you.`);
    g.player.life = g.player.maxLife; lines.push('You wake up some time later, restored but poorer.');
    if (tpl.boss) { bossLink(); if (g.status !== 'playing') return; }
  }
  roamResult(tpl, winner === 0, lines);
}

// ---- city ---------------------------------------------------------------------
// A card the engine gives no real function to is a shop trap: unsupported cards, and cards whose
// only text the engine ignores — ante cards like Bronze Tablet, or artifacts whose sole ability
// can't be run (Jester's Mask, Runed Arch, Sword of the Ages). Creatures always have a usable body
// and lands make mana, so those are never blank. Such cards stay in a collection but aren't sold.
const DRAWBACK_STATICS = new Set(['entersTapped']);
function engineFunctional(d) {
  if (!d || d.kind === 'unsupported') return false;
  if (d.kind === 'creature' || d.kind === 'land') return true;
  const sp = d.spell;
  if (sp && ((sp.effects && sp.effects.length) || (sp.modes && sp.modes.some(mo => mo.effects && mo.effects.length)))) return true;
  if (d.manaAbilities && d.manaAbilities.length) return true;
  if (d.keywords && d.keywords.length) return true;
  if (d.abilities && d.abilities.some(a => a.type !== 'static' || !DRAWBACK_STATICS.has(a.kind))) return true;
  return false;
}
// The ultra-rares are never for sale — they can only be pried from a dungeon vault.
const POWER_NINE = new Set(['Black Lotus', 'Mox Pearl', 'Mox Sapphire', 'Mox Jet', 'Mox Ruby', 'Mox Emerald', 'Ancestral Recall', 'Time Walk', 'Timetwister']);
const shopOk = n => !POWER_NINE.has(n) && engineFunctional(defOf(n));
function cityPool(color) {
  const names = new Set();
  for (const e of S.content.enemies) if (e.color === color) for (const n of Object.keys(e.deck)) { const d = defOf(n); if (engineFunctional(d) && d.kind !== 'land') names.add(n); }
  return [...names];
}
function cityStock(city) {
  const g = S.game; const key = city.color;
  const st = g.cityStock[key];
  if (st && g.player.day - st.day < 6) return st.items;
  const pool = cityPool(city.color); const items = [];
  for (let i = 0; i < 4 && pool.length; i++) { const n = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; items.push({ name: n, price: 3 + defOf(n).cmc * 2, sold: false }); }
  // Occasional artifacts and special lands. Engine-ignored / do-nothing cards never appear.
  const ok = n => shopOk(n);
  if (Math.random() < 0.6) { const a = rnd(S.shop.artifacts.filter(ok)); if (a) items.push({ name: a, price: 6 + defOf(a).cmc * 4 + (S.shop.rareArtifacts.includes(a) ? 12 : 0), sold: false, special: 'artifact' }); }
  if (Math.random() < 0.55) {
    const list = [...(S.shop.lands[city.color] || []), ...S.shop.lands.any].filter(ok);
    const l = rnd(list);
    if (l) { const d = defOf(l); const dual = d.subtypes.length >= 2; const price = dual ? 30 : d.produces.length >= 2 ? 18 : 14; items.push({ name: l, price, sold: false, special: 'land' }); }
  }
  addTownGold(city.color, 30);   // trade trickles back into the coffers as the days pass
  g.cityStock[key] = { day: g.player.day, items }; save();
  return items;
}
// What a town pays you for a card. Priced by power tier so a bomb sells for real money and chaff for
// scraps; basics are worthless. The town only pays out of its own reserve.
const SELL_TIER_GOLD = { S: 60, A: 34, B: 18, C: 10, D: 5, E: 2 };
function sellPrice(name) {
  if (BASIC_NAMES.has(name)) return 1;
  const d = defOf(name); if (!d) return 1;
  const t = tierOf(name);
  const base = (t && SELL_TIER_GOLD[t] != null) ? SELL_TIER_GOLD[t] : Math.max(3, 4 + (d.cmc || 0) * 2);
  return Math.max(1, Math.floor(base * 0.6));
}
// Copies of `name` you could sell without touching your deck (owned beyond what the deck uses).
function sellableCopies(name) { const g = S.game; return Math.max(0, (S.collection[name] || 0) - (g.deck[name] || 0)); }
function sellCard(name) {
  const g = S.game; const c = cityAt(g.world, g.player.x, g.player.y); if (!c) return;
  if (sellableCopies(name) <= 0) { toast('Every copy of that is in your deck — remove one first.'); return; }
  const price = sellPrice(name);
  if (townGold(c.color) < price) { toast(`${esc(c.name)}'s coffers can't cover that right now.`); return; }
  addCards(S.collection, name, -1); addTownGold(c.color, -price); g.player.gold += price;
  sfx('coin'); save(); render();
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
  // Price by power tier, not rarity: a bomb should cost a bomb's worth and a do-nothing rare should be
  // cheap (Dingus Egg shouldn't cost what a Mox does). The tier screen uses this same S..E price ladder.
  const priceByTier = (S.tiers && S.tiers.price) || { S: 8, A: 6, B: 4, C: 3, D: 2, E: 1 };
  const t = tierOf(name);
  if (t && priceByTier[t] != null) return priceByTier[t];
  // Unranked card (outside the tiered sets): a mild mana-value estimate around the middle of the ladder.
  const d = defOf(name); if (!d) return 3;
  return Math.max(1, Math.min(6, 2 + Math.floor((d.cmc || 0) / 3)));
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
function amuletShopPool(color) {
  return shopNames(color).filter(n => shopOk(n) && defOf(n).kind !== 'land').sort((a, b) => (defOf(a).cmc - defOf(b).cmc) || a.localeCompare(b));
}
// A shop shows a random 15 that stays put until the player wins or loses a battle (wins+losses is the nonce).
function amuletStockNames(city) {
  const g = S.game; const color = city.color; const bc = g.wins + g.losses;
  g.amuletStock ||= {};
  const st = g.amuletStock[color];
  if (st && st.bc === bc && st.names && st.names.length) return st.names.filter(shopOk);
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
  return artifactNames().filter(shopOk).sort((a, b) => (defOf(a).cmc - defOf(b).cmc) || a.localeCompare(b));
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
  app.classList.toggle('full', S.screen === 'duel' || S.screen === 'mpduel');
  renderTop();
  const views = { title, collection, deck, map, city, duel, result, end, dungeon, tutorial, tiers, mplobby, mpdeck, mpduel };
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
      <div class="btnrow"><button class="btn primary" data-go="tutorial">Learn to play</button><button class="btn" id="b-practice">Practice duel</button><button class="btn" id="b-multiplayer">Multiplayer (1v1)</button></div>
    </div>
    <div class="cols">
      <form id="newgame" class="box">
        <h2>New journey</h2>
        <label>Your name <input name="name" value="${esc(g?.name || '')}" placeholder="Wanderer"></label>
        <fieldset><legend>Starting color</legend>${COLORS.map(c => `<label class="radio"><input type="radio" name="color" value="${c}" ${c === 'G' ? 'checked' : ''}> <i class="dot c-${c}"></i>${COLOR_NAME[c]}</label>`).join('')}</fieldset>
        <label>Difficulty <select name="difficulty">${Object.entries(DIFF).map(([k, d]) => `<option value="${k}">${d.label} — ${['', 'one colour', 'two colours', 'three colours'][d.colors]}, ${d.life} life</option>`).join('')}</select></label>
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

// Simple, Shandalar-flavoured deck advice shown under the stats. Targets a 40-card base at
// ~40% lands / ~40% creatures / 20-25% interaction, shifted by the archetype the mana curve implies.
// The old mulligan rule (redraw only on 0 or 7 lands) makes a stable mana base matter most, so the
// land note is the loudest. Shows the few biggest deviations, or an all-clear when the ratios are good.
function deckAdvice({ size, lands, spells, creatures, others, curve, avg }) {
  if (!spells && !lands) return '';
  const base = Math.max(40, size);
  const pct = n => Math.round(n / base * 100);
  const heavy = curve[5] + curve[6] + curve[7];   // spells costing 5+
  const arch = (spells >= 6 && avg <= 2.4 && heavy <= 2) ? 'aggro'
    : (avg >= 3.3 || heavy >= 5) ? 'control' : 'midrange';
  const aArch = `${arch === 'aggro' ? 'an' : 'a'} ${arch}`;
  const band = { aggro: [0.30, 0.35, 0.37], midrange: [0.38, 0.40, 0.42], control: [0.40, 0.42, 0.44] }[arch];
  const [lo, mid, hi] = band.map(f => Math.round(base * f));
  const tips = [];
  if (size < 40) tips.push(['warn', `Only ${size} cards — build up to at least 40. The targets below assume a 40-card deck.`]);
  if (lands < lo) tips.push(['warn', `Add about ${mid - lands} land${mid - lands === 1 ? '' : 's'}: ${lands} (${pct(lands)}%) is thin for ${aArch} deck — aim for ${mid} (~${Math.round(mid / base * 100)}%). Under the old mulligan rule (redraw only on 0 or 7 lands) a shaky mana base loses games on the shuffle.`]);
  else if (lands > hi) tips.push(['tip', `Trim about ${lands - mid} land${lands - mid === 1 ? '' : 's'}: ${lands} (${pct(lands)}%) is more than ${aArch} deck needs — swap the spares for spells.`]);
  const cMid = Math.round(base * 0.40);
  if (creatures < Math.round(base * 0.30)) tips.push(['tip', `Add creatures: ${creatures} (${pct(creatures)}%) is light. They are your win condition and your blockers against the AI — aim for about ${cMid} (40%).`]);
  if (arch !== 'aggro' && others < Math.round(base * 0.10)) tips.push(['tip', `Work in some interaction: only ${others} noncreature spell${others === 1 ? '' : 's'}. A few removal, burn or counters (aim 20–25%, about ${Math.round(base * 0.22)}) answer the AI's threats.`]);
  if (avg >= 3.6) tips.push(['tip', `Heavy curve (avg ${avg.toFixed(1)}): add a land or a couple of 1–2 drops so you can cast on time.`]);
  const shown = tips.slice(0, 4);
  const body = shown.length
    ? shown.map(([cls, t]) => `<li class="adv-${cls}">${esc(t)}</li>`).join('')
    : `<li class="adv-ok">Ratios look solid for ${aArch} deck — ${lands} lands (${pct(lands)}%), ${creatures} creatures (${pct(creatures)}%), ${others} other spell${others === 1 ? '' : 's'} (${pct(others)}%).</li>`;
  return `<div class="deckadvice"><div class="curve-head"><span>Recommendations</span><span class="small">reads as ${arch}</span></div><ul>${body}</ul></div>`;
}
// The curve + colour pie + recommendations for any deck object — shared by the journey deck builder and
// the multiplayer deck builder.
function deckStatsHtml(deckObj) {
  const inDeck = Object.entries(deckObj).map(([n, c]) => ({ n, c, d: defOf(n) }));
  const size = deckSize(deckObj);
  const lands = inDeck.filter(r => r.d?.kind === 'land').reduce((a, r) => a + r.c, 0);
  const curve = new Array(8).fill(0); let spells = 0, cmcSum = 0;
  const pip = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let creatures = 0;
  for (const r of inDeck) {
    if (!r.d || r.d.kind === 'land') continue;
    const cv = Math.min(7, r.d.cmc || 0); curve[cv] += r.c; spells += r.c; cmcSum += (r.d.cmc || 0) * r.c;
    if (r.d.power != null) creatures += r.c;
    for (const grp of (r.d.cost?.pips || [])) { const cols = grp.filter(c => pip[c] !== undefined); for (const c of cols) pip[c] += r.c / cols.length; }
  }
  const maxC = Math.max(1, ...curve), avg = spells ? (cmcSum / spells) : 0, BH = 64;
  const avgLeft = spells ? (Math.min(7, avg) / 7 * 100) : 0;
  const curveHtml = `<div class="curve">
    <div class="curve-head"><span>Mana curve</span><span class="small">${spells} spell${spells === 1 ? '' : 's'}${spells ? ` · avg ${avg.toFixed(1)}` : ''}</span></div>
    ${spells ? `<div class="curve-plot">${spells ? `<span class="curve-avg" style="left:${avgLeft}%" title="Average mana value ${avg.toFixed(2)}"></span>` : ''}${curve.map((n, i) => `<div class="curve-col"><span class="curve-n">${n || ''}</span><div class="curve-bar${n ? '' : ' empty'}" style="height:${n ? Math.max(4, Math.round(n / maxC * BH)) : 0}px" title="${n} spell${n === 1 ? '' : 's'} at ${i === 7 ? '7+' : i} mana"></div></div>`).join('')}</div>
    <div class="curve-axis">${curve.map((n, i) => `<span>${i === 7 ? '7+' : i}</span>`).join('')}</div>`
    : '<p class="small statmsg">Add nonland cards to see the curve.</p>'}
  </div>`;
  const pipTotal = COLORS.reduce((a, c) => a + pip[c], 0);
  let acc = 0; const stops = [];
  for (const c of COLORS) { if (pip[c] <= 0) continue; const s = acc / pipTotal * 360, e = (acc + pip[c]) / pipTotal * 360; stops.push(`var(--${c}) ${s.toFixed(2)}deg ${e.toFixed(2)}deg`); acc += pip[c]; }
  const pieHtml = `<div class="pie-box">
    <div class="curve-head"><span>Colors</span><span class="small">${pipTotal ? Math.round(pipTotal) + ' symbol' + (Math.round(pipTotal) === 1 ? '' : 's') : ''}</span></div>
    ${pipTotal ? `<div class="pie-row">
      <div class="pie" style="background:conic-gradient(${stops.join(',')})"><div class="pie-hole">${COLORS.filter(c => pip[c] > 0).length}<small>color${COLORS.filter(c => pip[c] > 0).length === 1 ? '' : 's'}</small></div></div>
      <ul class="pie-legend">${COLORS.filter(c => pip[c] > 0).sort((a, b) => pip[b] - pip[a]).map(c => `<li><i class="dot c-${c}"></i>${COLOR_NAME[c]}<span class="pie-pct">${Math.round(pip[c])} · ${Math.round(pip[c] / pipTotal * 100)}%</span></li>`).join('')}</ul>
    </div>` : '<p class="small statmsg">Colored spells show your color split here.</p>'}
  </div>`;
  return `<div class="deckstats">${curveHtml}${pieHtml}</div>${deckAdvice({ size, lands, spells, creatures, others: spells - creatures, curve, avg })}`;
}
function deck() {
  const g = S.game; if (!g) return title();
  const q = S.deckFilter.toLowerCase();
  const owned = Object.keys(S.collection).map(n => ({ n, q: S.collection[n], d: defOf(n) })).filter(r => r.d && r.d.kind !== 'unsupported' && (!q || r.n.toLowerCase().includes(q))).sort((a, b) => a.d.cmc - b.d.cmc || a.n.localeCompare(b.n));
  const inDeck = Object.entries(g.deck).map(([n, c]) => ({ n, c, d: defOf(n) })).sort((a, b) => (a.d?.kind === 'land') - (b.d?.kind === 'land') || (a.d?.cmc || 0) - (b.d?.cmc || 0) || a.n.localeCompare(b.n));
  const probs = deckProblems(g.deck);
  const size = deckSize(g.deck), lands = inDeck.filter(r => r.d?.kind === 'land').reduce((a, r) => a + r.c, 0);
  const statsHtml = deckStatsHtml(g.deck);
  app.innerHTML = `<section class="screen deckb">
    <div class="cols wide">
      <div class="box">
        <div class="rowhead"><h2>Your cards</h2><span class="rowtools"><button class="btn tiny" id="b-addall">Add all</button><input id="dfilter" placeholder="Filter…" value="${esc(S.deckFilter)}"></span></div>
        <table class="coll"><tr><th>Card</th><th>Cost</th><th>Own</th><th>In deck</th><th></th></tr>
        ${owned.map(r => { const used = g.deck[r.n] || 0; const room = deckRoom(r.n); const atCap = copyCap(r.n) !== Infinity && used >= copyCap(r.n); return `<tr><td data-preview="${esc(r.n)}">${esc(r.n)}<span class="small"> ${esc(r.d.typeLine)}</span></td><td>${r.d.kind === 'land' ? '' : manaHtml(r.d.cost)}</td><td>${r.q}</td><td>${used}${atCap ? ' <span class="small">(max)</span>' : ''}</td><td class="nowrap"><button class="btn tiny" data-add="${esc(r.n)}" ${room <= 0 ? 'disabled' : ''}>+</button><button class="btn tiny" data-addmax="${esc(r.n)}" ${room <= 0 ? 'disabled' : ''} title="Add all copies (max ${copyCap(r.n) === Infinity ? '∞' : copyCap(r.n)})">+all</button></td></tr>`; }).join('')}</table>
      </div>
      <div class="box">
        <div class="rowhead"><h2>Deck · ${size} cards, ${lands} lands</h2><span class="rowtools"><button class="btn" id="b-fill">Fill basics to 40</button><button class="btn" id="b-clear-deck"${size ? '' : ' disabled'}>Remove all</button></span></div>
        ${statsHtml}
        <div class="basics">${COLORS.map(c => `<span class="basic"><i class="dot c-${c}"></i>${BASICS[c]} <b>${g.deck[BASICS[c]] || 0}</b> <button class="btn tiny" data-rem="${BASICS[c]}">−</button><button class="btn tiny" data-add="${BASICS[c]}">+</button></span>`).join('')}</div>
        ${probs.length ? `<div class="msg">${probs.map(esc).join('<br>')}</div>` : '<div class="ok">Deck is ready.</div>'}
        <table class="coll"><tr><th>Card</th><th>Cost</th><th>Qty</th><th></th></tr>
        ${inDeck.map(r => `<tr class="st-${r.d?.status || 'missing'}"><td data-preview="${esc(r.n)}">${esc(r.n)}</td><td>${r.d && r.d.kind !== 'land' ? manaHtml(r.d.cost) : ''}</td><td>${r.c}</td><td class="nowrap"><button class="btn tiny" data-rem="${esc(r.n)}">−</button><button class="btn tiny" data-remmax="${esc(r.n)}" title="Remove all copies">−all</button></td></tr>`).join('')}</table>
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

// The "Dungeon lore" panel on the map: every dungeon the clues have told you anything about, with its
// location precision, its foes and rules, and the prizes named so far.
function dungeonIntelHtml(g) {
  const known = (g.world.dungeons || []).filter(d => (d.intel || 0) > 0 || d.sensed || d.revealed || d.cleared);
  if (!known.length) return `<p class="small dgnhint">No dungeon lore yet. Beat a roaming mage and wring out a clue to sense the dark places.</p>`;
  const row = d => {
    const t = dungeonTemplate(d.id);
    let where;
    if (d.cleared && !d.revealed) where = '<span class="dgn-cleared">vault emptied</span>';
    else if (d.revealed) where = `<span class="dgn-here">located · ${esc(compassTo(g, d))}</span>${d.cleared ? ' <span class="dgn-cleared">(cleared)</span>' : ''}`;
    else if (d.sensed && d.hint) where = `<span class="dgn-sensed">sensed ${esc(compassTo(g, d.hint))}, within ${d.hint.r} tiles</span>`;
    else where = '<span class="dgn-lost">location unknown — clues needed</span>';
    const prizes = knownPrizes(d, t);
    const intel = (d.intel || 0) >= 1 ? `<div class="small dgn-intel">${esc(dungeonArchetype(t))} · ${esc(S.dungeons.rules[t.rule].label)}: ${esc(S.dungeons.rules[t.rule].text)}</div>` : '';
    const prize = prizes.length ? `<div class="small dgn-prize">Prizes: ${prizes.map(esc).join(', ')}${(d.intel || 0) < FIND_CLUES ? ' …' : ''}</div>` : '';
    return `<li><i class="sw" style="background:${BIOME[t.color].fill}"></i> <b>${esc(t.name)}</b> — ${where}<span class="dgn-clue small"> (intel ${d.intel || 0}/${FIND_CLUES})</span>${intel}${prize}</li>`;
  };
  return `<div class="dgnhud"><b>Dungeon lore</b><ul>${known.map(row).join('')}</ul></div>`;
}
// Compass bearing + distance from the player to a spot on the map, so a besieged city can be found
// even when it has scrolled out of the viewport. y grows downward, so dy>0 is south.
function compassTo(g, spot) {
  const dx = spot.x - g.player.x, dy = spot.y - g.player.y;
  if (!dx && !dy) return 'you are here';
  const ns = dy < 0 ? 'N' : dy > 0 ? 'S' : '', ew = dx < 0 ? 'W' : dx > 0 ? 'E' : '';
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  return `${ns}${ew} · ${dist} tile${dist === 1 ? '' : 's'}`;
}
function map() {
  const g = S.game; if (!g) return title();
  const here = tileAt(g.world, g.player.x, g.player.y);
  const onRoad = roadAt(g.world, g.player.x, g.player.y);
  const near = g.world.enemies.filter(e => Math.abs(e.x - g.player.x) <= 1 && Math.abs(e.y - g.player.y) <= 1);
  const sieged = g.world.cities.filter(c => c.siege > 0 || c.captured).sort((a, b) => (b.captured - a.captured) || (b.siege - a.siege));
  const fallen = g.world.cities.filter(c => c.captured).length;
  const panel = `<canvas id="minimap" class="minimap"></canvas>
      <h2>${esc(g.name)}</h2>
      <p>Standing in the <b>${BIOME[here].name}</b> (${COLOR_NAME[here]}).${onRoad ? ' <b class="onroad">On a road — you travel it swiftly and pursuers lose your trail.</b>' : ''} ${near.length ? `<br>${near.map(e => `${enemyById(e.template)?.name || 'a mage'} (Lvl ${roamLevel(e)})`).join(', ')} nearby.` : ''}</p>
      ${sieged.length ? `<div class="siegehud"><b>⚔ Under siege (${fallen}/4 fallen)</b>
      <ul>${sieged.map(c => `<li><i class="sw" style="background:${BIOME[c.color].fill}"></i> <b>${esc(c.name)}</b> — ${c.captured ? '<span class="fallenmark">FALLEN</span>' : `${c.siege}/3`}, <span class="bearing">${compassTo(g, c)}</span></li>`).join('')}</ul>
      <span class="small">Reach a besieged city to break the siege and reclaim it. Lose four and the realm collapses.</span></div>` : ''}
      <p class="small">Move with WASD or the arrow keys, or click a neighbouring tile. Walking costs food. Blue crystals are mana links (+2 life). Landmarks marked ? ask a riddle about a card: answer right for a card of that region's color, wrong and you lose life, food or, rarely, a card. Pits with a torch are dungeons: revealed by clues from beaten foes, fought room by room with your life carried over. Faint sparks are mana motes — walk over one for gold or an amulet. Dirt roads link the cities: stay on one and you move too fast for pursuing mages to close in. The five dark fortresses are the Warden guilds; storm them to find the one the Usurper wears.</p>
      ${dungeonIntelHtml(g)}
      <div class="btnrow"><button class="btn" id="b-rest" ${g.player.food < 3 || g.player.life >= g.player.maxLife ? 'disabled' : ''}>Rest (3 food, +5 life)</button><button class="btn ghost" data-go="title">Menu</button></div>
      ${totalAmulets() ? `<h3>World magic</h3><p class="small">Spend amulets to bend the world. ${g.player.cloak > 0 ? `<b>Cloaked: ${g.player.cloak} step${g.player.cloak > 1 ? 's' : ''} of shadow left.</b>` : 'Cast from anywhere on the map.'}</p>
      <div class="wmgrid">${WORLD_MAGIC.map(s => `<button class="btn wm" id="${s.id}" ${amuletCount(s.c) ? '' : 'disabled'} title="${esc(s.desc)}"><b>${s.name}</b><span class="wmd">${esc(s.desc)}</span><span class="wmcost">1 <i class="amu-chip" style="background:${AMULET_HEX[s.c]}"></i></span></button>`).join('')}</div>` : ''}
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
  if (!g.world.motes) { placeMotes(g.world, Math.random); save(); }
  if (!g.world.castles) { migrateCastles(g); save(); }
  if (!g.world.roads) { ensureRoads(g.world); save(); }
  // Give pre-clue saves the new dungeon intel model: a previously-revealed dungeon counts as fully located.
  if ((g.world.dungeons || []).some(d => d.intel === undefined)) {
    for (const d of g.world.dungeons) if (d.intel === undefined) { d.intel = d.revealed ? FIND_CLUES : 0; d.locClues = d.revealed ? FIND_CLUES : 0; d.sensed = !!d.revealed; d.collected = d.collected || []; d.hint = null; }
    save();
  }
  // Give pre-level saves the graded overland: assign each roaming mage a level by its distance from home.
  if (g.world.enemies.some(e => e.level == null)) {
    const w = g.world, span = Math.max(w.w, w.h);
    for (const e of w.enemies) if (e.level == null) {
      const frac = Math.min(1, Math.hypot(e.x - w.start.x, e.y - w.start.y) / (span * 0.7));
      const maxL = Math.min(5, 1 + Math.floor(frac * 5)), lo = Math.max(1, maxL - 2);
      e.level = lo + Math.floor(Math.random() * (maxL - lo + 1)); e.tier = e.level >= 3 ? 2 : 1;
    }
    save();
  }
  if (!g.usurper) { g.usurper = rnd(COLORS); save(); }
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

// A few fantasy ways to say the inn topped you off, so a city visit always heals to full for free.
function innFlavor(n) {
  return rnd([
    `The inn's hearth-witch mends you with a song and a bowl of suspiciously green stew. ${n} life restored.`,
    `A real feather bed, no roots in your back for once — you wake ${n} life the better.`,
    `The innkeeper pours you a tankard of something that glows faintly. You feel ${n} life braver.`,
    `You sleep like the dead and wake like the living. The inn gives back ${n} life.`,
    `Warm bread, warmer fire, and a bard who only knew three songs. ${n} life recovered.`,
    `The bathhouse cauldron does wonders for a mage's aches. Healed ${n} life.`,
  ]);
}
// Enter a city, resting at its inn for free on the way in: full life, with a bit of flavour to show for it.
function enterCity() {
  const g = S.game;
  const healed = g.player.maxLife - g.player.life;
  if (healed > 0) { g.player.life = g.player.maxLife; S.innMsg = innFlavor(healed); } else S.innMsg = null;
  save(); go('city');
}
function city() {
  const g = S.game; const c = cityAt(g.world, g.player.x, g.player.y); if (!c) return map();
  const stock = cityStock(c);
  stockAmuletShop(c.color);
  app.innerHTML = `<section class="screen cityscreen">
    <div class="box">
      <h2>${esc(c.name)} <span class="small">· a ${COLOR_NAME[c.color].toLowerCase()} city in the ${BIOME[c.color].name.toLowerCase()}</span></h2>
      ${S.innMsg ? `<p class="innmsg">${esc(S.innMsg)}</p>` : ''}
      <div class="btnrow">
        <button class="btn" id="b-food" ${g.player.gold < 2 ? 'disabled' : ''}>Buy 20 food (2 gold)</button>
        <button class="btn primary" id="b-leave">Leave</button>
      </div>
      <h3>Market</h3>
      <div class="market">${stock.map((it, i) => { const d = defOf(it.name); return `<div class="stall${it.sold ? ' sold' : ''}">${cardHtml(d)}<div class="price">${it.sold ? 'Sold' : `${it.price} gold`}</div><button class="btn small" data-buy="${i}" ${it.sold || g.player.gold < it.price ? 'disabled' : ''}>Buy</button></div>`; }).join('')}</div>
      <p class="small">Stock changes every few days. Artifacts and rare lands pass through now and then. Bought cards go to your collection; add them to your deck from the Deck tab.</p>
      ${(() => {
        const reserve = townGold(c.color);
        const sellable = Object.keys(S.collection).filter(n => !BASIC_NAMES.has(n) && sellableCopies(n) > 0 && defOf(n) && defOf(n).kind !== 'unsupported').sort((a, b) => sellPrice(b) - sellPrice(a) || a.localeCompare(b));
        return `<h3>Sell cards <span class="small">· ${esc(c.name)}'s coffers hold ${reserve} gold</span></h3>
        <p class="small">The town buys your spare cards — copies you own beyond what your deck uses — paying from its own reserve. Buying here refills the coffers; selling drains them${reserve === 0 ? ', and right now they are empty' : ''}.</p>
        ${sellable.length ? `<div class="selllist">${sellable.map(n => { const price = sellPrice(n); return `<div class="sellrow"><span class="nm" data-preview="${esc(n)}">${esc(n)} ${tierChip(n)}</span><span class="small qty">${sellableCopies(n)} spare</span><button class="btn small" data-sell="${esc(n)}" ${reserve < price ? 'disabled' : ''}>Sell for ${price}g</button></div>`; }).join('')}</div>` : '<p class="small">No spare cards to sell — every card you own is in your deck.</p>'}`;
      })()}
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
    <h2>${g.status === 'won' ? 'The Usurper falls' : g.lostBy === 'siege' ? 'The realm is overrun' : 'The Spell of Dominion is cast'}</h2>
    <p>${g.status === 'won'
      ? `${esc(g.name)} unbinds the mana links on day ${g.player.day} after ${g.wins} victories. The plane is free, for now.`
      : g.lostBy === 'siege'
        ? `On day ${g.player.day} the Wardens' hosts take a fourth city. With the free realms fallen the Usurper rules unopposed. Your collection survives; your journey does not.`
        : `On day ${g.player.day} the Usurper binds the final link. The world dims. Your collection survives; your journey does not.`}</p>
    <button class="btn primary" id="b-newgame">Start a new journey</button>
  </div></section>`;
}

// ---- events -----------------------------------------------------------------------
app.addEventListener('submit', ev => {
  if (ev.target.id === 'newgame') { ev.preventDefault(); const f = new FormData(ev.target); newGame({ name: f.get('name').trim(), color: f.get('color'), difficulty: f.get('difficulty') }); }
});
document.addEventListener('click', ev => {
  if (ev.target.closest('.btn, .tab, .linkbtn')) sfx('click');
  const t = ev.target.closest('[data-go],[data-modal],[data-filter],[data-add],[data-addmax],[data-rem],[data-remmax],[data-dec],[data-buy],[data-sell],[data-amshop],[data-audio],[data-lesson],#b-import,#b-csv,#b-rescan,#b-clear-coll,#b-fill,#b-addall,#b-clear-deck,#b-rest,#b-food,#b-leave,#b-newgame,#b-dleave,#b-practice,#b-bounty,#wm-heal,#wm-blink,#wm-cloak,#wm-thunder,#wm-sight,#b-reset-all');
  if (!t) return;
  const g = S.game;
  if ('audio' in t.dataset) { toggleAudio(); renderTop(); return; }
  if (t.dataset.lesson != null) { if (!t.disabled) { S.lesson = Number(t.dataset.lesson); go('tutorial'); } return; }
  if (t.dataset.go) { if (!t.disabled) { if (t.dataset.go === 'map' && g?.status !== 'playing' && g) go('end'); else if (t.dataset.go === 'dungeon' && !currentDungeon()) go('map'); else go(t.dataset.go); } return; }
  if (t.dataset.modal != null) { const b = S.modal?.buttons[Number(t.dataset.modal)]; if (b && !b.disabled) b.action(); return; }
  if (t.dataset.filter) { S.filter = t.dataset.filter; render(); return; }
  if (t.dataset.add) { if (deckRoom(t.dataset.add) > 0) { addCards(g.deck, t.dataset.add, 1); save(); render(); } return; }
  if (t.dataset.addmax) { const room = deckRoom(t.dataset.addmax); if (room > 0) { addCards(g.deck, t.dataset.addmax, room); save(); render(); } return; }
  if (t.dataset.rem) { addCards(g.deck, t.dataset.rem, -1); save(); render(); return; }
  if (t.dataset.remmax) { delete g.deck[t.dataset.remmax]; save(); render(); return; }
  if (t.dataset.sell != null) { sellCard(t.dataset.sell); return; }
  if (t.dataset.dec) { addCards(S.collection, t.dataset.dec, -1); if (g && g.deck[t.dataset.dec] > (S.collection[t.dataset.dec] || 0)) addCards(g.deck, t.dataset.dec, -1); save(); render(); return; }
  if (t.dataset.buy != null) { const c = cityAt(g.world, g.player.x, g.player.y); const it = cityStock(c)[Number(t.dataset.buy)]; if (it && !it.sold && g.player.gold >= it.price) { g.player.gold -= it.price; addTownGold(c.color, it.price); it.sold = true; addCards(S.collection, it.name, 1); sfx('coin'); save(); render(); } return; }
  if (t.dataset.amshop != null) { const name = t.dataset.amshop; const color = t.dataset.amcolor || null; const cost = amuletPrice(name); if (spendAmulets(cost, color)) { addCards(S.collection, name, 1); sfx('coin'); save(); render(); toast(`${name} bought for ${cost} amulet${cost > 1 ? 's' : ''}.`); } return; }
  switch (t.id) {
    case 'b-import': S.importText = document.getElementById('imp').value; doImport(S.importText); break;
    case 'b-csv': fetch('api/collection').then(r => r.ok ? r.text() : Promise.reject(new Error('collection.csv not found next to server.js'))).then(txt => { S.importText = txt; doImport(txt); }).catch(e => { S.report = { error: e.message }; render(); }); break;
    case 'b-rescan': loadArtIndex().then(render); break;
    case 'b-clear-coll': if (confirm('Remove every card from your collection? Your deck will need rebuilding.')) { S.collection = {}; if (g) g.deck = {}; save(); render(); } break;
    case 'b-fill': fillBasics(g.deck); save(); render(); break;
    case 'b-addall': { const q = S.deckFilter.toLowerCase(); for (const n of Object.keys(S.collection)) { const d = defOf(n); if (!d || d.kind === 'unsupported') continue; if (q && !n.toLowerCase().includes(q)) continue; const want = deckRoom(n); if (want > 0) addCards(g.deck, n, want); } save(); render(); break; }
    case 'b-clear-deck': if (deckSize(g.deck) && confirm('Remove every card from your deck?')) { g.deck = {}; save(); render(); } break;
    case 'b-rest': if (g.player.food >= 3) { g.player.food -= 3; g.player.life = Math.min(g.player.maxLife, g.player.life + 5); g.player.day++; if (g.player.day % 30 === 0) bossLink(); stepEnemies(g.world, Math.random, g.player); save(); render(); } break;
    case 'b-food': if (g.player.gold >= 2) { g.player.gold -= 2; g.player.food += 20; save(); render(); } break;
    case 'b-leave': go('map'); break;
    case 'b-newgame': S.game = null; save(); go('title'); break;
    case 'b-dleave': dungeonExitPrompt(false); break;
    case 'b-practice': startTutorialDuel().catch(e => setBusy('Could not load card data: ' + e.message)); break;
    case 'b-bounty': { const c = cityAt(g.world, g.player.x, g.player.y); if (c) acceptBounty(c); break; }
    case 'b-reset-all': if (confirm('Wipe your current journey AND your entire collection so you can start completely fresh? This cannot be undone.')) { S.game = null; S.collection = {}; S.filter = 'all'; S.report = null; save(); go('title'); toast('Everything wiped. Begin a new journey with an empty collection.'); } break;
    case 'wm-heal': if (amuletCount('W') && g.player.life < g.player.maxLife) { giveAmulet('W', -1); g.player.life = g.player.maxLife; sfx('cast'); save(); toast('Healing Light: your wounds close.'); } break;
    case 'wm-blink': if (amuletCount('U')) { const c = g.world.cities.slice().sort((a, b) => (Math.abs(a.x - g.player.x) + Math.abs(a.y - g.player.y)) - (Math.abs(b.x - g.player.x) + Math.abs(b.y - g.player.y))).find(c => c.x !== g.player.x || c.y !== g.player.y); if (c) { giveAmulet('U', -1); g.player.x = c.x; g.player.y = c.y; sfx('cast'); toast(`Blink: you step out in ${c.name}.`); enterCity(); return; } } break;
    case 'wm-cloak': if (amuletCount('B')) { giveAmulet('B', -1); g.player.cloak = 8; sfx('cast'); save(); toast('Shadow Cloak: you walk unseen for 8 steps.'); render(); } break;
    case 'wm-thunder': {
      if (amuletCount('R') < 1) break;
      const before = g.world.enemies.length;
      g.world.enemies = g.world.enemies.filter(e => Math.abs(e.x - g.player.x) > 3 || Math.abs(e.y - g.player.y) > 3);
      const cleared = before - g.world.enemies.length;
      giveAmulet('R', -1); sfx('cast'); save();
      toast(cleared ? `Thunder scatters ${cleared} monster${cleared > 1 ? 's' : ''}.` : 'Thunder rolls, but no monster stood near.');
      break;
    }
    case 'wm-sight': if (amuletCount('G')) { const hidden = (g.world.dungeons || []).filter(d => !d.revealed && !d.cleared); if (hidden.length) { giveAmulet('G', -1); hidden.forEach(d => { d.intel = FIND_CLUES; d.locClues = FIND_CLUES; d.sensed = true; d.revealed = true; d.hint = null; }); sfx('cast'); save(); toast(`Sylvan Sight lays bare ${hidden.length} hidden dungeon${hidden.length > 1 ? 's' : ''} — location and prizes both.`); } else toast('The forest knows of no more hidden ways.'); } break;
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
// ==================== Multiplayer (1v1) ====================
// Host-authoritative: the host runs the real Duel and streams redacted snapshots over the relay; the
// guest renders a mirror and sends its inputs back. See js/net.js, js/mp.js, relay.js.
function mpDefaultAddr() { try { return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`; } catch { return 'ws://localhost:8642/ws'; } }
function mpName() { try { return localStorage.getItem('ff_mpname') || S.game?.name || 'Duelist'; } catch { return S.game?.name || 'Duelist'; } }
function mpEnter() {
  mpTeardown();
  S.mp = { addr: mpDefaultAddr(), name: mpName(), status: 'idle', view: 'lobby', rooms: [], role: null, room: null, deckColor: 'G', deckDiff: 'apprentice', deck: null, ready: false, oppReady: false, oppName: null, oppDeck: null, started: false, msg: '' };
  go('mplobby');
  mpConnect();   // auto-connect straight to the lobby of open games
}
function mpTeardown() { const mp = S.mp; if (mp?.net) { try { mp.net.close(); } catch {} } S.mp = null; }
function mpLeave() { const mp = S.mp; if (mp?.net) { try { mp.net.leave(); } catch {} } mpTeardown(); S.modal = null; go('title'); }

async function mpConnect() {
  const mp = S.mp; if (!mp) return;
  mp.status = 'connecting'; mp.msg = ''; render();
  const net = new Net(mp.addr); mp.net = net;
  mpWire(net);
  try { await net.connect(mp.name); mp.status = 'online'; mp.view = 'lobby'; net.list(); }
  catch { mp.status = 'error'; mp.msg = `Could not reach the relay at ${mp.addr}. Start it with "npm run relay" and check the address.`; }
  render();
}
function mpWire(net) {
  net.on('lobby', rooms => { if (S.mp) { S.mp.rooms = rooms; if (S.screen === 'mplobby') render(); } });
  net.on('hosted', room => { if (!S.mp) return; S.mp.role = 'host'; S.mp.room = room; S.mp.view = 'host-wait'; render(); });
  net.on('peerJoined', ({ name }) => { if (!S.mp) return; S.mp.oppName = name; mpToDeck(); });      // host: a guest arrived
  net.on('joined', room => { if (!S.mp) return; S.mp.role = 'guest'; S.mp.room = room; S.mp.oppName = room.host; mpToDeck(); });
  net.on('joinError', reason => { if (!S.mp) return; S.mp.msg = reason === 'no-such-room' ? 'No room with that code.' : reason === 'room-full' ? 'That room is already full.' : String(reason); render(); });
  net.on('peerLeft', info => mpPeerLeft(info));
  net.on('peer', data => mpOnPeer(data));
  net.on('close', () => { if (S.mp && S.mp.status === 'online') { S.mp.status = 'closed'; S.mp.msg = 'Lost the connection to the relay.'; render(); } });
}
function mpToDeck() {
  const mp = S.mp; mp.view = 'deck'; mp.ready = false; mp.oppReady = false; mp.started = false;
  mp.mull = false; mp.begun = false; mp.guestKeptLocal = false; mp.lastSnap = null; mp.duel = null; mp.mirror = null; mp.root = null; mp.api = null;
  if (!mp.deck) mp.deck = buildStartDeck(mp.deckColor, DIFF[mp.deckDiff].colors, Math.random);
  go('mpdeck');
}
function mpSetDeck(color, diff) { const mp = S.mp; mp.deckColor = color; mp.deckDiff = diff; mp.deck = buildStartDeck(color, DIFF[diff].colors, Math.random); mp.ready = false; mp.net.relay({ k: 'ready', ready: false }); render(); }
function mpReroll() { const mp = S.mp; mp.deck = buildStartDeck(mp.deckColor, DIFF[mp.deckDiff].colors, Math.random); mp.ready = false; mp.net.relay({ k: 'ready', ready: false }); render(); }
function mpReady() { const mp = S.mp; mp.ready = true; mp.net.relay({ k: 'deck', deck: mp.deck, name: mp.name, ready: true }); render(); mpTryStart(); }
function mpOnPeer(data) {
  const mp = S.mp; if (!mp || !data) return;
  switch (data.k) {
    case 'deck': mp.oppDeck = data.deck; mp.oppName = data.name || mp.oppName; mp.oppReady = !!data.ready; if (S.screen === 'mpdeck') render(); mpTryStart(); break;
    case 'ready': mp.oppReady = !!data.ready; if (S.screen === 'mpdeck') render(); break;
    case 'start': mpGuestStart(); break;              // guest: host says both are ready — stand by for hands
    case 'ready2': if (mp.role === 'host') mpHostStart(); break;   // host: guest is ready — build+deal+mulligan
    case 'mullstart': mp.mull = true; if (mp.lastSnap && !mp.guestKeptLocal) mpGuestMull(); break;   // guest: decide opening hand
    case 'mullkeep': if (mp.role === 'host') { mp.mull.guestKept = true; mpMaybeBegin(); } break;   // host: guest kept
    case 'begin': mpGuestBegin(); break;              // guest: mulligans done — mount and play
    case 'snap': mpGuestSnap(data.snap); break;
    case 'input': mpHostInput(data.action); break;
    case 'rematch': mpToDeck(); break;
  }
}
function mpTryStart() {
  const mp = S.mp; if (mp.role !== 'host' || mp.started) return;
  if (!mp.ready || !mp.oppReady || !mp.deck || !mp.oppDeck) return;
  mp.started = true; mp.view = 'starting'; mp.net.relay({ k: 'start' }); render();   // wait for the guest's mirror (ready2)
}
function mpGuestStart() {   // guest: reset for a fresh match and tell the host we are ready for it to deal
  const mp = S.mp; mp.localIdx = 1; mp.winner = null; mp.duel = null; mp.api = null; mp.root = null; mp.mirror = null;
  mp.begun = false; mp.mull = false; mp.guestKeptLocal = false; mp.lastSnap = null;
  mp.net.relay({ k: 'ready2' });
}
function mpHostStart() {   // host: build the authoritative duel, deal hands, and run the mulligan phase
  const mp = S.mp; mp.localIdx = 0; mp.winner = null; mp.root = null; mp.api = null; mp.mirror = null; mp.begun = false;
  const duel = new Duel({
    player: { name: mp.name, deck: expandDeck(mp.deck), life: 20, ai: false },
    ai: { name: mp.oppName || 'Opponent', deck: expandDeck(mp.oppDeck), life: 20, ai: false },
    hooks: null,
  });
  mp.duel = duel;
  // Broadcast a redacted snapshot to the guest on each change, coalesced to at most one per frame.
  let queued = false;
  duel.onChange(() => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; if (S.mp?.net && S.mp.duel === duel) S.mp.net.relay({ k: 'snap', snap: duel.snapshot(1) }); }); });
  duel.start();   // deals both hands (its emit sends the guest its first snapshot)
  mp.mull = { hostKept: false, guestKept: false };
  mp.net.relay({ k: 'mullstart' });
  mpHostMull();
}
// The free opening-hand mulligan, coordinated across both clients: each sees their hand and keeps or
// redraws; the game only starts once both have kept.
function mpHandLands(names) { return names.filter(n => defOf(n)?.kind === 'land').length; }
function mpMullModal(names, onKeep, onMull) {
  const lands = mpHandLands(names);
  S.modal = {
    title: 'Your opening hand',
    body: `<p>${names.length} cards · <b>${lands} land${lands === 1 ? '' : 's'}</b>.</p>
      <div class="mullhand">${names.map(n => `<span class="mullcard" data-preview="${esc(n)}">${esc(n)}${defOf(n)?.kind === 'land' ? ' <i class="dot c-' + ({ Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }[n] || 'C') + '"></i>' : ''}</span>`).join('')}</div>
      <p class="small">${lands <= 1 ? 'A land-light hand — you may mulligan (reshuffle and redraw the same number, free).' : 'A workable hand.'}</p>`,
    buttons: [{ label: 'Keep', primary: true, action: onKeep }, { label: 'Mulligan', action: onMull }],
  };
  render();
}
function mpHostMull() {
  const mp = S.mp, duel = mp.duel; if (!duel) return;
  mpMullModal(duel.players[0].hand.map(c => c.def.name),
    () => { S.modal = null; mp.mull.hostKept = true; render(); mpMaybeBegin(); },
    () => { duel.mulligan(0); mpHostMull(); });   // mulligan(0) redraws and re-broadcasts
}
function mpGuestMull() {
  const mp = S.mp; if (!mp.lastSnap) return;
  mpMullModal(mp.lastSnap.players[1].hand.map(c => c.name),
    () => { S.modal = null; mp.guestKeptLocal = true; render(); mp.net.relay({ k: 'mullkeep' }); },
    () => { mp.net.relay({ k: 'input', action: { type: 'mulligan' } }); });   // host redraws; a fresh snapshot reopens this
}
function mpMaybeBegin() {
  const mp = S.mp; if (!mp.mull || !mp.mull.hostKept || !mp.mull.guestKept || mp.begun) return;
  mp.begun = true; mp.net.relay({ k: 'begin' }); go('mpduel');   // host mounts (autoStart false) and runs
}
function mpGuestBegin() {
  const mp = S.mp; mp.begun = true; S.modal = null;
  mp.mirror = makeMirror({ me: mp.name, foe: mp.oppName || 'Opponent' });
  go('mpduel');
  if (mp.lastSnap) hydrate(mp.mirror, mp.lastSnap, defOf, 1);
}
function mpGuestSnap(snap) {
  const mp = S.mp; if (!mp) return;
  mp.lastSnap = snap;
  if (mp.begun) { if (!mp.mirror) { mp.pendingSnap = snap; return; } hydrate(mp.mirror, snap, defOf, 1); if (snap.winner !== null && snap.winner !== undefined) mp.winner = snap.winner; return; }
  if (mp.mull && !mp.guestKeptLocal) mpGuestMull();   // (re)show the opening-hand choice with the latest hand
}
function mpHostInput(action) {
  const mp = S.mp; if (!mp || !mp.duel) return;
  if (mp.mull && !mp.begun) { if (action.type === 'mulligan') mp.duel.mulligan(1); return; }   // mulligan phase
  if (action.type === 'concede') { mp.duel.end(0, `${mp.oppName || 'Your opponent'} concedes.`); }
  else applyRemoteInput(mp.duel, action, 1);
  mp.api?.run();   // resume ticking after the guest's action
}
function mpOnEnd(winner) {
  const mp = S.mp; if (!mp) return;
  mp.winner = winner;
  const iWon = winner === mp.localIdx;
  S.modal = {
    title: iWon ? 'Victory' : 'Defeat',
    body: `<p>${iWon ? `You defeated ${esc(mp.oppName || 'your opponent')}.` : `${esc(mp.oppName || 'Your opponent')} defeated you.`}</p>`,
    buttons: [{ label: 'Rematch', primary: true, action: () => { S.modal = null; mp.net.relay({ k: 'rematch' }); mpToDeck(); } }, { label: 'Leave', action: () => { S.modal = null; mpLeave(); } }],
  };
  render();
}
function mpPeerLeft(info) {
  const mp = S.mp; if (!mp) return;
  mp.oppReady = false; mp.oppDeck = null; mp.started = false; mp.duel = null; mp.mirror = null; mp.root = null; mp.api = null; mp.winner = null;
  S.modal = null;
  if (info.roomClosed) { mp.room = null; mp.role = null; mp.view = 'lobby'; mp.msg = 'The host closed the room.'; mp.net?.list(); go('mplobby'); }
  else { mp.oppName = null; mp.msg = 'Your opponent left. Waiting for a new challenger…'; mp.view = 'host-wait'; go('mplobby'); }
}

function mplobby() {
  const mp = S.mp; if (!mp) return title();
  let body = '';
  if (mp.status === 'connecting') {
    body = `<h2>Multiplayer</h2><p class="small">Connecting to the relay…</p>`;
  } else if (mp.status !== 'online') {
    // Only shown if the auto-connect failed: let the player fix the relay address and retry.
    body = `<h2>Multiplayer</h2>
      <p class="small">Couldn't reach the relay. It hosts the lobby — run <code>npm run relay</code> somewhere you both can reach, or point at a hosted one.</p>
      <label>Your name <input id="mp-name" value="${esc(mp.name)}" maxlength="24"></label>
      <label>Relay address <input id="mp-addr" value="${esc(mp.addr)}" spellcheck="false"></label>
      ${mp.msg ? `<p class="warn small">${esc(mp.msg)}</p>` : ''}
      <div class="btnrow"><button class="btn primary" id="mp-connect">Connect</button><button class="btn ghost" data-go="title">Back</button></div>`;
  } else if (mp.view === 'host-wait') {
    body = `<h2>Waiting for a challenger…</h2>
      <p class="small">Your game is listed in the lobby. Anyone connected can pick it — or share this code for a direct join:</p>
      <p class="mp-code">${esc(mp.room?.code || '????')}</p>
      ${mp.msg ? `<p class="small">${esc(mp.msg)}</p>` : ''}
      <div class="btnrow"><button class="btn ghost" id="mp-cancel">Cancel</button></div>`;
  } else if (mp.view === 'starting') {
    body = `<h2>Starting the duel…</h2><p class="small">Both decks are ready. Shuffling up.</p>`;
  } else {
    // The lobby: a live list of open games waiting for a player, plus Host and join-by-code.
    body = `<div class="rowhead"><h2>Open games</h2><span class="small">playing as <b>${esc(mp.name)}</b> · <button class="linkbtn" id="mp-rename">change</button></span></div>
      <div class="btnrow mp-lobbybar"><button class="btn primary" id="mp-host">Host a game</button>
        <input id="mp-code" placeholder="code" maxlength="4" style="text-transform:uppercase;width:5.5em">
        <button class="btn" id="mp-join">Join by code</button>
        <button class="btn ghost" id="mp-refresh" title="Refresh the list">↻</button></div>
      ${mp.msg ? `<p class="warn small">${esc(mp.msg)}</p>` : ''}
      ${mp.rooms.length
        ? `<ul class="mp-rooms">${mp.rooms.map(r => `<li data-mpjoin="${esc(r.code)}"><span class="mp-game-name"><b>${esc(r.host)}</b><span class="small"> — ${esc(r.name)}</span></span><span class="mp-join-hint">Join →</span></li>`).join('')}</ul>`
        : `<p class="small mp-empty">No open games yet. <b>Host a game</b> and it'll appear here for others to join — or wait for someone to host.</p>`}
      <div class="btnrow"><button class="btn ghost" id="mp-quit">Leave</button></div>`;
  }
  app.innerHTML = `<section class="screen mplobby"><div class="box">${body}</div></section>`;
}
// Multiplayer is a sandbox: every card is available in plenty, so the copy oracle reports a full stock
// for any name (the 4-of rule still governs). The display pool is the client's cached, supported cards.
const MP_STOCK = new Proxy({}, { get: () => 99, has: () => true });
function mpSandbox() { return MP_STOCK; }
function mpPool() {
  const seen = new Set(); const out = [];
  for (const c of allCached()) { if (seen.has(c.name) || BASIC_NAMES.has(c.name) || c.name.startsWith('A-')) continue; const d = defOf(c.name); if (d && d.kind !== 'unsupported') { seen.add(c.name); out.push({ n: c.name, d }); } }
  return out;
}
// Editing the deck un-readies you and tells your opponent so a match can't start on a stale deck.
function mpEdit(fn) { const mp = S.mp; fn(mp.deck); if (mp.ready) { mp.ready = false; mp.net.relay({ k: 'ready', ready: false }); } render(); }
function mpdeck() {
  const mp = S.mp; if (!mp) return title();
  const sandbox = mpSandbox();
  const q = (S.mpFilter || '').toLowerCase();
  const owned = mpPool().filter(r => !q || r.n.toLowerCase().includes(q)).sort((a, b) => (a.d.cmc || 0) - (b.d.cmc || 0) || a.n.localeCompare(b.n)).slice(0, 400);
  const inDeck = Object.entries(mp.deck).map(([n, c]) => ({ n, c, d: defOf(n) })).sort((a, b) => (a.d?.kind === 'land') - (b.d?.kind === 'land') || (a.d?.cmc || 0) - (b.d?.cmc || 0) || a.n.localeCompare(b.n));
  const probs = deckProblems(mp.deck, sandbox);
  const size = deckSize(mp.deck), lands = inDeck.filter(r => r.d?.kind === 'land').reduce((a, r) => a + r.c, 0);
  const oppState = mp.oppReady ? `<b class="mp-ok">${esc(mp.oppName || 'Opponent')} is ready.</b>` : `Waiting for ${esc(mp.oppName || 'your opponent')}…`;
  app.innerHTML = `<section class="screen deckb mpdeck"><div class="cols wide">
    <div class="box">
      <div class="rowhead"><h2>Card pool</h2><span class="rowtools"><input id="mp-filter" placeholder="Filter…" value="${esc(S.mpFilter || '')}"></span></div>
      <table class="coll"><tr><th>Card</th><th>Cost</th><th>In deck</th><th></th></tr>
      ${owned.map(r => { const used = mp.deck[r.n] || 0; const room = deckRoom(r.n, mp.deck, sandbox); const atCap = used >= copyCap(r.n); return `<tr><td data-preview="${esc(r.n)}">${esc(r.n)}<span class="small"> ${esc(r.d.typeLine)}</span></td><td>${r.d.kind === 'land' ? '' : manaHtml(r.d.cost)}</td><td>${used}${atCap ? ' <span class="small">(max)</span>' : ''}</td><td class="nowrap"><button class="btn tiny" data-mpadd="${esc(r.n)}" ${room <= 0 ? 'disabled' : ''}>+</button><button class="btn tiny" data-mpaddmax="${esc(r.n)}" ${room <= 0 ? 'disabled' : ''} title="Add up to ${copyCap(r.n)}">+all</button></td></tr>`; }).join('')}</table>
    </div>
    <div class="box">
      <div class="rowhead"><h2>Your deck · ${size} cards, ${lands} lands</h2><span class="rowtools"><button class="btn" id="mp-clear"${size ? '' : ' disabled'}>Clear</button></span></div>
      <details class="mp-quick"><summary>Quick deck</summary>
        <fieldset><legend>Main colour</legend>${COLORS.map(c => `<label class="radio"><input type="radio" name="mpcolor" value="${c}" ${c === mp.deckColor ? 'checked' : ''}> <i class="dot c-${c}"></i>${COLOR_NAME[c]}</label>`).join('')}</fieldset>
        <label>Colours <select id="mp-diff">${Object.entries(DIFF).map(([k, d]) => `<option value="${k}" ${k === mp.deckDiff ? 'selected' : ''}>${['', 'One colour', 'Two colours', 'Three colours'][d.colors]}</option>`).join('')}</select></label>
        <button class="btn" id="mp-reroll">Generate this deck</button>
      </details>
      ${deckStatsHtml(mp.deck)}
      <div class="basics">${COLORS.map(c => `<span class="basic"><i class="dot c-${c}"></i>${BASICS[c]} <b>${mp.deck[BASICS[c]] || 0}</b> <button class="btn tiny" data-mprem="${BASICS[c]}">−</button><button class="btn tiny" data-mpadd="${BASICS[c]}">+</button></span>`).join('')}</div>
      ${probs.length ? `<div class="msg">${probs.slice(0, 6).map(esc).join('<br>')}</div>` : '<div class="ok">Deck is ready.</div>'}
      <div class="btnrow"><button class="btn primary" id="mp-ready" ${probs.length || mp.ready ? 'disabled' : ''}>${mp.ready ? 'Ready ✓' : "I'm ready"}</button><button class="btn ghost" id="mp-quit">Leave</button></div>
      <p class="small">${mp.ready ? 'Waiting for your opponent…' : ''} ${oppState}</p>
      <table class="coll"><tr><th>Card</th><th>Cost</th><th>Qty</th><th></th></tr>
      ${inDeck.map(r => `<tr><td data-preview="${esc(r.n)}">${esc(r.n)}</td><td>${r.d && r.d.kind !== 'land' ? manaHtml(r.d.cost) : ''}</td><td>${r.c}</td><td class="nowrap"><button class="btn tiny" data-mprem="${esc(r.n)}">−</button><button class="btn tiny" data-mpremmax="${esc(r.n)}" title="Remove all">−all</button></td></tr>`).join('')}</table>
    </div>
  </div></section>`;
}
function mpduel() {
  const mp = S.mp; if (!mp) return title();
  if (!mp.root) {
    mp.root = document.createElement('div'); mp.root.id = 'duelroot';
    const ph = Math.max(80, Math.min(150, Math.round((window.innerHeight - 700) * 0.2 + 110)));
    const portrait = frames => { frames = frames.filter(Boolean); return { frames, scale: Math.min(2.6, ph / Math.max(...frames.map(f => f[3]))) }; };
    const heroP = portrait([SPRITES.hero, SPRITES['hero-alt']]);
    const portraits = { me: heroP, foe: heroP };
    if (mp.role === 'host') {
      // The duel was already started (hands dealt) during the mulligan phase; mount without re-dealing, then tick.
      mp.api = mountDuel(mp.root, mp.duel, { onEnd: mpOnEnd, portraits, localIdx: 0, allowMulligan: false, autoStart: false });
      mp.api.run();
    } else {
      const input = guestInput(a => mp.net.relay({ k: 'input', action: a }));
      mp.api = mountDuel(mp.root, mp.mirror, { onEnd: mpOnEnd, portraits, localIdx: 1, input, allowMulligan: false, autoStart: false });
      if (mp.pendingSnap) { hydrate(mp.mirror, mp.pendingSnap, defOf, 1); mp.pendingSnap = null; }
    }
  }
  app.innerHTML = '';
  const sec = document.createElement('section'); sec.className = 'screen duelscreen'; sec.appendChild(mp.root); app.appendChild(sec);
}
// Dedicated MP event handling, isolated from the main click delegation.
document.addEventListener('click', ev => {
  const mp = S.mp;
  const jb = ev.target.closest('[data-mpjoin]'); if (jb && mp?.net) { mp.msg = ''; mp.net.join(jb.dataset.mpjoin); return; }
  if (mp && S.screen === 'mpdeck') {
    const sandbox = mpSandbox();
    const el = ev.target.closest('[data-mpadd],[data-mpaddmax],[data-mprem],[data-mpremmax]');
    if (el) {
      if (el.dataset.mpadd != null) { const n = el.dataset.mpadd; if (deckRoom(n, mp.deck, sandbox) > 0) mpEdit(d => addCards(d, n, 1)); }
      else if (el.dataset.mpaddmax != null) { const n = el.dataset.mpaddmax, room = deckRoom(n, mp.deck, sandbox); if (room > 0) mpEdit(d => addCards(d, n, room)); }
      else if (el.dataset.mprem != null) mpEdit(d => addCards(d, el.dataset.mprem, -1));
      else if (el.dataset.mpremmax != null) mpEdit(d => addCards(d, el.dataset.mpremmax, -(d[el.dataset.mpremmax] || 0)));
      return;
    }
  }
  const t = ev.target.closest('button'); if (!t || !t.id) return;
  switch (t.id) {
    case 'b-multiplayer': mpEnter(); break;
    case 'mp-connect': if (mp) { mp.name = (document.getElementById('mp-name')?.value || 'Duelist').trim() || 'Duelist'; try { localStorage.setItem('ff_mpname', mp.name); } catch {} mp.addr = (document.getElementById('mp-addr')?.value || mp.addr).trim(); mpConnect(); } break;
    case 'mp-host': mp?.net.host(`${mp.name}'s game`); break;
    case 'mp-rename': if (mp) { const n = (prompt('Your name in the lobby:', mp.name) || '').trim().slice(0, 24); if (n) { mp.name = n; try { localStorage.setItem('ff_mpname', n); } catch {} render(); } } break;
    case 'mp-refresh': mp?.net.list(); break;
    case 'mp-join': if (mp?.net) { const code = (document.getElementById('mp-code')?.value || '').trim(); if (code) { mp.msg = ''; mp.net.join(code); } } break;
    case 'mp-cancel': if (mp) { mp.net.leave(); mp.role = null; mp.room = null; mp.view = 'lobby'; mp.msg = ''; mp.net.list(); render(); } break;
    case 'mp-reroll': mpReroll(); break;
    case 'mp-clear': mpEdit(d => { for (const k of Object.keys(d)) delete d[k]; }); break;
    case 'mp-ready': mpReady(); break;
    case 'mp-quit': mpLeave(); break;
  }
});
document.addEventListener('change', ev => {
  const mp = S.mp; if (!mp) return;
  if (ev.target.name === 'mpcolor') mpSetDeck(ev.target.value, mp.deckDiff);
  else if (ev.target.id === 'mp-diff') mpSetDeck(mp.deckColor, ev.target.value);
});
document.addEventListener('input', ev => {
  if (ev.target.id === 'mp-filter') { S.mpFilter = ev.target.value; const box = ev.target.closest('.box'); const tbl = box?.querySelector('table'); if (tbl) mpdeck(); const f = document.getElementById('mp-filter'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
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
window.ff = { S, defOf, save, render, startDuel, enemyById, startTutorialDuel, riddleDefs, makeRiddle, amuletShopPool, artifactShopPool, cityPool, wardenOf, finishDuel, advanceSieges, maxSieges, collectMote, ambushFromMote, amuletPrice, tierOf, leveledEnemy, colorBombs, roamTemplate, deckRoom, copyCap, sellPrice, sellableCopies, townGold, addTownGold, sellCard, MAX_COPIES, deckProblems, addClue, clueTarget, dungeonArchetype, knownPrizes, dungeonTemplate, FIND_CLUES, relocateDungeon, enterCity, roamResult, buildStartDeck, START_POOLS };
initPreview();
load();
render();
ensureContent().then(() => { if (S.game && S.game.status === 'playing') go(S.game.dungeon ? 'dungeon' : 'map'); else render(); prefetchCatalog(); }).catch(e => { setBusy('Could not load card data: ' + e.message + ' (is the internet reachable?)'); });
