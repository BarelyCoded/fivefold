// Per-deck AI playbooks for the Premodern preset decks. The generic greedy AI in js/ai.js plays a fair game,
// but archetype decks want deck-specific intelligence: which pieces to prioritise, what to tutor for, what to
// pitch, and which activated-ability engines to run. A plan is looked up by the AI player's deck name
// (the preset name from content/ai-decks.json) and consulted by aiHooks.
//
// Schema (every field optional):
//   priority   [names]  — cast/deploy these first (the deck's engine pieces and key threats).
//   ramp       [names]  — mana accelerants to play as early as possible.
//   disruption [names]  — hand disruption / interaction to fire early.
//   fodder     [names]  — creatures the AI is happy to discard or sacrifice (they recur or are cheap).
//   toolbox    [{ need, cards:[names] }] — situational tutor / search targets. The first need that applies
//                         (see assessNeeds in js/ai.js) picks from its list; otherwise the biggest threat.
//   engines    [names]  — activated-ability engines to run each turn (Survival of the Fittest, Recurring
//                         Nightmare, …). The AI drives these with fodder-aware costs and smart targets.
//   reanimate  [names]  — big creatures the deck wants in its graveyard: the AI discards these on purpose
//                         (Careful Study, Putrid Imp, hand-size) when it can bring one back.
// To add a deck: copy a block, set the name to match the preset in content/ai-decks.json, fill the lists.

export const PLANS = {
  'Recurring Survival': {
    priority: ['Survival of the Fittest', 'Recurring Nightmare', 'Living Death'],
    ramp: ['Birds of Paradise', 'Wall of Roots', 'Yavimaya Granger'],
    disruption: ['Mesmeric Fiend', 'Duress'],
    fodder: ['Squee, Goblin Nabob', 'Wall of Roots', 'Birds of Paradise', 'Wall of Blossoms', 'Yavimaya Granger'],
    engines: ['Recurring Nightmare', 'Survival of the Fittest'],
    toolbox: [
      { need: 'removal', cards: ['Bone Shredder', 'Avalanche Riders', 'Uktabi Orangutan', 'Monk Realist'] },
      { need: 'lifegain', cards: ['Radiant\'s Dragoons', 'Wall of Blossoms'] },
      { need: 'threat', cards: ['Akroma, Angel of Wrath', 'Siege-Gang Commander'] },
    ],
  },

  // Turbo Reanimator: pitch a fatty, then Exhume / Animate Dead / Reanimate it out on turn one or two.
  'Reanimator': {
    priority: ['Exhume', 'Animate Dead', 'Reanimate', 'Putrid Imp', 'Careful Study'],
    ramp: ['Dark Ritual', 'Lotus Petal'],
    disruption: ['Unmask', 'Cabal Therapy'],
    reanimate: ['Symbiotic Wurm', 'Verdant Force', 'Visara the Dreadful'],
    fodder: ['Putrid Imp'],
  },

  // 4-Colour Control is deliberately left plan-less: the generic AI holds up reactive mana better than any
  // proactive casting-priority hints do (headless mirrors: a plan lost 6-24 by tapping out at the wrong time).

  // Goblins: curve out, Lackey to cheat in a fatty, Warchief to enable, Ringleader to refuel, Piledriver/Siege-Gang to close.
  'Goblins': {
    priority: ['Goblin Lackey', 'Goblin Warchief', 'Goblin Piledriver', 'Siege-Gang Commander', 'Goblin Ringleader', 'Clickslither'],
    ramp: ['Skirk Prospector'],
    disruption: ['Wasteland'],
    fodder: ['Skirk Prospector', 'Mogg Fanatic'],
  },

  // Mono Brown (Stax): Metalworker/Thran Dynamo ramp, lock with Tangle Wire + Rishadan Port, beat down with Karn and Factories.
  'Mono Brown': {
    priority: ['Metalworker', 'Thran Dynamo', 'Karn, Silver Golem', 'Masticore', 'Tangle Wire', 'Mishra\'s Helix'],
    ramp: ['Ancient Tomb', 'City of Traitors', 'Mind Stone', 'Thran Dynamo', 'Metalworker'],
    disruption: ['Wasteland', 'Rishadan Port'],
    fodder: [],
  },

  // UW Standstill: land a Standstill while ahead, hold up counters/removal, grind with man-lands and Decree.
  'UW Standstill': {
    priority: ['Standstill', 'Fact or Fiction', 'Impulse', 'Wrath of God', 'Decree of Justice'],
    disruption: ['Counterspell', 'Mana Leak', 'Absorb', 'Swords to Plowshares'],
    fodder: [],
  },

  // Trix: assemble Illusions of Grandeur + Donate to hand the opponent the life-loss, protected by counters.
  'Trix': {
    priority: ['Sapphire Medallion', 'Illusions of Grandeur', 'Donate', 'Accumulated Knowledge'],
    disruption: ['Counterspell', 'Arcane Denial'],
    fodder: [],
    // fetch the combo half you're missing, or interaction
    toolbox: [
      { need: 'threat', cards: ['Illusions of Grandeur', 'Donate'] },
    ],
  },

  // Tinker Prison: ramp into Tinker for a huge artifact, lock the board with Tangle Wire / Winter Orb / Rishadan Port.
  'Tinker Prison': {
    priority: ['Tinker', 'Thran Dynamo', 'Masticore', 'Karn, Silver Golem', 'Tangle Wire', 'Winter Orb', 'Sphere of Resistance'],
    ramp: ['Ancient Tomb', 'City of Traitors', 'Lotus Petal', 'Mind Stone', 'Thran Dynamo'],
    disruption: ['Rishadan Port'],
    fodder: [],
  },

  // The Rock: disrupt, trade, grind with Deed sweeps, Yavimaya Elder value and the Recurring Nightmare engine.
  'The Rock': {
    priority: ['Wall of Roots', 'Yavimaya Elder', 'Pernicious Deed', 'Ravenous Baloth', 'Recurring Nightmare', 'Deranged Hermit', 'Blastoderm'],
    ramp: ['Wall of Roots'],
    disruption: ['Duress', 'Cabal Therapy', 'Vendetta'],
    fodder: ['Festering Goblin', 'Wall of Roots', 'Yavimaya Elder', 'Wall of Blossoms'],
    engines: ['Recurring Nightmare'],
  },

  // Sligh: cheap red beats and burn, curve out, point burn at the face to close.
  'Sligh': {
    priority: ['Jackal Pup', 'Grim Lavamancer', 'Goblin Patrol', 'Ball Lightning', 'Cursed Scroll'],
    disruption: [],
    fodder: [],
  },

  // Zombie Spark: fill the graveyard (Buried Alive, Careful loops), grind recursive creatures, Zombie Infestation tokens.
  'Zombie Spark': {
    priority: ['Buried Alive', 'Zombie Infestation', 'Nether Shadow', 'Ashen Ghoul', 'Krovikan Horror'],
    disruption: ['Duress', 'Cabal Therapy'],
    reanimate: ['Nether Shadow', 'Ashen Ghoul', 'Krovikan Horror'],
    fodder: ['Squee, Goblin Nabob'],
  },
};

export function planFor(name) { return (name && PLANS[name]) || null; }
