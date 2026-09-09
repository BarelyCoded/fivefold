// Power-tier generator for the Alpha–Alliances card base.
//
// Produces content/power-tiers.json: { tiers: {S:[...names], A:[...], ... }, meta:{...} }
// A card's tier is CURATED (hand-assigned below) when its real in-play power diverges from what
// its mana cost / stats suggest — the busted rares, the format staples, the expensive traps. Every
// other card gets a BASELINE tier from its characteristics (creatures by stat-efficiency, spells and
// lands by a sensible default nudged by rarity). Curated always wins over baseline.
//
// Tiers, strongest to weakest, with the amulet price each is *proposed* to cost (review & tweak):
//   S  broken / format-warping  → 8      C  solid, maindeckable        → 3
//   A  premium staple           → 6      D  filler / marginal          → 2
//   B  strong, commonly played   → 4      E  weak / draft chaff         → 1
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ORDER = ['S', 'A', 'B', 'C', 'D', 'E'];
export const TIER_PRICE = { S: 8, A: 6, B: 4, C: 3, D: 2, E: 1 };

// ---- Curated overrides -------------------------------------------------------------------------
// Grouped by tier. Names not present in the card base are ignored (reported in meta.unmatched).
const CURATED = {
  S: [
    // Power Nine + fast mana
    'Black Lotus', 'Mox Pearl', 'Mox Sapphire', 'Mox Jet', 'Mox Ruby', 'Mox Emerald',
    'Ancestral Recall', 'Time Walk', 'Timetwister', 'Sol Ring', 'Mana Vault',
    // Card-advantage / tutor engines
    'Library of Alexandria', 'Wheel of Fortune', 'Braingeyser', 'Demonic Tutor', 'Sylvan Library',
    'Necropotence', 'Land Tax', 'Recall', 'Timmerian Fiends',
    // Broken control / disruption
    'Mind Twist', 'Balance', 'Mana Drain', 'Force of Will', 'The Abyss', 'Nether Void',
    'The Tabernacle at Pendrell Vale', 'Moat', 'Chains of Mephistopheles', 'Winter Orb',
    // Broken lands / mana denial
    'Mishra\'s Workshop', 'Bazaar of Baghdad', 'Strip Mine',
    // Combo pieces
    'Channel', 'Fastbond', 'Time Vault', 'Copy Artifact', 'Ivory Tower',
  ],
  A: [
    // Premium fat / evasive threats
    'Serra Angel', 'Shivan Dragon', 'Sengir Vampire', 'Juzám Djinn', 'Hypnotic Specter',
    'Erhnam Djinn', 'Mahamoti Djinn', 'Nicol Bolas', 'Old Man of the Sea', 'Vesuvan Doppelganger',
    'Clone', 'Su-Chi', 'Triskelion', 'Serendib Efreet', 'Sedge Troll', 'Whirling Dervish',
    'Autumn Willow', 'Spectral Bears', 'Ball Lightning',
    'White Knight', 'Black Knight', 'Order of the White Shield', 'Order of Leitbur', 'Order of the Ebon Hand',
    'Knight of Stromgald', 'Elvish Archers', 'Ihsan\'s Shade', 'Uthden Troll', 'Bog Wraith',
    // Efficient interaction
    'Lightning Bolt', 'Swords to Plowshares', 'Chain Lightning', 'Fireball', 'Disintegrate',
    'Terror', 'Dark Ritual', 'Hymn to Tourach', 'Sinkhole', 'Counterspell', 'Control Magic',
    'Power Sink', 'Incinerate', 'Psionic Blast', 'Wrath of God', 'Armageddon',
    'Berserk', 'Pyrokinesis', 'Contagion', 'Diminishing Returns', 'Exile',
    'Swords to Plowshares', 'Regrowth',
    // Utility artifacts / lands
    'Icy Manipulator', 'Nevinyrral\'s Disk', 'Juggernaut', 'Tetravus',
    'Mishra\'s Factory', 'City of Brass', 'Maze of Ith',
    'Tundra', 'Underground Sea', 'Badlands', 'Taiga', 'Savannah', 'Scrubland', 'Volcanic Island',
    'Bayou', 'Plateau', 'Tropical Island',
  ],
  B: [
    // Solid creatures
    'Savannah Lions', 'Kird Ape', 'Llanowar Elves', 'Fyndhorn Elves', 'Birds of Paradise',
    'Sabretooth Tiger', 'Hill Giant', 'War Mammoth', 'Scryb Sprites',
    'Argothian Pixies', 'Brass Man', 'Wall of Stone', 'Wall of Air', 'Icatian Javelineers',
    'Order of the Sacred Torch', 'Carrion Ants',
    // Good spells / utility
    'Disenchant', 'Hydroblast', 'Pyroblast', 'Red Elemental Blast', 'Blue Elemental Blast',
    'Giant Growth', 'Healing Salve', 'Brainstorm', 'Howling Mine', 'Jayemdae Tome', 'Zuran Orb',
    'The Rack', 'Black Vise', 'Meekstone', 'Winter Orb', 'Feldon\'s Cane', 'Nevinyrral\'s Disk',
    'Kismet', 'Paralyze', 'Spirit Link', 'Karma', 'Underworld Dreams', 'Manabarbs', 'Mana Flare',
    'Ankh of Mishra', 'Fellwar Stone', 'Jester\'s Cap', 'Soul Net', 'Iron Star',
    // Utility lands
    'Adarkar Wastes', 'Sulfurous Springs', 'Brushland', 'Karplusan Forest', 'Underground River',
    'Kjeldoran Outpost', 'Lake of the Dead', 'Thawing Glaciers', 'Ice Floe',
  ],
  D: [
    // Overcosted / do-little that look better than they are
    'Wall of Wood', 'Grizzly Bears', 'Mons\'s Goblin Raiders', 'Goblin Balloon Brigade',
    'Craw Wurm', 'Rod of Ruin', 'The Hive', 'Wall of Bone', 'Onulet', 'Yotian Soldier',
    'Obsianus Golem', 'Gray Ogre', 'Hurloon Minotaur', 'Bog Rats', 'Wall of Swords',
  ],
  E: [
    // Notorious duds
    'Sorrow\'s Path', 'Wood Elemental', 'Jandor\'s Ring',
    'Jandor\'s Saddlebags', 'Dingus Egg', 'Squire', 'Zephyr Falcon', 'Coral Reef',
    'Reef Pirates', 'Mesa Pegasus', 'Eye for an Eye',
  ],
};

