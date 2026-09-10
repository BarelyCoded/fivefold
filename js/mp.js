// Fivefold multiplayer glue. The host runs the authoritative Duel and streams redacted snapshots; the
// guest keeps a render-only "mirror" Duel it never ticks — this file rebuilds that mirror from each
// snapshot (hydrate) and serialises the guest's inputs back to the host.
//
// hydrate(mirror, snap, defOf, localIdx) mutates `mirror` in place (preserving its identity so a mounted
// view keeps working) to match the snapshot as `localIdx` may see it, then refresh()es and emit()s it.

import { Duel } from './engine.js';

// A minimal, render-safe stand-in for a face-down card (opponent hand / either library): it only ever
// needs to occupy a slot for counts — its contents are never shown.
export const FACE_DOWN = {
  name: '', types: [], subtypes: [], supertypes: [], keywords: [], abilities: [], manaAbilities: [],
  colors: [], cost: { pips: [], generic: 0, x: false }, cmc: 0, kind: 'unknown', isPermanent: false,
  oracle: '', typeLine: '', image: null, id: 'facedown',
};

// Build the empty mirror once; hydrate() fills it from each snapshot. Decks are placeholders (never used).
export function makeMirror(names = { me: 'You', foe: 'Opponent' }) {
  const stub = { name: names.me, deck: [FACE_DOWN], life: 20, ai: false };
  const stub2 = { name: names.foe, deck: [FACE_DOWN], life: 20, ai: false };
  const m = new Duel({ player: stub, ai: stub2, hooks: null });
  m.isMirror = true;
  return m;
}

function mkCard(mirror, sc, defOf) {
  const def = sc.hidden ? FACE_DOWN : (defOf(sc.name) || FACE_DOWN);
  const c = mirror.instance(def, sc.owner ?? 0);
  c.id = sc.id;
  if (!sc.hidden) {
    c.controller = sc.controller; c.tapped = !!sc.tapped; c.sick = !!sc.sick; c.damage = sc.damage | 0; c.token = !!sc.token;
    c.counters = { ...sc.counters }; c.temp = { p: sc.temp.p | 0, t: sc.temp.t | 0, kw: [...sc.temp.kw], flags: [...sc.temp.flags] };
    c.flags = new Set(sc.flags); c.regen = sc.regen | 0; c.shield = sc.shield | 0; c.chosenColor = sc.chosenColor || null;
    c._attachId = sc.attachedTo;
  }
  return c;
}

// Rebuild `mirror` in place from a snapshot. localIdx is which player this client is (0 host / 1 guest),
// so pending is only surfaced when it is genuinely this client's action to take.
export function hydrate(mirror, snap, defOf, localIdx) {
  mirror.turn = snap.turn; mirror.active = snap.active; mirror.priority = snap.priority; mirror.step = snap.step;
  mirror.stepIndex = snap.stepIndex; mirror.firstPlayer = snap.firstPlayer; mirror.winner = snap.winner;
  mirror.fog = snap.fog; mirror.extraTurns = snap.extraTurns;
  mirror.attackers = [...snap.attackers];
  mirror.blocks = Object.fromEntries(Object.entries(snap.blocks).map(([k, v]) => [k, [...v]]));
  mirror.log = snap.log.slice();
  mirror.fx = (snap.fx || []).map(f => ({ ...f }));
  const byId = new Map();
  for (const sp of snap.players) {
    const P = mirror.players[sp.idx];
    P.name = sp.name; P.life = sp.life; P.poison = sp.poison; P.landPlayed = sp.landPlayed;
    P.pool = { ...sp.pool }; P.shield = sp.shield | 0; P.cop = [...sp.cop]; P.ai = !!sp.ai;
    const zone = (list, z) => list.map(sc => { const c = mkCard(mirror, sc, defOf); c.zone = z; byId.set(c.id, c); return c; });
    P.battlefield = zone(sp.battlefield, 'battlefield');
    P.graveyard = zone(sp.graveyard, 'graveyard');
    P.exile = zone(sp.exile, 'exile');
    P.hand = zone(sp.hand, 'hand');
    // Only the count of a library/opponent-hand is known: fill with distinct face-down placeholders.
    P.library = Array.from({ length: sp.libraryCount }, (_, k) => { const c = mirror.instance(FACE_DOWN, sp.idx); c.id = `lib${sp.idx}_${k}`; c.zone = 'library'; return c; });
  }
  for (const c of byId.values()) if (c._attachId != null) { c.attachedTo = byId.get(c._attachId) || null; delete c._attachId; }
  // Stack items just need a name + controller to render.
  mirror.stack = (snap.stack || []).map(s => ({ id: s.id, kind: s.kind, controller: s.controller, targets: s.targets || [], card: byId.get(s.id) || { id: s.id, def: { ...FACE_DOWN, name: s.name || 'ability', types: [] }, controller: s.controller } }));
  // Surface pending only when it is this client's move; otherwise the board is passive ("opponent acting").
  mirror.pending = null; mirror.mpWaitingOn = null;
  if (snap.pending) {
    if (snap.pending.type === 'priority') {
      if (snap.pending.player === localIdx) mirror.pending = { type: 'priority' };
      else mirror.mpWaitingOn = snap.pending.player;
    } else if (snap.pending.type === 'request') {
      if (snap.pending.req && (snap.pending.req.player === localIdx)) mirror.pending = { type: 'request', req: snap.pending.req, job: { answer: undefined } };
      else mirror.mpWaitingOn = snap.pending.player;
    }
  }
  mirror.refresh();
  mirror.emit();
  return mirror;
}

// The guest's input adapter: instead of mutating the local mirror, serialise each action (cards -> ids)
// and hand it to `send`, which relays it to the host. Returns the object mountDuel expects as `input`.
export function guestInput(send) {
  const cid = c => (c && c.id != null ? c.id : c);
  return {
    pass: () => { send({ type: 'pass' }); return true; },
    endTurn: () => { send({ type: 'endTurn' }); return true; },
    cast: (card, opts) => { send({ type: 'cast', card: cid(card), opts: opts || {} }); return true; },
    activate: (card, i, opts) => { send({ type: 'activate', card: cid(card), index: i, opts: opts || {} }); return true; },
    mana: (card, i, color) => { send({ type: 'mana', card: cid(card), index: i, color }); return true; },
    answer: value => { send({ type: 'answer', value }); return true; },
    mulligan: () => { send({ type: 'mulligan' }); return true; },
    concede: () => { send({ type: 'concede' }); return true; },
  };
}

// Host side: apply a remote (guest = player 1) action to the authoritative duel. Resolves card ids to
// objects. Returns true if the action was accepted. Illegal/out-of-turn actions are safely rejected.
export function applyRemoteInput(duel, action, idx = 1) {
  const card = action.card != null ? duel.card(action.card) : null;
  switch (action.type) {
    case 'pass': return duel.passFor(idx);
    case 'endTurn': return duel.endTurnFor(idx);
    case 'cast': return card ? duel.castFor(idx, card, action.opts || {}) : false;
    case 'activate': return card ? duel.activateFor(idx, card, action.index, action.opts || {}) : false;
    case 'mana': return card ? duel.manaFor(idx, card, action.index, action.color) : false;
    case 'answer': return duel.answerFor(idx, action.value);
    case 'mulligan': return false;   // handled specially before the game proper (see mp match runner)
    default: return false;
  }
}
