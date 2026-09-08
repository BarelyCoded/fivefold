// Learn to play: lessons for someone who has never held a Magic card, and live hints for the practice duel.
import { isCreature, isLand, power, toughness, has } from './engine.js';

const card = name => `<span class="tcard" data-preview="${name}">${name}</span>`;
export const LESSONS = [
  { title: 'The goal', html: `
    <p>Two mages duel. Each starts with a pile of <b>life</b> (20 in a normal game) and a <b>deck</b> of at least 40 cards. You win by bringing your opponent to <b>0 life</b>. You also win if they have to draw a card from an empty deck.</p>
    <p>In Fivefold your life on the map carries into duels: the crystals you find raise your maximum, resting at an inn restores it, and losing a duel costs you gold and the card you wagered.</p>
    <p class="small">Hover any card name shown in green, like ${card('Serra Angel')}, to see the real card.</p>` },
  { title: 'Cards, hands and turns', html: `
    <p>You start a duel by drawing <b>7 cards</b>. At the start of each of your turns you <b>draw one more</b> (the player who goes first skips that first draw). You may hold at most 7 at the end of your turn.</p>
    <p>Cards come in a few kinds:</p>
    <ul>
      <li><b>Lands</b> like ${card('Forest')} make mana, the energy that pays for everything else.</li>
      <li><b>Creatures</b> like ${card('Grizzly Bears')} stay on the table and fight for you.</li>
      <li><b>Instants</b> and <b>sorceries</b> like ${card('Lightning Bolt')} and ${card('Divination')} do one thing and are discarded.</li>
      <li><b>Artifacts</b> and <b>enchantments</b> like ${card('Howling Mine')} and ${card('Pacifism')} stay on the table and change the rules while they do.</li>
    </ul>` },
  { title: 'Lands and mana', html: `
    <p>Every card except a land has a <b>mana cost</b> in its top corner. ${card('Grizzly Bears')} costs <b>1G</b>: one green mana and one mana of any colour. ${card('Serra Angel')} costs <b>3WW</b>: two white and three of anything.</p>
    <p>You may play <b>one land per turn</b>, for free. To use it, you <b>tap</b> it (turn it sideways) for one mana of its colour: a Forest gives green, a Plains white, an Island blue, a Swamp black, a Mountain red. Tapped lands straighten out again (<b>untap</b>) at the start of your next turn.</p>
    <p>Mana you make disappears at the end of each phase, so make it when you need it. The game does this for you: click a card to cast it and the right lands tap themselves.</p>
    <p>This is why decks are built around colours. A deck of Forests cannot cast ${card('Lightning Bolt')}.</p>` },
  { title: 'Creatures', html: `
    <p>A creature has two numbers in its bottom corner: <b>power / toughness</b>. ${card('Grizzly Bears')} is 2/2: it deals 2 damage and dies after taking 2 in one turn. ${card('Hill Giant')} is 3/3.</p>
    <p>A creature that arrived this turn is <b>summoning sick</b>: it cannot attack until your next turn (unless it has <b>haste</b>). Damage a creature takes <b>heals at the end of the turn</b>, so wounds do not add up across turns.</p>
    <p>Some creatures carry keywords. <b>Flying</b> can only be blocked by creatures with flying or reach. <b>First strike</b> deals its damage before normal creatures. <b>Trample</b> pushes leftover damage past a blocker to the player. Hover a creature in the game to read its text.</p>` },
  { title: 'Combat', html: `
    <p>On your turn, after your main phase, you may <b>attack</b>. Choose which of your untapped creatures attack; they tap as they go in. Attackers hit the <b>opponent</b>, not their creatures.</p>
    <p>The defender then chooses <b>blockers</b>: each of their untapped creatures may stand in front of one attacker. A blocked attacker fights the blocker instead of the player: they deal their power to each other at the same time. An unblocked attacker deals its power to the player.</p>
    <p>So attacking with a 2/2 into an untapped 3/3 is usually a bad trade, and a creature that blocks is not tapped, so it can still block next turn. Attack when you have more or bigger creatures, or flyers they cannot block.</p>
    <p>The <b>Attack with all</b> button sends every creature that can go.</p>` },
  { title: 'Spells and responding', html: `
    <p><b>Sorceries</b> and creatures can only be cast in your own <b>main phase</b> when nothing else is happening. <b>Instants</b>, and abilities you activate, can be used at almost any moment, even during the opponent's turn or in the middle of combat.</p>
    <p>When a spell is cast it goes on the <b>stack</b> and the other player gets a chance to <b>respond</b> before it happens. Responses resolve first: if you ${card('Giant Growth')} a creature in response to ${card('Lightning Bolt')}, the creature grows to 5/4 before the 3 damage arrives and survives. ${card('Counterspell')} stops a spell outright.</p>
    <p>When the game pauses and asks you to pass, it is offering you that chance. <b>Pass</b> (or the space bar) lets things happen. <b>Stop asking this turn</b> passes for the rest of the turn.</p>` },
  { title: 'A turn, step by step', html: `
    <ol>
      <li><b>Untap</b>: everything of yours straightens out.</li>
      <li><b>Upkeep</b>: some cards charge a cost here.</li>
      <li><b>Draw</b> a card.</li>
      <li><b>Main phase</b>: play a land, cast creatures and sorceries.</li>
      <li><b>Combat</b>: attack, they block, damage is dealt.</li>
      <li><b>Second main phase</b>: cast what you held back.</li>
      <li><b>End</b>: "until end of turn" effects wear off, damage heals, discard down to 7.</li>
    </ol>
    <p>A good first-turn plan: play a land. Second turn: land, cast a two-cost creature. Third turn: land, attack if it is safe, cast more. Keep your hand full of things you can afford.</p>` },
  { title: 'Fivefold itself', html: `
    <p>The map is five regions, one per colour. The mages roaming it duel you for <b>ante</b>: each side wagers a random non-land card from their deck and the winner keeps both. Every step costs <b>food</b>; buy it in cities. Blue <b>crystals</b> are mana links that raise your life. Landmarks marked <b>?</b> ask a riddle about a card. Beaten mages may reveal a <b>dungeon</b>.</p>
    <p>Your deck must have at least 40 cards; the deck builder adds basic lands for free. Cards you win, buy or find go to your collection, and you can import the cards you own in real life from the Collection tab.</p>
    <p>Ready? The practice duel below pits the green starter deck against the Novice Cleric with nothing at stake, and a tutor box on the right tells you what to do at each step.</p>` },
];