// ---- Baseline heuristic ------------------------------------------------------------------------
function baseline(c) {
  const cmc = c.cmc || 0;
  const t = c.type || '';
  const rare = c.rarity === 'rare' || c.rarity === 'mythic';
  const unc = c.rarity === 'uncommon';
  if (/Land/.test(t)) return unc || rare ? 'C' : 'D';               // curated duals/utility ride above
  if (/Creature/.test(t)) {
    const [p, tf] = (c.pt || '0/0').split('/').map(x => parseInt(x, 10) || 0);
    const stat = p + tf;
    let tier;
    if (cmc <= 1) tier = stat >= 3 ? 'B' : stat >= 2 ? 'C' : 'D';
    else if (cmc <= 2) tier = stat >= 5 ? 'B' : stat >= 4 ? 'C' : stat >= 3 ? 'D' : 'E';
    else if (cmc <= 3) tier = stat >= 7 ? 'B' : stat >= 5 ? 'C' : stat >= 4 ? 'D' : 'E';
    else if (cmc <= 4) tier = stat >= 9 ? 'B' : stat >= 7 ? 'C' : stat >= 5 ? 'D' : 'E';
    else if (cmc <= 5) tier = stat >= 11 ? 'A' : stat >= 9 ? 'B' : stat >= 7 ? 'C' : 'D';
    else if (cmc <= 6) tier = stat >= 13 ? 'A' : stat >= 10 ? 'B' : stat >= 8 ? 'C' : 'D';
    else tier = stat >= 14 ? 'A' : stat >= 11 ? 'B' : 'C';
    return tier;
  }
  // Noncreature spells: modest default, a small nudge for rares (curation lifts the real bombs).
  if (rare) return 'C';
  return unc ? 'C' : 'D';
}

