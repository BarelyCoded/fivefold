// Global game log. Every duel is recorded from start to finish — each engine log line with its turn and
// step, every action the human takes and every answer they give, the prompts they were shown, script
// errors, and moments the player flags with a note (those carry a snapshot of the whole board). Records
// go to the local server when one is running (POST api/log → logs/games.jsonl, one JSON line per game)
// and always into this browser, where the title screen can export them. The point is data: the log of
// a game where "the trigger didn't do what the card says" is what fixes the rules engine.
import { hasServer } from './collection.js';

const KEY = 'ff.gamelogs.v1';           // finished games kept in this browser
const PARTIAL = 'ff.gamelog.partial.v1'; // the game in progress, so a crash or reload still leaves a record
const UNSENT = 'ff.gamelog.unsent.v1';    // records the collector hasn't accepted yet, retried on the next load
const KEEP = 40, MAX_EVENTS = 6000, KEEP_UNSENT = 40;
// content/config.json names the collector every build reports to; a page served by server.js/relay.js also
// keeps its own copy. Loaded once, lazily; a missing file just means "same origin only".
let configP = null;
const config = () => configP ||= fetch('content/config.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
// The collector is what must accept a record; the page's own server (if any) gets a best-effort copy — on the
// static site that POST just 404s.
async function targets() { const c = await config(); const ep = (c.logEndpoint || '').trim(); const sameOrigin = 'api/log'; return { primary: ep || sameOrigin, all: [...new Set([ep, sameOrigin].filter(Boolean))] }; }
// keepalive lets a small record finish sending while the page is being closed (browsers cap that at ~64 KB).
async function post(url, rec) { try { const body = JSON.stringify(rec); const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 }); return r.ok; } catch { return false; } }
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
function savePartial() { if (!current) return; sinceSave = 0; store.set(PARTIAL, current.rec); syncPartial(); }

// Mark a record in this browser's list as delivered (or not) so the title screen and admin page can show it.
function markSent(id, ok) { const list = store.get(KEY) || []; const r = list.find(x => x.id === id); if (r) { r.sent = ok; if (ok) r.sentAt = now(); store.set(KEY, list); } }
const queueUnsent = rec => { const q = (store.get(UNSENT) || []).filter(r => r.id !== rec.id); q.push(rec); while (q.length > KEEP_UNSENT) q.shift(); store.set(UNSENT, q); };
const dequeueUnsent = id => store.set(UNSENT, (store.get(UNSENT) || []).filter(r => r.id !== id));
// Flush a finished (or abandoned) record: browser first, then the collector. The record sits in the unsent
// queue from before the POST until the collector says OK, so a tab closed mid-send still retries next visit.
async function flush(rec) {
  const list = (store.get(KEY) || []).filter(r => r.id !== rec.id); list.push({ ...rec, sent: false }); while (list.length > KEEP) list.shift(); store.set(KEY, list);
  store.del(PARTIAL);
  queueUnsent(rec);
  const t = await targets();
  let accepted = false;
  for (const url of t.all) { const ok = await post(url, rec); if (url === t.primary) accepted = ok; }
  if (accepted) { dequeueUnsent(rec.id); markSent(rec.id, true); }
}
// Send whatever the collector didn't accept last time (offline, spun-down free tier, first visit, closed tab).
export async function retryUnsent() {
  const q = store.get(UNSENT) || []; if (!q.length) return 0;
  const t = await targets(); let sent = 0;
  for (const rec of q) { if (await post(t.primary, rec)) { sent++; dequeueUnsent(rec.id); markSent(rec.id, true); } }
  return sent;
}
// The game in progress goes to the collector every so often (and when the tab is hidden), marked partial, so a
// browser that never comes back still leaves the match on record; the collector keeps the newest version.
const SYNC_EVERY = 120e3; let lastSync = 0, syncing = false;
async function syncPartial(force = false) {
  if (!current || syncing) return; if (!force && now() - lastSync < SYNC_EVERY) return;
  syncing = true; lastSync = now();
  try { const t = await targets(); await post(t.primary, { ...current.rec, partial: true }); } finally { syncing = false; }
}
function onHidden() { if (document.visibilityState === 'hidden') { savePartial(); syncPartial(true); } }
export const unsentCount = () => (store.get(UNSENT) || []).length;
// What the collector reports about itself (games held, whether its folder survives deploys), or null if unreachable.
export async function collectorStatus() { try { const t = await targets(); const r = await fetch(t.primary.replace(/\/?$/, '/status')); return r.ok ? { url: t.primary, ...(await r.json()) } : null; } catch { return null; } }

