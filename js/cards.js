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
  'Eternalize', 'Improvise', 'Fabricate', 'Partner', 'Melee', 'Escalate', 'Emerge', 'Escape', 'Mutate', 'Companion', 'Landfall', 'Hellbent', 'Threshold', 'Amplify', 'Modular']);
// Keywords that break the game if ignored.
const UNSUPPORTED_KW = new Set(['Storm', 'Suspend', 'Morph', 'Megamorph', 'Cascade', 'Dredge', 'Transmute', 'Ripple', 'Epic', 'Haunt',
  'Forecast', 'Graft', 'Hideaway', 'Champion', 'Evoke', 'Conspire', 'Devour', 'Crew', 'Amass', 'Adapt', 'Riot', 'Spectacle']);

export function slug(name) {
  return String(name).toLowerCase().split(' // ')[0].replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parseCost(mc) {
  const pips = []; let generic = 0, x = 0;   // x counts the X pips: {X}{X}{U} costs twice X
  for (const m of (mc || '').matchAll(/\{([^}]+)\}/g)) {
    const s = m[1];
    if (/^\d+$/.test(s)) generic += Number(s);
    else if (s === 'X' || s === 'Y' || s === 'Z') x++;
    else if (s === 'C' || s === 'S') pips.push(['C']);
    else {
      const parts = s.split('/');
      const cols = parts.filter(t => COLORS.includes(t));
      if (parts[0] && /^\d+$/.test(parts[0])) generic += Number(parts[0]);
      else if (cols.length) pips.push(cols);
      else x++;
    }
  }
  return { pips, generic, x };
}
export function costString(cost) {
  if (!cost) return '';
  const parts = [];
  if (cost.x) parts.push('X'.repeat(cost.x));
  if (cost.generic) parts.push(String(cost.generic));
  for (const p of cost.pips || []) parts.push(p.join('/'));
  return parts.join('') || (cost.pips ? '0' : '');
}
// Cost as colored mana-symbol pips (HTML). Pass a cost object; returns inner HTML for a <span>.
export function manaHtml(cost) {
  if (!cost) return '';
  const pips = [];
  for (let i = 0; i < (cost.x || 0); i++) pips.push(['X']);
  if (cost.generic) pips.push([String(cost.generic)]);
  for (const p of cost.pips || []) pips.push(p);
  if (!pips.length) return cost.pips ? '<i class="pip pip-c">0</i>' : '';
  return pips.map(p => {
    const first = String(p[0]);
    const key = p.length > 1 ? 'h' : /^[WUBRGC]$/.test(first) ? first.toLowerCase() : first === 'X' ? 'x' : 'c';
    return `<i class="pip pip-${key}">${p.length > 1 ? p.join('') : first}</i>`;
  }).join('');
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
  if (p === '~' || p === 'it' || p === 'itself' || p === 'themselves') return { sel: 'self', restrict: r };
  if (p === 'that player' || p === "that player's") return { sel: 'thatPlayer', restrict: r };
  if (p === 'that opponent' || p === "that opponent's") return { sel: 'thatPlayer', restrict: r };
  if (/^(?:that (?:land|creature|permanent)'s|its|the creature's) controller$/.test(p)) return { sel: 'prevController', restrict: r };
  if (/^(that creature|that permanent|it|them|that card|the creature|the other creature)$/.test(p)) return { sel: 'prev', restrict: r };
  if (p === 'target opponent or planeswalker') return { sel: 'opponent', restrict: r };
  if (/^enchanted (creature|permanent|land|artifact)$/.test(p)) return { sel: 'enchanted', restrict: r };
  if (/^equipped creature$/.test(p)) return { sel: 'enchanted', restrict: r };
  if (p === 'target opponent') return { sel: 'opponent', restrict: r };
  if (p === 'target player') return { sel: 'player', restrict: r };
  if (p === 'each player' || p === 'all players') return { sel: 'each', restrict: { players: 'all' } };
  if (p === 'each opponent' || p === 'defending player') return { sel: 'each', restrict: { players: 'opp' } };
  if (p === 'its controller' || p === "that creature's controller" || p === "that permanent's controller" || p === "that artifact's controller" || p === "that land's controller") return { sel: 'prevController', restrict: r };
  if (p === 'the sacrificed creature' || p === 'that creature\'s') return { sel: 'sacrificed', restrict: r };
  let m;
  if ((m = p.match(/^you and (each .+)$/))) { const k = parseTarget(m[1]); if (!k || k.sel !== 'each') return null; k.restrict.players = 'you'; return k; }
  if (/^another target /.test(p)) { const inner = parseTarget(p.replace(/^another /, '')); if (inner) { inner.restrict.other = true; return inner; } }
  if (/^target spell with (?:converted mana cost|mana value) x$/.test(p)) return { sel: 'spell', restrict: { spellKind: 'spell', cmcX: true } };
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
  let each = p.match(/^(?:each|all) (.+?)(?: and each player| and each opponent)?$/);
  // A bare plural subject ("attacking creatures", "nonwhite creatures", "green creatures you control", "walls") means all of them.
  if (!each && !p.startsWith('target') && /(?:creatures|permanents|artifacts|enchantments|lands|walls|[a-z]+s)(?: (?:you|your opponents|an opponent) control(?:s)?| on the battlefield| with flying| without flying| with power \d+ or (?:less|greater))?$/.test(p) && !/^(?:you|it|them)$/.test(p)) each = [p, p.replace(/ on the battlefield$/, '')];
  const isEach = !!each && !p.startsWith('target');
  let body = isEach ? each[1] : p.replace(/^target /, '');
  if (!isEach && body === p) return null; // no "target" prefix and not "each"
  if (/ and each player$/.test(p)) r.players = 'all'; else if (/ and each opponent$/.test(p)) r.players = 'opp';
  if ((m = body.match(/ named (.+)$/))) { r.name = m[1].split(' ').map(cap).join(' '); body = body.replace(m[0], ''); }
  // trailing controller clauses
  if (/ you control$/.test(body)) { r.control = 'you'; body = body.replace(/ you control$/, ''); }
  else if (/ (?:an opponent controls|you don't control|target opponent controls|your opponents control|defending player controls)$/.test(body)) { r.control = 'opp'; body = body.replace(/ (?:an opponent controls|you don't control|target opponent controls|your opponents control|defending player controls)$/, ''); }
  else if (/ (?:they|that player) controls?$/.test(body)) { r.control = 'targetPlayer'; body = body.replace(/ (?:they|that player) controls?$/, ''); }
  if (/ you both own and control$/.test(body)) { r.control = 'you'; body = body.replace(/ you both own and control$/, ''); }
  else if ((m = body.match(/ (?:target player|that player) controls$/))) { r.control = 'targetPlayer'; body = body.replace(m[0], ''); }
  if (/ that's attacking you$/.test(body)) { r.state = 'attacking'; body = body.replace(/ that's attacking you$/, ''); }
  if (/ with flying$/.test(body)) { r.flying = true; body = body.replace(/ with flying$/, ''); }
  if (/ without flying$/.test(body)) { r.flying = false; body = body.replace(/ without flying$/, ''); }
  if ((m = body.match(/ with power (\d+) or (less|greater)$/))) { r.power = { n: Number(m[1]), op: m[2] }; body = body.replace(m[0], ''); }
  if ((m = body.match(/ with toughness (\d+) or (less|greater)$/))) { r.toughness = { n: Number(m[1]), op: m[2] }; body = body.replace(m[0], ''); }
  if ((m = body.match(/ with (?:converted mana cost|mana value) (\d+|x)(?: or (less|greater))?$/))) { body = body.replace(m[0], ''); r.note = 'condition ignored'; }
  if ((m = body.match(/^(\d+)\/(\d+) (.+)$/))) { r.pt = [Number(m[1]), Number(m[2])]; body = m[3]; }
  if ((m = body.match(/ that isn't enchanted$/))) { body = body.replace(m[0], ''); }
  if ((m = body.match(/ (?:that|which) is (?:attacking|blocking)$/))) { r.state = m[0].includes('attacking') ? 'attacking' : 'blocking'; body = body.replace(m[0], ''); }
  if (/\battacking or blocking\b/.test(body)) { r.state = 'combat'; body = body.replace(/\battacking or blocking\b/, ''); }
  const words = body.split(/[\s,]+/).filter(w => w && w !== 'or' && w !== 'and' && w !== 'and/or');
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
    else if (w === 'snow') r.snow = true;
    else if (w === 'nonsnow') (r.not ||= []).push('snow');
    else if (w === 'non-wall' || w === 'nonwall') (r.not ||= []).push('wall');
    else if (COLOR_WORD[w]) (r.colors ||= []).push(COLOR_WORD[w]);
    else if (/^non(white|blue|black|red|green)$/.test(w)) (r.not ||= []).push(COLOR_WORD[w.slice(3)]);
    else if (/^non-?(artifact|land|creature|wall|enchantment)$/.test(w)) (r.not ||= []).push(w.replace(/^non-?/, ''));
    else if (w === 'nonland') (r.not ||= []).push('land');
    else if (w === 'other') r.other = true;
    else if (w === 'another') r.other = true;
    else if (w === 'attacking' || w === 'blocking') r.state = w;
    else if (/^[a-z]+(?:-[a-z]+)?$/.test(w)) (r.subtypes ||= []).push(capSub(w)); // Wall, Goblin, Aura, Assembly-Worker ...
    else return null;
  }
  if (r.players && !types.length) return { sel: 'each', restrict: r };
  if (!types.length && r.subtypes && r.subtypes.some(st => /^Walls?$|^Auras?$/.test(st))) { r.subtypes = r.subtypes.map(st => st.replace(/s$/, '')); types.push(r.subtypes.includes('Aura') ? 'enchantment' : 'creature'); }
  if (!types.length && r.subtypes) { r.subtypes = r.subtypes.map(st => st.replace(/s$/, '')); types.push('permanent'); } // "target Wall", "all Plains", "other Rats"
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
// Subtype capitalisation that survives hyphens: "assembly-worker" -> "Assembly-Worker" (matches the type line).
const capSub = w => w.split('-').map(cap).join('-');
// "where X is <something>": a calc object the engine evaluates at resolution.
function parseWhereX(text) {
  let m;
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if ((m = t.match(/^(?:its|that creature's) (power|toughness|mana value)$/))) return { calc: 'stat', stat: m[1] === 'mana value' ? 'cmc' : m[1], of: 'prev' };
  if ((m = t.match(/^the sacrificed creature's (power|toughness|mana value)$/))) return { calc: 'stat', stat: m[1] === 'mana value' ? 'cmc' : m[1], of: 'sacrificed' };
  if ((m = t.match(/^(\d+) plus the sacrificed creature's (power|toughness|mana value)$/))) return { calc: 'stat', stat: m[2] === 'mana value' ? 'cmc' : m[2], of: 'sacrificed', base: Number(m[1]) };
  if ((m = t.match(/^(?:the number of )?(.+?) (?:you control|on the battlefield)$/)) && (m = parseTarget(m[0].replace(/^the number of /, '')))) return { calc: 'count', restrict: m.restrict };
  if ((m = t.match(/^the number of (.+?) cards? in your graveyard$/))) return { calc: 'graveyard', what: m[1] };
  if ((m = t.match(/^the number of cards in your hand$/))) return { calc: 'hand', base: 0, sign: 1 };
  return null;
}
const countOf = phrase => { const k = parseTarget(phrase.replace(/^the number of /, '')); return k && k.sel === 'each' && !k.restrict.players ? { calc: 'count', restrict: k.restrict } : null; };
// Build a count-calc from a permanent-descriptor phrase, including bare subtypes (Wizard, Bird, Island, Sliver)
// that parseTarget won't take. Returns null for hand/graveyard/compound phrases so more specific rules win.
const PERM_TYPE_WORDS = ['creature', 'land', 'artifact', 'enchantment', 'permanent', 'planeswalker', 'wall'];
function countPhrase(subject) {
  let str = subject.trim().toLowerCase().replace(/^(?:each |all |every |a |an |another )/, '').replace(/ (?:on the battlefield|in play)$/, '').trim();
  if (/ in (?:their|your|a|all|its|the) | and |greatest|number of|that /.test(str)) return null;
  const r = {};
  if (/ you control$/.test(str)) { r.control = 'you'; str = str.replace(/ you control$/, ''); }
  else if (/ (?:target opponent|an opponent|your opponents?|defending player) controls?$/.test(str)) { r.control = 'opp'; str = str.replace(/ (?:target opponent|an opponent|your opponents?|defending player) controls?$/, ''); }
  else if (/ (?:you|they|that player) controls?$/.test(str)) { r.control = 'you'; str = str.replace(/ (?:you|they|that player) controls?$/, ''); }
  for (const w of str.split(/\s+/).filter(Boolean)) {
    if (['tapped', 'untapped', 'attacking', 'blocking'].includes(w)) r.state = w;
    else if (COLOR_WORD[w]) (r.colors = r.colors || []).push(COLOR_WORD[w]);
    else if (PERM_TYPE_WORDS.includes(w.replace(/s$/, ''))) (r.types = r.types || []).push(w.replace(/s$/, ''));
    else if (/^[a-z][a-z'-]+$/.test(w)) (r.subtypes = r.subtypes || []).push(capSub(w));
    else return null;
  }
  if (!Object.keys(r).length) return null;
  return { calc: 'count', restrict: r, of: r.control === 'you' ? 'you' : undefined };
}
const rules = [
  // Counts of permanents: An-Havva Inn, Typhoon, Primal Order, Goblin Lyre.
  [/^you gain x(?: plus (\d+))? life, where x is the number of (.+)$/, m => { const c = countOf(m[2]); return c ? [{ type: 'gain', amount: { ...c, base: Number(m[1] || 0) }, sel: 'you' }] : null; }],
  [/^~ deals damage to (.+?) equal to the number of (.+?) (they|that player|you) controls?$/, m => { const k = T(m[1]); const c = countOf(m[2] + (m[3] === 'you' ? ' you control' : ' that player controls')); if (!k || !c) return null; c.of = m[3] === 'you' ? 'you' : 'subject'; return [{ type: 'damage', amount: c, ...k }]; }],
  [/^~ deals damage to (.+?) equal to the number of (.+?) in (?:their|that player's) hand$/, () => null],
  [/^~ deals damage to (.+?) equal to the number of cards in (?:their|that player's) hand$/, m => tgt({ type: 'damage', amount: { calc: 'hand', base: 0, sign: 1, of: 'subject' } }, m[1])],
  [/^~ deals damage equal to (?:that creature's|its) (power|toughness) to (.+)$/, m => tgt({ type: 'damageEqualStat', stat: m[1] }, m[2])],
  [/^~ deals that much damage to (.+)$/, m => tgt({ type: 'damage', amount: 'LAST' }, m[1])],
  [/^you gain life equal to (?:its|that creature's) (power|toughness)$/, m => [{ type: 'gainEqualPrev', stat: m[1] }]],
  [/^you gain life equal to the sacrificed creature's (power|toughness|mana value)$/, m => [{ type: 'gainEqualPrev', stat: m[1] === 'mana value' ? 'cmc' : m[1], of: 'sacrificed' }]],
  [/^exchange life totals with (target opponent|target player)$/, m => tgt({ type: 'swapLife' }, m[1])],
  [/^destroy the creature with the least power$/, () => [{ type: 'destroyLeastPower', note: 'ties: every tied creature is destroyed' }]],
  [/^each player chooses a number of lands they control equal to the number of lands controlled by the player who controls the fewest, then sacrifices the rest\. each player discards cards the same way, then sacrifices creatures the same way$/, () => [{ type: 'balance' }]],
  [/^each player shuffles the cards from their hand into their library, then draws that many cards$/, () => [{ type: 'windsOfChange' }]],
  [/^shuffle your graveyard into your library$/, () => [{ type: 'shuffleGraveyard' }]],
  [/^put the top card of your graveyard on the bottom of your library$/, () => [{ type: 'graveyardTopToBottom' }]],
  [/^look at (target player's|target opponent's) hand$/, m => [{ type: 'lookHand', sel: m[1].startsWith('target o') ? 'opponent' : 'player' }]],
  [/^look at a card at random in (target player's|target opponent's) hand$/, m => [{ type: 'lookHand', random: true, sel: m[1].startsWith('target o') ? 'opponent' : 'player' }]],
  [/^exile (target player's|target opponent's) graveyard$/, m => [{ type: 'exileGraveyard', who: 'targetPlayer', sel: m[1].startsWith('target o') ? 'opponent' : 'player' }]],
  [/^return all (.+?) target player owns to their hand$/, m => { const k = T('all ' + m[1]); return k ? [{ type: 'bounceAll', restrict: k.restrict, sel: 'player' }] : null; }],
  [/^target player reveals their hand and discards all nonland cards$/, () => [{ type: 'discard', filter: 'nonland', sel: 'player' }]],
  [/^target player chooses (\S+) cards? from their hand and puts (?:them|it) on top of their library in any order$/, m => [{ type: 'putBack', amount: amt(m[1]), sel: 'player' }]],
  [/^target player discards (\S+) cards?, then draws as many cards as they discarded this way$/, m => [{ type: 'discard', amount: amt(m[1]), sel: 'player' }, { type: 'draw', amount: amt(m[1]), sel: 'prev', note: 'draws the full number even if fewer cards were discarded' }]],
  [/^look at the top (\S+) cards of your library, put one of them into your hand, and exile the rest$/, m => [{ type: 'peek', amount: amt(m[1]), mode: 'pick', sel: 'you', restrict: {} }]],
  [/^look at the top (\S+) cards of (your|target player's) library\. put one of them into your hand and the rest on top of (?:your|their) library in any order$/, m => { const k = m[2] === 'your' ? { sel: 'you', restrict: {} } : T('target player'); return k ? [{ type: 'peek', amount: amt(m[1]), mode: 'handTop', ...k }] : null; }],
  [/^return (target creature) and all (?:white )?auras you own attached to it to their owners' hands$/, m => tgt({ type: 'bounce', note: 'auras go to the graveyard instead of your hand' }, m[1])],
  [/^put (target creature card from a graveyard) onto the battlefield under your control$/, m => tgt({ type: 'fromGraveyard', to: 'battlefield' }, m[1])],
  [/^return that card to the battlefield under your control$/, () => [{ type: 'fromGraveyard', to: 'battlefield', sel: 'prev' }]],
  [/^return that card to its owner's hand$/, () => [{ type: 'fromGraveyard', to: 'hand', sel: 'prev' }]],
  [/^return (?:it|~) to its owner's hand$/, () => [{ type: 'returnSelfToHand' }]],   // recurring Auras: Cessation, Sleeper's Guile, …
  [/^sacrifice (?:it|~)$/, () => [{ type: 'sacrificeSelf' }]],
  [/^sacrifice a creature other than ~\. if you can't, ~ deals (\d+) damage to you$/, m => [{ type: 'sacrifice', what: 'creature', other: true, sel: 'you', orElse: [{ type: 'damage', amount: Number(m[1]), sel: 'you' }] }]],
  [/^(target player|target opponent|each player|each opponent|you|that player|its controller) sacrifices? (?:a|an|\S+) (creature|land|artifact|enchantment|permanent)s?(?: of (?:their|an opponent's) choice)?$/, m => { const k = T(m[1]); return k ? [{ type: 'sacrifice', what: m[2], ...k }] : null; }],
  [/^(each player|that player|target player) sacrifices (?:a|an) (.+?) permanent of their choice$/, m => { const k = T(m[1]); const r = T('all ' + m[2] + ' permanents'); return k && r ? [{ type: 'sacrifice', what: 'permanent', ...k, note: `any permanent may be sacrificed, not only ${m[2]} ones` }] : null; }],
  [/^tap ~ and sacrifice (?:a|an) (creature|land|artifact|permanent) of an opponent's choice$/, m => [{ type: 'tap', sel: 'self' }, { type: 'sacrifice', what: m[1], sel: 'you', note: 'you choose what to sacrifice' }]],
  [/^creatures can't attack this turn$/, () => [{ type: 'flag', flag: 'cantAttack', sel: 'each', restrict: { types: ['creature'] } }]],
  [/^(target creature|it|that creature) can't be blocked by walls this turn$/, m => tgt({ type: 'flag', flag: 'cantBeBlockedByWalls' }, m[1])],
  [/^(target creature|it|that creature) can't be blocked this turn except by walls$/, m => tgt({ type: 'flag', flag: 'blockableOnlyByWalls' }, m[1])],
  [/^prevent all combat damage that would be dealt by (target .+?) this turn$/, m => tgt({ type: 'flag', flag: 'dealsNoCombatDamage' }, m[1])],
  [/^prevent all damage that would be dealt this turn by (target .+?)$/, m => tgt({ type: 'flag', flag: 'dealsNoDamage' }, m[1])],
  [/^prevent all damage that would be dealt to (target .+?) this turn$/, m => tgt({ type: 'flag', flag: 'noDamage' }, m[1])],
  [/^the next time a source of your choice would deal damage to you this turn, prevent that damage$/, () => [{ type: 'dmgRep', to: 'you', action: 'prevent' }]],
  [/^the next time (?:a|an) (white|blue|black|red|green)(?: or (white|blue|black|red|green))? source of your choice would deal damage to you this turn, prevent that damage$/, m => [{ type: 'dmgRep', to: 'you', action: 'prevent', color: m[2] ? [COLOR_WORD[m[1]], COLOR_WORD[m[2]]] : COLOR_WORD[m[1]] }]],
  [/^the next time a source of your choice would deal damage to (target creature) this turn, that source deals that damage to you instead$/, m => { const k = T(m[1]); return k ? [{ type: 'dmgRep', to: 'targetCreature', action: 'redirectToOwner', ...k }] : null; }],
  [/^the next time a source of your choice would deal damage to you this turn, that damage is dealt to target creature of an opponent's choice instead$/, () => [{ type: 'dmgRep', to: 'you', action: 'redirectToCreature', note: "the redirected creature is chosen automatically" }]],
  [/^the next time an unblocked creature of your choice would deal combat damage to you this turn, prevent all but (\d+) of that damage$/, m => [{ type: 'dmgRep', to: 'you', action: 'reduceTo', n: Number(m[1]), sourceType: 'unblockedCreature', combat: true }]],
  [/^prevent all damage that would be dealt to you this turn by attacking creatures without flying$/, () => [{ type: 'dmgRep', to: 'you', action: 'prevent', sourceType: 'attackingNonFlyer', oneShot: false, combat: true }]],
  [/^the next time (?:a|an) (white|blue|black|red|green) or (white|blue|black|red|green) source of your choice would deal damage to you this turn, prevent that damage$/, m => [{ type: 'copShield', from: [COLOR_WORD[m[1]], COLOR_WORD[m[2]]], sel: 'you' }]],
  [/^switch (target creature)'s power and toughness until end of turn$/, m => tgt({ type: 'flag', flag: 'swapPT', temp: true }, m[1])],
  [/^(target .+?|it|that creature) gets ([+-]\S+)\/([+-]\S+) and gains (.+?) until end of turn(?:, where x is (.+))?$/, m => { const k = T(m[1]); if (!k) return null; const kws = m[4].split(/,? and |, /).map(w => cap(w.trim())); if (!kws.every(kw => KEYWORDS.has(kw))) return null; const x = m[5] ? parseWhereX(m[5]) : null; const pt = v => v.toLowerCase().replace('+', '') === 'x' ? (x || 'X') : v.toLowerCase() === '-x' ? '-X' : Number(v); return [{ type: 'pump', p: pt(m[2]), t: pt(m[3]), ...k }, ...kws.map(kw => ({ type: 'grant', keyword: kw, ...k }))]; }],
  [/^(target .+?|it|that creature) gains (.+?) and gets ([+-]\S+)\/([+-]\S+) until end of turn(?:, where x is (.+))?$/, m => { const k = T(m[1]); if (!k) return null; const kws = m[2].split(/,? and |, /).map(w => cap(w.trim())); if (!kws.every(kw => KEYWORDS.has(kw))) return null; const x = m[5] ? parseWhereX(m[5]) : null; const pt = v => v.toLowerCase().replace('+', '') === 'x' ? (x || 'X') : v.toLowerCase() === '-x' ? '-X' : Number(v); return [...kws.map(kw => ({ type: 'grant', keyword: kw, ...k })), { type: 'pump', p: pt(m[3]), t: pt(m[4]), ...k }]; }],
  [/^(target .+?|it|that creature) gets ([+-]\S+)\/([+-]\S+) until end of turn, where x is (.+)$/, m => { const k = T(m[1]); const x = parseWhereX(m[4]); if (!k || !x) return null; const pt = v => v.toLowerCase().replace('+', '') === 'x' ? x : v.toLowerCase() === '-x' ? { ...x, mult: -1 } : Number(v); return [{ type: 'pump', p: pt(m[2]), t: pt(m[3]), ...k }]; }],
  [/^(?:target |x target |one or more target )creatures? gains? (plains|island|swamp|mountain|forest)walk until end of turn$/, m => [{ type: 'grant', keyword: { k: 'Landwalk', land: cap(m[1]) }, sel: 'creature', restrict: { types: ['creature'] } }]],
  [/^all creatures lose flying(?: and islandwalk)? until end of turn$/, () => [{ type: 'loseTemp', keyword: 'Flying', sel: 'each', restrict: { types: ['creature'] } }]],
  [/^add (\{[wubrg]\}) for each (.+?) cards? in your graveyard$/, m => [{ type: 'addMana', mana: [m[1][1].toUpperCase()], times: { calc: 'graveyard', what: m[2] } }]],
  [/^for each (.+?) cards? in (target opponent's|your) graveyard, add \{c\} and you gain 1 life$/, m => [{ type: 'addMana', mana: ['C'], times: { calc: 'graveyard', what: m[1].replace(/ or /g, '|') } }, { type: 'gain', amount: { calc: 'graveyard', what: m[1].replace(/ or /g, '|') }, sel: 'you', note: m[2].startsWith('target') ? 'counts your own graveyard, not the opponent\'s' : undefined }]],
  [/^add an amount of (\{[wubrg]\}) equal to the sacrificed creature's mana value$/, m => [{ type: 'addMana', mana: [m[1][1].toUpperCase()], times: { calc: 'stat', stat: 'cmc', of: 'sacrificed' } }]],
  [/^add x mana of any one color, where x is (.+)$/, m => { const x = parseWhereX(m[1]); return x ? [{ type: 'addMana', any: x }] : null; }],
  [/^add x mana in any combination of \{b\} and\/or \{r\}, where x is (.+)$/, m => { const x = parseWhereX(m[1]); return x ? [{ type: 'addMana', any: x, note: 'all of the mana is one colour' }] : null; }],
  [/^(?:create|put) x (\d+)\/(\d+) (.*?) creature tokens?(?: onto the battlefield)?, where x is (.+)$/, m => { const x = parseWhereX(m[4]); if (!x) return null; const desc = m[3].split(/\s+/); return [{ type: 'token', count: x, p: Number(m[1]), t: Number(m[2]), colors: desc.filter(w => COLOR_WORD[w]).map(w => COLOR_WORD[w]), types: ['creature'], subtypes: desc.filter(w => !COLOR_WORD[w]).map(cap), keywords: [] }]; }],
  // X tokens where X was paid for (Decree of Justice's cycling trigger, X spells)
  [/^(?:create|put) x (\d+)\/(\d+) (.*?) creature tokens?(?: onto the battlefield)?$/, m => { const desc = m[3].split(/\s+/); return [{ type: 'token', count: 'X', p: Number(m[1]), t: Number(m[2]), colors: desc.filter(w => COLOR_WORD[w]).map(w => COLOR_WORD[w]), types: ['creature'], subtypes: desc.filter(w => !COLOR_WORD[w]).map(cap), keywords: [] }]; }],
  [/^counter (?:it|that spell)(?: unless that player pays \{(\w+)\}(?:, where x is its mana value)?)?$/, m => [{ type: 'counter', sel: 'castSpell', unlessPay: m[1] ? (m[1] === 'x' ? { calc: 'stat', stat: 'cmc', of: 'castSpell' } : Number(m[1])) : null }]],
  [/^if this ability has been activated (\S+) or more times this turn, sacrifice ~ at the beginning of the next end step$/, m => [{ type: 'overuse', n: amt(m[1]) }]],
  [/^gain control of (target creature) for as long as you control ~ and ~ remains tapped$/, m => tgt({ type: 'controlLinked' }, m[1])],
  // Card-count and land-count amounts: Black Vise, The Rack, Ivory Tower, Karma.
  [/^~ deals x damage to that player, where x is the number of cards in their hand minus (\d+)$/, m => [{ type: 'damage', amount: { calc: 'hand', base: -Number(m[1]), sign: 1, of: 'thatPlayer' }, sel: 'thatPlayer' }]],
  [/^~ deals x damage to that player, where x is (\d+) minus the number of cards in their hand$/, m => [{ type: 'damage', amount: { calc: 'hand', base: Number(m[1]), sign: -1, of: 'thatPlayer' }, sel: 'thatPlayer' }]],
  [/^~ deals damage to that player equal to the number of (plains|islands|swamps|mountains|forests) they control$/, m => [{ type: 'damage', amount: { calc: 'lands', land: cap(m[1].replace(/s$/, '')), of: 'thatPlayer' }, sel: 'thatPlayer' }]],
  [/^you gain x life, where x is the number of cards in your hand minus (\d+)$/, m => [{ type: 'gain', amount: { calc: 'hand', base: -Number(m[1]), sign: 1, of: 'you' }, sel: 'you' }]],
  // Damage prevention shields and Circles of Protection.
  [/^prevent the next (\d+) damage that would be dealt to (.+?) this turn$/, m => { const w = m[2]; if (w === 'you') return [{ type: 'preventNext', amount: Number(m[1]), sel: 'you' }]; if (w === '~' || w === 'it') return [{ type: 'preventNext', amount: Number(m[1]), sel: 'self' }]; return tgt({ type: 'preventNext', amount: Number(m[1]) }, w); }],
  [/^the next time (?:a|an) (white|blue|black|red|green|artifact) source of your choice would deal damage to you this turn, prevent that damage$/, m => [{ type: 'copShield', from: COLOR_WORD[m[1]] || 'artifact', sel: 'you' }]],
  // Thawing Glaciers, Paralyze, Brainstorm, Pyroblast/Hydroblast, Tawnos's Weaponry, Ice Floe, Spirit Link.
  [/^return ~ to its owner's hand at the beginning of the next (?:cleanup step|end step)$/, () => [{ type: 'delayedBounceSelf' }]],
  [/^tap enchanted creature$/, () => [{ type: 'tap', sel: 'enchanted' }]],
  [/^untap (?:the creature|enchanted creature)$/, () => [{ type: 'untap', sel: 'enchanted' }]],
  [/^put (\S+) cards? from your hand on top of your library(?: in any order)?$/, m => [{ type: 'putBack', amount: amt(m[1]) }]],
  [/^counter target spell if it's (white|blue|black|red|green)$/, m => tgt({ type: 'counter', unlessPay: null }, `target ${m[1]} spell`)],
  [/^destroy target permanent if it's (white|blue|black|red|green)$/, m => tgt({ type: 'destroy' }, `target ${m[1]} permanent`)],
  [/^(target .+?) gets ([+-]\d+)\/([+-]\d+) for as long as ~ remains tapped$/, m => tgt({ type: 'pump', p: Number(m[2]), t: Number(m[3]), whileTapped: true }, m[1])],
  [/^(?:it|that creature) doesn't untap during its controller's untap step for as long as ~ remains tapped$/, () => [{ type: 'freeze', sel: 'prev', note: 'the creature skips one untap step instead of staying tapped while Ice Floe is' }]],
  [/^you gain that much life$/, () => [{ type: 'gainEqualPrev' }]],
  // Jackal Pup: "Whenever ~ is dealt damage, it deals that much damage to you."
  [/^(?:it|~) deals that much damage to (you|.+)$/, m => m[1] === 'you' ? [{ type: 'damage', amount: 'LAST', sel: 'you' }] : tgt({ type: 'damage', amount: 'LAST' }, m[1])],
  // Vendetta / Reanimate: life loss keyed to the creature just destroyed or the card just returned.
  [/^you lose life equal to that creature's (power|toughness)$/, m => [{ type: 'lose', amount: { calc: 'stat', stat: m[1], of: 'prev' }, sel: 'you' }]],
  [/^you lose life equal to (?:that|the) card's mana value$/, () => [{ type: 'lose', amount: { calc: 'stat', stat: 'cmc', of: 'prev' }, sel: 'you' }]],
  // Price of Progress: damage to each player scaled by their nonbasic lands.
  [/^~ deals damage to each player equal to twice the number of nonbasic lands (?:that player|they) controls?$/, () => [{ type: 'damage', amount: { calc: 'lands', nonbasic: true, of: 'subject', mult: 2 }, sel: 'each', restrict: { players: 'all' } }]],
  // Graveyard recursion: Squee, Ashen Ghoul, Nether Shadow, Krovikan Horror, Death Spark.
  [/^return ~ from your graveyard to (your hand|the battlefield)$/, m => [{ type: 'selfFromGraveyard', to: m[1] === 'your hand' ? 'hand' : 'battlefield' }]],
  // Goblin Lackey: put a matching permanent card from your hand onto the battlefield.
  [/^put (?:a|an) (.+?) card from your hand onto the battlefield$/, m => [{ type: 'putFromHand', filter: parseCardFilter(m[1]) }]],
  // Mesmeric Fiend's leave trigger.
  [/^return the exiled card to its owner's hand$/, () => [{ type: 'returnLinkedExile' }]],
  // Gaea's Blessing (approximated: the whole graveyard is shuffled back rather than three chosen cards).
  [/^target player shuffles up to three target cards from their graveyard into their library$/, () => [{ type: 'shuffleGraveyard', sel: 'player', restrict: { players: 'all' }, note: 'shuffles the whole graveyard rather than three chosen cards' }]],
  [/^shuffle your graveyard into your library$/, () => [{ type: 'shuffleGraveyard', sel: 'you' }]],
  // Powder Keg: "Destroy each artifact and creature with mana value equal to the number of fuse counters on ~."
  [/^destroy each (.+?) with mana value equal to the number of (\w+) counters on ~$/, m => { const k = T('each ' + m[1]); if (!k) return null; return [{ type: 'destroyAll', restrict: k.restrict, cmcEq: { calc: 'counters', kind: m[2] } }]; }],
  // Karn, Silver Golem: animate a noncreature artifact with P/T equal to its mana value.
  [/^(target .+?) becomes an artifact creature with power and toughness each equal to its mana value until end of turn$/, m => tgt({ type: 'animateTarget' }, m[1])],
  // Buried Alive: tutor straight to the graveyard.
  [/^search your library for up to (\w+) (.+?) cards?, put them into your graveyard, then shuffle$/, m => [{ type: 'tutor', what: m[2], to: 'graveyard', n: amt(m[1]) || 1 }]],
  // Exhume / Living Death.
  [/^each player puts a creature card from their graveyard onto the battlefield$/, () => [{ type: 'eachReanimate' }]],
  [/^each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield$/, () => [{ type: 'livingDeath' }]],
  // Donate: the player is chosen first, then the permanent that changes hands.
  [/^target player gains control of target permanent you control$/, () => [{ type: 'pickPlayer', sel: 'player' }, { type: 'donate', sel: 'permanent', restrict: { control: 'you' } }]],
  // Pernicious Deed: sweep by mana value paid.
  [/^destroy each (.+?) with mana value x or less$/, m => { const k = T('each ' + m[1]); if (!k) return null; return [{ type: 'destroyAll', restrict: k.restrict, cmcLE: 'X' }]; }],
  // Mishra's Helix (approximated: taps up to X of target opponent's lands).
  [/^tap x target lands$/, () => [{ type: 'tapMany', sel: 'opponent', restrict: { types: ['land'] }, amount: 'X', chooser: 'controller', note: 'taps up to X of target opponent\'s lands' }]],
  // Tangle Wire: that player taps permanents for each fade counter.
  [/^that player taps (?:an? )?(.+?) they control for each (\w+) counter on ~$/, m => { const k = T('each ' + m[1]); if (!k) return null; return [{ type: 'tapMany', sel: 'thatPlayer', restrict: k.restrict, amount: { calc: 'counters', kind: m[2] }, chooser: 'subject' }]; }],
  // Phyrexian Processor.
  [/^pay any amount of life$/, () => [{ type: 'payAnyLife' }]],
  [/^create an? x\/x (.*?) creature tokens?, where x is the life paid(?: as ~ entered)?$/, m => { const desc = m[1].split(/\s+/); return [{ type: 'token', count: 1, p: { calc: 'paidLife' }, t: { calc: 'paidLife' }, colors: desc.filter(w => COLOR_WORD[w]).map(w => COLOR_WORD[w]), types: ['creature'], subtypes: desc.filter(w => !COLOR_WORD[w]).map(cap), keywords: [] }]; }],
  // Cunning Wish: fetch a card from the sideboard, then the spell exiles itself.
  [/^(?:choose an? (instant|sorcery|creature|artifact|enchantment|land) card you own from outside the game, reveal that card, and put it into your hand|reveal an? (instant|sorcery|creature|artifact|enchantment|land) card you own from outside the game and put it into your hand)$/, m => [{ type: 'wish', what: m[1] || m[2] }]],
  [/^exile ~$/, () => [{ type: 'exileSelfSpell' }]],
  [/^destroy ~$/, () => [{ type: 'destroy', sel: 'self' }]],   // Volrath's Dungeon's escape hatch
  // Chain of Vapor: the bounce works; the chain (sacrifice a land to copy the spell) is not offered.
  [/^then that permanent's controller may sacrifice a land of their choice$/, () => []],
  [/^if the player does, they may copy ~ and may choose a new target for that copy$/, () => [{ type: 'noop', note: 'the chain (sacrifice a land to copy the spell) is not offered' }]],
  // Smokestack: each player sacrifices per soot counter.
  [/^that player sacrifices a permanent of their choice for each (\w+) counter on ~$/, m => [{ type: 'sacrificeMany', sel: 'thatPlayer', what: 'permanent', amount: { calc: 'counters', kind: m[1] } }]],
  // Teferi's Response (approximated: counters a spell an opponent controls; the land-targeting condition and abilities are not handled).
  [/^counter target spell or ability an opponent controls that targets a land you control$/, () => [{ type: 'counter', sel: 'spell', restrict: { spellKind: 'spell' }, unlessPay: null, note: 'counters a spell (not an ability); the "targets a land you control" condition is not enforced' }]],
  [/^if a permanent's ability is countered this way, destroy that permanent$/, () => []],
  // Volrath's Dungeon.
  [/^(target player) puts a card from their hand on top of their library$/, m => tgt({ type: 'handToTop' }, m[1])],
  // Engineered Plague / Evacuation / Hibernation / Flaring Pain / Gerrard's Wisdom.
  [/^choose a creature type$/, () => [{ type: 'chooseType' }]],
  [/^choose a color$/, () => [{ type: 'chooseColorSelf' }]],
  [/^~ becomes the color of your choice until end of turn$/, () => [{ type: 'chooseColorSelf', temp: true }]],
  [/^~ becomes the creature type of your choice until end of turn$/, () => [{ type: 'chooseType', temp: true }]],
  [/^return all (.+?) to their owners' hands$/, m => { const k = T('all ' + m[1]); return k ? [{ type: 'bounceAllPerms', restrict: k.restrict }] : null; }],
  [/^damage can't be prevented this turn$/, () => [{ type: 'noPrevent' }]],
  [/^you gain (\d+) life for each card in your hand$/, m => [{ type: 'gain', amount: { calc: 'hand', base: 0, sign: 1, mult: Number(m[1]) }, sel: 'you' }]],
  [/^(?:~|it|that creature) deals (\S+) damage to (.+?)(?: and (\S+) damage to (.+))?$/, m => {
    const a = tgt({ type: 'damage', amount: amt(m[1]) }, m[2]); if (!a) return null;
    if (m[3]) { const b = tgt({ type: 'damage', amount: amt(m[3]) }, m[4]); if (!b) return null; a.push(...b); }
    return a;
  }],
  [/^~ deals damage equal to its power to (.+)$/, m => tgt({ type: 'damageEqualPower' }, m[1])],
  [/^~ deals (\S+) damage to each creature (with|without) flying and each player$/, m => [{ type: 'damage', amount: amt(m[1]), sel: 'each', restrict: { types: ['creature'], flying: m[2] === 'with', players: 'all' } }]],
  [/^~ deals (\S+) damage to each creature and each player$/, m => [{ type: 'damage', amount: amt(m[1]), sel: 'each', restrict: { types: ['creature'], players: 'all' } }]],
  [/^~ deals (\S+)(?: plus (\d+))? damage divided (?:evenly|as you choose)[^]*$/, m => [{ type: 'damage', amount: m[2] ? { calc: 'x', base: Number(m[2]) } : amt(m[1]), sel: 'any', restrict: {}, note: 'damage not divided' }]],
  [/^~ deals damage to that player equal to the number of (.+?) they control$/, m => { const c = countOf(m[1] + ' that player controls'); return c ? [{ type: 'damage', amount: { ...c, of: 'subject' }, sel: 'thatPlayer' }] : null; }],
  // "have it deal X damage to target creature, where X is ..." — cycling triggers like Gempalm Incinerator
  [/^have (?:it|~) deal (\S+) damage to (.+?)(?:, where x is (.+))?$/, m => { const amount = m[3] ? parseWhereX(m[3]) : amt(m[1]); return amount != null && !Number.isNaN(amount) ? tgt({ type: 'damage', amount }, m[2]) : null; }],   // also Slice and Dice's "each creature"
  [/^~ fights (.+)$/, m => tgt({ type: 'fight' }, m[1])],
  [/^destroy all (.+?)(?:\. they can't be regenerated)?$/, m => { const k = T('all ' + m[1]); if (!k) return null; return [{ type: 'destroyAll', restrict: k.restrict }]; }],
  [/^destroy (target .+?)(?:\. it can't be regenerated)?$/, m => tgt({ type: 'destroy' }, m[1])],
  [/^exile all (.+)$/, m => { const k = T('all ' + m[1]); if (!k) return null; return [{ type: 'exileAll', restrict: k.restrict }]; }],
  [/^exile (target .+)$/, m => tgt({ type: 'exile' }, m[1])],
  [/^return (target .+?) to (?:its|their) owner's hand$/, m => tgt({ type: 'bounce' }, m[1])],
  [/^return (target .+?) to your hand$/, m => tgt({ type: 'bounce' }, m[1])],
  [/^return (target .+? (?:from|in) your graveyard) to your hand$/, m => tgt({ type: 'fromGraveyard', to: 'hand' }, m[1])],
  [/^return (target .+? (?:from|in) your graveyard) to the battlefield(?: under your control)?( tapped)?$/, m => tgt({ type: 'fromGraveyard', to: 'battlefield', tapped: !!m[2] }, m[1])],
  [/^return (target .+?) to the battlefield under your control$/, m => tgt({ type: 'fromGraveyard', to: 'battlefield' }, m[1])],
  // "gets +2/+0 until end of turn for each other attacking Goblin" (Goblin Piledriver and kin)
  [/^(target .+?|enchanted creature|~|it|that creature) gets ([+-]\d+)\/([+-]\d+) until end of turn for each (other )?(.+)$/, m => {
    const k = T(m[1]); if (!k) return null;
    const c = countPhrase(m[5]); if (!c) return null;
    if (m[4]) c.restrict.other = true;
    const mk = v => v === 0 ? 0 : { ...c, restrict: { ...c.restrict }, mult: v };
    return [{ type: 'pump', p: mk(Number(m[2])), t: mk(Number(m[3])), ...k }];
  }],
  // "gets +2/+2 until end of turn and gains trample until end of turn" or the shorter "gets +2/+2 and gains trample until end of turn"
  [/^(target .+?|enchanted creature|~|it|that creature|[a-z][a-z /-]*?) gets? ([+-]\S+)\/([+-]\S+)(?: and (?:gains|has) (.+?))? until end of turn(?: and (?:gains|has) (.+?) until end of turn)?$/, m => {
    const k = T(m[1]); if (!k) return null;
    const p = m[2].toLowerCase().replace('+', ''), t = m[3].toLowerCase().replace('+', '');
    const e = [{ type: 'pump', p: p === 'x' ? 'X' : p === '-x' ? '-X' : Number(p), t: t === 'x' ? 'X' : t === '-x' ? '-X' : Number(t), ...k }];
    const kwText = m[4] || m[5];
    if (kwText) { const kws = kwText.split(/,? and |, /).map(s => cap(s.trim())); for (const kw of kws) { if (!KEYWORDS.has(kw)) return null; e.push({ type: 'grant', keyword: kw, ...k }); } }
    return e;
  }],
  [/^(target .+?|enchanted creature|~|it|that creature|[a-z][a-z /-]*?) (?:gains?|has|have) (.+?) until end of turn$/, m => {
    const k = T(m[1]); if (!k) return null;
    const kws = m[2].split(/,? and |, /).map(s => cap(s.trim()));
    const out = [];
    for (const kw of kws) {
      if (KEYWORDS.has(kw)) out.push({ type: 'grant', keyword: kw, ...k });
      else if (/^(Plains|Island|Swamp|Mountain|Forest)walk$/.test(kw)) out.push({ type: 'grant', keyword: { k: 'Landwalk', land: kw.replace(/walk$/, '') }, ...k });
      else if (/^protection from (white|blue|black|red|green)$/i.test(kw)) out.push({ type: 'grant', keyword: { k: 'Protection', from: COLOR_WORD[kw.toLowerCase().replace('protection from ', '')] }, ...k });
      else return null;
    }
    return out;
  }],
  [/^(target .+?|it|that creature) can't (block|attack|attack or block|be blocked) this turn$/, m => tgt({ type: 'flag', flag: { block: 'cantBlock', attack: 'cantAttack', 'attack or block': 'cantAttackOrBlock', 'be blocked': 'unblockable' }[m[2]] }, m[1])],
  [/^(?:you )?draw (\S+) cards?(?:, then discard (\S+) (?:cards?|of them))?$/, m => { const e = [{ type: 'draw', amount: amt(m[1]), sel: 'you' }]; if (m[2]) e.push({ type: 'discard', amount: amt(m[2]), sel: 'you' }); return e; }],
  // loot: a named subject draws then discards (Cephalid Looter/Broker, Merfolk Looter's target forms)
  [/^(you|target player|target opponent|each player|each opponent|that player) draws? (\S+) cards?, then discards? (\S+) (?:cards?|of them)( at random)?$/, m => { const k = m[1] === 'you' ? { sel: 'you' } : T(m[1]); if (!k) return null; return [{ type: 'draw', amount: amt(m[2]), ...k }, { type: 'discard', amount: amt(m[3]), random: !!m[4], ...k }]; }],
  [/^its controller may draws? (\S+|a) cards?$/, m => [{ type: 'draw', amount: amt(m[1] === 'a' ? '1' : m[1]), sel: 'you' }]],
  [/^(?:defending player|target opponent|each other player|each opponent) may draws? (?:up to )?(\S+|a) cards?$/, m => { const k = /defending/.test(m[0]) ? { sel: 'each', restrict: { players: 'opp' } } : /each other|each opponent/.test(m[0]) ? { sel: 'each', restrict: { players: 'opp' } } : { sel: 'opponent' }; return [{ type: 'draw', amount: amt(m[1] === 'a' ? '1' : m[1]), ...k }]; }],
  [/^target player skips their next draw step$/, () => [{ type: 'skipDrawStep', sel: 'player' }]],
  [/^any number of target opponents each discard their hands, then draw (\S+) cards?$/, m => [{ type: 'discard', all: true, sel: 'each', restrict: { players: 'opp' } }, { type: 'draw', amount: amt(m[1]), sel: 'each', restrict: { players: 'opp' } }]],
  // variable draw: "draw a card for each attacking creature" and "for each <perm> you control"
  [/^shuffle a card from your hand into your library$/, () => [{ type: 'shuffleIn', sel: 'you', amount: 1 }]],   // Lat-Nam's Legacy
  [/^each of that player's opponents draws? (\S+) cards?$/, m => [{ type: 'draw', amount: amt(m[1]), sel: 'thatOpp' }]],   // Standstill
  [/^(?:you )?draw an additional card$/, () => [{ type: 'draw', amount: 1, sel: 'you' }]],
  [/^draw a card and reveal it$/, () => [{ type: 'draw', amount: 1, sel: 'you', note: 'the reveal and discard-if-nonland are not enforced' }]],
  [/^(target player|you) draws? cards? equal to the number of cards in (?:their|your) hand, then discards? that many cards?$/, m => { const k = m[1] === 'you' ? { sel: 'you' } : T(m[1]); return k ? [{ type: 'drawDiscardHand', ...k }] : null; }],
  [/^(?:you )?draw (?:a card|cards) for each attacking creature$/, () => [{ type: 'draw', amount: { calc: 'attackers' }, sel: 'you' }]],
  [/^(?:you )?draw (?:a card|cards) for each (.+)$/, m => { const c = countPhrase(m[1]); return c ? [{ type: 'draw', amount: c, sel: 'you' }] : null; }],
  [/^(target player|target opponent|each player|each opponent|that player) draws? (?:a card|cards) for each (.+)$/, m => { const k = T(m[1]); const c = countPhrase(m[2]); return k && c ? [{ type: 'draw', amount: c, ...k }] : null; }],
  [/^(?:you )?draw cards equal to the number of (.+)$/, m => { const c = countPhrase(m[1]); return c ? [{ type: 'draw', amount: c, sel: 'you' }] : null; }],
  [/^(?:you )?draw cards equal to the greatest mana value among permanents you control$/, () => [{ type: 'draw', amount: { calc: 'maxCmc', control: 'you' }, sel: 'you' }]],
  [/^shuffle the cards from your hand into your library, then draw that many cards$/, () => [{ type: 'shuffleHandDraw' }]],
  [/^put (\S+) cards? from your hand on the bottom of your library$/, m => [{ type: 'putBottom', amount: amt(m[1]) }]],
  [/^each player draws (\S+) cards?, then discards (\S+) cards?(?:, then loses (\d+) life)?$/, m => { const e = [{ type: 'draw', amount: amt(m[1]), sel: 'each', restrict: { players: 'all' } }, { type: 'discard', amount: amt(m[2]), sel: 'each', restrict: { players: 'all' } }]; if (m[3]) e.push({ type: 'lose', amount: Number(m[3]), sel: 'each', restrict: { players: 'all' } }); return e; }],
  [/^you draw (\S+) cards?, then each other player draws (\S+) cards?$/, m => [{ type: 'draw', amount: amt(m[1]), sel: 'you' }, { type: 'draw', amount: amt(m[2]), sel: 'each', restrict: { players: 'opp' } }]],
  [/^discard (?:all the cards in your hand|your hand), then draw that many cards$/, () => [{ type: 'discardDraw', sel: 'you' }]],
  [/^(target player|target opponent|each player|each opponent) draws (\S+) cards?$/, m => { const k = T(m[1]); return k ? [{ type: 'draw', amount: amt(m[2]), ...k }] : null; }],
  [/^(target player|target opponent|each player|each opponent|you|that player|that opponent|defending player) discards? (\S+) cards?( at random)?$/, m => { const k = T(m[1]); return k ? [{ type: 'discard', amount: amt(m[2]), random: !!m[3], ...k }] : null; }],
  [/^discard (\S+) cards?( at random)?$/, m => [{ type: 'discard', amount: amt(m[1]), random: !!m[2], sel: 'you' }]],
  [/^(target player|target opponent|each player|each opponent|you|that player) discards? (?:their|your) hand$/, m => { const k = T(m[1]); return k ? [{ type: 'discard', all: true, ...k }] : null; }],
  [/^(that player|target player|target opponent) gets (\S+) poison counters?$/, m => { const k = T(m[1]); return k ? [{ type: 'poison', amount: amt(m[2]), ...k }] : null; }],
  [/^(that player|target player|each player|each opponent|target opponent) (?:draws|draw) (\S+) cards?$/, m => { const k = T(m[1]); return k ? [{ type: 'draw', amount: amt(m[2]), ...k }] : null; }],
  [/^(that player|target player) (gains|loses) (\S+) life$/, m => { const k = T(m[1]); return k ? [{ type: m[2] === 'gains' ? 'gain' : 'lose', amount: amt(m[3]), ...k }] : null; }],
  [/^look at the top (\S+) cards? of (your|target player's) library(, then put (?:them|it) back in any order|\. you may put (?:them|it) on the bottom of your library in any order)?$/, m => {
    const k = m[2] === 'your' ? { sel: 'you', restrict: {} } : T('target player');
    const mode = !m[3] ? 'look' : m[3].startsWith(',') ? 'reorder' : 'bottom';
    return [{ type: 'peek', amount: amt(m[1]), mode, ...k }];
  }],
  [/^a creature dealt damage this way can't be regenerated this turn$/, () => []],
  [/^you may put (?:it|that card) on the bottom of your library$/, () => []],
  [/^(?:you )?gain (\S+) life$/, m => [{ type: 'gain', amount: amt(m[1]), sel: 'you' }]],
  [/^(?:you )?lose (\S+) life$/, m => [{ type: 'lose', amount: amt(m[1]), sel: 'you' }]],
  [/^(target player|target opponent|each player|each opponent) gains (\S+) life$/, m => { const k = T(m[1]); return k ? [{ type: 'gain', amount: amt(m[2]), ...k }] : null; }],
  [/^(target player|target opponent|each player|each opponent) loses (\S+) life$/, m => { const k = T(m[1]); return k ? [{ type: 'lose', amount: amt(m[2]), ...k }] : null; }],
  [/^its controller gains life equal to its power$/, () => [{ type: 'gainEqualPower', sel: 'prev' }]],
  [/^you gain life equal to (?:the damage dealt this way|its power|that creature's power)$/, () => [{ type: 'gainEqualPrev' }]],
  [/^(target player|target opponent|each player|each opponent|that player) mills (\S+) cards?$/, m => { const k = T(m[1]); return k ? [{ type: 'mill', amount: amt(m[2]), ...k }] : null; }],
  [/^(?:you )?mill (\S+) cards?$/, m => [{ type: 'mill', amount: amt(m[1]), sel: 'you' }]],
  [/^counter (target(?: .+?)? spell)(?: unless its controller pays \{(\w+)\})?$/, m => { const k = T(m[1]); if (!k) return null; return [{ type: 'counter', unlessPay: m[2] ? (m[2].toUpperCase() === 'X' ? 'X' : Number(m[2])) : null, ...k }]; }],
  [/^counter (target spell with mana value x)$/, m => { const k = T(m[1]); return k ? [{ type: 'counter', unlessPay: null, note: 'X must equal the spell\'s mana value; the game does not enforce it', ...k }] : null; }],
  [/^counter (target(?: .+?)? spell)\. if that spell is countered this way, put it on top of its owner's library instead of into that player's graveyard$/, m => { const k = T(m[1]); return k ? [{ type: 'counter', toTop: true, unlessPay: null, ...k }] : null; }],
  [/^counter (target(?: .+?)? spell) that targets a permanent you control$/, m => { const k = T(m[1]); return k ? [{ type: 'counter', unlessPay: null, note: 'only counters spells that target a permanent you control; not enforced', ...k }] : null; }],
  [/^search your library for (?:a|an|up to \S+) (.+?) cards?(?:, reveal (?:it|that card|them),)?(?:,)? (?:and )?put (?:it|that card|them) (into your hand|onto the battlefield( tapped)?|on top of your library)(?:, then shuffle| and shuffle|, then shuffle your library| and shuffle your library)?$/, m => {
    const what = m[1].replace(/ or /g, '|'); const to = m[2].startsWith('into') ? 'hand' : m[2].startsWith('on top') ? 'top' : 'battlefield';
    return [{ type: 'tutor', what, to, tapped: !!m[3] }];
  }],
  // Mercenary / Rebel chains: "Search your library for a Mercenary permanent card with mana value N or less, put it onto the battlefield, then shuffle."
  [/^search your library for (?:a|an) (.+?) permanent card with mana value (\d+) or less, put it onto the battlefield, then shuffle$/, m => [{ type: 'tutor', what: m[1].replace(/ or /g, '|'), maxMv: Number(m[2]), to: 'battlefield' }]],
  [/^search your library for a card, put (?:it|that card) into your hand, then shuffle$/, () => [{ type: 'tutor', what: 'card', to: 'hand' }]],
  [/^search your library for a card and put (?:it|that card) into your hand\. then shuffle$/, () => [{ type: 'tutor', what: 'card', to: 'hand' }]],
  [/^tap (target .+)$/, m => tgt({ type: 'tap' }, m[1])],
  [/^discard x cards, then return a card from your graveyard to your hand for each card discarded this way$/, () => [{ type: 'recall', sel: 'you', amount: 'X' }]],   // Recall
  [new RegExp('^untap (up to )?' + AMT + ' (lands?|creatures?|artifacts?|permanents?|nonland permanents?)(?: you control)?$'), m => { const k = T('all ' + m[3]); return k ? [{ type: 'untapMany', sel: 'you', restrict: k.restrict, amount: amt(m[2]), upTo: !!m[1] }] : null; }],   // Frantic Search
  [/^untap (target .+)$/, m => tgt({ type: 'untap' }, m[1])],
  [/^tap or untap (target .+)$/, m => tgt({ type: 'tapOrUntap' }, m[1])],
  [/^tap all (.+?)$/, m => { const k = T('all ' + m[1]); return k ? [{ type: 'tapAll', restrict: k.restrict }] : null; }],
  [/^untap all (.+?)$/, m => { const k = T('all ' + m[1]); return k ? [{ type: 'untapAll', restrict: k.restrict }] : null; }],
  [/^(?:it|that creature|that permanent|enchanted creature|~|target .+?) doesn't untap during (?:its controller's|your) (?:next )?untap step$/, m => [{ type: 'freeze', sel: 'prev' }]],
  [/^(target player|target opponent|each player|each opponent|you) sacrifices? (?:a|an|\S+) (creature|land|artifact|enchantment|permanent)s?$/, m => { const k = T(m[1]); return k ? [{ type: 'sacrifice', what: m[2], ...k }] : null; }],
  [/^sacrifice ~$/, () => [{ type: 'sacrificeSelf' }]],
  [/^sacrifice (?:a|an) (creature|land|artifact|permanent)$/, m => [{ type: 'sacrifice', what: m[1], sel: 'you' }]],
  [/^gain control of (target .+?)( until end of turn)?$/, m => tgt({ type: 'control', until: m[2] ? 'eot' : null }, m[1])],
  [/^put (?:up to )?(\S+) ([+-]\d+\/[+-]\d+|[a-z]+) counters? on (.+)$/, m => tgt({ type: 'counters', kind: m[2], amount: amt(m[1]) }, m[3])],
  [/^remove (a|an|\S+) ([+-]\d+\/[+-]\d+|[a-z]+) counters? from (~|it|that creature|target .+)$/, m => tgt({ type: 'counters', kind: m[2], amount: -(amt(m[1]) || 1) }, m[3])],
  [/^(?:you )?draw a card at the beginning of the next turn's upkeep$/, () => [{ type: 'delayedDraw' }]],
  [/^(?:you |target player |its controller )?(?:may )?draws? (?:up to )?(\S+) cards? at the beginning of the next turn's upkeep$/, m => [/its controller/.test(m[0]) ? { type: 'counterBonusDraw', amount: amt(m[1]) } : { type: 'delayedDraw', amount: amt(m[1]), sel: /target player/.test(m[0]) ? 'target' : 'you' }]],
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
  [/^(?:you |target player )?skips? (?:your |their )?next turn$/, m => [{ type: 'skipTurn', sel: /target player|their/.test(m[0]) ? 'target' : 'you' }]],
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
  [/^destroy (?:that creature|that wall|it|the other creature) at end of combat$/, () => [{ type: 'flag', flag: 'destroyAtEndOfCombat', sel: 'prev' }]],
  [/^at the beginning of the next end step, destroy (?:that creature|it)( if it attacked this turn)?$/, m => [{ type: 'delayed', when: 'end', effects: [{ type: 'destroy', sel: 'prev' }], cond: m[1] ? 'attacked' : null }]],
  [/^destroy (?:that creature|it) at the beginning of the next end step$/, () => [{ type: 'delayed', when: 'end', effects: [{ type: 'destroy', sel: 'prev' }] }]],
  [/^when (?:that creature|the creature) leaves the battlefield this turn, sacrifice ~$/, () => [{ type: 'delayed', when: 'leaves', effects: [{ type: 'sacrificeSelf' }] }]],
  [/^destroy ~$/, () => [{ type: 'destroy', sel: 'self' }]],
  [/^(?:~ )?deals (\S+) damage to you$/, m => [{ type: 'damage', amount: amt(m[1]), sel: 'you' }]],
  [/^(?:~ |it )?deals (\S+) damage to itself$/, m => [{ type: 'damage', amount: amt(m[1]), sel: 'self' }]],
  [/^remove ~ from combat and tap it$/, () => [{ type: 'removeFromCombat', sel: 'self' }, { type: 'tap', sel: 'self' }]],
  [/^remove ~ from combat and it can't block this turn$/, () => [{ type: 'removeFromCombat', sel: 'self' }, { type: 'flag', flag: 'cantBlock', sel: 'self' }]],
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
  [/^~ can't be countered$/, () => []],
  // Manlands: "~ becomes a 2/2 Assembly-Worker artifact creature until end of turn" (Mishra's Factory, etc.)
  // Also "2/1 blue Faerie creature with flying until end of turn" (Faerie Conclave, Treetop Village) and the
  // permanent "3/3 Elemental artifact creature that's still a land" (Stalking Stones).
  [/^~ becomes a (\d+)\/(\d+)(.*?) creature(?: with (.+?))? (until end of turn|that's still a land)(?:\. it's still a land)?$/, m => {
    const words = (m[3] || '').trim().split(/\s+/).filter(Boolean);
    const SUPER = ['artifact', 'enchantment', 'land'];
    const types = ['creature', ...words.filter(w => SUPER.includes(w))];
    const subtypes = words.filter(w => !SUPER.includes(w) && !COLOR_WORD[w]).map(cap);
    const keywords = m[4] ? m[4].split(/,? and |, /).map(s => cap(s.trim())) : [];
    if (keywords.some(kw => !KEYWORDS.has(kw))) return null;
    return [{ type: 'animateSelf', p: Number(m[1]), t: Number(m[2]), types, subtypes, keywords, permanent: m[5] !== 'until end of turn' }];
  }],
  [/^it's still a land$/, () => []],   // reminder text: manlands remain lands in the engine anyway
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
  if ((um = t.match(/^(.+?) unless (you|they|that player) pays? ((?:\{[^}]+\})+)$/)) || (um = t.match(/^unless (you) pay ((?:\{[^}]+\})+), (.+)$/))) {
    const pre = um[3].startsWith('{') ? false : true;
    const body = pre ? um[3] : um[1], cost = pre ? um[2] : um[3], payer = pre ? 'you' : um[2];
    const inner = parseSentence(body);
    if (inner) return [{ type: 'unlessPay', cost: parseCost(cost.toUpperCase()), effects: inner, payer: payer === 'you' ? 'you' : 'thatPlayer' }];
  }
  if ((um = t.match(/^(.+?) unless (you|they|that player) pays? (\d+) life$/))) {
    const inner = parseSentence(um[1]);
    if (inner) return [{ type: 'unlessPay', life: Number(um[3]), effects: inner, payer: um[2] === 'you' ? 'you' : 'thatPlayer' }];
  }
  // Masticore: "sacrifice ~ unless you discard a card"
  if ((um = t.match(/^(.+?) unless you discard a card$/))) {
    const inner = parseSentence(um[1]);
    if (inner) return [{ type: 'unlessDiscard', effects: inner }];
  }
  for (const splitter of [/, then /, /\. then /, / and (?=you |target |~ |each |all |put |untap |tap |draw |discard |destroy |exile |return |gain |lose |that |deals |it deals )/]) {
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
  const whole = body.replace(/\s+/g, ' ').replace(/\.$/, '').trim();   // collapse newlines so multi-sentence whole-text rules match
  if (/^each player chooses a number of lands they control equal to the number of lands controlled by the player who controls the fewest, then sacrifices the rest\. (?:each player discards cards the same way, then sacrifices creatures the same way|players discard cards and sacrifice creatures the same way)$/.test(whole)) { out.effects.push({ type: 'balance' }); return out; }
  let wm;
  // Cabal Ritual: "Add {B}{B}{B}. Threshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard."
  if ((wm = whole.match(/^add ((?:\{[wubrgc]\})+)\. (?:threshold — )?add ((?:\{[wubrgc]\})+) instead if there are seven or more cards in your graveyard$/))) { const base = [...wm[1].matchAll(/\{(\w)\}/g)].map(x => x[1].toUpperCase()); const thr = [...wm[2].matchAll(/\{(\w)\}/g)].map(x => x[1].toUpperCase()); out.effects.push({ type: 'addMana', mana: base, threshold: thr }); return out; }
  if ((wm = whole.match(/^sacrifice a creature other than ~\. if you can't, ~ deals (\d+) damage to you$/))) { out.effects.push({ type: 'sacrifice', what: 'creature', other: true, sel: 'you', orElse: [{ type: 'damage', amount: Number(wm[1]), sel: 'you' }] }); return out; }
  if (/^each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way$/.test(whole)) { out.effects.push({ type: 'windfall' }); return out; }
  if (/^each player discards any number of cards, then draws that many cards$/.test(whole)) { out.effects.push({ type: 'fluxDiscard' }); return out; }
  if ((wm = whole.match(/^domain — (target player|you) draws? a card for each basic land type among lands (?:they|you) controls?$/))) { const k = wm[1] === 'you' ? { sel: 'you' } : T(wm[1]); if (k) { out.effects.push({ type: 'draw', amount: { calc: 'domain', of: k.sel === 'you' ? 'you' : 'subject' }, ...k }); return out; } }
  if (/^draw four cards, then choose x cards in your hand and discard the rest$/.test(whole)) { out.effects.push({ type: 'draw', amount: 4, sel: 'you' }, { type: 'discardDownTo', amount: 'X', sel: 'you' }); return out; }
  if (/^draw a card, then draw cards equal to the number of cards named ~ in all graveyards$/.test(whole)) { out.effects.push({ type: 'draw', amount: 1, sel: 'you' }, { type: 'draw', amount: { calc: 'graveyardNameAll' }, sel: 'you' }); return out; }
  // Hand disruption: Duress / Unmask ("... that player discards that card") and Mesmeric Fiend ("exile that card").
  if ((wm = whole.match(/^(target opponent|target player) reveals their hand(?:,? and|\.) you choose (?:a|an) (.+?) card from it\. (exile that card|(?:that player|they) discards? that card)$/))) { const k = T(wm[1]); if (k) { out.effects.push({ type: 'handPick', action: wm[3].startsWith('exile') ? 'exile' : 'discard', filter: parseCardFilter(wm[2]), ...k }); return out; } }
  // Cabal Therapy (approximated: you see the hand and name a card in it; all copies are discarded).
  if ((wm = whole.match(/^choose a nonland card name\. (target player|target opponent) reveals their hand and discards all cards with that name$/))) { const k = T(wm[1]); if (k) { out.effects.push({ type: 'handPick', action: 'discardName', filter: { not: ['land'] }, note: 'the hand is revealed before the name is chosen', ...k }); return out; } }
  // Intuition: three cards, the opponent picks the one you keep.
  if (/^search your library for three cards and reveal them\. target opponent chooses one\. put that card into your hand and the rest into your graveyard(?:\. then shuffle)?$/.test(whole)) { out.effects.push({ type: 'intuition', sel: 'opponent' }); return out; }
  // Fact or Fiction.
  if (/^reveal the top five cards of your library\. an opponent separates those cards into two piles\. put one pile into your hand and the other into your graveyard$/.test(whole)) { out.effects.push({ type: 'fof' }); return out; }
  // Stronghold Gambit: everyone reveals a card; creature cards hit the table.
  if ((wm = whole.match(/^each player chooses a card in their hand\. then each player reveals (?:the|their) chosen card\. the owner of each creature card revealed this way( with the lowest mana value)? puts it onto the battlefield$/))) { out.effects.push({ type: 'gambit', lowest: !!wm[1] }); return out; }
  // Cursed Scroll.
  if ((wm = whole.match(/^choose a card name(?:, then|\.) reveal a card at random from your hand\. if that card has the chosen name, ~ deals (\d+) damage to any target$/))) { out.effects.push({ type: 'cursedScroll', amount: Number(wm[1]), sel: 'any', restrict: {} }); return out; }
  // Goblin Ringleader: reveal the top N, take the matching ones, bottom the rest.
  if ((wm = whole.match(/^reveal the top (\S+) cards? of your library\. put all (.+?) cards revealed this way into your hand and the rest on the bottom of your library(?: in any order)?$/))) { out.effects.push({ type: 'revealTake', amount: amt(wm[1]), filter: parseCardFilter(wm[2]) }); return out; }

  if ((wm = whole.match(/^draw (\S+) cards?, then put (\S+) cards? from your hand on the bottom of your library$/))) { out.effects.push({ type: 'draw', amount: amt(wm[1]), sel: 'you' }, { type: 'putBottom', amount: amt(wm[2]) }); return out; }
  if ((wm = whole.match(/^draw (\S+) cards?, then put (\S+) cards? from your hand (?:both )?on top of your library(?: or (?:both )?on the bottom of your library)?(?: in any order)?$/))) { out.effects.push({ type: 'draw', amount: amt(wm[1]), sel: 'you' }, { type: 'putBack', amount: amt(wm[2]) }); return out; }
  if ((wm = whole.match(/^look at the top (\S+) cards? of your library\. put one of them into your hand and (?:the other|the rest(?: of them)?)(?: cards?)? on the bottom of your library(?: in any order)?$/))) { out.effects.push({ type: 'peek', amount: amt(wm[1]), mode: 'handBottom', sel: 'you', restrict: {} }); return out; }
  const sentences = body.split(/(?<=\.)\s+(?=[A-Z~"])/i).map(s => s.trim()).filter(Boolean);
  for (let i = 0; i < sentences.length; i++) {
    let s = sentences[i];
    let ifDid = false;
    if (/^if you do,/i.test(s)) {   // mandatory "sacrifice ~. If you do, …": runs only if the previous effect happened
      if (out.notes.length && /^Ignored: /.test(out.notes[out.notes.length - 1]) && !out.optional) { out.notes.push('Ignored: ' + s.slice(0, 80)); continue; }   // its condition was not understood either
      s = s.replace(/^if you do, /i, ''); if (!out.optional) ifDid = true;
    }
    if (/^flip a coin\.?$/.test(s)) {
      const branch = {};
      while (i + 1 < sentences.length) {
        const nm = sentences[i + 1].match(/^if you (win|lose) the flip, (.+)$/);
        if (!nm) break;
        const inner = parseSentence(nm[2].replace(/\.$/, ''));
        if (!inner) { out.notes.push('Ignored: ' + sentences[i + 1].slice(0, 80)); i++; continue; }
        for (const x of inner) if (x.sel === 'opponent') { x.sel = 'each'; x.restrict = { players: 'opp' }; } // no targeting inside a coin flip
        branch[nm[1]] = inner; i++;
      }
      const coin = { type: 'coin', win: branch.win || [], lose: branch.lose || [] };
      // A target inside a branch is chosen up front: the coin carries the target and the branches refer back to it.
      const first = [...coin.win, ...coin.lose].find(needsTarget);
      if (first) { coin.sel = first.sel; coin.restrict = first.restrict; for (const x of [...coin.win, ...coin.lose]) if ((needsTarget(x) && x.sel === first.sel) || x.sel === 'self') { x.sel = 'prev'; delete x.restrict; } }
      out.effects.push(coin);
      continue;
    }
    const last = out.effects[out.effects.length - 1];
    // Riders: a sentence that upgrades the previous effect in place instead of adding a new one.
    if (last && last.type === 'counter' && /^if that spell is countered this way, put it on top of its owner's library instead of into that player's graveyard$/i.test(s.replace(/\.$/, ''))) { last.toTop = true; continue; }
    if (last && last.type === 'peek' && /^put one of them into your hand and the rest on top of (?:your|their) library in any order$/i.test(s.replace(/\.$/, ''))) { last.mode = 'handTop'; continue; }
    if (last && last.type === 'peek' && /^you may have that player shuffle$/i.test(s.replace(/\.$/, ''))) { last.mayShuffle = true; continue; }
    if (last && last.type === 'dmgRep' && /^you gain life equal to the damage prevented(?: this way)?$/i.test(s.replace(/\.$/, ''))) { last.gainLife = true; continue; }
    const e = parseSentence(s);
    if (e) { if (ifDid) for (const x of e) x.ifDid = true; out.effects.push(...e); for (const x of e) if (x.note) out.notes.push('Approximated: ' + x.note); }
    else out.notes.push('Ignored: ' + s.slice(0, 80));
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
    else if ((m = p.match(/^sacrifice (a|an|another|two|three|\d+) (?:(snow|white|blue|black|red|green|untapped) )?([a-z]+?)(?: (token))?s?$/i)) && /^[a-z]+$/i.test(m[3])) {
      cost.sacrifice = m[3].toLowerCase() === 'plain' ? 'plains' : m[3].toLowerCase(); cost.sacN = amt(m[1].toLowerCase()) || 1;
      if (m[2] && COLOR_WORD[m[2].toLowerCase()]) cost.sacColor = COLOR_WORD[m[2].toLowerCase()];
      if (m[2] && m[2].toLowerCase() === 'snow') cost.sacSnow = true;
      if (m[4]) cost.sacToken = true;
    }
    else if (/^exile ~$/i.test(p)) cost.exileSelf = true;
    else if ((m = p.match(/^put a ([+-]\d+\/[+-]\d+|\w+) counter on ~$/i))) cost.addCounter = { kind: m[1].toLowerCase(), n: 1 };   // Wall of Roots
    else if (/^return ~ to its owner's hand$/i.test(p)) cost.returnSelf = true;   // Recurring Nightmare
    else if ((m = p.match(/^exile the top (\w+) cards? of your library$/i))) cost.exileTop = amt(m[1].toLowerCase()) || 1;
    else if ((m = p.match(/^tap an untapped (plains|island|swamp|mountain|forest) you control$/i))) cost.tapLand = cap(m[1].toLowerCase());
    else if ((m = p.match(/^remove any number of (\w+) counters from ~$/i))) cost.removeCounter = { kind: m[1].toLowerCase(), n: 'all' };
    else if ((m = p.match(/^discard (a|an|\w+) (?:(nonblack|black|white|blue|red|green|colorless|land|nonland|creature|artifact|nonartifact) )?cards?(?: at random)?$/i))) { cost.discard = amt(m[1].toLowerCase()) || 1; if (m[2]) cost.discardFilter = m[2].toLowerCase(); }
    else if (/^discard ~$/i.test(p)) cost.discardSelf = true;
    else if ((m = p.match(/^pay (\d+) life$/i))) cost.life = Number(m[1]);
    else if ((m = p.match(/^remove (a|an|\w+) ([+-]1\/[+-]1|\w+) counters? from ~$/i))) cost.removeCounter = { kind: m[2].toLowerCase(), n: amt(m[1].toLowerCase()) || 1 };
    else if (/^exile ~ from your graveyard$/i.test(p)) cost.exileSelfFromGraveyard = true;
    else if ((m = p.match(/^exile (a|an|\w+) cards? from your graveyard$/i))) cost.exileFromGraveyard = amt(m[1].toLowerCase()) || 1;   // Grim Lavamancer
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
      else if (m && m[1] === 'Fading') found.push({ k: 'Fading', n: Number(m[2]) });   // Blastoderm, Tangle Wire
      else if (m && m[1] === 'Amplify') def._amplify = Number(m[2]);   // enters with N counters per revealed card sharing a creature type
      else def.notes.push(`${p} ignored`);
    }
    else if ((m = p.match(/^Rampage (\d+)$/))) found.push({ k: 'Rampage', n: Number(m[1]) });
    else if (/^Morph (\{.+\}|\S.*)$/.test(p)) def.notes.push('Morph ignored: the creature is cast face up only');   // Dwarven Blastminer & co. keep their other abilities
    else if (UNSUPPORTED_KW.has(p) || UNSUPPORTED_KW.has(p.split(' ')[0])) { def.unsupportedReason = `${p} is not supported`; }
    else if ((m = p.match(/^Protection from (.+)$/))) {
      const from = m[1].toLowerCase();
      if (COLOR_WORD[from]) found.push({ k: 'Protection', from: COLOR_WORD[from] });
      else if (['artifacts', 'creatures', 'everything', 'instants', 'sorceries', 'enchantments'].includes(from)) found.push({ k: 'Protection', from });
      else if (/^(white|blue|black|red|green) and (?:from )?(white|blue|black|red|green)$/.test(from)) { for (const c of from.split(/ and (?:from )?/)) found.push({ k: 'Protection', from: COLOR_WORD[c] }); }   // Akroma: "from black and from red"
      else def.notes.push(`${p} ignored`);
    }
    else if ((m = p.match(/^(Plains|Island|Swamp|Mountain|Forest)walk$/))) found.push({ k: 'Landwalk', land: m[1] });
    else if ((m = p.match(/^Snow (plains|island|swamp|mountain|forest)walk$/i))) found.push({ k: 'Landwalk', land: cap(m[1].toLowerCase()), snow: true });
    else if ((m = p.match(/^(Legendary )?landwalk$/i))) def.notes.push(`${p} ignored`);
    else if ((m = p.match(/^Cumulative upkeep[—\s-]+(.+)$/))) { const c = parseAbilityCost(m[1].replace(/\.$/, '')); if (c && !c.sacSelf) found.push({ k: 'Cumulative upkeep', cost: c }); else def.notes.push('Cumulative upkeep ignored'); }
    else if ((m = p.match(/^Cycling (\{.+\})$/))) found.push({ k: 'Cycling', cost: parseCost(m[1]) });
    else if ((m = p.match(/^Kicker (\{.+\})$/))) found.push({ k: 'Kicker', cost: parseCost(m[1]) });
    else if ((m = p.match(/^Flashback (\{.+\})$/))) found.push({ k: 'Flashback', cost: parseCost(m[1]) });
    else if ((m = p.match(/^Flashback—sacrifice (?:a|an) (\w+)$/i))) found.push({ k: 'Flashback', cost: { pips: [], generic: 0, x: false }, sacrifice: m[1].toLowerCase() });   // Cabal Therapy
    else if ((m = p.match(/^Buyback (\{.+\})$/))) found.push({ k: 'Buyback', cost: parseCost(m[1]) });
    else if ((m = p.match(/^Echo (\{.+\})$/))) found.push({ k: 'Echo', cost: parseCost(m[1]) });
    else if ((m = p.match(/^Equip (\{.+\}|\d+)$/))) found.push({ k: 'Equip', cost: parseCost(m[1].startsWith('{') ? m[1] : `{${m[1]}}`) });
    else if ((m = p.match(/^Enchant (creature|permanent|land|artifact|enchantment|wall|creature you control|land you control|artifact an opponent controls|creature an opponent controls|player|opponent)$/i))) found.push({ k: 'Enchant', what: m[1].toLowerCase() });
    else if (/^Kicker /.test(p) || /^Flashback /.test(p) || /^Buyback /.test(p)) def.notes.push(`${p} ignored`);
    else return false;
  }
  def.keywords.push(...found);
  return true;
}

// ---- static abilities ------------------------------------------------------------
function parseStatic(t) {
  let m;
  t = t.replace(/\s*this effect can't reduce the mana in that cost to less than one mana\.?$/, '');
  // Threshold statics lead with the condition: "Threshold — As long as seven or more cards are in your graveyard, ~ gets +1/+1 and has flying."
  if ((m = t.match(/^(?:threshold — )?as long as (?:there are )?seven or more cards (?:are )?in your graveyard, (.+)$/))) { const inner = parseStatic(m[1]); if (!inner) return null; for (const o of inner) o.condition = { ...(o.condition || {}), threshold: true }; return inner; }
  // Effect-first threshold wording: "~ gets +2/+2 as long as there are seven or more cards in your graveyard." (Nimble Mongoose, Werebear, Krosan Beast).
  if ((m = t.match(/^(?:threshold — )?(.+?) as long as (?:there are )?seven or more cards (?:are )?in your graveyard$/))) { const inner = parseStatic(m[1]); if (!inner) return null; for (const o of inner) o.condition = { ...(o.condition || {}), threshold: true }; return inner; }
  // "~ can't be countered" / "this spell can't be countered": a cast-time flag, harmless as a static on a permanent.
  if (/^(?:~|this spell|this creature) can't be countered(?: by spells or abilities)?$/.test(t)) return [{ type: 'static', kind: 'uncounterable', scope: { who: 'self' } }];
  // "~ gets +1/+1 and can't block" (Putrid Imp): a P/T change riding with a combat restriction.
  if ((m = t.match(/^(.+?) and can't (block|attack|attack or block)$/))) { const inner = parseStatic(m[1]); if (!inner) return null; return [...inner, { type: 'static', kind: { block: 'cantBlock', attack: 'cantAttack', 'attack or block': 'cantAttackOrBlock' }[m[2]], scope: inner[0].scope }]; }
  // Crumbling Sanctuary: damage to a player exiles that many cards from their library instead.
  if (/^if damage would be dealt to a player, that player exiles that many cards from the top of their library instead$/.test(t)) return [{ type: 'static', kind: 'damageToLibrary', scope: { who: 'self' } }];
  // Phantom Nishoba: damage is prevented and costs a +1/+1 counter instead.
  if (/^if damage would be dealt to ~, prevent that damage\. remove a \+1\/\+1 counter from ~$/.test(t)) return [{ type: 'static', kind: 'phantom', scope: { who: 'self' } }];
  if (/^if a player would gain life, that player gains no life instead$/.test(t)) return [{ type: 'static', kind: 'noLifeGain', scope: { who: 'self' } }];   // Sulfuric Vortex
  if (/^players can cast spells and activate abilities only during their own turns$/.test(t)) return [{ type: 'static', kind: 'ownTurnOnly', scope: { who: 'self' } }];   // City of Solitude
  if (/^creatures with power greater than the number of cards in your hand can't attack$/.test(t)) return [{ type: 'static', kind: 'bridge', scope: { who: 'self' } }];   // Ensnaring Bridge
  if (/^all creatures lose all abilities and (?:are|have base power and toughness) 1\/1$/.test(t)) return [{ type: 'static', kind: 'humility', scope: { who: 'all', types: ['creature'] } }];   // Humility
  if (/^activated abilities of artifacts can't be activated$/.test(t)) return [{ type: 'static', kind: 'nullRod', scope: { who: 'self' } }];   // Null Rod
  if ((m = t.match(/^if you control a creature,? (?:and )?damage that would reduce your life total to less than (\d+) reduces it to \1 instead$/))) return [{ type: 'static', kind: 'lifeFloor', n: Number(m[1]), scope: { who: 'self' }, condition: { controlsCreature: true } }];   // Worship
  if ((m = t.match(/^as long as ~ is untapped, (.+)$/))) { const inner = parseStatic(m[1]); if (!inner) return null; for (const o of inner) o.condition = { selfUntapped: true }; return inner; }
  if ((m = t.match(/^(.+?)\. otherwise, it gets ([+-]\d+)\/([+-]\d+)$/))) { const inner = parseStatic(m[1]); if (!inner || !inner.every(o => o.condition)) return null; return [...inner, { type: 'static', kind: 'pt', p: Number(m[2]), t: Number(m[3]), scope: inner[0].scope, condition: { ...inner[0].condition, negate: true } }]; }
  if ((m = t.match(/^players can't untap more than (one|two) (creature|land|artifact)s? during their untap steps$/))) return [{ type: 'static', kind: 'untapLimit', what: m[2], n: NUM[m[1]], scope: { who: 'self' } }];
  if ((m = t.match(/^creatures with power (\d+) or greater don't untap during their controllers' untap steps$/))) return [{ type: 'static', kind: 'doesntUntap', scope: { who: 'all', types: ['creature'], powerGE: Number(m[1]) } }];
  if ((m = t.match(/^(.+?) don't untap during their controllers' untap steps$/))) { const scope = parseScope(m[1]); return scope ? [{ type: 'static', kind: 'doesntUntap', scope }] : null; }
  if ((m = t.match(/^~ doesn't untap during your untap step if it has a (\w+) counter on it$/))) return [{ type: 'static', kind: 'doesntUntap', scope: { who: 'self' }, condition: { hasCounter: m[1] } }];
  if ((m = t.match(/^(.+?) can't attack$/)) && !/^~|enchanted/.test(m[1])) { const scope = parseScope(m[1]); return scope ? [{ type: 'static', kind: 'cantAttack', scope }] : null; }
  if ((m = t.match(/^all creatures lose (flying)(?: and islandwalk)?$/))) return [{ type: 'static', kind: 'loseKeyword', keyword: 'Flying', scope: { who: 'all', types: ['creature'] } }, ...(/islandwalk/.test(t) ? [{ type: 'static', kind: 'loseKeyword', keyword: 'Landwalk', scope: { who: 'all', types: ['creature'] } }] : [])];
  if ((m = t.match(/^enchanted creature loses (flying|first strike|trample)$/))) return [{ type: 'static', kind: 'loseKeyword', keyword: cap(m[1]), scope: { who: 'enchanted' } }];
  if ((m = t.match(/^creatures with (plains|island|swamp|mountain|forest)walk can be blocked as though they didn't have \1walk$/))) return [{ type: 'static', kind: 'ignoreLandwalk', land: cap(m[1]), scope: { who: 'self' } }];
  if (/^creatures with landwalk abilities can be blocked as though they didn't have those abilities$/.test(t)) return [{ type: 'static', kind: 'ignoreLandwalk', land: null, scope: { who: 'self' } }];
  // Defense Grid: a tax that only applies off-turn.
  if ((m = t.match(/^each spell costs \{(\d+)\} more to cast except during its controller's turn$/))) return [{ type: 'static', kind: 'costMod', delta: Number(m[1]), filter: {}, who: 'all', offTurn: true, scope: { who: 'self' } }];
  if ((m = t.match(/^(?:(.+?) )?spells?( you cast| your opponents cast)? costs? \{(\d+)\} (more|less) to cast$/))) {
    const kinds = !m[1] ? null : m[1].split(/ and | or /).map(w => w.trim());
    const f = {};
    if (kinds) {
      const cols = kinds.filter(k => COLOR_WORD[k]).map(k => COLOR_WORD[k]); const ks = kinds.filter(k => !COLOR_WORD[k]);
      if (cols.length) f.colors = cols;
      const KINDS = ['creature', 'noncreature', 'artifact', 'enchantment', 'instant', 'sorcery'];
      const plain = ks.filter(k => KINDS.includes(k)), subs = ks.filter(k => !KINDS.includes(k));
      if (plain.length) f.kinds = plain;
      if (subs.some(k => !/^[a-z]+(?:-[a-z]+)?$/.test(k))) return null;
      if (subs.length) f.subtypes = subs.map(capSub);   // "Goblin spells you cast cost {1} less" (Goblin Warchief)
    }
    return [{ type: 'static', kind: 'costMod', delta: (m[4] === 'more' ? 1 : -1) * Number(m[3]), filter: f, who: m[2] === ' your opponents cast' ? 'opp' : m[2] ? 'you' : 'all', scope: { who: 'self' } }];
  }
  if (/^you may play any number of lands on each of your turns$/.test(t)) return [{ type: 'static', kind: 'extraLands', any: true, who: 'you', scope: { who: 'self' } }];
  if (/^each player may play an additional land during each of their turns$/.test(t)) return [{ type: 'static', kind: 'extraLands', n: 1, who: 'all', scope: { who: 'self' } }];
  if (/^you may play an additional land on each of your turns$/.test(t)) return [{ type: 'static', kind: 'extraLands', n: 1, who: 'you', scope: { who: 'self' } }];
  if (/^artifacts, creatures, and lands your opponents control enter tapped$/.test(t)) return [{ type: 'static', kind: 'oppEntersTapped', scope: { who: 'self' } }];
  if (/^you have no maximum hand size$/.test(t)) return [{ type: 'static', kind: 'noMaxHand', scope: { who: 'self' } }];
  if ((m = t.match(/^all (lands|(?:plains|islands|swamps|mountains|forests)) are (\d+)\/(\d+)(?: (?:white|blue|black|red|green))? creatures that are still lands$/))) {
    const scope = m[1] === 'lands' ? { who: 'all', types: ['land'] } : { who: 'all', types: ['land'], subtype: cap(m[1].replace(/s$/, '')) };
    return [{ type: 'static', kind: 'animateLand', p: Number(m[2]), t: Number(m[3]), scope }];
  }
  if ((m = t.match(/^damage that would reduce your life total to less than (\d+) reduces it to \1 instead$/))) return [{ type: 'static', kind: 'lifeFloor', n: Number(m[1]), scope: { who: 'self' } }];
  if (/^~ can't be the target of aura spells$/.test(t)) return [{ type: 'static', kind: 'noAuras', scope: { who: 'self' } }];
  if ((m = t.match(/^~ can't attack if defending player controls an untapped creature with power (\d+) or greater$/))) return [{ type: 'static', kind: 'cantAttackIfDefenderPower', n: Number(m[1]), scope: { who: 'self' } }];
  if (/^prevent all combat damage that would be dealt to and dealt by enchanted creature$/.test(t)) return [{ type: 'static', kind: 'noCombatDamage', scope: { who: 'enchanted' } }];
  if (/^prevent all damage that would be dealt to ~ by creatures it's blocking$/.test(t)) return [{ type: 'static', kind: 'noCombatDamageTo', scope: { who: 'self' } }];
  if ((m = t.match(/^prevent all damage that would be dealt to (enchanted creature|~) by (artifact|white|blue|black|red|green) sources$/))) return [{ type: 'static', kind: 'preventFrom', from: COLOR_WORD[m[2]] || 'artifact', scope: parseScope(m[1]) }];
  if ((m = t.match(/^you control enchanted (creature|land|artifact|permanent)$/))) return [{ type: 'static', kind: 'control', scope: { who: 'enchanted' } }];
  if ((m = t.match(/^(~|enchanted creature) has shroud as long as it's untapped$/))) return [{ type: 'static', kind: 'keyword', keyword: 'Shroud', scope: parseScope(m[1]), condition: m[1] === '~' ? { selfUntapped: true } : { enchantedUntapped: true } }];
  if ((m = t.match(/^(~|enchanted creature|enchanted land) can't be enchanted by other auras$/))) return [{ type: 'static', kind: 'noop', scope: { who: 'self' } }];
  if ((m = t.match(/^(~|enchanted creature) can't be the target of spells(?: and can't be enchanted by other auras)?$/))) return [{ type: 'static', kind: 'keyword', keyword: 'Shroud', scope: parseScope(m[1]), note: 'abilities cannot target it either' }];
  if ((m = t.match(/^if ~ would enter, sacrifice (?:a|an) (untapped )?(plains|island|swamp|mountain|forest) instead\. if you do, put ~ onto the battlefield\. if you don't, put it into its owner's graveyard$/))) return [{ type: 'static', kind: 'entersSacrifice', land: cap(m[2]), untapped: !!m[1], scope: { who: 'self' } }];
  if (/^as ~ enters, choose an opponent$/.test(t)) return [{ type: 'static', kind: 'noop', scope: { who: 'self' } }];
  if (/^as ~ enters, choose a color$/.test(t)) return [{ type: 'triggered', event: 'etb', effects: [{ type: 'chooseColorSelf' }], optional: false, text: 'as ~ enters, choose a color' }];
  if ((m = t.match(/^(enchanted wall|enchanted creature) can attack as though it didn't have defender$/))) return [{ type: 'static', kind: 'canAttackWithDefender', scope: { who: 'enchanted' } }];
  if ((m = t.match(/^whenever enchanted land is tapped for mana, its controller adds an additional \{([wubrg])\}$/))) return [{ type: 'static', kind: 'manaBonus', mana: m[1].toUpperCase(), scope: { who: 'enchanted' } }];
  if (/^whenever a player taps a land for mana, that player adds one mana of any type that land produced$/.test(t)) return [{ type: 'static', kind: 'manaBonus', mana: 'same', scope: { who: 'all', types: ['land'] } }];
  // "Creatures you control get +1/+1." "Other Goblin creatures get +1/+0." "All Walls get..." "Enchanted creature gets +2/+2 and has flying."
  if ((m = t.match(/^(enchanted creature|equipped creature|~|other (.+?)|all (.+?)|(.+?) you control|(.+?) creatures|.+?) (?:gets?|has|have|gains?) (.+?)(?: as long as (.+))?$/))) {
    const scopeText = m[1], cond = m[7];
    let rest = m[6], extraNote = null;
    if (/ and can't be the target of spells$/.test(rest)) { rest = rest.replace(/ and can't be the target of spells$/, ''); rest += ' and has shroud'; extraNote = 'abilities cannot target it either'; }
    if (/ and can only attack alone$/.test(rest)) { rest = rest.replace(/ and can only attack alone$/, ''); extraNote = 'it may attack alongside other creatures'; }
    if (/ and can't be enchanted by other auras$/.test(rest)) rest = rest.replace(/ and can't be enchanted by other auras$/, '');
    const scope = parseScope(scopeText); if (!scope) return null;
    const out = [];
    const parts = /^"/.test(rest) ? [rest] : rest.split(/ and (?=has|have|gains?|gets?|\+|-)|, /).map(s => s.trim());
    for (const part of parts) {
      let mm;
      if ((mm = part.match(/^(?:gets? |gains? |has |have )?([+-]\d+)\/([+-]\d+)$/))) out.push({ type: 'static', kind: 'pt', p: Number(mm[1]), t: Number(mm[2]), scope });
      else if ((mm = part.match(/^(?:has |have |gains? )?(.+)$/))) {
        const kws = /^"/.test(mm[1]) ? [mm[1]] : mm[1].split(/,? and |, /).map(s => cap(s.trim()));
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
      let cm, c = null;
      if ((cm = cond.match(/^you control (?:a|an) (plains|island|swamp|mountain|forest)$/))) c = { landType: cap(cm[1]) };
      else if (/^you control a snow land$/.test(cond)) c = { snowLand: true };
      else if (/^~ is untapped$/.test(cond)) c = { selfUntapped: true };
      else if (/^it's untapped$/.test(cond)) c = scope.who === 'enchanted' ? { enchantedUntapped: true } : { selfUntapped: true };
      else if ((cm = cond.match(/^it's (white|blue|black|red|green)$/)) && scope.who === 'enchanted') c = { enchantedColor: COLOR_WORD[cm[1]] };
      else if ((cm = cond.match(/^an opponent controls (?:a|an) (.+)$/))) { const k = parseTarget('each ' + cm[1]); if (!k) return null; c = { oppControls: k.restrict }; }
      else if ((cm = cond.match(/^you control no (.+)$/))) { const k = parseTarget('each ' + cm[1]); if (!k) return null; c = { youControlNone: k.restrict }; }
      else return null;
      for (const o of out) o.condition = c;
    }
    if (extraNote) for (const o of out) o.note = extraNote;
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
  if ((m = t.match(/^~'s (power and toughness are each|power is|toughness is) equal to (?:(\d+) plus )?the number of (.+?)$/)) && /(?: you control| on the battlefield|your opponents control)$/.test(m[3])) {
    const k = parseTarget(m[3]); if (!k || k.sel !== 'each') return null;
    return [{ type: 'static', kind: 'cda', count: m[3], restrict: k.restrict, base: Number(m[2] || 0), which: m[1].startsWith('power and') ? 'both' : m[1].startsWith('power') ? 'p' : 't', scope: { who: 'self' } }];
  }
  if ((m = t.match(/^~'s power and toughness are each equal to the number of (.+?) you control$/))) return [{ type: 'static', kind: 'cda', count: m[1], scope: { who: 'self' } }];
  if ((m = t.match(/^~'s power and toughness are each equal to the number of cards in your hand$/))) return [{ type: 'static', kind: 'cda', count: 'cards in hand', scope: { who: 'self' } }];
  if ((m = t.match(/^~'s power and toughness are each equal to the total number of cards in all players' hands$/))) return [{ type: 'static', kind: 'cda', count: 'cards in all hands', scope: { who: 'self' } }];   // Multani, Maro-Sorcerer
  if ((m = t.match(/^~'s power is equal to the number of creature cards in all graveyards and its toughness is equal to that number plus 1$/))) return [{ type: 'static', kind: 'cda', count: 'creature cards in graveyards', plusT: 1, scope: { who: 'self' } }];
  if (/^~ enters(?: the battlefield)? tapped$/.test(t)) return [{ type: 'static', kind: 'entersTapped', scope: { who: 'self' } }];
  if ((m = t.match(/^~ enters(?: the battlefield)? with (\S+) ([+-]\d+\/[+-]\d+|[a-z]+) counters? on it$/))) return [{ type: 'static', kind: 'entersWithCounters', amount: amt(m[1]), counter: m[2], scope: { who: 'self' } }];
  // "~ enters tapped with two depletion counters on it" (Hickory Woodlot, Peat Bog, Sandstone Needle, …): both at once.
  if ((m = t.match(/^~ enters(?: the battlefield)? tapped with (\S+) ([a-z]+) counters? on it$/))) return [{ type: 'static', kind: 'entersTapped', scope: { who: 'self' } }, { type: 'static', kind: 'entersWithCounters', amount: amt(m[1]), counter: m[2], scope: { who: 'self' } }];
  if (/^you may choose not to untap ~ during your untap step$/.test(t)) return [{ type: 'static', kind: 'mayNotUntap', scope: { who: 'self' } }];
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
  if (t === 'all creatures of the chosen type') return { who: 'all', types: ['creature'], subtype: '$chosen' };   // Engineered Plague
  if (t === 'enchanted creature' || t === 'enchanted permanent' || t === 'enchanted land' || t === 'enchanted wall' || t === 'equipped creature') return { who: 'enchanted' };
  if (t === 'creatures you control' || t === 'all creatures you control') return { who: 'you', types: ['creature'] };
  if (t === 'all creatures' || t === 'creatures' || t === 'each creature') return { who: 'all', types: ['creature'] };
  let m;
  if ((m = t.match(/^(other )?(.+?) creatures you control$/))) return { who: 'you', types: ['creature'], subtype: cap(m[2]), other: !!m[1] };
  if ((m = t.match(/^(other )?(.+?) creatures$/))) { const w = m[2]; return COLOR_WORD[w] ? { who: 'all', types: ['creature'], color: COLOR_WORD[w], other: !!m[1] } : { who: 'all', types: ['creature'], subtype: cap(w), other: !!m[1] }; }
  if ((m = t.match(/^(other |all )?(\w+)s$/))) return { who: 'all', types: ['creature'], subtype: cap(m[2].replace(/s$/, '') === m[2] ? m[2] : m[2]), other: (m[1] || '').trim() === 'other' };
  if ((m = t.match(/^(other |all )?(\w+)$/)) && !/^(?:creatures|artifacts|lands|permanents|enchantments)$/.test(m[2])) return { who: 'all', types: ['creature'], subtype: cap(m[2]), other: (m[1] || '').trim() === 'other' };
  const k = parseTarget(t.replace(/^all /, ''));
  if (k && k.sel === 'each' && !k.restrict.players) return { who: k.restrict.control === 'you' ? 'you' : k.restrict.control === 'opp' ? 'opp' : 'all', restrict: { ...k.restrict, control: undefined }, other: !!k.restrict.other };
  return null;
}

// ---- ability lines ---------------------------------------------------------------
function parseAbilityLine(line, ctx) {
  let m;
  let t = line.trim().replace(/\s*this effect doesn't remove ~\.?$/i, '').replace(/\.$/, '');
  t = t.replace(/^as (~|this [a-z]+) enters(?: the battlefield)?, /i, 'when ~ enters, ');   // lower-case: the trigger matcher below is case-sensitive
  // "Threshold — {R}, {T}, Sacrifice ~: ..." — the ability word is decoration; the condition rides at the end.
  const thresholdWord = /^threshold — /i.test(t); if (thresholdWord) t = t.replace(/^threshold — /i, '');
  // activated: "cost: effect"
  if ((m = t.match(/^((?:(?:\{[^}]+\})+|[^:{}]+?)(?:,\s*(?:(?:\{[^}]+\})+|[^:{}]+?))*):\s+(.+)$/)) && /\{|sacrifice|discard|pay|remove|tap|put a/i.test(m[1])) {
    const cost = parseAbilityCost(m[1]);
    if (!cost) return null;
    let body = m[2];
    let timing = 'instant', limit = 0, condition = null;   // limit: activations allowed per turn (0 = unlimited)
    body = body.replace(/\s*activate (?:this ability )?only (as a sorcery|once each turn|during your turn and only once each turn|during your upkeep and only once each turn|during your upkeep and only if [^.]+|during your upkeep|during your turn|during combat|if [^.]+|any time you could cast a sorcery)\.?$/i, (s, w) => {
      let cm;
      if (/sorcery$/.test(w) || /cast a sorcery/.test(w)) timing = 'sorcery';
      else if ((cm = w.match(/^during your upkeep and only if (.+)$/))) { timing = 'upkeep'; condition = parseCondText(cm[1]); }
      else if (/^during your upkeep/.test(w)) { timing = 'upkeep'; if (/once each turn/.test(w)) limit = 1; }
      else if (/^during your turn and/.test(w)) { timing = 'yourTurn'; limit = 1; }
      else if (/once each turn/.test(w)) limit = 1;
      else if ((cm = w.match(/^if (.+)$/))) condition = parseCondText(cm[1]);
      return '';
    });
    if (thresholdWord && !condition) condition = { threshold: true };
    // Gemstone Mine: a mana ability that sacrifices its source once its counters run out.
    let sacWhenEmpty = null;
    body = body.replace(/\.?\s*if there are no (\w+) counters on ~, sacrifice it\.?$/i, (s, k) => { sacWhenEmpty = k.toLowerCase(); return ''; });
    // Undiscovered Paradise: the land bounces itself during your next untap step after being tapped for mana.
    let bounceOnUntap = false;
    body = body.replace(/\.?\s*during your next untap step, as you untap your permanents, return ~ to its owner's hand\.?$/i, () => { bounceOnUntap = true; return ''; });
    // Cinder Marsh, Mogg Hollows, Rootwater Depths, …: "{T}: Add {B} or {R}. This land doesn't untap during your
    // next untap step." — strip the untap restriction so the mana line parses, and flag it on the ability.
    let noUntapNext = false;
    body = body.replace(/\.?\s*(?:~|this land|this permanent) doesn't untap during your next untap step\.?$/i, () => { noUntapNext = true; return ''; });
    // Volrath's Dungeon: "Any player may activate this ability but only during their turn" — only the controller can here.
    let anyPlayerNote = null;
    body = body.replace(/\.?\s*any player may activate this ability but only during (?:their|its owner's) upkeep\.?$/i, () => { timing = 'upkeep'; anyPlayerNote = 'only its controller can activate it (any player may, in the real rules)'; return ''; });
    body = body.replace(/\.?\s*any player may activate this ability but only during their turn\.?$/i, () => { timing = 'yourTurn'; anyPlayerNote = 'only its controller can activate it (any player may, in the real rules)'; return ''; });
    body = body.replace(/\.?\s*any player may activate this ability\.?$/i, () => { anyPlayerNote = 'only its controller can activate it (any player may, in the real rules)'; return ''; });
    const manaExtra = { ...(limit ? { limit } : {}), ...(sacWhenEmpty ? { sacWhenEmpty } : {}), ...(bounceOnUntap ? { bounceOnUntap: true } : {}), ...(noUntapNext ? { noUntapNext: true } : {}) };
    // Metalworker: "{T}: Reveal any number of artifact cards in your hand. Add {C}{C} for each card revealed this way."
    let mw;
    if ((mw = body.match(/^reveal any number of (\w+) cards in your hand\. add ((?:\{c\})+) for each card revealed this way\.?$/))) return { type: 'mana', cost, produces: ['C'], amount: { calc: 'handKind', what: mw[1], mult: mw[2].match(/\{c\}/g).length }, ...manaExtra };
    body = body.replace(/\s*this ability can't cause the total number of [^.]*\.?/i, ' ').trim();
    body = body.replace(/\s*activate (?:this ability )?no more than (once|twice|\w+) (?:times? )?each turn\.?$/i, (s, w) => { limit = w === 'once' ? 1 : w === 'twice' ? 2 : (NUM[w] ?? Number(w) ?? 1) || 1; return ''; });
    body = body.replace(/\s*activate only during your upkeep\.?$/i, () => { timing = 'upkeep'; return ''; });
    // mana ability
    let mm;
    if ((mm = body.match(/^add ((?:\{[wubrgc]\})+)\.?$/))) return { type: 'mana', cost, produces: [...new Set([...mm[1].matchAll(/\{(\w)\}/g)].map(x => x[1].toUpperCase()))] , amount: [...mm[1].matchAll(/\{(\w)\}/g)].length, ...manaExtra };
    if ((mm = body.match(/^add (\{[wubrgc]\})(?: or (\{[wubrgc]\}))+\.?$/))) return { type: 'mana', cost, produces: [...body.matchAll(/\{(\w)\}/g)].map(x => x[1].toUpperCase()), amount: 1, ...manaExtra };
    if ((mm = body.match(/^add ((?:\{[wubrgc]\})(?: or \{[wubrgc]\})*)\. put a (\w+) counter on ~\.?$/))) return { type: 'mana', cost, produces: [...mm[1].matchAll(/\{(\w)\}/g)].map(x => x[1].toUpperCase()), amount: 1, counter: mm[2] };
    if ((mm = body.match(/^add (\{[wubrgc]\}) for each (\w+) counter removed this way\.?$/)) && cost.removeCounter?.n === 'all') return { type: 'mana', cost, produces: [mm[1][1].toUpperCase()], amount: 1 };
    if ((mm = body.match(/^add (\S+) mana of any one color\.?$/))) return { type: 'mana', cost, produces: COLORS.slice(), amount: amt(mm[1]), sameColor: true };
    if (/^add one mana of any color\.?$/.test(body)) return { type: 'mana', cost, produces: COLORS.slice(), amount: 1, ...manaExtra };
    if (/^add one mana of any type that a land you control could produce\.?$/.test(body)) return { type: 'mana', cost, produces: [], reflect: true, amount: 1 };   // Reflecting Pool
    if (/^add one mana of the chosen color\.?$/.test(body)) return { type: 'mana', cost, produces: COLORS.slice(), chosen: true, amount: 1, ...manaExtra };
    if (/^add \{c\}\{c\}\.?$/.test(body)) return { type: 'mana', cost, produces: ['C'], amount: 2 };
    if ((mm = body.match(/^add (\{[wubrgc]\}), then add an additional \1 for each (\w+) counter removed this way\.?$/)) && cost.removeCounter?.n === 'all') return { type: 'mana', cost, produces: [mm[1][1].toUpperCase()], amount: 1, plus: 'counters' };
    if ((mm = body.match(/^add ((?:\{[wubrgc]\})+|\{[wubrgc]\}(?: or \{[wubrgc]\})+)\. ~ deals (\d+) damage to you\.?$/))) { const cols = [...mm[1].matchAll(/\{(\w)\}/g)].map(x => x[1].toUpperCase()); return { type: 'mana', cost, produces: [...new Set(cols)], amount: mm[1].includes(' or ') ? 1 : cols.length, damage: Number(mm[2]) }; }
    if (/^add one mana of any color that a land an opponent controls could produce\.?$/.test(body)) return { type: 'mana', cost, produces: COLORS.slice(), amount: 1, notes: ['Approximated: adds any color, whatever lands the opponent controls'] };
    const eff = parseEffects(body);
    if (!eff.effects.length) return null;
    if (anyPlayerNote) eff.notes.push('Approximated: ' + anyPlayerNote);
    const zone = eff.effects.some(e => e.type === 'selfFromGraveyard') ? 'graveyard' : undefined;   // Ashen Ghoul activates from the graveyard
    return { type: 'activated', cost, effects: eff.effects, optional: eff.optional, timing, limit, once: limit === 1, condition, zone, notes: eff.notes, text: line };
  }
  // triggered
  if ((m = t.match(/^(when|whenever) (.+?), (.+)$/))) {
    const ev = parseEvent(m[2]);
    if (ev) {
      let rest = m[3];
      if (/^enchanted/.test(ev.event)) rest = rest.replace(/\b(?:it|that creature) (gets|gains|has|deals|can't|doesn't)\b/g, 'enchanted creature $1').replace(/\bon it\b/g, 'on enchanted creature').replace(/^(?:tap|untap) it$/, w => w.replace(' it', ' enchanted creature'));
      if (/^if it wasn't sacrificed, /.test(rest)) { rest = rest.replace(/^if it wasn't sacrificed, /, ''); ev.notSacrificed = true; }
      const pay = parsePay(rest);
      const eff = parseEffects(pay.body);
      if (eff.effects.length) return { type: 'triggered', ...ev, effects: eff.effects, optional: eff.optional, pay: pay.cost, payer: pay.payer, notes: eff.notes, text: line };
    }
  }
  if ((m = t.match(/^at end of combat, if ~ attacked or blocked this combat, (.+)$/))) {
    const eff = parseEffects(m[1]);
    if (eff.effects.length) return { type: 'triggered', event: 'endCombat', condition: { attackedOrBlocked: true }, effects: eff.effects, notes: eff.notes, text: line };
  }
  if ((m = t.match(/^until end of turn, (whenever .+)$/))) return null;
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
    else if (/^the chosen player's upkeep$/.test(w)) ev = { event: 'upkeep', who: 'opp' };
    else return null;
    // Graveyard-recursion triggers (Nether Shadow, Krovikan Horror, Death Spark): the card triggers from the
    // graveyard when enough creature cards lie above it. Rewrite the effect so it reads as a graveyard return.
    let rest = m[2], condition = null, cm;
    if ((cm = rest.match(/^if ~ is in your graveyard with (a|an|\w+ or more) creature cards? (directly )?above it, (.+)$/))) {
      const n = /or more/.test(cm[1]) ? (NUM[cm[1].split(' ')[0]] ?? Number(cm[1].split(' ')[0]) ?? 1) : 1;
      condition = { gyAbove: n, directly: !!cm[2] };
      rest = cm[3].replace(/\breturn ~ to your hand\b/, 'return ~ from your graveyard to your hand').replace(/\bput ~ onto the battlefield\b/, 'return ~ from your graveyard to the battlefield');
    }
    const pay = parsePay(rest);
    let body = pay.body;
    if ((cm = body.match(/^if ~ is untapped, (.+)$/))) { condition = { selfUntapped: true }; body = cm[1]; }
    if ((cm = body.match(/^if ~ is tapped, (.+)$/))) { condition = { selfTapped: true }; body = cm[1]; }
    if ((cm = body.match(/^if ~ didn't attack this turn, (.+)$/))) { condition = { didntAttack: true }; body = cm[1]; }
    if ((cm = body.match(/^if no creatures are on the battlefield, (.+)$/))) { condition = { noCreatures: true }; body = cm[1]; }
    if ((cm = body.match(/^for each player, (.+)$/))) { const eff = parseEffects(cm[1].replace(/that player/g, 'each player')); if (eff.effects.length) return { type: 'triggered', ...ev, condition, effects: eff.effects, notes: eff.notes, text: line }; }
    if ((cm = body.match(/^that player (draws an additional card|draws a card)$/))) return { type: 'triggered', ...ev, condition, effects: [{ type: 'draw', amount: 1, sel: 'thatPlayer' }], text: line };
    const eff = parseEffects(body);
    if (!eff.effects.length) return null;
    const zone = eff.effects.some(e => e.type === 'selfFromGraveyard') ? 'graveyard' : undefined;   // Squee & co. trigger while in the graveyard
    return { type: 'triggered', ...ev, condition, zone, effects: eff.effects, optional: eff.optional, pay: pay.cost, payer: pay.payer, notes: eff.notes, text: line };
  }
  const st = parseStatic(t);
  if (st) return st.length === 1 ? st[0] : { type: 'multi', list: st };
  return null;
}

// "Activate only if <condition>" / "and only if <condition>" clauses on activated abilities.
function parseCondText(s) {
  let m;
  s = s.trim().replace(/\.$/, '');
  if (/^seven or more cards are in your graveyard$/.test(s)) return { threshold: true };
  if ((m = s.match(/^(\w+) or more creature cards are above ~(?: in your graveyard)?$/))) return { gyAbove: NUM[m[1]] ?? Number(m[1]) ?? 1 };
  return null;
}
// Card filters for hand/library picks: "noncreature, nonland" / "nonland" / "goblin permanent" / "artifact".
function parseCardFilter(text) {
  const f = {};
  for (const w of text.toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    let m;
    if ((m = w.match(/^non-?(creature|land|artifact|enchantment|instant|sorcery)$/))) (f.not ||= []).push(m[1]);
    else if (['creature', 'land', 'artifact', 'enchantment', 'instant', 'sorcery', 'permanent'].includes(w)) (f.types ||= []).push(w);
    else if (COLOR_WORD[w]) (f.colors ||= []).push(COLOR_WORD[w]);
    else if (/^[a-z]+(?:-[a-z]+)?$/.test(w)) (f.subtypes ||= []).push(capSub(w));
  }
  return f;
}
// "you may pay {1}. If you do, <effect>" on a trigger: the payment is optional and gates the effect.
function parsePay(body) {
  const m = body.match(/^(you|that player|the player) may pay ((?:\{[^}]+\})+)\. if (?:you do|they do|the player does|that player does), (.+)$/);
  if (!m) return { body, cost: null, payer: null };
  return { body: m[3], cost: parseCost(m[2].toUpperCase()), payer: m[1] === 'you' ? 'you' : 'thatPlayer' };
}

function parseEvent(w) {
  let m;
  if (/^~ enters(?: the battlefield)?$/.test(w)) return { event: 'etb' };
  if (/^you cycle ~$/.test(w)) return { event: 'cycle' };
  if (/^you play another land$/.test(w)) return { event: 'youPlayLand', other: true };   // City of Traitors: not its own arrival
  if (/^~ is put into your graveyard from your library$/.test(w)) return { event: 'milled' };   // Gaea's Blessing
  if (/^~ (?:dies|is put into a graveyard from the battlefield)$/.test(w)) return { event: 'dies' };
  if (/^~ leaves the battlefield$/.test(w)) return { event: 'leaves' };
  if (/^~ attacks$/.test(w)) return { event: 'attacks' };
  if (/^~ attacks and isn't blocked$/.test(w)) return { event: 'unblocked' };
  if (/^~ blocks$/.test(w)) return { event: 'blocks' };
  if (/^~ blocks or becomes blocked$/.test(w)) return { event: 'blocksOrBecomesBlocked' };
  if (/^~ becomes blocked$/.test(w)) return { event: 'becomesBlocked' };
  if (/^~ attacks or blocks$/.test(w)) return { event: 'attacksOrBlocks' };
  if ((m = w.match(/^~ blocks or becomes blocked by (?:a |an )?(.+?)$/))) return { event: 'blocksOrBlockedBy', filter: parseCreatureFilter(m[1] === 'creature' ? '' : m[1]) };
  if (/^~ becomes blocked by a creature$/.test(w)) return { event: 'becomesBlocked' };
  if ((m = w.match(/^~ becomes blocked by (?:a |an )?(.+)$/))) return { event: 'becomesBlockedBy', filter: parseCreatureFilter(m[1]) };
  if (/^enchanted (?:land|creature|artifact|permanent) (?:becomes tapped|is tapped for mana)$/.test(w)) return { event: 'enchantedTapped' };
  if ((m = w.match(/^enchanted (?:artifact|creature|permanent) becomes tapped or a player activates an ability of enchanted (?:artifact|creature|permanent) without \{t\} in its activation cost$/))) return { event: 'enchantedTapped', note: 'only tapping triggers it' };
  if ((m = w.match(/^enchanted creature blocks or becomes blocked(?: by (?:a |an )?(.+?))?$/))) return { event: 'enchantedBlocksOrBlockedBy', filter: m[1] && m[1] !== 'creature' ? parseCreatureFilter(m[1]) : {} };
  if (/^enchanted creature blocks$/.test(w)) return { event: 'enchantedBlocks' };
  if (/^enchanted creature becomes blocked$/.test(w)) return { event: 'enchantedBecomesBlocked' };
  if (/^enchanted (?:creature|permanent|land|artifact) leaves the battlefield$/.test(w)) return { event: 'enchantedLeaves' };
  if ((m = w.match(/^(?:a|an) (.+?) becomes tapped$/)) && !/ or /.test(m[1])) { const k = parseTarget('each ' + m[1]); return k && k.sel === 'each' && !k.restrict.players ? { event: 'anyTapped', restrict: k.restrict } : null; }
  if ((m = w.match(/^(?:a|an) (.+?) is put into a graveyard from the battlefield(?:, if it wasn't sacrificed)?$/))) { const k = parseTarget('each ' + m[1]); return k && k.sel === 'each' && !k.restrict.players ? { event: 'anyDies', restrict: k.restrict, notSacrificed: / wasn't sacrificed/.test(w) } : null; }
  if (/^~ is dealt damage$/.test(w)) return { event: 'dealtDamage' };
  if ((m = w.match(/^(a player|an opponent) casts (?:a|an) (creature|noncreature|artifact|enchantment|instant|sorcery) spell$/))) return { event: 'anyCast', kind: m[2], who: m[1] === 'an opponent' ? 'opp' : null };
  if (/^you play a land$/.test(w)) return { event: 'youPlayLand' };
  if (/^(?:a|another) land enters(?: the battlefield)?$/.test(w)) return { event: 'anyLandEtb' };
  if (/^an opponent draws a card$/.test(w)) return { event: 'oppDraws' };
  if (/^a player taps a land for mana$/.test(w)) return { event: 'manaTap' };
  if ((m = w.match(/^a player casts a (white|blue|black|red|green) spell$/))) return { event: 'anyCast', color: COLOR_WORD[m[1]] };
  if ((m = w.match(/^an opponent casts a (white|blue|black|red|green) spell$/))) return { event: 'anyCast', who: 'opp', color: COLOR_WORD[m[1]] };
  if ((m = w.match(/^(?:a|an) (.+?) (?:you control )?deals combat damage to (?:a player|an opponent)$/))) { const f = /you control/.test(w) ? { control: 'you' } : {}; const sub = m[1].replace(/ you control$/, '').trim(); if (sub !== 'creature') { const c = cap(sub); f.subtypes = [c]; } return { event: 'anyCombatToPlayer', filter: f }; }
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
  if (/^enchanted creature deals (?:combat )?damage to (?:an opponent|a player)$/.test(w)) return { event: 'enchantedDealsDamage' };
  if (/^enchanted creature deals (?:combat )?damage to you$/.test(w)) return { event: 'enchantedDealsDamage', toYou: true };
  if (/^enchanted creature dies$/.test(w)) return { event: 'enchantedDies' };
  if (/^enchanted creature attacks$/.test(w)) return { event: 'enchantedAttacks' };
  if (/^you cast a spell$/.test(w)) return { event: 'youCast', kind: 'any' };
  if ((m = w.match(/^you cast (?:a|an) (\w+) spell$/))) { const k = m[1]; return { event: 'youCast', kind: ['noncreature', 'creature', 'artifact', 'enchantment', 'instant', 'sorcery'].includes(k) ? k : 'any' }; }
  if (/^an opponent casts a spell$/.test(w)) return { event: 'anyCast', who: 'opp' };
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
  if (legendary && first.length > 3 && /^[A-Z]/.test(first) && short.includes(' ')) t = t.replace(new RegExp("\\b" + esc(first) + "'s\\b", 'g'), "~'s");   // "Multani's power and toughness"

  t = t.replace(/\b(this creature|this permanent|this artifact|this enchantment|this land|this spell|this aura|this equipment|this card)\b/gi, '~');
  // A one-word name that is also the verb of its own text (Exile, Recall): restore the verb.
  if (!short.includes(' ')) t = t.replace(/(^|\. |\n)~ (target|all|each|up to|the top|two|three|x |a |an )/g, (m0, pre, w) => pre + short.toLowerCase() + ' ' + w);
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

  // Chaos Orb: a bespoke one-shot. Its ability tears the orb into pieces that flutter down and destroy
  // the permanents they land on, then shatters the orb itself. The generic parser can't express any of
  // that, so it's hand-built here (and js/engine.js resolves the `chaosOrb` effect).
  if (c.name === 'Chaos Orb') {
    def.abilities.push({
      type: 'activated',
      cost: { mana: { pips: [], generic: 1, x: false }, tap: true, untap: false, sacSelf: false, sacrifice: null, discard: 0, life: 0, removeCounter: null, exileSelfFromGraveyard: false },
      effects: [{ type: 'chaosOrb' }],
      optional: false, timing: 'sorcery', limit: 0, once: false,
      text: '{1}, {T}: Tear Chaos Orb into pieces; they scatter across the battlefield and destroy each nontoken permanent they touch. Then Chaos Orb is destroyed.',
    });
    def.status = 'full'; def.chaosOrb = true;
    return def;
  }
  // Animate Dead: a reanimation Aura. The generic aura machinery only enchants permanents, so it's hand-built:
  // when it enters, pick a creature card in any graveyard, return it under your control and attach the Aura;
  // the creature gets -1/-0 while enchanted and is sacrificed when the Aura leaves.
  if (c.name === 'Animate Dead') {
    def.abilities.push({ type: 'triggered', event: 'etb', effects: [{ type: 'animateDead', sel: 'card', restrict: { zone: 'graveyard', who: 'any', what: 'creature' } }], optional: false, text: 'When Animate Dead enters, return target creature card from a graveyard to the battlefield under your control and attach Animate Dead to it. When Animate Dead leaves the battlefield, sacrifice that creature.' });
    def.abilities.push({ type: 'static', kind: 'pt', p: -1, t: 0, scope: { who: 'enchanted' } });
    def.status = 'approx'; def.animateDead = true; def.notes.push('Approximated: the creature is chosen as Animate Dead enters rather than as it is cast');
    return def;
  }

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

  // A kicker rider can share a line with the main effect ("Destroy target artifact. If this spell was kicked,
  // draw two cards."): split it off so the line-level kicker handler below sees it.
  const lines = normalizeOracle(c.oracle_text || '', c.name, def.legendary).flatMap(l => l.split(/(?<=\.)\s+(?=if (?:~|this spell) was kicked,)/i));
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
    if ((m = lower.match(/^as an additional cost to cast (?:this spell|~), (sacrifice (?:a|an) (creature|land|artifact|permanent|goblin|\w+)|discard (?:a|\w+) cards?|pay (\d+) life|exile (?:a|an) \w+ card from your graveyard)\.?$/))) {
      if (m[2]) additionalCost = { sacrifice: m[2] };
      else if (/^discard/.test(m[1])) additionalCost = { discard: amt(m[1].split(' ')[1]) };
      else if (m[3]) additionalCost = { life: Number(m[3]) };
      else { def.notes.push('Additional cost ignored: ' + line); }
      continue;
    }
    if ((m = lower.match(/^you may (?:pay (\d+) life and )?(?:exile|remove) (?:a|an) (white|blue|black|red|green) card from your hand rather than pay (?:this spell's|~'s) mana cost\.?$/))) { alternativeCost = { pitch: COLOR_WORD[m[2]], life: m[1] ? Number(m[1]) : 0 }; continue; }
    // Fireblast: "You may sacrifice two Mountains rather than pay this spell's mana cost."
    if ((m = lower.match(/^you may sacrifice (\w+) (plains|islands|swamps|mountains|forests) rather than pay (?:this spell's|~'s) mana cost\.?$/))) { alternativeCost = { ...(alternativeCost || {}), sacLands: { land: cap(m[2].replace(/s$/, '')), n: amt(m[1]) || 1 } }; continue; }
    if ((m = lower.match(/^if (?:~|this spell) was kicked, (.+)$/))) { const eff = parseEffects(m[1]); if (eff.effects.length) kickedEffects = eff.effects; else def.notes.push('Kicker effect ignored'); continue; }
    if ((m = lower.match(/^if ~ was kicked, it enters(?: the battlefield)? with (\S+) ([+-]1\/[+-]1) counters? on it$/))) { kickedEffects = [{ type: 'counters', kind: m[2], amount: amt(m[1]), sel: 'self' }]; continue; }
    if (parseKeywordLine(line, def)) continue;
    if (def.unsupportedReason) break;
    // Instant / sorcery text is spell effects; permanents have abilities.
    if (/^(?:this spell|~) can't be countered(?: by spells or abilities)?\.?$/i.test(lower)) { def.uncounterable = true; continue; }   // Blurred Mongoose, Kavu Chameleon, Vexing Beetle, …
    // Cabal Ritual: the threshold "Add {B}{B}{B}{B}{B} instead …" rider folds into the ritual on the line before it.
    if ((m = lower.match(/^(?:threshold — )?add ((?:\{[wubrgc]\})+) instead if there are seven or more cards in your graveyard\.?$/)) && spellEffects.length && spellEffects[spellEffects.length - 1].type === 'addMana') {
      spellEffects[spellEffects.length - 1].threshold = [...m[1].matchAll(/\{(\w)\}/g)].map(x => x[1].toUpperCase()); continue;
    }
    if (def.kind === 'instant' || def.kind === 'sorcery') {
      // "When you cycle ~, ..." / "When ~ is put into your graveyard from your library, ..." on a spell are
      // triggered abilities of the card, not part of the spell's effect.
      // (Death Spark's upkeep recursion is the same: an ability the card has while in the graveyard.)
      if (/^(?:when (?:you cycle ~|~ is put into your graveyard from your library), |at the beginning of (?:your upkeep|the end step), if ~ is in your graveyard\b)/.test(lower)) { const ab = parseAbilityLine(lower); if (ab && ab.type === 'triggered') { def.abilities.push(ab); continue; } }
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
        if (a.note) def.notes.push('Approximated: ' + a.note);
        if (a.type === 'triggered' && a.notes === undefined && a.effects) for (const x of a.effects) if (x.note) def.notes.push('Approximated: ' + x.note);
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
  // Amplify N: as this creature enters, reveal any number of cards sharing a creature type with it and enter with N counters each.
  if (def._amplify) { def.abilities.push({ type: 'triggered', event: 'etb', effects: [{ type: 'amplify', n: def._amplify }], optional: false, text: `amplify ${def._amplify}` }); delete def._amplify; }
  def.entersTapped = def.abilities.some(a => a.type === 'static' && a.kind === 'entersTapped');
  const es = def.abilities.find(a => a.type === 'static' && a.kind === 'entersSacrifice');
  if (es) def.entersSacrifice = { land: es.land, untapped: es.untapped };

  if (def.kind === 'instant' || def.kind === 'sorcery') {
    // fold a "its controller may draw N cards next upkeep" rider (Arcane Denial) into the counter effect
    for (let i = spellEffects.length - 1; i >= 0; i--) if (spellEffects[i].type === 'counterBonusDraw') { const c = spellEffects.find(e => e.type === 'counter'); if (c) c.drawController = spellEffects[i].amount; spellEffects.splice(i, 1); }
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
  if (def.kind === 'land' && !def.produces.length && !def.abilities.length && !def.manaAbilities.length) return unsupported('Land with no understood ability');   // Reflecting Pool produces nothing on its own
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
