// Fivefold app controller: screens, world loop, persistence.
import { parseList, importNames, defOf, forgetDefs, loadArtIndex, artFor, artCount, hasOwnArt } from './collection.js';
import { fetchCards, cacheSize, cached as cachedCard } from './scryfall.js';
import { COLORS, COLOR_NAME, costString, statusLabel } from './cards.js';
import { generateWorld, drawWorld, drawMinimap, tileAt, inBounds, cityAt, linkAt, enemyAt, stepEnemies, BIOME, TILE, VIEW, placeDungeons, dungeonAt } from './world.js';
import { Duel } from './engine.js';
import { mountDuel, cardHtml } from './duelview.js';
import { aiHooks } from './ai.js';
import { initPreview, hide as hidePreview } from './preview.js';
import { generateDungeon, drawDungeon, cellAtPixel, cellOf, linked, playerCell, remainingMonsters, makeRiddle, CANVAS as DCANVAS } from './dungeon.js';
import { loadAtlas, onAtlas, SPRITES, MONSTERS, DUNGEON_MONSTER } from './atlas.js';

const SAVE_KEY = 'ff.save.v1', COLL_KEY = 'ff.collection.v1';
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
  S.dungeons = await (await fetch('content/dungeons.json')).json();
  S.shop = await (await fetch('content/shop.json')).json();
  const names = new Set(Object.values(BASICS));
  for (const n of S.shop.artifacts) names.add(n);
  for (const list of Object.values(S.shop.lands)) for (const n of list) names.add(n);
  for (const d of S.dungeons.dungeons) for (const n of d.treasure) names.add(n);
  for (const n of S.dungeons.artifacts) names.add(n);
  for (const n of Object.values(S.dungeons.walls)) names.add(n);
  for (const e of S.content.enemies) for (const n of Object.keys(e.deck)) names.add(n);
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
  S.game = {
    name: name || 'Wanderer', color, difficulty, deck, world,
    player: { x: world.start.x, y: world.start.y, life: d.life, maxLife: d.life, gold: d.gold, food: 60, day: 1, steps: 0 },
    boss: { links: 0 }, status: 'playing', wins: 0, losses: 0, cityStock: {},
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
  g.player.x = nx; g.player.y = ny; g.player.steps++;
  if (g.player.food > 0) g.player.food--;
  else if (g.player.steps % 2 === 0 && g.player.life > 1) { g.player.life--; toast('You are starving: 1 life lost. Buy food in any city.'); }
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
  const r = makeRiddle(Math.random, [...new Set(names)].map(defOf));
  if (!r) { cell.done = true; save(); render(); return; }
  S.modal = {
    title: 'A scroll, pinned to the wall',
    body: `<p class="taunt">${esc(r.q)}</p>`,
    buttons: r.options.map(o => ({ label: o, primary: false, action: () => {
      S.modal = null; cell.done = true;
      let msg;
      if (o === r.answer) { const c = rnd(tpl.treasure.filter(n => defOf(n) && defOf(n).kind !== 'unsupported')) || rnd(tpl.treasure); addCards(S.collection, c, 1); g.player.gold += 10; msg = `Correct. The scroll unrolls into ${c} and 10 gold.`; }
      else { g.player.life = Math.max(1, g.player.life - 3); msg = `Wrong: it was ${r.answer}. The scroll burns your hand for 3 life.`; }
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
  const gold = 20 + Math.floor(Math.random() * 21); g.player.gold += gold; lines.push(`${gold} gold in an old chest.`);
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
  const g = S.game; const { duel, tpl, ante, roamUid, dungeon } = S.duel; S.duel = null;
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
    ${g ? `<div class="stats"><span title="Life">♥ ${g.player.life}/${g.player.maxLife}</span><span title="Gold">◎ ${g.player.gold}</span><span title="Food" class="${g.player.food === 0 ? 'starving' : ''}">✦ ${g.player.food}${g.player.food === 0 ? ' STARVING' : ''}</span><span title="Day">Day ${g.player.day}</span><span title="Usurper's links">Links ${g.boss.links}/3</span></div>` : ''}`;
}

function render() {
  renderTop();
  const views = { title, collection, deck, map, city, duel, result, end, dungeon };
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
    <p class="lede">A generation ago a wandering mage with a weak deck broke five corrupt guilds and drove a planeswalker back beyond the barrier. The barrier healed crooked. Mana pools and drains in tides now, the five Orders hoard the links that pin the cracks shut, and something that came through before the seal closed has spent thirty years whispering to their Wardens. The old Wanderer is dying. The letter, and the title, are yours.</p>
    <p class="lede small">Walk a world where geography is color. Duel the mages who roam it with the cards you actually own. Wager cards you cannot buy back. Find which Warden the Usurper is wearing before the Sealing completes.</p>
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
      ${rows.length ? `<table class="coll"><tr><th></th><th>Card</th><th>Qty</th><th>Type</th><th>Cost</th><th>Art</th><th>Status</th><th>Notes</th><th></th></tr>
      ${rows.map(r => { const raw = r.d ? cachedCard(r.n) : null; const art = r.d && hasOwnArt(r.d) ? 'yours' : raw?.art_set ? `${raw.art_set.toUpperCase()} ${raw.art_year || ''}` : ''; return `<tr class="st-${r.d ? r.d.status : 'missing'}"><td class="thumb">${r.d ? `<div class="mini${hasOwnArt(r.d) ? ' own' : ''}" data-preview="${esc(r.n)}" style="${artFor(r.d) ? `background-image:url('${artFor(r.d)}')` : ''}"></div>` : ''}</td><td data-preview="${esc(r.n)}">${esc(r.n)}</td><td>${r.q}</td><td>${esc(r.d?.typeLine || '')}</td><td>${r.d && r.d.kind !== 'land' ? esc(costString(r.d.cost)) : ''}</td><td class="small">${esc(art)}</td><td>${statusLabel(r.d)}</td><td class="notes">${esc((r.d?.notes || []).join('; '))}</td><td><button class="btn tiny" data-dec="${esc(r.n)}">−1</button></td></tr>`; }).join('')}</table>` : '<p class="small">Nothing here yet. Import a list above, or start a new journey to receive a starter deck.</p>'}
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
      <canvas id="minimap" class="minimap"></canvas>
      <h2>${esc(g.name)}</h2>
      <p>Standing in the <b>${BIOME[here].name}</b> (${COLOR_NAME[here]}). ${near.length ? `<br>${near.map(e => enemyById(e.template).name).join(', ')} nearby.` : ''}</p>
      <p class="small">Move with WASD or the arrow keys, or click a neighbouring tile. Walking costs food. Blue crystals are mana links (+2 life). Pits with a torch are dungeons: revealed by clues from beaten foes, fought room by room with your life carried over. The dark fortress is the Usurper.</p>
      ${(g.world.dungeons || []).some(d => d.revealed) ? `<p class="small">Known dungeons: ${g.world.dungeons.filter(d => d.revealed).map(d => `${dungeonTemplate(d.id).name}${d.cleared ? ' (cleared)' : ''}`).join(', ')}.</p>` : ''}
      <div class="btnrow"><button class="btn" id="b-rest" ${g.player.food < 3 || g.player.life >= g.player.maxLife ? 'disabled' : ''}>Rest (3 food, +5 life)</button><button class="btn ghost" data-go="title">Menu</button></div>
      <h3>Legend</h3>
      <div class="legend">${COLORS.map(c => `<span><i class="sw" style="background:${BIOME[c].fill}"></i>${BIOME[c].name}</span>`).join('')}</div>
    </aside>
  </section>`;
  const canvas = document.getElementById('map');
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
    </div>
  </section>`;
}

function duel() {
  const d = S.duel;
  // Mount once per duel; a re-render (toast, stats) must not restart the game.
  if (!d.root) {
    d.root = document.createElement('div'); d.root.id = 'duelroot';
    const portrait = frames => { frames = frames.filter(Boolean); return { frames, scale: Math.min(2.6, 170 / Math.max(...frames.map(f => f[3]))) }; };
    const mageFrames = (color, tier) => { const c = SPRITES.mage[color] ? color : 'M'; return [SPRITES.mage[c][tier >= 2 ? 1 : 0], SPRITES[`mage-${c}-${tier >= 2 ? 2 : 1}-alt`]]; };
    const foe = d.tpl.boss ? portrait(MONSTERS.dragon.idle) : d.dungeon ? portrait(MONSTERS[DUNGEON_MONSTER[d.tpl.color] || 'skeleton'].idle) : portrait(mageFrames(d.tpl.color, d.tpl.tier));
    mountDuel(d.root, d.duel, { ante: d.ante ? { mine: d.ante.mine || '—', theirs: d.ante.theirs || '—' } : null, onEnd: finishDuel, portraits: { me: portrait([SPRITES.hero, SPRITES['hero-alt']]), foe } });
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
    <p>${g.status === 'won' ? `${esc(g.name)} unbinds the mana links on day ${g.player.day} after ${g.wins} victories. The plane is free, for now.` : `On day ${g.player.day} the Usurper binds the third link. The world dims. Your collection survives; your journey does not.`}</p>
    <button class="btn primary" id="b-newgame">Start a new journey</button>
  </div></section>`;
}

// ---- events -----------------------------------------------------------------------
app.addEventListener('submit', ev => {
  if (ev.target.id === 'newgame') { ev.preventDefault(); const f = new FormData(ev.target); newGame({ name: f.get('name').trim(), color: f.get('color'), difficulty: f.get('difficulty') }); }
});
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-go],[data-modal],[data-filter],[data-add],[data-rem],[data-dec],[data-buy],#b-import,#b-csv,#b-rescan,#b-clear-coll,#b-fill,#b-rest,#b-inn,#b-food,#b-leave,#b-newgame,#b-dleave');
  if (!t) return;
  const g = S.game;
  if (t.dataset.go) { if (!t.disabled) { if (t.dataset.go === 'map' && g?.status !== 'playing' && g) go('end'); else if (t.dataset.go === 'dungeon' && !currentDungeon()) go('map'); else go(t.dataset.go); } return; }
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
    case 'b-food': if (g.player.gold >= 2) { g.player.gold -= 2; g.player.food += 20; save(); render(); } break;
    case 'b-leave': go('map'); break;
    case 'b-newgame': S.game = null; save(); go('title'); break;
    case 'b-dleave': dungeonExitPrompt(false); break;
  }
});
document.addEventListener('input', ev => { if (ev.target.id === 'dfilter') { S.deckFilter = ev.target.value; deck(); document.getElementById('dfilter').focus(); const el = document.getElementById('dfilter'); el.setSelectionRange(el.value.length, el.value.length); } });
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
window.ff = { S, defOf, save, render, startDuel, enemyById };
initPreview();
load();
render();
ensureContent().then(() => { if (S.game && S.game.status === 'playing') go(S.game.dungeon ? 'dungeon' : 'map'); else render(); }).catch(e => { setBusy('Could not load card data: ' + e.message + ' (is the internet reachable?)'); });