// A hint for the human player (index 0) from the current duel state. Returns { title, text }.
// Every card the lessons mention, so the app can fetch them before the lessons open.
export const TUTORIAL_CARDS = [...new Set(LESSONS.flatMap(l => [...l.html.matchAll(/data-preview="([^"]+)"/g)].map(m => m[1])))];

export function hintFor(duel, me, ui) {
  const pend = duel.pending;
  if (duel.winner !== null) return { title: duel.winner === 0 ? 'You won' : 'You lost', text: duel.winner === 0 ? 'Their life reached 0. Every duel on the map works like this one.' : 'Your life reached 0. Try keeping a blocker back and attacking only when it is safe.' };
  if (ui?.wizard?.stage === 'targets') return { title: 'Choose a target', text: 'This spell needs a target. Click a creature or a player on the table. Damage and destruction go at their creatures; pumps and protection go on yours.' };
  if (!pend) return { title: 'Opponent is thinking', text: 'Wait a moment.' };
  const mine = duel.active === 0;
  if (pend.type === 'request') {
    switch (pend.req.kind) {
      case 'attackers': {
        const opp = duel.players[1];
        const blockers = opp.battlefield.filter(c => isCreature(c) && !c.tapped);
        const ours = me.battlefield.filter(c => duel.canAttack(c));
        if (!blockers.length) return { title: 'Attack', text: 'They have no untapped creatures, so nothing can block. Attack with everything.' };
        const safe = ours.filter(a => has(a, 'Flying') ? !blockers.some(b => has(b, 'Flying') || has(b, 'Reach')) : !blockers.some(b => power(b) >= toughness(a)));
        return { title: 'Declare attackers', text: safe.length ? `${safe.map(c => c.def.name).join(', ')} can attack safely: no blocker of theirs would kill it. Click those creatures, then Confirm.` : `Each of your creatures could be blocked and killed by ${blockers.map(c => `${c.def.name} (${power(c)}/${toughness(c)})`).join(', ')}. Confirm with no attackers and build up first.` };
      }
      case 'blockers': {
        const atk = duel.attackers.map(id => duel.card(id)).filter(Boolean);
        const total = atk.reduce((s, a) => s + power(a), 0);
        return { title: 'Declare blockers', text: `${atk.map(a => `${a.def.name} (${power(a)}/${toughness(a)})`).join(', ')} attacking for ${total} total. Click one of your creatures, then the attacker to block. A blocker survives if its toughness is more than the attacker's power. ${total >= me.life ? 'This is lethal: block as much as you can.' : 'If no block is good, take the damage.'}` };
      }
      case 'yesno': return { title: 'A choice', text: pend.req.text };
      case 'target': return { title: 'Choose a target', text: pend.req.text + '. Click it on the table.' };
      default: return { title: 'Make a choice', text: pend.req.text || 'Pick from the options on the right.' };
    }
  }
  if (duel.stack.length) {
    const top = duel.stack[duel.stack.length - 1];
    if (top.controller !== 0) return { title: 'They cast something', text: `${top.card.def.name} is on the stack. You may respond with an instant or an ability now, or Pass to let it happen.` };
    return { title: 'Your spell is waiting', text: 'Pass to let it resolve. The opponent gets a chance to respond first.' };
  }
  if (!mine) return { title: "Opponent's turn", text: duel.step === 'end' ? 'Their end step. Instants cast now use mana that would otherwise be wasted. Otherwise Pass.' : 'Nothing to do unless you hold an instant. Pass, or Stop asking this turn.' };
  const step = duel.step;
  if (step === 'main1' || step === 'main2') {
    const land = me.hand.find(c => isLand(c));
    if (land && me.landPlayed === 0) return { title: 'Play a land', text: `Click ${land.def.name} in your hand and play it. One land per turn, always, for free.` };
    const castable = me.hand.filter(c => !isLand(c) && duel.canCast(me, c)).sort((a, b) => b.def.cmc - a.def.cmc);
    if (castable.length) return { title: 'Cast something', text: `You can afford ${castable.map(c => c.def.name).join(', ')}. Click one in your hand. Creatures first: they win the game.` };
    const ready = me.battlefield.some(c => duel.canAttack(c));
    if (step === 'main1' && ready) return { title: 'Go to combat', text: 'Nothing else to cast. Press "Go to combat" and choose attackers.' };
    return { title: step === 'main1' ? 'Nothing to do' : 'End your turn', text: 'You cannot afford anything else. Press Next phase or End turn.' };
  }
  return { title: 'Pass', text: 'Press Pass or space to move on.' };
}