// A game left unfinished by the last session (crash, reload) becomes a record marked abandoned.
export function recoverPartial() { const rec = store.get(PARTIAL); if (rec) { rec.result = rec.result || { abandoned: true, why: 'closed' }; rec.endedAt = rec.endedAt || now(); flush(rec); } }

export function attachGameLog(duel, meta = {}) {
  if (current) detach();
  const rec = {
    id: 'g' + now().toString(36) + Math.random().toString(36).slice(2, 6), startedAt: now(), endedAt: null,
    mode: meta.mode || 'duel', meta, url: typeof location !== 'undefined' ? location.href : '', ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    players: duel.players.map(p => ({ name: p.name, ai: !!p.ai, life: p.life, deck: deckOf(p), sideboard: (p.sideboard || []).map(c => c.def.name) })),
    events: [], flags: [], errors: [], approximations: {}, result: null,
  };
  current = { duel, rec }; sinceSave = 0;
  retryUnsent().catch(() => {});   // a new game is a good moment to deliver what earlier ones couldn't
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
  if (typeof window !== 'undefined') { window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onError); window.addEventListener('beforeunload', savePartial); document.addEventListener('visibilitychange', onHidden); }
  lastSync = now(); savePartial();
  return rec.id;
}
function onError(ev) { if (!current) return; const e = ev.error || ev.reason || ev; const entry = { t: now() - current.rec.startedAt, turn: current.duel.turn, step: current.duel.step, message: String(e?.message || e), stack: String(e?.stack || '').split('\n').slice(0, 8).join('\n') }; current.rec.errors.push(entry); push({ k: 'error', message: entry.message }); savePartial(); }

// The player reports a problem — a card error, a mechanic that didn't work, something to improve — with
// the board as it stands right now. `extra` carries the category and the card they pointed at. A duel
// that isn't being recorded (a multiplayer guest's mirror) still gets its report through as a record of
// its own.
export function flagIssue(note, duel, forIdx = 0, extra = {}) {
  const d = current && (!duel || duel === current.duel) ? current.duel : duel;
  if (!d) return false;
  let board = null; try { board = d.snapshot(forIdx); } catch {}
  const flag = { t: current ? now() - current.rec.startedAt : 0, turn: d.turn, step: d.step, category: extra.category || 'other', card: extra.card || null, note, recent: d.log.slice(-12), board, stack: d.stack.map(it => it.card ? it.card.def.name : it.kind) };
  if (current && d === current.duel) { flag.recent = current.rec.events.filter(e => e.k === 'log').slice(-12).map(e => e.msg); current.rec.flags.push(flag); push({ k: 'flag', note, category: flag.category, card: flag.card }); savePartial(); }
  else flush({ id: 'r' + now().toString(36) + Math.random().toString(36).slice(2, 6), startedAt: now(), endedAt: now(), mode: 'report', meta: { standalone: true }, url: typeof location !== 'undefined' ? location.href : '', ua: typeof navigator !== 'undefined' ? navigator.userAgent : '', players: d.players.map(p => ({ name: p.name, ai: !!p.ai, life: p.life, deck: deckOf(p), sideboard: [] })), events: [], flags: [flag], errors: [], approximations: approximations(d), result: { report: true } });
  return true;
}
function finish(result) {
  if (!current) return;
  const rec = current.rec; rec.result = result; rec.endedAt = now(); rec.approximations = approximations(current.duel);
  detach(); flush(rec);
}
function detach() { if (typeof window !== 'undefined') { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onError); window.removeEventListener('beforeunload', savePartial); document.removeEventListener('visibilitychange', onHidden); } current = null; }
// A duel that ends without the engine declaring a winner (leaving the screen) is closed out here.
export function closeGameLog(reason = 'left') { if (current) finish({ abandoned: true, why: reason, turns: current.duel.turn }); }

export const currentGameLogId = () => current?.rec.id || null;
export const currentGameLog = () => current?.rec || null;   // for the console and tests
export function listGameLogs() { return store.get(KEY) || []; }
export function exportGameLogs() { return (store.get(KEY) || []).map(r => JSON.stringify(r)).join('\n') + '\n'; }
export function clearGameLogs() { store.del(KEY); }
