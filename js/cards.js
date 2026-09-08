// Card compiler v2: turns Scryfall card JSON into an engine definition.
// Target era: Alpha through Alliances, using current Oracle text.
// Anything not understood is either approximated (with notes) or marked unsupported.

export const COLORS = ['W', 'U', 'B', 'R', 'G'];
export const COLOR_NAME = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Five-color' };
const COLOR_WORD = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const BASIC = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };

// Keywords the engine implements directly.
export const KEYWORDS = new Set(['Flying', 'First strike', 'Double strike', 'Trample', 'Haste', 'Vigilance', 'Deathtouch',
  'Lifelink', 'Reach', 'Defender', 'Menace', 'Flash', 'Indestructible', 'Hexproof', 'Shroud', 'Fear', 'Intimidate',
  'Shadow', 'Horsemanship', 'Flanking', 'Prowess', 'Exalted', 'Wither', 'Infect', 'Undying', 'Persist', 'Changeling']);
// Keywords we deliberately ignore (card still plays, marked approximated).
const IGNORED_KW = new Set(['Banding', 'Phasing', 'Bushido', 'Provoke', 'Soulshift', 'Ninjutsu', 'Convoke', 'Affinity',
  'Split second', 'Madness', 'Fading', 'Vanishing', 'Devoid', 'Ingest', 'Cohort', 'Skulk', 'Renown', 'Outlast', 'Dash', 'Delve', 'Awaken',
  'Rebound', 'Battle cry', 'Living weapon', 'Totem armor', 'Annihilator', 'Level up', 'Unearth', 'Retrace', 'Exert', 'Afflict', 'Embalm',
  'Eternalize', 'Improvise', 'Fabricate', 'Partner', 'Melee', 'Escalate', 'Emerge', 'Escape', 'Mutate', 'Companion', 'Landfall', 'Hellbent', 'Threshold']);
// Keywords that break the game if ignored.
const UNSUPPORTED_KW = new Set(['Storm', 'Suspend', 'Morph', 'Megamorph', 'Cascade', 'Dredge', 'Transmute', 'Ripple', 'Epic', 'Haunt',
  'Forecast', 'Graft', 'Hideaway', 'Champion', 'Evoke', 'Conspire', 'Devour', 'Crew', 'Amass', 'Adapt', 'Riot', 'Spectacle']);

export function slug(name) {
  return String(name).toLowerCase().split(' // ')[0].replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parseCost(mc) {
  const pips = []; let generic = 0, x = false;
  for (const m of (mc || '').matchAll(/\{([^}]+)\}/g)) {
    const s = m[1];
    if (/^\d+$/.test(s)) generic += Number(s);
    else if (s === 'X' || s === 'Y' || s === 'Z') x = true;
    else if (s === 'C' || s === 'S') pips.push(['C']);
    else {
      const parts = s.split('/');
      const cols = parts.filter(t => COLORS.includes(t));
      if (parts[0] && /^\d+$/.test(parts[0])) generic += Number(parts[0]);
      else if (cols.length) pips.push(cols);
      else x = true;
    }
  }
  return { pips, generic, x };
}
export function costString(cost) {
  if (!cost) return '';
  const parts = [];
  if (cost.x) parts.push('X');
  if (cost.generic) parts.push(String(cost.generic));
  for (const p of cost.pips || []) parts.push(p.join('/'));
  return parts.join('') || (cost.pips ? '0' : '');
}
export const cmcOf = cost => (cost.generic || 0) + (cost.pips || []).length;

