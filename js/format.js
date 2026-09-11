// Premodern constructed legality. Pure and UI-agnostic: given a deck (and optional sideboard) as a
// name -> count map, and the format's legal card names + banned list, report every rule violation.
// Loaded data comes from content/premodern.json (sets, banned, rules) and content/premodern-pool.json
// (the legal card names, built by tools/build-catalog.mjs).

export const BASIC_LANDS = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp', 'Snow-Covered Mountain', 'Snow-Covered Forest',
]);

const DEFAULT_RULES = { minDeck: 60, maxSideboard: 15, maxCopies: 4 };

// deck / sideboard: { [name]: count }. opts: { legal: Set<name>, banned: Set<name>, rules, basics }.
// Returns { legal: boolean, errors: [], warnings: [], counts: { main, side } }.
export function premodernLegality(deck = {}, sideboard = {}, opts = {}) {
  const rules = { ...DEFAULT_RULES, ...(opts.rules || {}) };
  const legal = opts.legal || null;              // when null, set-legality is not enforced (pool not loaded yet)
  const banned = opts.banned || new Set();
  const basics = opts.basics || BASIC_LANDS;
  const errors = [], warnings = [];
  const entries = Object.entries(deck).filter(([, n]) => n > 0);
  const side = Object.entries(sideboard).filter(([, n]) => n > 0);
  const main = entries.reduce((a, [, n]) => a + n, 0);
  const sideCount = side.reduce((a, [, n]) => a + n, 0);

  if (main < rules.minDeck) errors.push(`Deck has ${main} cards; ${rules.minDeck} is the minimum.`);
  if (sideCount > rules.maxSideboard) errors.push(`Sideboard has ${sideCount} cards; ${rules.maxSideboard} is the maximum.`);

  // copy limits across main + sideboard combined
  const total = {};
  for (const [name, n] of [...entries, ...side]) total[name] = (total[name] || 0) + n;
  for (const [name, n] of Object.entries(total)) {
    if (basics.has(name)) continue;
    if (n > rules.maxCopies) errors.push(`${n} copies of ${name}; ${rules.maxCopies} is the maximum.`);
  }

  // banned and set-legality
  for (const [name] of [...entries, ...side]) {
    if (banned.has(name)) errors.push(`${name} is banned in Premodern.`);
    else if (legal && !basics.has(name) && !legal.has(name)) warnings.push(`${name} is not in the Premodern card pool.`);
  }
  return { legal: errors.length === 0, errors, warnings, counts: { main, side: sideCount } };
}

// Browser helper: load the format definition and legal-name set from the content files.
export async function loadPremodern(fetchFn = fetch) {
  const fmt = await (await fetchFn('content/premodern.json')).json();
  let legal = null;
  try {
    const p = (await (await fetchFn('content/premodern-pool.json')).json()).pool;
    legal = new Set(Object.values(p).flat().map(c => c.name));
  } catch { /* pool not built yet */ }
  return { rules: fmt.rules, banned: new Set(fmt.banned || []), legal, sets: fmt.sets };
}
