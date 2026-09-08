# Fivefold art specification

What to ask for when the sprite sheet is recreated. Everything the game draws is listed here with exact sizes. The renderers in `js/world.js`, `js/dungeon.js` and `js/duelview.js` read rectangles from `js/atlas.js`, so a sheet that follows this layout can be wired in by filling one table.

## Ground rules (these caused all the trouble last time)

1. **Separate PNG files, one per category**, not a single showcase image. No title, no labels, no decorative frame, no drop shadows.
2. **Transparent background** on every sprite file. Terrain textures are the only opaque images.
3. **Uniform grid** per file: every cell exactly the size given below, starting at pixel (0, 0), no gutters, no padding. A sprite may be smaller than its cell but must be centred horizontally and rest on the cell's bottom edge.
4. **Native pixel size.** Draw at the sizes below and export at 1x. No upscaling, no smoothing, no JPEG. The game scales up with nearest-neighbour itself.
5. **One consistent style**: same palette, same light direction (upper left), same outline weight, top-down three-quarter view for the overworld and dungeon, side view for the battle sprites.
6. **Seamless terrain**: every ground texture must tile with itself on all four edges. The game blends regions by masking, not by transition tiles, so no edge or corner pieces are needed.

## 1. `terrain.png` — ground textures, 32×32 cells, opaque

One row per texture, four variants per row (columns 0–3). Variants are the same material with different detail, close in brightness so they can be mixed without showing a grid.

| Row | Texture | Notes |
|---|---|---|
| 0 | grass | forest floor, mid green |
| 1 | sand | pale desert sand, the white region |
| 2 | sea | deep teal water, subtle ripples |
| 3 | shallow water | lighter, for shorelines |
| 4 | dark rock | cracked basalt, the black region |
| 5 | lava | glowing, used as accents in rock |
| 6 | grey rock | mountain ground, no peaks drawn in |
| 7 | snow | optional, for high peaks |
| 8 | cobbles | town ground, under cities |
| 9 | dirt road | straight strip, tileable vertically, for later use |

## 2. `scenery.png` — overworld decorations, 48×48 cells, transparent

Row 0: trees. pine, pine cluster, oak, round tree, sapling, dead tree, bush, shrub.
Row 1: desert. dune, dune large, cactus, palm, oasis pond (may span two cells: draw it 96 wide starting at an even column), rocks.
Row 2: mountains. peak, peak wide, peak snowy, volcano (96×96, spans 2×2 cells, place at column 0 of rows 2–3), crag, boulder.
Row 3: (volcano continued) then: rock pile, skull, bones, lava vent, dead tree burnt.
Row 4: settlements. hut, two huts, watchtower, ruined tower, standing stone, cave mouth, well, signpost.
Row 5: water. rock in sea, ship wreck, sea serpent coil (decorative), reeds, lily pads.

## 3. `locations.png` — map icons, 64×64 cells, transparent

Row 0: the five cities. White marble castle with gold spires, blue-roofed coastal castle, purple-black keep, red-brown volcanic fortress, green village of timber houses.
Row 1: the Usurper's dark fortress (make it the largest and most sinister), a generic town, a dungeon entrance (pit with stairs and a torch), the same entrance cleared (no torch, barred), a mana link crystal cluster, the same crystal dull and grey.
Row 2: compass rose, and five colour banners (white, blue, black, red, green) for the minimap legend.

## 4. `figures.png` — map and duel figures, 48×64 cells, transparent

Rows are characters, columns are poses: 0 idle front, 1 idle front alternate (for a two-frame idle), 2 walking, 3 casting.

| Row | Character |
|---|---|
| 0 | the hero: robed mage with staff |
| 1 | white mage, tier 1 (cleric) |
| 2 | white mage, tier 2 (knight of the order) |
| 3 | blue mage, tier 1 (tidecaller) |
| 4 | blue mage, tier 2 (stormseer) |
| 5 | black mage, tier 1 (grave robber) |
| 6 | black mage, tier 2 (necromancer) |
| 7 | red mage, tier 1 (hill raider) |
| 8 | red mage, tier 2 (fire mage) |
| 9 | green mage, tier 1 (druid) |
| 10 | green mage, tier 2 (beastmaster) |
| 11 | the Usurper in disguise (hooded, five-colour trim) |

## 5. `townsfolk.png` — 48×64 cells, transparent

One row, twelve townsfolk for the city screens: merchant, innkeeper, guard, priest, farmer, child, old woman, blacksmith, scholar, sailor, beggar, noble. One idle pose each.

## 6. `monsters.png` — battle sprites, 96×96 cells, transparent, side view facing left

Rows are creatures, columns are frames: 0 idle, 1 idle alternate, 2 attack windup, 3 attack strike, 4 hurt, 5 dead.

| Row | Creature | Used for |
|---|---|---|
| 0 | red dragon | the Usurper's final duel |
| 1 | stone golem | white dungeon (Sunken Chapel) |
| 2 | sea serpent | blue dungeon (Drowned Archive) |
| 3 | skeleton | black dungeon (Barrow of the Keepers) |
| 4 | fire lizard | red dungeon (Ashfall Foundry) |
| 5 | giant spider | green dungeon (Rootbound Hollow) |
| 6 | wall of stone | the Warded rule's guardian wall |
| 7 | wraith | spare |

Attack effects on their own row 8: fire breath, water spout, bone shards, venom spit, web — one 96×96 cell each.

## 7. `dungeon.png` — top-down dungeon tiles, 32×32 cells, transparent except floors

Row 0: floors, opaque, seamless: stone floor ×4 variants.
Row 1: floors, opaque: dark rock ×2, lava ×2 (all seamless).
Row 2: walls, drawn as blocks seen from above with a lit front face: wall top, wall top with crack, wall face, wall face with moss, inner corner, outer corner, pillar, rubble.
Row 3: doors and exits at 32×32: closed door, open door, barred gate, portal (blue glow), stairs down, stairs up, pit, drain grate.
Row 4: wall fixtures, transparent: torch lit, torch out, chains, weapon rack, banner, skull pile, cobweb, crack with lava glow.
Row 5: pickups, transparent: chest closed, chest open, small chest, scroll, potion red, potion blue, amulet, gold pile, key gold, key silver, crystal, bones.

## 8. `ui.png` — frame and controls, transparent

Row 0, 64×64 cells: frame corner (top-left), frame edge horizontal (tileable), frame edge vertical (tileable), panel corner, panel edge horizontal, panel edge vertical. The other corners are mirrored by the game.
Row 1, 48×48 cells: buttons for the bottom bar: map, deck, collection, journal, rest, menu, each in normal state; the game darkens them for hover and pressed.
Row 2, 32×32 cells: minimap markers: city, dungeon, crystal, fortress, player; plus a food icon, gold icon, life icon.

## 9. `cards.png` — optional, 63×88 cells

Card frames for the deck builder, one per colour plus artifact, land and a "your own art" star badge. Only if we decide to stop using Scryfall images for the frame.

## Delivery checklist

- Nine files named exactly as above, PNG with alpha, 1x, cells aligned to the grid from (0, 0).
- A `README.txt` listing anything that deviates from this spec.
- No text, watermarks, frames or shadows baked into any file.
- If a generator cannot keep a uniform grid, deliver each sprite as its own PNG instead, named `category-name.png` (for example `scenery-pine.png`), and the game will build the atlas from the files.