// ---- Build -------------------------------------------------------------------------------------
function loadAttrs() {
  // The amulet shop sells the catalog (spells + artifacts, no lands); city shops sell lands. Rank the
  // whole printed base so every sellable card — lands included — gets a tier; mark what is sellable.
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/amulet-catalog.json'), 'utf8'));
  const inCatalog = new Set();
  for (const k of Object.keys(cat)) for (const n of cat[k]) inCatalog.add(n);
  const dir = path.join(ROOT, 'tools/.sets');
  const attr = new Map();
  for (const f of fs.readdirSync(dir).sort()) {
    for (const c of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      if (attr.has(c.name)) continue;
      const face = c.card_faces?.[0] || c;
      const type = face.type_line || c.type_line || '';
      if (/Basic Land/.test(type)) continue;                 // basics are free, never priced
      attr.set(c.name, { name: c.name, cmc: c.cmc ?? 0, type, pt: face.power != null ? `${face.power}/${face.toughness}` : '', rarity: c.rarity || '', colors: (face.colors || c.colors || []).join(''), sellable: inCatalog.has(c.name) || /Land/.test(type) });
    }
  }
  return { want: [...attr.keys()], attr };
}

export function build() {
  const { want, attr } = loadAttrs();
  const curatedOf = new Map();
  const unmatched = [];
  for (const tier of ORDER) for (const name of CURATED[tier] || []) {          // ORDER is strong→weak
    if (!attr.has(name)) { unmatched.push([tier, name]); continue; }
    if (!curatedOf.has(name)) curatedOf.set(name, tier);                        // first (strongest) wins
  }
  const tiers = { S: [], A: [], B: [], C: [], D: [], E: [] };
  const source = {}, sellable = {};
  for (const name of want) {
    const c = attr.get(name); if (!c) continue;
    const tier = curatedOf.get(name) || baseline(c);
    tiers[tier].push(name);
    source[name] = curatedOf.has(name) ? 'curated' : 'baseline';
    sellable[name] = !!c.sellable;
  }
  for (const k of ORDER) tiers[k].sort((a, b) => a.localeCompare(b));
  const counts = Object.fromEntries(ORDER.map(k => [k, tiers[k].length]));
  const curatedCount = curatedOf.size;
  return { tiers, source, sellable, counts, curatedCount, unmatched, attr, want };
}

if (import.meta.filename === process.argv[1]) {
  const r = build();
  // Flat per-card records power the review page and downstream pricing.
  const cards = {};
  for (const tier of ORDER) for (const name of r.tiers[tier]) {
    const a = r.attr.get(name);
    cards[name] = { tier, src: r.source[name], sell: r.sellable[name], cmc: a.cmc, type: a.type.replace(/ —.*/, '').replace('Legendary ', '').trim(), pt: a.pt, rar: a.rarity, col: a.colors };
  }
  const out = { generated: new Date().toISOString().slice(0, 10), price: TIER_PRICE, counts: r.counts, curated: r.curatedCount, tiers: r.tiers, cards };
  fs.writeFileSync(path.join(ROOT, 'content/power-tiers.json'), JSON.stringify(out));
  const sellCounts = Object.fromEntries(ORDER.map(k => [k, r.tiers[k].filter(n => r.sellable[n]).length]));
  console.log('all cards :', JSON.stringify(r.counts), '| total', r.want.length);
  console.log('sellable  :', JSON.stringify(sellCounts), '| curated', r.curatedCount);
  if (r.unmatched.length) console.log('curated names NOT in card base (ignored):\n  ' + r.unmatched.map(([t, n]) => `${t}:${n}`).join('\n  '));
}
