// Global game log. Every duel is recorded from start to finish — each engine log line with its turn and
// step, every action the human takes and every answer they give, the prompts they were shown, script
// errors, and moments the player flags with a note (those carry a snapshot of the whole board). Records
// go to the local server when one is running (POST api/log → logs/games.jsonl, one JSON line per game)
// and always into this browser, where the title screen can export them. The point is data: the log of
// a game where "the trigger didn't do what the card says" is what fixes the rules engine.
import { hasServer } from './collection.js';

const KEY = 'ff.gamelogs.v1';           // finished games kept in this browser
const PARTIAL = 'ff.gamelog.partial.v1'; // the game in progress, so a crash or reload still leaves a record
const KEEP = 40, MAX_EVENTS = 6000;
let current = null, unlisten = null, sinceSave = 0;
const now = () => Date.now();
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };

// Card names on both sides (library, hand, sideboard) as {name: count}: the decks as they were dealt.
function deckOf(p) { const m = {}; for (const c of [...p.library, ...p.hand, ...p.battlefield]) m[c.def.name] = (m[c.def.name] || 0) + 1; return m; }
// Every card the game touched whose rules are approximated: the engine's own notes about them.
function approximations(duel) {
  const out = {};
  for (const p of duel.players) for (const c of [...p.library, ...p.hand, ...p.battlefield, ...p.graveyard, ...p.exile, ...(p.sideboard || [])]) {
    const d = c.def; if (!d || out[d.name]) continue;
    if (d.status !== 'full' || (d.notes && d.notes.length)) out[d.name] = { status: d.status, notes: d.notes || [] };
  }
  return out;
}
const refLabel = (duel, r) => !r ? null : r.type === 'player' ? duel.players[r.idx]?.name : (duel.card(r.id)?.def.name || `#${r.id}`) + (r.type === 'card' ? ' (graveyard)' : r.type === 'spell' ? ' (stack)' : '');
const describeOpts = (duel, o) => { if (!o) return null; const out = {}; for (const [k, v] of Object.entries(o)) { if (k === 'targets') out.targets = (v || []).map(r => refLabel(duel, r)); else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = '…'; else out[k] = v; } return out; };

function push(ev) {
  if (!current) return;
  const d = current.duel;
  current.rec.events.push({ t: now() - current.rec.startedAt, turn: d.turn, step: d.step, ...ev });
  if (current.rec.events.length > MAX_EVENTS) { current.rec.events.splice(0, 500); current.rec.truncated = true; }
  if (++sinceSave >= 25) savePartial(); else scheduleSave();
}
let saveTimer = null;
function scheduleSave() { if (saveTimer) return; saveTimer = setTimeout(() => { saveTimer = null; savePartial(); }, 1000); }
function savePartial() { if (!current) return; sinceSave = 0; store.set(PARTIAL, current.rec); }

