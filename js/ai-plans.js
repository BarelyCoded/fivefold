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
// To add a deck: copy a block, set the name to match the preset in content/ai-decks.json, fill the lists.

export const PLANS = {
  'Recurring Survival': {
    priority: ['Survival of the Fittest', 'Recurring Nightmare'],
    ramp: ['Birds of Paradise', 'Llanowar Elves', 'Wall of Roots', 'Wall of Blossoms', 'Quirion Ranger'],
    disruption: ['Duress', 'Cabal Therapy'],
    fodder: ['Squee, Goblin Nabob', 'Wall of Roots', 'Birds of Paradise', 'Wall of Blossoms', 'Llanowar Elves'],
    engines: ['Recurring Nightmare', 'Survival of the Fittest'],
    toolbox: [
      { need: 'removal', cards: ['Bone Shredder', 'Flametongue Kavu', 'Avalanche Riders', 'Uktabi Orangutan'] },
      { need: 'graveyardHate', cards: ['Withered Wretch', 'Bone Shredder'] },
      { need: 'lifegain', cards: ['Spike Feeder', 'Wall of Blossoms'] },
      { need: 'threat', cards: ['Verdant Force', 'Symbiotic Wurm', 'Deranged Hermit', 'Spike Feeder', 'Ravenous Baloth'] },
    ],
  },
};

export function planFor(name) { return (name && PLANS[name]) || null; }
