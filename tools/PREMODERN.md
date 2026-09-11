# Premodern format pipeline

The game is being grown into a tool for the **Premodern** community format (Fourth Edition through
Scourge). The format is defined in `content/premodern.json` (legal set codes, deck rules, banned list)
and the shared set list lives in `tools/sets.mjs`.

## One-time data ingest (needs Scryfall access)

Run wherever `api.scryfall.com` is reachable, then commit the results:

    node tools/fetch-sets.mjs premodern     # -> tools/.sets/<code>.json for all 29 legal sets
    node tools/build-catalog.mjs            # -> content/premodern-pool.json (legal pool by colour)
    node tools/power-tiers.mjs              # -> content/power-tiers.json (regenerate with the new cards)

Then commit `tools/.sets/*.json`, `content/premodern-pool.json` and `content/power-tiers.json`.

## Checking rules coverage

    node tools/coverage.mjs premodern       # how much of the format the rules engine can play
    node tools/coverage.mjs premodern --list # list the unsupported / approximated cards + reasons

## Applying the banned list

Add exact card names to `banned` in `content/premodern.json`, then re-run `build-catalog.mjs`. Deck
legality (`js/format.js`, `premodernLegality`) enforces legal sets, the banned list, the 4-copy limit
(basics exempt), the 60-card minimum and the 15-card sideboard cap.