// Flush a finished (or abandoned) record: browser first, then the server if there is one.
async function flush(rec) {
  const list = store.get(KEY) || []; list.push(rec); while (list.length > KEEP) list.shift(); store.set(KEY, list);
  store.del(PARTIAL);
  // Try the server whether or not it has announced itself: on the static site this 404s harmlessly.
  try { const r = await fetch('api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) }); if (!r.ok && hasServer()) console.warn('game log not stored by the server', r.status); } catch (e) { if (hasServer()) console.warn('game log not sent', e); }
}

// A game left unfinished by the last session (crash, reload) becomes a record marked abandoned.
export function recoverPartial() { const rec = store.get(PARTIAL); if (rec) { rec.result = rec.result || { abandoned: true }; rec.endedAt = rec.endedAt || now(); flush(rec); } }

export function attachGameLog(duel, meta = {}) {
  if (current) detach();
  const rec = {
    id: 'g' + now().toString(36) + Math.random().toString(36).slice(2, 6), startedAt: now(), endedAt: null,
    mode: meta.mode || 'duel', meta, url: typeof location !== 'undefined' ? location.href : '', ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    players: duel.players.map(p => ({ name: p.name, ai: !!p.ai, life: p.life, deck: deckOf(p), sideboard: (p.sideboard || []).map(c => c.def.name) })),
    events: [], flags: [], errors: [], approximations: {}, result: null,
  };
  current = { duel, rec }; sinceSave = 0;
  // engine narration, with the turn and step it happened in
  const say = duel.say.bind(duel); duel.say = msg => { say(msg); push({ k: 'log', msg }); };
  // the human's actions (what the engine accepted or refused)
  for (const [name, fn] of [['castFor', 'cast'], ['activateFor', 'activate'], ['manaFor', 'mana'], ['passFor', 'pass'], ['concedeFor', 'concede']]) {
    const orig = duel[name]; if (typeof orig !== 'function') continue;
    duel[name] = function (idx, card, ...rest) { const ok = orig.call(this, idx, card, ...rest); if (!this.players[idx]?.ai) push({ k: 'act', a: fn, by: idx, card: card && card.def ? card.def.name : undefined, opts: describeOpts(this, fn === 'activate' ? rest[1] : rest[0]), index: fn === 'activate' ? rest[0] : undefined, ok: !!ok }); return ok; };
  }
  const answer = duel.answerFor; duel.answerFor = function (idx, value) { const req = this.pending?.req; const ok = answer.call(this, idx, value); push({ k: 'answer', by: idx, kind: req?.kind, value: Array.isArray(value) ? value.map(id => this.card(id)?.def.name || id) : (value && typeof value === 'object' ? refLabel(this, value) : value), ok: !!ok }); return ok; };
  // prompts shown to the human
  let lastReq = null;
  unlisten = () => {};
  duel.onChange(() => { const req = duel.pending?.type === 'request' ? duel.pending.req : null; if (req && req !== lastReq && !duel.players[req.player]?.ai) { lastReq = req; push({ k: 'req', kind: req.kind, text: req.text, options: (req.options || []).slice(0, 40).map(o => o.label ?? o) }); } });
  const end = duel.end.bind(duel); duel.end = (winner, why) => { end(winner, why); finish({ winner, winnerName: duel.players[winner]?.name, why, turns: duel.turn }); };
  if (typeof window !== 'undefined') { window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onError); window.addEventListener('beforeunload', savePartial); }
  savePartial();
  return rec.id;
}
function onError(ev) { if (!current) return; const e = ev.error || ev.reason || ev; const entry = { t: now() - current.rec.startedAt, turn: current.duel.turn, step: current.duel.step, message: String(e?.message || e), stack: String(e?.stack || '').split('\n').slice(0, 8).join('\n') }; current.rec.errors.push(entry); push({ k: 'error', message: entry.message }); savePartial(); }

// The player says something went wrong: keep their note with the board as it stands right now.
export function flagIssue(note, duel, forIdx = 0) {
  if (!current || (duel && duel !== current.duel)) return false;
  const d = current.duel;
  let board = null; try { board = d.snapshot(forIdx); } catch {}
  const recent = current.rec.events.filter(e => e.k === 'log').slice(-12).map(e => e.msg);
  current.rec.flags.push({ t: now() - current.rec.startedAt, turn: d.turn, step: d.step, note, recent, board, stack: d.stack.map(it => it.card ? it.card.def.name : it.kind) });
  push({ k: 'flag', note }); savePartial();
  return true;
}
function finish(result) {
  if (!current) return;
  const rec = current.rec; rec.result = result; rec.endedAt = now(); rec.approximations = approximations(current.duel);
  detach(); flush(rec);
}
function detach() { if (typeof window !== 'undefined') { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onError); window.removeEventListener('beforeunload', savePartial); } current = null; }
// A duel that ends without the engine declaring a winner (leaving the screen) is closed out here.
export function closeGameLog(reason = 'left') { if (current) finish({ abandoned: true, why: reason, turns: current.duel.turn }); }

export const currentGameLogId = () => current?.rec.id || null;
export const currentGameLog = () => current?.rec || null;   // for the console and tests
export function listGameLogs() { return store.get(KEY) || []; }
export function exportGameLogs() { return (store.get(KEY) || []).map(r => JSON.stringify(r)).join('\n') + '\n'; }
export function clearGameLogs() { store.del(KEY); }
