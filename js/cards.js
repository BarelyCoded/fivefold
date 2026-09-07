// Card compiler: turns Scryfall card JSON into a definition the demo engine understands.
//
// This is deliberately a small vocabulary. Anything it does not understand is
// either approximated (creature abilities ignored, extra sentences ignored) or
// marked unsupported. The real project replaces this whole file with a full
// rules engine behind the same interface.

export const COLORS = ['W', 'U', 'B', 'R', 'G'];
export const COLOR_NAME = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Five-color' };
const BASIC = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };
export const KEYWORDS = new Set(['Flying', 'First strike', 'Double strike', 'Trample', 'Haste',
  'Vigilance', 'Deathtouch', 'Lifelink', 'Reach', 'Defender', 'Menace']);

export function slug(name) {
  return String(name).toLowerCase().split(' // ')[0]
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parseCost(mc) {
  const pips = []; let generic = 0, x = false;
  for (const m of (mc || '').matchAll(/\{([^}]+)\}/g)) {
    const s = m[1];
    if (/^\d+$/.test(s)) generic += Number(s);
    else if (s === 'X' || s === 'Y') x = true;
    else if (s === 'C') pips.push(['C']);
    else if (s === 'S') pips.push(['C']);
    else {
      const parts = s.split('/');
      const cols = parts.filter(t => COLORS.includes(t));
      if (parts[0] && /^\d+$/.test(parts[0])) generic += Number(parts[0]); // {2/W}: pay generic
      else if (cols.length) pips.push(cols);
      else x = true;
    }
  }
  return { pips, generic, x };
}

export function costString(cost) {
  const parts = [];
  if (cost.generic) parts.push(String(cost.generic));
  for (const p of cost.pips) parts.push(p.join('/'));
  return parts.join('') || '0';
}

const MANA_RE = /\{T\}: Add ((?:\{[WUBRGC]\}(?:, | or |, or )?)+)/g;
function manaFrom(oracle) {
  const out = new Set();
  for (const m of oracle.matchAll(MANA_RE)) for (const p of m[1].matchAll(/\{([WUBRGC])\}/g)) out.add(p[1]);
  if (/\{T\}: Add one mana of any color/i.test(oracle)) COLORS.forEach(c => out.add(c));
  return out;
}

export function compile(c) {
  if (!c) return null;
  const notes = [];
  const types = (c.type_line || '').toLowerCase();
  const oracle = (c.oracle_text || '').replace(/\([^)]*\)/g, '').replace(/−/g, '-').trim();
  const base = {
    name: c.name, id: c.id, image: c.image, set: c.set, typeLine: c.type_line,
    oracle: c.oracle_text || '', colors: c.colors || [], cmc: c.cmc || 0,
    cost: parseCost(c.mana_cost || ''), notes,
  };
  const unsupported = why => ({ ...base, kind: 'unsupported', status: 'unsupported', notes: [why] });
  const status = () => (notes.length ? 'approx' : 'full');

  if (types.includes('land')) {
    const produces = new Set();
    for (const [t, col] of Object.entries(BASIC)) if (types.includes(t)) produces.add(col);
    for (const m of manaFrom(oracle)) produces.add(m);
    if (!produces.size) return unsupported('Land with no recognisable mana ability');
    const entersTapped = /enters(?: the battlefield)? tapped/i.test(oracle);
    for (const line of oracle.split('\n').map(s => s.trim()).filter(Boolean)) {
      if (/^\{T\}: Add/i.test(line) || /enters(?: the battlefield)? tapped/i.test(line)) continue;
      notes.push('Ignored: ' + line.slice(0, 70));
    }
    return { ...base, kind: 'land', basic: types.includes('basic'), produces: [...produces], entersTapped, status: status() };
  }

  if (base.cost.x) return unsupported('X costs are not supported yet');

  if (types.includes('creature')) {
    const p = parseInt(c.power, 10), t = parseInt(c.toughness, 10);
    if (!Number.isFinite(p) || !Number.isFinite(t)) return unsupported('Variable power or toughness');
    const keywords = new Set();
    for (const k of c.keywords || []) { if (KEYWORDS.has(k)) keywords.add(k); else notes.push(`${k} ignored`); }
    const produces = manaFrom(oracle);
    for (const line of oracle.split('\n').map(s => s.trim()).filter(Boolean)) {
      if (/^\{T\}: Add/i.test(line)) continue;
      const words = line.replace(/\.$/, '').split(/[,;]\s*/).map(w => w.charAt(0).toUpperCase() + w.slice(1));
      if (words.every(w => KEYWORDS.has(w) || (c.keywords || []).includes(w))) continue;
      notes.push('Ignored: ' + line.slice(0, 70));
    }
    return { ...base, kind: 'creature', power: p, toughness: t, keywords: [...keywords], produces: [...produces], status: status() };
  }

  if (types.includes('instant') || types.includes('sorcery')) {
    const effects = [];
    const sentences = oracle.split(/\n|(?<=\.)\s+/).map(s => s.trim()).filter(Boolean);
    for (const s of sentences) {
      const e = parseSentence(s, c.name);
      if (e) effects.push(...e); else notes.push('Ignored: ' + s.slice(0, 70));
    }
    if (!effects.length) return unsupported('No recognisable effect');
    return { ...base, kind: 'spell', timing: types.includes('instant') ? 'instant' : 'sorcery', effects, status: status() };
  }

  return unsupported(`${c.type_line} is not supported yet`);
}