// ---- helpers --------------------------------------------------------------------
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const AMT = '(\\d+|x|a|an|one|two|three|four|five|six|seven|eight|nine|ten)';
const amt = w => (w === 'x' ? 'X' : (NUM[w] ?? Number(w)));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseTypeLine(tl) {
  const [left, right] = (tl || '').split('—').map(s => s.trim());
  const words = left.split(/\s+/).filter(Boolean);
  const supertypes = words.filter(w => ['Legendary', 'Basic', 'Snow', 'World'].includes(w));
  const types = words.filter(w => ['Land', 'Creature', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Planeswalker', 'Tribal', 'Battle'].includes(w));
  const subtypes = right ? right.split(/\s+/).filter(Boolean) : [];
  return { supertypes, types, subtypes };
}

function kwDisplay(k) { return typeof k === 'string' ? k : k.k + (k.from ? ' from ' + k.from : '') + (k.land ? ' (' + k.land + ')' : ''); }

// Parse a target phrase like "target nonblack creature you control". Returns {sel, restrict} or null.
export function parseTarget(phrase) {
  let p = phrase.trim().toLowerCase().replace(/\.$/, '');
  const r = {};
  if (p === 'any target' || /^target (creature or player|creature, player, or planeswalker|creature or planeswalker|player or planeswalker)$/.test(p)) return { sel: p.includes('player or planeswalker') && !p.includes('creature') ? 'player' : 'any', restrict: r };
  if (p === 'you' || p === 'yourself') return { sel: 'you', restrict: r };
  if (p === '~' || p === 'it') return { sel: 'self', restrict: r };
  if (p === 'that player' || p === "that player's") return { sel: 'thatPlayer', restrict: r };
  if (/^(that creature|that permanent|it|them|that card|the creature)$/.test(p)) return { sel: 'prev', restrict: r };
  if (/^enchanted (creature|permanent|land|artifact)$/.test(p)) return { sel: 'enchanted', restrict: r };
  if (/^equipped creature$/.test(p)) return { sel: 'enchanted', restrict: r };
  if (p === 'target opponent') return { sel: 'opponent', restrict: r };
  if (p === 'target player') return { sel: 'player', restrict: r };
  if (p === 'each player' || p === 'all players') return { sel: 'each', restrict: { players: 'all' } };
  if (p === 'each opponent') return { sel: 'each', restrict: { players: 'opp' } };
  let m;
  if ((m = p.match(/^target (.*?)\s*spell$/))) {
    const words = m[1].trim().split(/\s+/).filter(Boolean);
    const rr = { spellKind: 'spell' };
    for (const w of words) {
      if (COLOR_WORD[w]) (rr.colors ||= []).push(COLOR_WORD[w]);
      else if (/^non(white|blue|black|red|green)$/.test(w)) (rr.not ||= []).push(COLOR_WORD[w.slice(3)]);
      else if (['creature', 'noncreature', 'instant', 'sorcery', 'artifact', 'enchantment', 'aura', 'permanent', 'land', 'or'].includes(w)) rr.spellKind = w === 'or' ? rr.spellKind : (rr.spellKind === 'spell' ? w : rr.spellKind + ' or ' + w);
      else return null;
    }
    return { sel: 'spell', restrict: rr };
  }
  if ((m = p.match(/^target (.*?)card(?:s)? (?:from|in) (your|a|target player's|an opponent's) graveyard$/))) {
    return { sel: 'card', restrict: { zone: 'graveyard', who: m[2] === 'your' ? 'you' : 'any', what: m[1].trim() || 'any' } };
  }
  const each = p.match(/^(?:each|all) (.+?)(?: and each player| and each opponent)?$/);
  const isEach = !!each && !p.startsWith('target');
  let body = isEach ? each[1] : p.replace(/^target /, '');
  if (!isEach && body === p) return null; // no "target" prefix and not "each"
  // trailing controller clauses
  if (/ you control$/.test(body)) { r.control = 'you'; body = body.replace(/ you control$/, ''); }
  else if (/ (?:an opponent controls|you don't control|target opponent controls)$/.test(body)) { r.control = 'opp'; body = body.replace(/ (?:an opponent controls|you don't control|target opponent controls)$/, ''); }
  else if ((m = body.match(/ (?:target player|that player) controls$/))) { r.control = 'targetPlayer'; body = body.replace(m[0], ''); }
  if (/ with flying$/.test(body)) { r.flying = true; body = body.replace(/ with flying$/, ''); }
  if (/ without flying$/.test(body)) { r.flying = false; body = body.replace(/ without flying$/, ''); }
  if ((m = body.match(/ with power (\d+) or (less|greater)$/))) { r.power = { n: Number(m[1]), op: m[2] }; body = body.replace(m[0], ''); }
  if ((m = body.match(/ with (?:toughness|converted mana cost|mana value) (\d+) or (less|greater)$/))) { body = body.replace(m[0], ''); r.note = 'condition ignored'; }
  if ((m = body.match(/ that isn't enchanted$/))) { body = body.replace(m[0], ''); }
  if ((m = body.match(/ (?:that|which) is (?:attacking|blocking)$/))) { r.state = m[0].includes('attacking') ? 'attacking' : 'blocking'; body = body.replace(m[0], ''); }
  if (/\battacking or blocking\b/.test(body)) { r.state = 'combat'; body = body.replace(/\battacking or blocking\b/, ''); }
  const words = body.split(/[\s,]+/).filter(w => w && w !== 'or' && w !== 'and');
  const types = [];
  for (const w of words) {
    if (w === 'creature' || w === 'creatures') types.push('creature');
    else if (w === 'artifact' || w === 'artifacts') types.push('artifact');
    else if (w === 'enchantment' || w === 'enchantments') types.push('enchantment');
    else if (w === 'land' || w === 'lands') types.push('land');
    else if (w === 'permanent' || w === 'permanents') types.push('permanent');
    else if (w === 'planeswalker' || w === 'planeswalkers') types.push('planeswalker');
    else if (w === 'player' || w === 'players') { r.players = r.players || 'all'; }
    else if (w === 'opponent') { r.players = 'opp'; }
    else if (['attacking', 'blocking', 'tapped', 'untapped'].includes(w)) r.state = w;
    else if (w === 'legendary') r.legendary = true;
    else if (w === 'basic') r.basic = true;
    else if (w === 'token') r.token = true;
    else if (w === 'nontoken') (r.not ||= []).push('token');
    else if (w === 'nonbasic') (r.not ||= []).push('basic');
    else if (w === 'nonlegendary') (r.not ||= []).push('legendary');
    else if (COLOR_WORD[w]) (r.colors ||= []).push(COLOR_WORD[w]);
    else if (/^non(white|blue|black|red|green)$/.test(w)) (r.not ||= []).push(COLOR_WORD[w.slice(3)]);
    else if (/^non-?(artifact|land|creature|wall|enchantment)$/.test(w)) (r.not ||= []).push(w.replace(/^non-?/, ''));
    else if (w === 'nonland') (r.not ||= []).push('land');
    else if (w === 'other') r.other = true;
    else if (w === 'another') r.other = true;
    else if (w === 'attacking' || w === 'blocking') r.state = w;
    else if (/^[a-z]+$/.test(w)) (r.subtypes ||= []).push(cap(w)); // Wall, Goblin, Aura ...
    else return null;
  }
  if (r.players && !types.length) return { sel: 'each', restrict: r };
  if (!types.length && r.subtypes) types.push('permanent'); // "target Wall", "all Plains"
  if (!types.length) return null;
  r.types = [...new Set(types)];
  if (isEach) return { sel: 'each', restrict: r };
  const sel = r.types.length === 1 && r.types[0] === 'creature' ? 'creature' : 'permanent';
  return { sel, restrict: r };
}

export function needsTarget(e) {
  return ['any', 'creature', 'permanent', 'player', 'opponent', 'spell', 'card'].includes(e.sel);
}

// ---- effect grammar ------------------------------------------------------------
// Each rule: [regex, handler(match) => effect[] | null]
const T = (p) => parseTarget(p);
const tgt = (e, p) => { const k = T(p); if (!k) return null; return [{ ...e, ...k }]; };
const rules = [
  [/^(?:~|it|that creature) deals (\S+) damage to (.+?)(?: and (\S+) damage to (.+))?$/, m => {
    const a = tgt({ type: 'damage', amount: amt(m[1]) }, m[2]); if (!a) return null;
    if (m[3]) { const b = tgt({ type: 'damage', amount: amt(m[3]) }, m[4]); if (!b) return null; a.push(...b); }
    return a;
  }],
  [/^~ deals damage equal to its power to (.+)$/, m => tgt({ type: 'damageEqualPower' }, m[1])],
  [/^~ deals (\S+) damage to each creature (with|without) flying and each player$/, m => [{ type: 'damage', amount: amt(m[1]), sel: 'each', restrict: { types: ['creature'], flying: m[2] === 'with', players: 'all' } }]],
  [/^~ deals (\S+) damage to each creature and each player$/, m => [{ type: 'damage', amount: amt(m[1]), sel: 'each', restrict: { types: ['creature'], players: 'all' } }]],
  [/^~ deals (\S+) damage divided (?:evenly|as you choose)[^]*$/, m => [{ type: 'damage', amount: amt(m[1]), sel: 'any', restrict: {}, note: 'damage not divided' }]],
  [/^~ fights (.+)$/, m => tgt({ type: 'fight' }, m[1])],
  [/^destroy all (.+?)(?:\. they can't be regenerated)?$/, m => { const k = T('all ' + m[1]); if (!k) return null; return [{ type: 'destroyAll', restrict: k.restrict }]; }],
  [/^destroy (target .+?)(?:\. it can't be regenerated)?$/, m => tgt({ type: 'destroy' }, m[1])],
  [/^exile all (.+)$/, m => { const k = T('all ' + m[1]); if (!k) return null; return [{ type: 'exileAll', restrict: k.restrict }]; }],
  [/^exile (target .+)$/, m => tgt({ type: 'exile' }, m[1])],
  [/^return (target .+?) to (?:its|their) owner's hand$/, m => tgt({ type: 'bounce' }, m[1])],
  [/^return (target .+? (?:from|in) your graveyard) to your hand$/, m => tgt({ type: 'fromGraveyard', to: 'hand' }, m[1])],
  [/^return (target .+? (?:from|in) your graveyard) to the battlefield(?: under your control)?( tapped)?$/, m => tgt({ type: 'fromGraveyard', to: 'battlefield', tapped: !!m[2] }, m[1])],
  [/^return (target .+?) to the battlefield under your control$/, m => tgt({ type: 'fromGraveyard', to: 'battlefield' }, m[1])],
  [/^(target .+?|enchanted creature|~|it|that creature|creatures you control|all creatures|each creature) gets? ([+-]\S+)\/([+-]\S+) until end of turn(?: and (?:gains|has) (.+?) until end of turn)?$/, m => {
    const k = T(m[1]); if (!k) return null;
    const p = m[2].toLowerCase().replace('+', ''), t = m[3].toLowerCase().replace('+', '');
    const e = [{ type: 'pump', p: p === 'x' ? 'X' : p === '-x' ? '-X' : Number(p), t: t === 'x' ? 'X' : t === '-x' ? '-X' : Number(t), ...k }];
    if (m[4]) { const kws = m[4].split(/,? and |, /).map(s => cap(s.trim())); for (const kw of kws) { if (!KEYWORDS.has(kw)) return null; e.push({ type: 'grant', keyword: kw, ...k }); } }
    return e;
  }],
  [/^(target .+?|enchanted creature|~|it|that creature|creatures you control|all creatures) (?:gains?|has) (.+?) until end of turn$/, m => {
    const k = T(m[1]); if (!k) return null;
    const kws = m[2].split(/,? and |, /).map(s => cap(s.trim()));
    const out = [];
    for (const kw of kws) {
      if (KEYWORDS.has(kw)) out.push({ type: 'grant', keyword: kw, ...k });
      else if (/^protection from (white|blue|black|red|green)$/i.test(kw)) out.push({ type: 'grant', keyword: { k: 'Protection', from: COLOR_WORD[kw.toLowerCase().replace('protection from ', '')] }, ...k });
      else return null;
    }
    return out;
  }],
  [/^(target .+?|it|that creature) can't (block|attack|attack or block|be blocked) this turn$/, m => tgt({ type: 'flag', flag: { block: 'cantBlock', attack: 'cantAttack', 'attack or block': 'cantAttackOrBlock', 'be blocked': 'unblockable' }[m[2]] }, m[1])],
  [/^(?:you )?draw (\S+) cards?(?:, then discard (\S+) cards?)?$/, m => { const e = [{ type: 'draw', amount: amt(m[1]), who: 'you' }]; if (m[2]) e.push({ type: 'discard', amount: amt(m[2]), who: 'you' }); return e; }],
  [/^(target player|target opponent|each player|each opponent) draws (\S+) cards?$/, m => { const k = T(m[1]); return k ? [{ type: 'draw', amount: amt(m[2]), ...k }] : null; }],
  [/^(target player|target opponent|each player|each opponent|you|that player) discards? (\S+) cards?( at random)?$/, m => { const k = T(m[1]); return k ? [{ type: 'discard', amount: amt(m[2]), random: !!m[3], ...k }] : null; }],
  [/^(target player|target opponent|each player|each opponent|you|that player) discards? (?:their|your) hand$/, m => { const k = T(m[1]); return k ? [{ type: 'discard', all: true, ...k }] : null; }],
  [/^(that player|target player|target opponent) gets (\S+) poison counters?$/, m => { const k = T(m[1]); return k ? [{ type: 'poison', amount: amt(m[2]), ...k }] : null; }],
  [/^(that player|target player|each player|each opponent|target opponent) (?:draws|draw) (\S+) cards?$/, m => { const k = T(m[1]); return k ? [{ type: 'draw', amount: amt(m[2]), ...k }] : null; }],
  [/^(that player|target player) (gains|loses) (\S+) life$/, m => { const k = T(m[1]); return k ? [{ type: m[2] === 'gains' ? 'gain' : 'lose', amount: amt(m[3]), ...k }] : null; }],
  [/^look at the top (\S+) cards? of (?:your|target player's) library(?:, then put (?:them|it) back in any order|\. you may put (?:them|it) on the bottom of your library in any order)?$/, () => [{ type: 'noop' }]],
  [/^a creature dealt damage this way can't be regenerated this turn$/, () => []],
  [/^you may put (?:it|that card) on the bottom of your library$/, () => []],
  [/^(?:you )?gain (\S+) life$/, m => [{ type: 'gain', amount: amt(m[1]), sel: 'you' }]],
  [/^(?:you )?lose (\S+) life$/, m => [{ type: 'lose', amount: amt(m[1]), sel: 'you' }]],
  [/^(target player|target opponent|each player|each opponent) gains (\S+) life$/, m => { const k = T(m[1]); return k ? [{ type: 'gain', amount: amt(m[2]), ...k }] : null; }],
  [/^(target player|target opponent|each player|each opponent) loses (\S+) life$/, m => { const k = T(m[1]); return k ? [{ type: 'lose', amount: amt(m[2]), ...k }] : null; }],
  [/^its controller gains life equal to its power$/, () => [{ type: 'gainEqualPower', sel: 'prev' }]],
  [/^you gain life equal to (?:the damage dealt this way|its power|that creature's power)$/, () => [{ type: 'gainEqualPrev' }]],
  [/^(target player|target opponent|each player|each opponent) mills (\S+) cards?$/, m => { const k = T(m[1]); return k ? [{ type: 'mill', amount: amt(m[2]), ...k }] : null; }],
  [/^(?:you )?mill (\S+) cards?$/, m => [{ type: 'mill', amount: amt(m[1]), sel: 'you' }]],
  [/^counter (target(?: .+?)? spell)(?: unless its controller pays \{(\w+)\})?$/, m => { const k = T(m[1]); if (!k) return null; return [{ type: 'counter', unlessPay: m[2] ? (m[2].toUpperCase() === 'X' ? 'X' : Number(m[2])) : null, ...k }]; }],
  [/^search your library for (?:a|an|up to \S+) (.+?) cards?(?:, reveal (?:it|that card|them),)?(?:,)? (?:and )?put (?:it|that card|them) (into your hand|onto the battlefield( tapped)?|on top of your library)(?:, then shuffle| and shuffle|, then shuffle your library| and shuffle your library)?$/, m => {
    const what = m[1].replace(/ or /g, '|'); const to = m[2].startsWith('into') ? 'hand' : m[2].startsWith('on top') ? 'top' : 'battlefield';
    return [{ type: 'tutor', what, to, tapped: !!m[3] }];
  }],
  [/^search your library for a card, put (?:it|that card) into your hand, then shuffle$/, () => [{ type: 'tutor', what: 'card', to: 'hand' }]],
  [/^search your library for a card and put (?:it|that card) into your hand\. then shuffle$/, () => [{ type: 'tutor', what: 'card', to: 'hand' }]],
  [/^tap (target .+)$/, m => tgt({ type: 'tap' }, m[1])],
  [/^untap (target .+)$/, m => tgt({ type: 'untap' }, m[1])],
  [/^tap or untap (target .+)$/, m => tgt({ type: 'tapOrUntap' }, m[1])],
  [/^tap all (.+?)$/, m => { const k = T('all ' + m[1]); return k ? [{ type: 'tapAll', restrict: k.restrict }] : null; }],
  [/^untap all (.+?)$/, m => { const k = T('all ' + m[1]); return k ? [{ type: 'untapAll', restrict: k.restrict }] : null; }],
  [/^(?:it|that creature|that permanent|enchanted creature|~|target .+?) doesn't untap during (?:its controller's|your) (?:next )?untap step$/, m => [{ type: 'freeze', sel: 'prev' }]],
  [/^(target player|target opponent|each player|each opponent|you) sacrifices? (?:a|an|\S+) (creature|land|artifact|enchantment|permanent)s?$/, m => { const k = T(m[1]); return k ? [{ type: 'sacrifice', what: m[2], ...k }] : null; }],
  [/^sacrifice ~$/, () => [{ type: 'sacrificeSelf' }]],
  [/^sacrifice (?:a|an) (creature|land|artifact|permanent)$/, m => [{ type: 'sacrifice', what: m[1], sel: 'you' }]],
  [/^gain control of (target .+?)( until end of turn)?$/, m => tgt({ type: 'control', until: m[2] ? 'eot' : null }, m[1])],
  [/^put (\S+) ([+-]\d+\/[+-]\d+|[a-z]+) counters? on (.+)$/, m => tgt({ type: 'counters', kind: m[2], amount: amt(m[1]) }, m[3])],
  [/^remove (a|an|\S+) ([+-]\d+\/[+-]\d+|[a-z]+) counters? from (~|it|that creature|target .+)$/, m => tgt({ type: 'counters', kind: m[2], amount: -(amt(m[1]) || 1) }, m[3])],
  [/^draw a card at the beginning of the next turn's upkeep$/, () => [{ type: 'delayedDraw' }]],
  [/^cast ~ only (?:during combat|before|after|during)[^]*$/, () => []],
  [/^remove ~ from your deck before playing if you're not playing for ante$/, () => []],
  [/^tap ~ and sacrifice (?:a|an) (creature|land|artifact|permanent)$/, m => [{ type: 'tap', sel: 'self' }, { type: 'sacrifice', what: m[1], sel: 'you' }]],
  [/^sacrifice ~ at the beginning of the next end step$/, () => [{ type: 'flag', flag: 'sacrificeAtEnd', sel: 'self' }]],
  [/^remove (?:a|all) [+-]1\/[+-]1 counters? from (.+)$/, m => tgt({ type: 'removeCounters' }, m[1])],
  [/^regenerate (.+)$/, m => tgt({ type: 'regenerate' }, m[1])],
  [/^prevent all combat damage that would be dealt this turn$/, () => [{ type: 'fog' }]],
  [/^prevent all combat damage that would be dealt (?:to and dealt by|by and dealt to) (?:that creature|it) this turn$/, () => [{ type: 'flag', flag: 'noCombatDamage', sel: 'prev' }]],
  [/^prevent all damage that would be dealt (?:to and dealt by|by) (?:that creature|it|target creature) this turn$/, m => [{ type: 'flag', flag: 'noCombatDamage', sel: m[0].includes('target') ? 'creature' : 'prev', restrict: { types: ['creature'] } }]],
  [/^add ((?:\{[wubrgc]\})+)$/, m => [{ type: 'addMana', mana: [...m[1].matchAll(/\{(\w)\}/g)].map(x => x[1].toUpperCase()) }]],
  [/^add (\S+) mana of any one color$/, m => [{ type: 'addMana', any: amt(m[1]) }]],
  [/^add one mana of any color$/, () => [{ type: 'addMana', any: 1 }]],
  [/^scry (\d+)$/, m => [{ type: 'scry', amount: Number(m[1]) }]],
  [/^take an extra turn after this one$/, () => [{ type: 'extraTurn' }]],
  [/^(?:create|put) (\S+) (\d+)\/(\d+) (.*?)(?:creature )?tokens?(?: with (.+?))?(?: onto the battlefield)?(?: tapped)?$/, m => {
    const desc = m[4].trim().split(/\s+/).filter(Boolean);
    const colors = desc.filter(w => COLOR_WORD[w]).map(w => COLOR_WORD[w]);
    const types = desc.includes('artifact') ? ['artifact', 'creature'] : ['creature'];
    const subtypes = desc.filter(w => !COLOR_WORD[w] && !['artifact', 'creature', 'colorless', 'and', 'named'].includes(w)).map(cap);
    const kws = m[5] ? m[5].split(/,? and |, /).map(s => cap(s.trim())).filter(k => KEYWORDS.has(k)) : [];
    return [{ type: 'token', count: amt(m[1]), p: Number(m[2]), t: Number(m[3]), colors, types, subtypes, keywords: kws }];
  }],
  [/^exile all cards from (target player's|your|each player's) graveyard$/, m => [{ type: 'exileGraveyard', who: m[1].startsWith('target') ? 'targetPlayer' : m[1].startsWith('your') ? 'you' : 'each' }]],
  [/^(target player|each player) shuffles (?:their|his or her) graveyard into (?:their|his or her) library$/, () => null],
  [/^it can't be regenerated$/, () => []],
  [/^they can't be regenerated$/, () => []],
  [/^then shuffle$/, () => []],
  [/^shuffle your library$/, () => []],
  [/^untap (?:that creature|it)$/, () => [{ type: 'untap', sel: 'prev' }]],
  [/^untap ~$/, () => [{ type: 'untap', sel: 'self' }]],
  [/^tap ~$/, () => [{ type: 'tap', sel: 'self' }]],
  [/^destroy (?:that creature|it) at end of combat$/, () => [{ type: 'flag', flag: 'destroyAtEndOfCombat', sel: 'prev' }]],
  [/^destroy (?:that creature|it)$/, () => [{ type: 'destroy', sel: 'prev' }]],
  [/^exile (?:that creature|it)$/, () => [{ type: 'exile', sel: 'prev' }]],
  [/^(?:that creature|it) deals damage equal to its power to (.+)$/, m => tgt({ type: 'damageEqualPower' }, m[1])],
  [/^(?:it|that creature|that permanent) gains haste until end of turn$/, () => [{ type: 'grant', keyword: 'Haste', sel: 'prev' }]],
  [/^return ~ to its owner's hand$/, () => [{ type: 'bounceSelf' }]],
  [/^put ~ on top of its owner's library$/, () => [{ type: 'bounceSelf' }]],
  [/^~ deals damage to (target .+?) equal to (?:the number of|its power)[^]*$/, m => tgt({ type: 'damageEqualPower' }, m[1])],
  [/^each player discards their hand, then draws seven cards$/, () => [{ type: 'discard', all: true, sel: 'each', restrict: { players: 'all' } }, { type: 'draw', amount: 7, sel: 'each', restrict: { players: 'all' } }]],
  [/^each player shuffles their hand and graveyard into their library, then draws seven cards$/, () => [{ type: 'twister' }]],
  [/^(target .+?) can't be regenerated this turn$/, () => []],
  [/^prevent the next (\d+) damage[^]*$/, () => null],
  [/^~ can't be countered$/, () => []],
];

function parseClause(t) {
  t = t.trim().replace(/\.$/, '');
  if (!t) return [];
  for (const [re, fn] of rules) { const m = t.match(re); if (m) { const r = fn(m); if (r) return r; } }
  return null;
}
// A sentence may chain clauses with ", then " or " and ".
function parseSentence(s) {
  const t = s.trim().replace(/\.$/, '');
  const one = parseClause(t);
  if (one) return one;
  let um;
  if ((um = t.match(/^(.+?) unless you pay ((?:\{[^}]+\})+)$/)) || (um = t.match(/^unless you pay ((?:\{[^}]+\})+), (.+)$/))) {
    const body = um[1].startsWith('{') ? um[2] : um[1], cost = um[1].startsWith('{') ? um[1] : um[2];
    const inner = parseSentence(body);
    if (inner) return [{ type: 'unlessPay', cost: parseCost(cost.toUpperCase()), effects: inner }];
  }
  for (const splitter of [/, then /, /\. then /, / and (?=you |target |~ |each |all |put |untap |tap |draw |discard |destroy |exile |return |gain |lose |that )/]) {
    if (splitter.test(t)) {
      const parts = t.split(splitter).map(parseClause);
      if (parts.every(Boolean)) return parts.flat();
    }
  }
  return null;
}

// "You may X. If you do, Y" / "unless" patterns are simplified.
export function parseEffects(text) {
  const out = { effects: [], notes: [], optional: false };
  let body = text.trim().toLowerCase();
  if (/^you may /.test(body)) { out.optional = true; body = body.replace(/^you may /, ''); }
  body = body.replace(/^if you do, /, '');
  const sentences = body.split(/(?<=\.)\s+(?=[A-Z~"])/i).map(s => s.trim()).filter(Boolean);
  for (const s of sentences) {
    if (/^if you do,/i.test(s)) continue;
    const e = parseSentence(s);
    if (e) out.effects.push(...e); else out.notes.push('Ignored: ' + s.slice(0, 80));
  }
  return out;
}

// ---- costs -------------------------------------------------------------------------
function parseAbilityCost(text) {
  const cost = { mana: { pips: [], generic: 0, x: false }, tap: false, untap: false, sacSelf: false, sacrifice: null, discard: 0, life: 0, removeCounter: null, exileSelfFromGraveyard: false };
  const parts = text.split(/,\s*(?![^{]*\})/).map(s => s.trim().replace(/\{([^}]+)\}/g, (all, s) => '{' + s.toUpperCase() + '}')).filter(Boolean);
  for (const p of parts) {
    let m;
    if (/^(\{[^}]+\})+$/.test(p)) {
      if (p.includes('{T}')) cost.tap = true;
      if (p.includes('{Q}')) cost.untap = true;
      const mana = p.replace(/\{T\}|\{Q\}/g, '');
      if (mana) { const c = parseCost(mana); cost.mana.pips.push(...c.pips); cost.mana.generic += c.generic; cost.mana.x ||= c.x; }
    }
    else if (/^sacrifice ~$/i.test(p)) cost.sacSelf = true;
    else if ((m = p.match(/^sacrifice (?:a|an|another) (creature|land|artifact|permanent|enchantment)$/i))) cost.sacrifice = m[1].toLowerCase();
    else if ((m = p.match(/^discard (a|\w+) cards?(?: at random)?$/i))) cost.discard = amt(m[1].toLowerCase());
    else if (/^discard ~$/i.test(p)) cost.discardSelf = true;
    else if ((m = p.match(/^pay (\d+) life$/i))) cost.life = Number(m[1]);
    else if ((m = p.match(/^remove (a|an|\w+) ([+-]1\/[+-]1|\w+) counters? from ~$/i))) cost.removeCounter = { kind: m[2].toLowerCase(), n: amt(m[1].toLowerCase()) || 1 };
    else if (/^exile ~ from your graveyard$/i.test(p)) cost.exileSelfFromGraveyard = true;
    else if (/^tap an untapped creature you control$/i.test(p)) cost.tapCreature = true;
    else return null;
  }
  return cost;
}

// ---- keyword lines ------------------------------------------------------------------
function parseKeywordLine(line, def) {
  // Returns true if the whole line was keywords.
  const parts = line.replace(/\.$/, '').split(/;\s*|,\s*(?![^{]*\})/).map(s => s.trim()).filter(Boolean);
  const found = [];
  for (const raw of parts) {
    const p = cap(raw);
    let m;
    if (KEYWORDS.has(p)) found.push(p);
    else if (IGNORED_KW.has(p) || (m = p.match(/^(Rampage|Bushido|Annihilator|Fading|Vanishing|Soulshift|Amplify|Modular) (\d+)$/)) && IGNORED_KW.has(m?.[1] || p)) {
      if (m && m[1] === 'Rampage') found.push({ k: 'Rampage', n: Number(m[2]) });
      else def.notes.push(`${p} ignored`);
    }
    else if ((m = p.match(/^Rampage (\d+)$/))) found.push({ k: 'Rampage', n: Number(m[1]) });
    else if (UNSUPPORTED_KW.has(p) || UNSUPPORTED_KW.has(p.split(' ')[0])) { def.unsupportedReason = `${p} is not supported`; }
    else if ((m = p.match(/^Protection from (.+)$/))) {
      const from = m[1].toLowerCase();
      if (COLOR_WORD[from]) found.push({ k: 'Protection', from: COLOR_WORD[from] });
      else if (['artifacts', 'creatures', 'everything', 'instants', 'sorceries', 'enchantments'].includes(from)) found.push({ k: 'Protection', from });
      else if (/^(white|blue|black|red|green) and (white|blue|black|red|green)$/.test(from)) { for (const c of from.split(' and ')) found.push({ k: 'Protection', from: COLOR_WORD[c] }); }
      else def.notes.push(`${p} ignored`);
    }
    else if ((m = p.match(/^(Plains|Island|Swamp|Mountain|Forest)walk$/))) found.push({ k: 'Landwalk', land: m[1] });
    else if ((m = p.match(/^(Legendary )?landwalk$/i))) def.notes.push(`${p} ignored`);
    else if ((m = p.match(/^Cumulative upkeep[—\s-]+(.+)$/))) { const c = parseAbilityCost(m[1].replace(/\.$/, '')); if (c && !c.sacSelf) found.push({ k: 'Cumulative upkeep', cost: c }); else def.notes.push('Cumulative upkeep ignored'); }
    else if ((m = p.match(/^Cycling (\{.+\})$/))) found.push({ k: 'Cycling', cost: parseCost(m[1]) });
    else if ((m = p.match(/^Kicker (\{.+\})$/))) found.push({ k: 'Kicker', cost: parseCost(m[1]) });
    else if ((m = p.match(/^Flashback (\{.+\})$/))) found.push({ k: 'Flashback', cost: parseCost(m[1]) });
    else if ((m = p.match(/^Buyback (\{.+\})$/))) found.push({ k: 'Buyback', cost: parseCost(m[1]) });
    else if ((m = p.match(/^Echo (\{.+\})$/))) found.push({ k: 'Echo', cost: parseCost(m[1]) });
    else if ((m = p.match(/^Equip (\{.+\}|\d+)$/))) found.push({ k: 'Equip', cost: parseCost(m[1].startsWith('{') ? m[1] : `{${m[1]}}`) });
    else if ((m = p.match(/^Enchant (creature|permanent|land|artifact|enchantment|creature you control|creature an opponent controls|player|opponent)$/i))) found.push({ k: 'Enchant', what: m[1].toLowerCase() });
    else if (/^Kicker /.test(p) || /^Flashback /.test(p) || /^Buyback /.test(p)) def.notes.push(`${p} ignored`);
    else return false;
  }
  def.keywords.push(...found);
  return true;
}

// ---- static abilities ------------------------------------------------------------
function parseStatic(t) {
  let m;
  // "Creatures you control get +1/+1." "Other Goblin creatures get +1/+0." "All Walls get..." "Enchanted creature gets +2/+2 and has flying."
  if ((m = t.match(/^(enchanted creature|equipped creature|~|other (.+?)|all (.+?)|(.+?) you control|(.+?) creatures|.+?) (?:gets?|has|have|gains?) (.+?)(?: as long as (.+))?$/))) {
    const scopeText = m[1], rest = m[6], cond = m[7];
    const scope = parseScope(scopeText); if (!scope) return null;
    const out = [];
    for (const part of rest.split(/ and (?=has|have|gains?|gets?|\+|-)|, /).map(s => s.trim())) {
      let mm;
      if ((mm = part.match(/^(?:gets? |gains? |has |have )?([+-]\d+)\/([+-]\d+)$/))) out.push({ type: 'static', kind: 'pt', p: Number(mm[1]), t: Number(mm[2]), scope });
      else if ((mm = part.match(/^(?:has |have |gains? )?(.+)$/))) {
        const kws = mm[1].split(/,? and |, /).map(s => cap(s.trim()));
        for (const kw of kws) {
          if (KEYWORDS.has(kw)) out.push({ type: 'static', kind: 'keyword', keyword: kw, scope });
          else if (/^Protection from (white|blue|black|red|green)$/i.test(kw)) out.push({ type: 'static', kind: 'keyword', keyword: { k: 'Protection', from: COLOR_WORD[kw.toLowerCase().replace('protection from ', '')] }, scope });
          else if (/^(plains|island|swamp|mountain|forest)walk$/i.test(kw)) out.push({ type: 'static', kind: 'keyword', keyword: { k: 'Landwalk', land: cap(kw.toLowerCase().replace('walk', '')) }, scope });
          else if ((mm = kw.match(/^"(.+)"$/))) { const ab = parseAbilityLine(mm[1].toLowerCase(), scope); if (ab) out.push({ type: 'static', kind: 'grantAbility', ability: ab, scope }); else return null; }
          else return null;
        }
      } else return null;
    }
    if (cond) {
      let cm;
      if ((cm = cond.match(/^you control (?:a|an) (plains|island|swamp|mountain|forest)$/))) for (const o of out) o.condition = { landType: cap(cm[1]) };
      else if ((cm = cond.match(/^~ is untapped$/))) for (const o of out) o.condition = { selfUntapped: true };
      else return null;
    }
    return out;
  }
  if ((m = t.match(/^(enchanted creature|equipped creature|~|creatures you control|all creatures|.+?) can't (attack|block|attack or block|be blocked)$/))) {
    const scope = parseScope(m[1]); if (!scope) return null;
    return [{ type: 'static', kind: { attack: 'cantAttack', block: 'cantBlock', 'attack or block': 'cantAttackOrBlock', 'be blocked': 'unblockable' }[m[2]], scope }];
  }
  if ((m = t.match(/^(~|enchanted creature) can't be blocked except by (.+?)$/))) return [{ type: 'static', kind: 'blockableOnlyBy', filter: parseCreatureFilter(m[2]), scope: parseScope(m[1]) }];
  if ((m = t.match(/^(~|enchanted creature) can't be blocked by (.+?)$/))) return [{ type: 'static', kind: 'cantBeBlockedBy', filter: parseCreatureFilter(m[2]), scope: parseScope(m[1]) }];
  if ((m = t.match(/^(~|enchanted creature) can block only creatures with flying$/))) return [{ type: 'static', kind: 'blockOnlyFlying', scope: parseScope(m[1]) }];
  if ((m = t.match(/^(~|enchanted creature) can block creatures with flying(?: as though it had reach)?$/))) return [{ type: 'static', kind: 'keyword', keyword: 'Reach', scope: parseScope(m[1]) }];
  if ((m = t.match(/^(~|enchanted creature) can't attack unless defending player controls (?:a|an) (plains|island|swamp|mountain|forest)$/))) return [{ type: 'static', kind: 'attackOnlyIfDefenderHas', land: cap(m[2]), scope: parseScope(m[1]) }];
  if ((m = t.match(/^(~|enchanted creature) attacks each (?:combat|turn) if able$/))) return [{ type: 'static', kind: 'mustAttack', scope: parseScope(m[1]) }];
  if ((m = t.match(/^(~|enchanted creature) can attack as though it had haste$/))) return [{ type: 'static', kind: 'keyword', keyword: 'Haste', scope: parseScope(m[1]) }];
  if ((m = t.match(/^(~|enchanted creature) can't be the target of spells or abilities$/))) return [{ type: 'static', kind: 'keyword', keyword: 'Shroud', scope: parseScope(m[1]) }];
  if ((m = t.match(/^(enchanted creature|~) doesn't untap during (?:its controller's|your) untap step$/))) return [{ type: 'static', kind: 'doesntUntap', scope: parseScope(m[1]) }];
  if (/^you control enchanted creature$/.test(t)) return [{ type: 'static', kind: 'control', scope: { who: 'enchanted' } }];
  if (/^all creatures able to block (enchanted creature|~) do so$/.test(t)) return [{ type: 'static', kind: 'lure', scope: parseScope(RegExp.$1) }];
  if ((m = t.match(/^~'s power and toughness are each equal to the number of (.+?) you control$/))) return [{ type: 'static', kind: 'cda', count: m[1], scope: { who: 'self' } }];
  if ((m = t.match(/^~'s power and toughness are each equal to the number of cards in your hand$/))) return [{ type: 'static', kind: 'cda', count: 'cards in hand', scope: { who: 'self' } }];
  if ((m = t.match(/^~'s power is equal to the number of creature cards in all graveyards and its toughness is equal to that number plus 1$/))) return [{ type: 'static', kind: 'cda', count: 'creature cards in graveyards', plusT: 1, scope: { who: 'self' } }];
  if (/^~ enters(?: the battlefield)? tapped$/.test(t)) return [{ type: 'static', kind: 'entersTapped', scope: { who: 'self' } }];
  if ((m = t.match(/^~ enters(?: the battlefield)? with (\S+) ([+-]\d+\/[+-]\d+|[a-z]+) counters? on it$/))) return [{ type: 'static', kind: 'entersWithCounters', amount: amt(m[1]), counter: m[2], scope: { who: 'self' } }];
  if (/^you may choose not to untap ~ during your untap step$/.test(t)) return [{ type: 'static', kind: 'noop', scope: { who: 'self' } }];
  if ((m = t.match(/^when you control no (plains|islands|swamps|mountains|forests), sacrifice ~$/))) return [{ type: 'static', kind: 'needsLand', land: cap(m[1].replace(/s$/, '')), scope: { who: 'self' } }];
  if ((m = t.match(/^(~|enchanted creature) can't block creatures with power (\d+) or greater$/))) return [{ type: 'static', kind: 'cantBlockPowerGE', n: Number(m[2]), scope: parseScope(m[1]) }];
  if (/^~ can block an additional creature each combat$/.test(t)) return [{ type: 'static', kind: 'noop', scope: { who: 'self' } }];
  return null;
}
function parseCreatureFilter(text) {
  const f = {};
  const t = text.toLowerCase();
  if (/artifact creatures/.test(t)) f.artifact = true;
  for (const [w, c] of Object.entries(COLOR_WORD)) if (t.includes(w + ' creatures')) (f.colors ||= []).push(c);
  if (/creatures with flying/.test(t)) f.flying = true;
  if (/walls?/.test(t)) f.subtype = 'Wall';
  const sub = t.match(/^(\w+)s?$/); if (sub && !f.flying && !f.artifact && !f.colors) f.subtype = cap(sub[1]);
  if (/creatures with (?:power|toughness)/.test(t)) f.note = true;
  return f;
}
function parseScope(text) {
  const t = text.trim().toLowerCase();
  if (t === '~') return { who: 'self' };
  if (t === 'enchanted creature' || t === 'enchanted permanent' || t === 'enchanted land' || t === 'equipped creature') return { who: 'enchanted' };
  if (t === 'creatures you control' || t === 'all creatures you control') return { who: 'you', types: ['creature'] };
  if (t === 'all creatures' || t === 'creatures' || t === 'each creature') return { who: 'all', types: ['creature'] };
  let m;
  if ((m = t.match(/^(other )?(.+?) creatures you control$/))) return { who: 'you', types: ['creature'], subtype: cap(m[2]), other: !!m[1] };
  if ((m = t.match(/^(other )?(.+?) creatures$/))) { const w = m[2]; return COLOR_WORD[w] ? { who: 'all', types: ['creature'], color: COLOR_WORD[w], other: !!m[1] } : { who: 'all', types: ['creature'], subtype: cap(w), other: !!m[1] }; }
  if ((m = t.match(/^(other |all )?(\w+)s$/))) return { who: 'all', types: ['creature'], subtype: cap(m[2].replace(/s$/, '') === m[2] ? m[2] : m[2]), other: (m[1] || '').trim() === 'other' };
  if ((m = t.match(/^(other |all )?(\w+)$/))) return { who: 'all', types: ['creature'], subtype: cap(m[2]), other: (m[1] || '').trim() === 'other' };
  return null;
}

// ---- ability lines ---------------------------------------------------------------
function parseAbilityLine(line, ctx) {
  let m;
  let t = line.trim().replace(/\s*this effect doesn't remove ~\.?$/i, '').replace(/\.$/, '');
  // activated: "cost: effect"
  if ((m = t.match(/^((?:(?:\{[^}]+\})+|[^:{}]+?)(?:,\s*(?:(?:\{[^}]+\})+|[^:{}]+?))*):\s+(.+)$/)) && /\{|sacrifice|discard|pay|remove|tap/i.test(m[1])) {
    const cost = parseAbilityCost(m[1]);
    if (!cost) return null;
    let body = m[2];
    let timing = 'instant', once = false;
    body = body.replace(/\s*activate (?:this ability )?only (as a sorcery|once each turn|during your turn|during combat|if [^.]+|any time you could cast a sorcery)\.?$/i, (s, w) => { if (/sorcery$/.test(w) || /cast a sorcery/.test(w)) timing = 'sorcery'; else if (/once each turn/.test(w)) once = true; return ''; });
    body = body.replace(/\s*activate (?:this ability )?no more than (once|twice|\w+ times) each turn\.?$/i, () => { once = true; return ''; });
    body = body.replace(/\s*activate only during your upkeep\.?$/i, () => { timing = 'upkeep'; return ''; });
    // mana ability
    let mm;
    if ((mm = body.match(/^add ((?:\{[wubrgc]\})+)\.?$/))) return { type: 'mana', cost, produces: [...new Set([...mm[1].matchAll(/\{(\w)\}/g)].map(x => x[1].toUpperCase()))] , amount: [...mm[1].matchAll(/\{(\w)\}/g)].length };
    if ((mm = body.match(/^add (\{[wubrgc]\})(?: or (\{[wubrgc]\}))+\.?$/))) return { type: 'mana', cost, produces: [...body.matchAll(/\{(\w)\}/g)].map(x => x[1].toUpperCase()), amount: 1 };
    if ((mm = body.match(/^add (\S+) mana of any one color\.?$/))) return { type: 'mana', cost, produces: COLORS.slice(), amount: amt(mm[1]), sameColor: true };
    if (/^add one mana of any color\.?$/.test(body)) return { type: 'mana', cost, produces: COLORS.slice(), amount: 1 };
    if (/^add \{c\}\{c\}\.?$/.test(body)) return { type: 'mana', cost, produces: ['C'], amount: 2 };
    const eff = parseEffects(body);
    if (!eff.effects.length) return null;
    return { type: 'activated', cost, effects: eff.effects, optional: eff.optional, timing, once, notes: eff.notes, text: line };
  }
  // triggered
  if ((m = t.match(/^(when|whenever) (.+?), (.+)$/))) {
    const ev = parseEvent(m[2]);
    if (ev) {
      const eff = parseEffects(m[3]);
      if (!eff.effects.length) return null;
      return { type: 'triggered', ...ev, effects: eff.effects, optional: eff.optional, notes: eff.notes, text: line };
    }
  }
  if ((m = t.match(/^at the beginning of (.+?), (.+)$/))) {
    const w = m[1];
    let ev = null;
    if (/^your upkeep$/.test(w)) ev = { event: 'upkeep', who: 'you' };
    else if (/^each (?:player's )?upkeep$/.test(w) || /^each upkeep$/.test(w)) ev = { event: 'upkeep', who: 'each' };
    else if (/^(?:your|the) end step$/.test(w) || /^each end step$/.test(w)) ev = { event: 'endstep', who: w.startsWith('your') ? 'you' : 'each' };
    else if (/^(?:the )?end step$/.test(w)) ev = { event: 'endstep', who: 'each' };
    else if (/^each player's draw step$/.test(w)) ev = { event: 'drawstep', who: 'each' };
    else if (/^your draw step$/.test(w)) ev = { event: 'drawstep', who: 'you' };
    else if (/^(?:your )?combat on your turn$/.test(w) || /^combat on your turn$/.test(w)) ev = { event: 'beginCombat', who: 'you' };
    else if (/^the upkeep of enchanted (?:creature|land|permanent|artifact|enchantment)'s controller$/.test(w)) ev = { event: 'upkeep', who: 'enchantedController' };
    else return null;
    let body = m[2];
    let condition = null;
    let cm;
    if ((cm = body.match(/^if ~ is untapped, (.+)$/))) { condition = { selfUntapped: true }; body = cm[1]; }
    if ((cm = body.match(/^if ~ didn't attack this turn, (.+)$/))) { condition = { didntAttack: true }; body = cm[1]; }
    if ((cm = body.match(/^that player (draws an additional card|draws a card)$/))) return { type: 'triggered', ...ev, condition, effects: [{ type: 'draw', amount: 1, sel: 'thatPlayer' }], text: line };
    const eff = parseEffects(body);
    if (!eff.effects.length) return null;
    return { type: 'triggered', ...ev, condition, effects: eff.effects, optional: eff.optional, notes: eff.notes, text: line };
  }
  const st = parseStatic(t);
  if (st) return st.length === 1 ? st[0] : { type: 'multi', list: st };
  return null;
}

function parseEvent(w) {
  let m;
  if (/^~ enters(?: the battlefield)?$/.test(w)) return { event: 'etb' };
  if (/^~ (?:dies|is put into a graveyard from the battlefield)$/.test(w)) return { event: 'dies' };
  if (/^~ leaves the battlefield$/.test(w)) return { event: 'leaves' };
  if (/^~ attacks$/.test(w)) return { event: 'attacks' };
  if (/^~ attacks and isn't blocked$/.test(w)) return { event: 'unblocked' };
  if (/^~ blocks$/.test(w)) return { event: 'blocks' };
  if (/^~ becomes blocked$/.test(w)) return { event: 'becomesBlocked' };
  if (/^~ attacks or blocks$/.test(w)) return { event: 'attacksOrBlocks' };
  if ((m = w.match(/^~ blocks or becomes blocked by (?:a |an )?(.+?)$/))) return { event: 'blocksOrBlockedBy', filter: parseCreatureFilter(m[1] === 'creature' ? '' : m[1]) };
  if (/^~ becomes blocked by a creature$/.test(w)) return { event: 'becomesBlocked' };
  if (/^~ deals combat damage to a player$/.test(w)) return { event: 'combatDamagePlayer' };
  if (/^~ deals damage to (?:a player|an opponent)$/.test(w)) return { event: 'damagePlayer' };
  if (/^~ deals combat damage to an opponent$/.test(w)) return { event: 'combatDamagePlayer' };
  if (/^~ deals damage$/.test(w)) return { event: 'dealsDamage' };
  if (/^~ deals combat damage to a creature$/.test(w)) return { event: 'combatDamageCreature' };
  if (/^~ becomes tapped$/.test(w)) return { event: 'becomesTapped' };
  if (/^~ becomes the target of a spell or ability$/.test(w)) return { event: 'targeted' };
  if (/^a creature dies$/.test(w) || /^another creature dies$/.test(w)) return { event: 'anyCreatureDies', other: /another/.test(w) };
  if (/^a creature dealt damage by ~ this turn dies$/.test(w)) return { event: 'damagedByDies' };
  if (/^(?:a|another) creature enters(?: the battlefield)?(?: under your control)?$/.test(w)) return { event: 'anyCreatureEtb', yours: /your control/.test(w), other: /another/.test(w) };
  if (/^enchanted creature (?:deals damage|deals combat damage)$/.test(w)) return { event: 'enchantedDealsDamage' };
  if (/^enchanted creature dies$/.test(w)) return { event: 'enchantedDies' };
  if (/^enchanted creature attacks$/.test(w)) return { event: 'enchantedAttacks' };
  if (/^you cast a (?:noncreature|creature|historic)? ?spell$/.test(w)) return { event: 'youCast', kind: w.includes('noncreature') ? 'noncreature' : w.includes('creature') ? 'creature' : 'any' };
  if (/^a player casts a spell$/.test(w)) return { event: 'anyCast' };
  if (/^~ is turned face up$/.test(w)) return null;
  return null;
}

// ---- main compile -----------------------------------------------------------------
function normalizeOracle(text, name, legendary) {
  const short = name.split(' // ')[0];
  let t = text.replace(new RegExp(esc(short), 'g'), '~');
  // Legendary cards are often referred to by first name in older text.
  const first = short.split(/[, ]/)[0];
  if (legendary && first.length > 3 && /^[A-Z]/.test(first) && short.includes(' ')) t = t.replace(new RegExp("\\b" + esc(first) + "\\b(?![\\w'])", 'g'), '~');
  t = t.replace(/\b(this creature|this permanent|this artifact|this enchantment|this land|this spell|this aura|this equipment|this card)\b/gi, '~');
  t = t.replace(/−/g, '-').replace(/—/g, '—');
  // Reminder text: drop, except a mana ability that is only reminder text (dual lands).
  const lines = t.split('\n').map(l => {
    const only = l.match(/^\(([^)]*)\)$/);
    if (only && /\{T\}: Add/.test(only[1])) return only[1];
    return l.replace(/\s*\([^)]*\)/g, '');
  }).map(s => s.trim()).filter(Boolean);
  return lines;
}

export function compile(c) {
  if (!c) return null;
  const tl = parseTypeLine(c.type_line);
  const def = {
    name: c.name, id: c.id, image: c.image, set: c.set, typeLine: c.type_line, oracle: c.oracle_text || '',
    colors: c.colors || [], cmc: c.cmc || 0, cost: parseCost(c.mana_cost || ''),
    supertypes: tl.supertypes, types: tl.types, subtypes: tl.subtypes,
    keywords: [], abilities: [], manaAbilities: [], spell: null, notes: [], produces: [],
    power: null, toughness: null, kind: 'unsupported', status: 'unsupported',
  };
  const isType = t => tl.types.includes(t);
  def.kind = isType('Land') ? 'land' : isType('Creature') ? 'creature' : isType('Planeswalker') ? 'planeswalker' : isType('Artifact') ? 'artifact' : isType('Enchantment') ? 'enchantment' : isType('Instant') ? 'instant' : isType('Sorcery') ? 'sorcery' : 'unsupported';
  def.isPermanent = ['land', 'creature', 'artifact', 'enchantment'].includes(def.kind);
  def.basic = tl.supertypes.includes('Basic');
  def.legendary = tl.supertypes.includes('Legendary');
  const unsupported = why => ({ ...def, kind: 'unsupported', status: 'unsupported', notes: [why] });

  if (def.kind === 'planeswalker') return unsupported('Planeswalkers are not supported');
  if (def.kind === 'unsupported') return unsupported(`${c.type_line} is not supported`);
  if (def.subtypes.includes('Vehicle') || def.subtypes.includes('Saga')) return unsupported(`${def.subtypes.join(' ')} is not supported`);

  if (def.kind === 'creature') {
    def.power = parseInt(c.power, 10); def.toughness = parseInt(c.toughness, 10);
    if (!Number.isFinite(def.power)) def.power = 0;
    if (!Number.isFinite(def.toughness)) def.toughness = 0;
    def.starPT = /\*/.test(c.power || '') || /\*/.test(c.toughness || '');
  }
  for (const [t, col] of Object.entries(BASIC)) if (def.subtypes.map(s => s.toLowerCase()).includes(t)) def.produces.push(col);

  const lines = normalizeOracle(c.oracle_text || '', c.name, def.legendary);
  if (/enters? (?:the battlefield )?as a copy of/i.test(c.oracle_text || '')) return unsupported('Copy effects are not supported');
  const spellEffects = [];
  const modes = [];
  let inModes = false, modal = null;
  let additionalCost = null, alternativeCost = null, kickedEffects = null;
  for (let line of lines) {
    const lower = line.toLowerCase();
    if (/^choose (one|two|one or more|any number)( —|—|:)/.test(lower)) { inModes = true; modal = lower.startsWith('choose one ') ? 'one' : 'two'; continue; }
    if (inModes && /^•/.test(line)) {
      const eff = parseEffects(line.replace(/^•\s*/, '').trim());
      if (eff.effects.length) modes.push({ text: line.replace(/^•\s*/, ''), effects: eff.effects, optional: eff.optional }); else def.notes.push('Mode ignored: ' + line.slice(0, 60));
      continue;
    }
    inModes = false;
    let m;
    if ((m = lower.match(/^as an additional cost to cast (?:this spell|~), (sacrifice (?:a|an) (creature|land|artifact|permanent)|discard (?:a|\w+) cards?|pay (\d+) life|exile (?:a|an) \w+ card from your graveyard)$/))) {
      if (m[2]) additionalCost = { sacrifice: m[2] };
      else if (/^discard/.test(m[1])) additionalCost = { discard: amt(m[1].split(' ')[1]) };
      else if (m[3]) additionalCost = { life: Number(m[3]) };
      else { def.notes.push('Additional cost ignored: ' + line); }
      continue;
    }
    if ((m = lower.match(/^you may (?:pay (\d+) life and )?(?:exile|remove) (?:a|an) (white|blue|black|red|green) card from your hand rather than pay (?:this spell's|~'s) mana cost\.?$/))) { alternativeCost = { pitch: COLOR_WORD[m[2]], life: m[1] ? Number(m[1]) : 0 }; continue; }
    if ((m = lower.match(/^if (?:~|this spell) was kicked, (.+)$/))) { const eff = parseEffects(m[1]); if (eff.effects.length) kickedEffects = eff.effects; else def.notes.push('Kicker effect ignored'); continue; }
    if ((m = lower.match(/^if ~ was kicked, it enters(?: the battlefield)? with (\S+) ([+-]1\/[+-]1) counters? on it$/))) { kickedEffects = [{ type: 'counters', kind: m[2], amount: amt(m[1]), sel: 'self' }]; continue; }
    if (parseKeywordLine(line, def)) continue;
    if (def.unsupportedReason) break;
    // Instant / sorcery text is spell effects; permanents have abilities.
    if (def.kind === 'instant' || def.kind === 'sorcery') {
      const eff = parseEffects(lower);
      spellEffects.push(...eff.effects);
      if (eff.optional && eff.effects.length) def.spellOptional = true;
      def.notes.push(...eff.notes);
      continue;
    }
    const ab = parseAbilityLine(lower);
    if (ab) {
      const list = ab.type === 'multi' ? ab.list : [ab];
      for (const a of list) {
        if (a.type === 'mana') def.manaAbilities.push(a);
        else def.abilities.push(a);
        if (a.notes?.length) def.notes.push(...a.notes);
      }
      continue;
    }
    // Spell-like effects on permanents (e.g. "When ~ enters" handled above). Unknown line:
    def.notes.push('Ignored: ' + line.slice(0, 80));
  }
  if (def.unsupportedReason) return unsupported(def.unsupportedReason);
  // Basic land types carry an intrinsic mana ability.
  if (def.kind === 'land' && def.produces.length) {
    const intrinsic = def.produces.filter(col => !def.manaAbilities.some(ma => ma.produces.includes(col)));
    if (intrinsic.length) def.manaAbilities.unshift({ type: 'mana', cost: { mana: { pips: [], generic: 0, x: false }, tap: true }, produces: intrinsic, amount: 1, intrinsic: true });
  }
  for (const ma of def.manaAbilities) for (const col of ma.produces) if (!def.produces.includes(col)) def.produces.push(col);
  def.entersTapped = def.abilities.some(a => a.type === 'static' && a.kind === 'entersTapped');

  if (def.kind === 'instant' || def.kind === 'sorcery') {
    if (!spellEffects.length && !modes.length) return unsupported('No recognisable effect');
    def.spell = { effects: spellEffects, modes: modes.length ? modes : null, modal, additionalCost, alternativeCost, kickedEffects };
    if (def.cost.x && !JSON.stringify(spellEffects).includes('"X"') && !modes.length) def.notes.push('X has no effect');
  }
  if (def.kind === 'creature') {
    if (def.starPT && !def.abilities.some(a => a.kind === 'cda')) return unsupported('Variable power/toughness');
    def.kicked = kickedEffects;
    def.additionalCost = additionalCost;
  }
  if (def.kind === 'enchantment') {
    const aura = def.keywords.find(k => k.k === 'Enchant');
    if (aura) { def.aura = aura.what; if (!def.abilities.length) return unsupported('Aura with no understood effect'); }
    else if (!def.abilities.length) return unsupported('Enchantment with no understood effect');
  }
  if (def.kind === 'artifact') {
    if (!def.abilities.length && !def.manaAbilities.length && !def.keywords.some(k => k.k === 'Equip')) return unsupported('Artifact with no understood effect');
    if (def.keywords.some(k => k.k === 'Equip')) def.equipment = true;
  }
  if (def.kind === 'land' && !def.produces.length && !def.abilities.length) return unsupported('Land with no understood ability');
  // Abilities whose effects were partly ignored are fine, but a permanent whose only text is ignored is unsupported.
  const ignoredCount = def.notes.filter(n => n.startsWith('Ignored:')).length;
  const understood = def.abilities.length + def.manaAbilities.length + def.keywords.length + (def.spell ? 1 : 0) + def.produces.length;
  if (ignoredCount && !understood && def.kind !== 'creature') return unsupported(def.notes[0]);
  def.status = def.notes.length ? 'approx' : 'full';
  def.kwNames = def.keywords.map(kwDisplay);
  return def;
}

export function statusLabel(def) {
  if (!def) return 'not found';
  return { full: 'ready', approx: 'approximated', unsupported: 'unsupported' }[def.status] || def.status;
}
