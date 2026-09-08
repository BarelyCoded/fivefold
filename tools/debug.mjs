import fs from 'node:fs';
const store = JSON.parse(fs.readFileSync('tools/.cardcache.json','utf8'));
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem(){}, removeItem(){} };
const { cached } = await import('../js/scryfall.js');
const { compile } = await import('../js/cards.js');
const { Duel } = await import('../js/engine.js');
const { aiHooks } = await import('../js/ai.js');
const content = JSON.parse(fs.readFileSync('content/enemies.json','utf8'));
const expand = deck => { const out=[]; for (const [n,c] of Object.entries(deck)) { const d=compile(cached(n)); for (let i=0;i<c;i++) out.push(d);} return out; };
const a = content.enemies[0], b = content.enemies[8];
const duel = new Duel({ player:{name:a.name, deck:expand(a.deck), life:a.life, ai:true}, ai:{name:b.name, deck:expand(b.deck), life:b.life, ai:true}, hooks: aiHooks });
duel.start();
for (let i=0;i<400 && duel.winner===null;i++) {
  const p = duel.players[duel.priority];
  if (duel.step==='main1' && duel.priority===0 && !duel.jobs.length && !duel.events.length && p.battlefield.length>=2) {
    const cr = p.hand.find(c=>c.def.kind==='creature');
    console.log('turn', duel.turn, 'bf', p.battlefield.map(c=>c.def.name+(c.tapped?'(T)':'')), 'hand', p.hand.map(c=>c.def.name));
    console.log('sources', duel.manaSources(p).map(s=>s.card.def.name+':'+s.produces.join('')), 'plains manaAbilities', JSON.stringify(p.battlefield[0].def.manaAbilities));
    console.log('creature', cr?.def.name, 'cost', JSON.stringify(cr?.def.cost), 'canPay', cr && duel.canPay(p, cr.def.cost), 'canCast', cr && duel.canCast(p, cr), 'kind', cr?.def.kind, 'zone', cr?.zone);
    console.log('decide', JSON.stringify(aiHooks.decide(duel,p), (k,v)=>k==='card'?v.def.name:v));
    break;
  }
  duel.tick();
}