// ---- Oracle sentence parsing -------------------------------------------------

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const num = w => NUM[w] ?? parseInt(w, 10);

function restrictions(phrase) {
  const r = {};
  const nots = phrase.match(/non(white|blue|black|red|green|artifact)/g);
  if (nots) r.not = nots.map(x => x.slice(3));
  const st = phrase.match(/target (attacking|blocking|tapped|untapped) creature/);
  if (st) r.state = st[1];
  return r;
}

function targetKind(phrase) {
  phrase = phrase.toLowerCase();
  if (/any target|creature or player|creature or planeswalker|creature, player, or planeswalker/.test(phrase)) return { sel: 'any' };
  if (/target player or planeswalker|target player\b/.test(phrase)) return { sel: 'player' };
  if (/target opponent/.test(phrase)) return { sel: 'opponent' };
  if (/each creature|all creatures/.test(phrase)) return { sel: 'eachCreature' };
  if (/each opponent/.test(phrase)) return { sel: 'opponent', auto: true };
  if (/each player/.test(phrase)) return { sel: 'eachPlayer' };
  if (/target (?:[\w-]+,? )*creature/.test(phrase)) return { sel: 'creature', restrict: restrictions(phrase) };
  return null;
}

function parseSentence(sentence, cardName) {
  const self = esc(cardName.split(' // ')[0]);
  const t = sentence.replace(new RegExp(self, 'g'), '~').toLowerCase().replace(/\.$/, '').trim();
  const one = parseClause(t);
  if (one) return one;
  // "X deals 3 damage to any target and you gain 3 life"
  if (t.includes(' and ')) {
    const parts = t.split(/ and (?=you |target |~ )/);
    if (parts.length > 1) {
      const all = parts.map(parseClause);
      if (all.every(Boolean)) return all.flat();
    }
  }
  return null;
}

function parseClause(t) {
  let m;
  if ((m = t.match(/^(?:~|this spell) deals (\d+) damage to (.+)$/))) {
    const k = targetKind(m[2]); return k ? [{ type: 'damage', amount: Number(m[1]), ...k }] : null;
  }
  if ((m = t.match(/^destroy (target .+)$/))) {
    if (/target land/.test(m[1])) return [{ type: 'destroyLand' }];
    const k = targetKind(m[1]); return k && k.sel === 'creature' ? [{ type: 'destroy', ...k }] : null;
  }
  if ((m = t.match(/^exile (target .+)$/))) {
    const k = targetKind(m[1]); return k && k.sel === 'creature' ? [{ type: 'exile', ...k }] : null;
  }
  if ((m = t.match(/^(target .+?) gets ([+-]\d+)\/([+-]\d+) until end of turn(?: and gains (.+?) until end of turn)?$/))) {
    const k = targetKind(m[1]); if (!k || k.sel !== 'creature') return null;
    const e = [{ type: 'pump', p: Number(m[2]), t: Number(m[3]), ...k }];
    if (m[4]) e.push({ type: 'grant', keyword: cap(m[4]), ...k });
    return e;
  }
  if ((m = t.match(/^(target .+?) gains (.+?) until end of turn$/))) {
    const k = targetKind(m[1]); if (!k || k.sel !== 'creature') return null;
    const kw = cap(m[2]); return KEYWORDS.has(kw) ? [{ type: 'grant', keyword: kw, ...k }] : null;
  }
  if ((m = t.match(/^(?:you )?draw (a|an|two|three|four|\d+) cards?$/))) return [{ type: 'draw', amount: num(m[1]) }];
  if ((m = t.match(/^target player draws (a|two|three|\d+) cards?$/))) return [{ type: 'draw', amount: num(m[1]) }];
  if ((m = t.match(/^(?:you )?gain (\d+) life$/))) return [{ type: 'gain', amount: Number(m[1]) }];
  if ((m = t.match(/^return (target .+?) to its owner's hand$/))) {
    const k = targetKind(m[1]); return k && k.sel === 'creature' ? [{ type: 'bounce', ...k }] : null;
  }
  if (/^return target creature card from your graveyard to your hand$/.test(t)) return [{ type: 'regrowth' }];
  if (/^it can't be regenerated$/.test(t)) return [];
  return null;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

export function needsTarget(effect) {
  return ['any', 'creature', 'player', 'opponent'].includes(effect.sel) && !effect.auto;
}

export function statusLabel(def) {
  if (!def) return 'not found';
  return { full: 'ready', approx: 'approximated', unsupported: 'unsupported' }[def.status] || def.status;
}
