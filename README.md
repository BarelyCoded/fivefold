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

## Use your own art

Drop images in the `art/` folder named after the card, lowercase with dashes:

```
art/lightning-bolt.jpg
art/serra-angel.png
art/grizzly-bears.webp
```

A photo of the physical card works. Cards with your art show a ★. Click **Rescan art folder** in the Collection screen after adding files. Cards without your art fall back to Scryfall's image at runtime. Nothing is ever bundled or committed: `art/` and `collection.csv` are in `.gitignore`.

## What the demo engine understands

- **Lands**: basics and anything with `{T}: Add {X}`; enters-tapped is respected.
- **Creatures** with numeric power and toughness. Keywords: flying, first strike, double strike, trample, haste, vigilance, deathtouch, lifelink, reach, defender, menace. Mana creatures work. Other abilities are ignored, and the card is marked approximated.
- **Instants and sorceries** whose text is: damage to a target/any target/each creature, destroy or exile target creature, +N/+N until end of turn, grant a keyword, draw cards, gain life, return target creature to hand, return a creature card from graveyard to hand, destroy target land.
- No stack. Spells resolve when cast. You get priority only on your own turn.

Everything else is unsupported for now. This engine is a placeholder: the project plan is to swap in a full rules engine behind the same interface.

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
content/enemies.json   enemy roster and decks (data only, no code)
```

Enemies are data. Add one to `content/enemies.json` with a name, color, tier, life, bribe cost, gold reward and a deck of card names, and it appears in the world.

## Legal

Unofficial fan content permitted under the Wizards of the Coast Fan Content Policy. Not approved or endorsed by Wizards. Magic: The Gathering and all card names and text are property of Wizards of the Coast. Card data is fetched at runtime from Scryfall under its API terms. This repository contains no card images and no material from the 1997 game. Code is GPL-3.0-or-later.
