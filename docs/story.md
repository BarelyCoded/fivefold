# Fivefold — story bible (draft 1)

Fivefold is a sequel in spirit to the 1997 MicroProse campaign. It borrows the shape of that story, not its names: a plane sealed behind a barrier, five color-aligned guilds, a hidden corruptor, a spell that would end everything, and a nobody with a starter deck who has to fix it. Everything below is original so the project never has to ask anyone's permission.

## What happened before (the previous game, retold without its names)

Long ago a Guardian raised a barrier around the mana-rich plane of Shandalar to keep planeswalkers out. The five guilds it founded were corrupted from beyond the barrier; their masters murdered the Guardian and each set out to gather enough mana to cast a spell they believed would make them immortal. It would have shattered the barrier instead. A wandering mage with a weak deck and stubborn habits defeated all five and drove off the thing behind them.

That is the story the villages still tell. In Fivefold it is a generation old, the Wanderer is grey, and nobody has checked whether the barrier actually healed.

## The premise

**The barrier healed like a broken bone: crooked.** Mana no longer flows evenly across Shandalar. It pools and drains in tides the farmers call the Ebb. Where it pools, monsters and wild magic; where it drains, crops fail and cities decay. The mana links, which once merely fed the guilds, are now the pins holding the barrier's cracks shut.

**The five guilds were refounded** by the heroes of the last war and have decayed into five Orders, each ruled by a Warden who believes only their color can hold the barrier together. The Wardens are hoarding links. Each is preparing the Sealing, a spell that will make the barrier permanent and unbreakable.

**The Sealing is a trap.** When the barrier cracked a generation ago, something came through before it closed: not the banished planeswalker, but a splinter of it, formless, that hid in the wreckage of the guilds and learned to wear faces. It calls itself nothing. The people who serve it call it the Usurper. It has spent thirty years whispering to five Wardens that the barrier must be sealed forever. A sealed barrier keeps planeswalkers out, and it keeps the Usurper in, with an entire plane to itself.

**You are nobody.** A village mage, newly risen, with a deck of whatever the local market sells. The old Wanderer, dying, hands you a letter and the title: find out which Warden the Usurper is wearing, before the Sealing completes.

## The five Wardens

Each Warden rules a color, a region, and a castle. Each has an authored deck and a siege with special rules. Each can be **fought or turned**: complete their quest instead of assaulting the castle and they become an ally. The Usurper is wearing one of them, and that one cannot be turned; which one it is changes from run to run.

| Color | Warden | Order | Seat | What they believe |
|---|---|---|---|---|
| White | Serelith, Voice of the Ivory Court | The Court | Alabaster | Law will hold what magic cannot. She has outlawed unlicensed dueling. |
| Blue | Ondrel the Tidebinder | The Tidewatch | Tidewater | Knowledge of the barrier's weave is the only defence. He is drowning the coast to study it. |
| Black | Vesk Morrow, Keeper of the Mire | The Keepers | Mirehold | The dead do not need mana. He is emptying villages to reduce demand. |
| Red | Brannoc Ashhand | The Forge Companies | Cinderfall | Burn the cracks shut. He is razing forests to feed the furnaces. |
| Green | Ysolde of the Deepwood | The Deepwood Circle | Greenhollow | The plane will heal itself if people stop meddling. She has closed the roads. |

The Usurper's own seat is a fortress that was not there last year, on the far side of the map from wherever you start. Villagers say it is the Guardian's tomb. It is.

## Structure

- **Act 1, home ground.** Your starting color's region. Tutorial quests from your home city, the old Wanderer's letter, first roaming enemies, the first mana link. The Ebb is introduced as a visible thing: the map's tides shift every few days.
- **Act 2, the five Orders.** Open. Visit the other four regions in any order. Each Warden has a chain of two or three city quests that ends in either the siege or the alliance. Allied Wardens stop hoarding links, which slows the Sealing, and give a boon: the Court protects your cities from sieges, the Tidewatch shows enemy decks before duels, the Keepers return one lost ante card, the Forge sells cheaper cards, the Circle heals you on the road.
- **Act 3, the tomb.** When the fifth Warden falls or turns, the Usurper drops the disguise. The fortress opens. Its deck is five colors and its life total is obscene, and every Warden you allied fights beside you: each grants a starting card in play or a life bonus in the final duel.
- **The clock.** Every Warden still hostile binds links over time. When the bound links reach the Sealing's threshold the barrier locks with the Usurper inside: game over. Turning or defeating Wardens is the only way to stop the count.

## Tone

Practical, weary, a little funny. Villages talk about mana the way farmers talk about weather. Nobody says "destiny". The Wardens are not cartoons; four of the five are right about something. The Usurper is the only character who is enjoying itself.

## What this changes in the game

Already in the demo: five color regions, five cities, roaming enemies, mana links as life, the final castle, the link clock. To do, in priority order:

1. Five Warden castles, one per region, with authored decks and siege rules. The final fortress stays.
2. Warden quest chains in `content/quests.json`: reach, fetch, defeat. Rewards: cards, gold, alliance.
3. The Ebb: a per-region mana tide that shifts enemy spawns and market stock every few days.
4. City sieges: a hostile Warden's minion camps outside a city; if unbeaten by the deadline the market closes until you clear it.
5. Intro and act text on the title screen and in a journal.
6. The Usurper's disguise: choose the compromised Warden at world generation; their "alliance" quest turns out to be an ambush.

## Naming

"Shandalar" is a Wizards of the Coast plane name. The project may say "inspired by" but should not make it the title. "Fivefold" is the working title. Warden and city names above are original and free to use.
