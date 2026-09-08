# Fivefold

An open-source, single-player card adventure inspired by MicroProse's 1997 *Magic: The Gathering* (the "Shandalar" campaign). This is the **minimum viable demo**: a walkable world where geography is color, roaming mages with authored decks, ante on every duel, mana links, cities with markets, and a five-color boss on a clock.

The point of the demo is the import pipeline: **you play with the cards you actually own, with your own pictures of them.**

## Run it

You need Node 18 or newer. No install step.

```bash
node server.js
```

Then open http://localhost:8642. The first launch fetches rules text for the built-in enemy decks from Scryfall and caches it in your browser.

## Import your cards

1. Copy `collection.example.csv` to `collection.csv` and list your cards, one per line: `4 Lightning Bolt`. Set codes in parentheses are ignored. Basic lands never need listing.
2. In the game, open **Collection** and click **Load collection.csv**, or paste any decklist-style text and click **Import list**.
3. Each card is looked up on Scryfall and compiled for the demo engine. The report tells you whether it is **ready**, **approximated** (plays, but some abilities are ignored), or **unsupported** (kept in your collection, not allowed in a deck yet).

## Art

The overworld, dungeons, map figures and duel portraits are drawn from the packed sheets in `assets/` (`terrain`, `scenery`, `locations`, `figures`, `townsfolk`, `monsters`, `dungeon`) indexed by `assets/atlas.json`, with `assets/tileset.png` (the older Bibliotheca sheet) filling any slot they do not cover. The generated source images are in `assets/source/`; `tools/slice.py` cuts them into sprites and `tools/pack.py` packs them. Open http://localhost:8642/tools/artcheck.html while the server runs to see every sprite the game uses on a generated world and one dungeon per colour. To replace sprites, drop one image per sprite into `art-src/` and run `python3 tools/pack.py`; see `docs/art-spec.md` for names and the delivery rules. The five regions are sand plains (white), coast (blue), lava-veined wastes (black), mountains (red) and forest (green). Regions meet along noisy borders, beaches ring the sea, roads join the cities, and trees, dunes, peaks, rock piles and hamlets are scattered as sprites.

## Use your own art

Drop images in the `art/` folder named after the card, lowercase with dashes:

```
art/lightning-bolt.jpg
art/serra-angel.png
art/grizzly-bears.webp
```

A photo of the physical card works. Cards with your art show a ★. Click **Rescan art folder** in the Collection screen after adding files. Cards without your art fall back to Scryfall's image at runtime. Nothing is ever bundled or committed: `art/` and `collection.csv` are in `.gitignore`.

## The rules core

The engine targets the mechanics of Alpha through Alliances, using current Oracle text from Scryfall.

- **Turn structure** with all steps, a real **stack**, and **priority** for both players. Instants and abilities can be cast on the opponent's turn; counterspells work. Space bar passes priority.
- **Permanents**: lands, creatures, artifacts, enchantments, auras (including control-changing ones), equipment.
- **Abilities**: static (lords, anthems, enchanted-creature effects, can't attack/block, must attack, doesn't untap), triggered (enters, dies, attacks, blocks, deals damage, upkeep, end step, draw step), activated (tap, mana, sacrifice, discard, life, counter costs; sorcery or upkeep timing), mana abilities.
- **Keywords**: flying, first strike, double strike, trample, haste, vigilance, deathtouch, lifelink, reach, defender, menace, flash, indestructible, hexproof, shroud, fear, intimidate, shadow, horsemanship, flanking, prowess, exalted, wither, infect, undying, persist, protection, landwalk, rampage, cumulative upkeep, echo, kicker, buyback, flashback, cycling, equip, enchant. Banding is ignored.
- **Effects**: damage, destroy, exile, bounce, pump, grants, draw, discard, mill, life, counters, tokens, tutors, regeneration, fog, tap/untap/freeze, sacrifice, control, X costs, modal spells, "unless you pay", additional costs, pitch spells, extra turns, scry, looking at and reordering the top of a library, damage-prevention shields and Circles of Protection, "may pay" upkeep triggers, untap restrictions (Winter Orb, Smoke, Meekstone), extra mana from lands (Wild Growth, Mana Flare), painlands, hand-size and land-count damage (Black Vise, The Rack, Karma), poison, legend rule.

Run the coverage report to see exactly which cards work:

```bash
node tools/coverage.mjs era --patterns
```

At the time of writing, 76% of the 1,590 distinct cards from Alpha to Alliances are playable and 45% are implemented exactly; the rest are approximated with a note saying what is ignored. `node tools/inspect.mjs "Card Name"` shows how a card was compiled. `node tools/simulate.mjs 20` plays the enemy roster against itself.

## Dungeons

Five dungeons are hidden on the map, one per color. Beating a roaming mage has a chance to yield a clue that reveals one. Inside is a top-down stone maze on black rock: stationary monsters block the corridors until beaten, and your life carries from fight to fight under a per-dungeon rule (six-card hands, a Wall guarding every fight, a life drain, tougher guardians). Treasure piles hold gold, healing draughts, cards from the dungeon's list, or an amulet that raises maximum life. Scrolls ask a riddle about a real card: answer right for a card and gold, wrong and the scroll burns you. The guardian before the exit keeps the vault: a card from the list in `content/dungeons.json`, a chance at a famous artifact, and gold. There is no ante inside. Leave by the entrance or the exit at any time; the maze remembers what you cleared.

Food: every step on the overworld costs one. At zero you lose a life every other step until you eat. Cities sell food and every won duel yields some.

## Layout

```
server.js          static server + /api/art + /api/collection
index.html         shell
css/style.css
js/main.js         screens, world loop, persistence
js/duelview.js     duel screen and AI driver
js/engine.js       demo duel engine
js/ai.js           opponent heuristics
js/cards.js        Scryfall card -> engine definition compiler
js/scryfall.js     fetch + cache
js/collection.js   list parsing, art index
js/world.js        world generation and map rendering
js/dungeon.js      dungeon mazes: generation, top-down rendering, riddles
js/atlas.js        sprite sheet coordinates, loading and keying
assets/tileset.png the sprite sheet
content/enemies.json   enemy roster and decks (data only, no code)
content/dungeons.json  dungeon templates, rules and treasure lists
docs/story.md          story bible
tools/                 coverage report, card inspector, AI-vs-AI simulator, art check page
```

Enemies are data. Add one to `content/enemies.json` with a name, color, tier, life, bribe cost, gold reward and a deck of card names, and it appears in the world.

## Legal

Unofficial fan content permitted under the Wizards of the Coast Fan Content Policy. Not approved or endorsed by Wizards. Magic: The Gathering and all card names and text are property of Wizards of the Coast. Card data is fetched at runtime from Scryfall under its API terms. This repository contains no card images and no material from the 1997 game. Code is GPL-3.0-or-later.
