// Set groups used by the offline tooling. Codes are Scryfall set codes (lowercase).
// ERA is the old-school base the adventure shipped with (Alpha … Alliances).
// PREMODERN is the card pool of the Premodern community format: Fourth Edition through Scourge,
// every expansion and core set released 1995-2003, in release order. This is the legal universe the
// game is being grown toward (a banned list is applied on top of it, not to it).

export const ERA = ['lea', 'leb', '2ed', 'arn', 'atq', '3ed', 'leg', 'drk', 'fem', '4ed', 'ice', 'chr', 'hml', 'all'];

export const PREMODERN = [
  '4ed',            // Fourth Edition
  'ice',            // Ice Age
  'chr',            // Chronicles
  'hml',            // Homelands
  'all',            // Alliances
  'mir',            // Mirage
  'vis',            // Visions
  '5ed',            // Fifth Edition
  'wth',            // Weatherlight
  'tmp',            // Tempest
  'sth',            // Stronghold
  'exo',            // Exodus
  'usg',            // Urza's Saga
  'ulg',            // Urza's Legacy
  '6ed',            // Classic Sixth Edition
  'uds',            // Urza's Destiny
  'mmq',            // Mercadian Masques
  'nem',            // Nemesis
  'pcy',            // Prophecy
  'inv',            // Invasion
  'pls',            // Planeshift
  '7ed',            // Seventh Edition
  'apc',            // Apocalypse
  'ody',            // Odyssey
  'tor',            // Torment
  'jud',            // Judgment
  'ons',            // Onslaught
  'lgn',            // Legions
  'scg',            // Scourge
];

export const GROUPS = { era: ERA, premodern: PREMODERN };

// Resolve command-line set arguments to a list of codes: a group name expands to its set list,
// otherwise each argument is taken as a literal set code.
export function resolveSets(args, fallback = ERA) {
  if (!args.length) return fallback;
  if (args.length === 1 && GROUPS[args[0]]) return GROUPS[args[0]];
  return args;
}
