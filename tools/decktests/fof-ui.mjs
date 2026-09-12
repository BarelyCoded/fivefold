// Browser check: Fact or Fiction shows the two piles face up with their cards and a take button per pile.
//   node tools/decktests/fof-ui.mjs   (needs playwright installed: npm i playwright)
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { chromium } from 'playwright';
const PORT=8877, BASE=`http://localhost:${PORT}`; const here='/home/user/fivefold/tools'; const all=new Map();
for(const f of fs.readdirSync(path.join(here,'.sets'))) for(const c of JSON.parse(fs.readFileSync(path.join(here,'.sets',f),'utf8'))) if(!all.has(c.name.toLowerCase())) all.set(c.name.toLowerCase(),c);
const stub=n=>({name:n,id:'s'+Math.random(),set:'x',mana_cost:'{1}',cmc:1,type_line:'Artifact',oracle_text:'',colors:[],keywords:[],rarity:'common',image_uris:null});
const relay=spawn('node',['/home/user/fivefold/relay.js'],{env:{...process.env,PORT:String(PORT)},stdio:['ignore','pipe','pipe']});
await new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('to')),4000);relay.stdout.on('data',d=>{if(String(d).includes('relay at')){clearTimeout(t);res();}});});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
let pass=0,fail=0; const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  FAIL',m);}};
try{ const p=await b.newPage({viewport:{width:1280,height:900}}); p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.route('https://api.scryfall.com/**',async r=>{const q=r.request();if(q.url().includes('/cards/collection')){const ids=JSON.parse(q.postData()||'{}').identifiers||[];return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:ids.map(i=>all.get(i.name.toLowerCase())||stub(i.name)),not_found:[]})});}return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[],has_more:false})});});
await p.route('**/*.mp3',r=>r.fulfill({status:200,contentType:'audio/mpeg',body:Buffer.alloc(0)}));
await p.goto(BASE); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000}); await p.evaluate(()=>{try{localStorage.clear()}catch{}}); await p.reload(); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000});
await p.evaluate(()=>{window.ff.S.screen='brew'; window.ff.render();}); await p.waitForSelector('.brewscreen',{timeout:20000}); await p.waitForFunction(()=>window.ff.S.aiDecks!==undefined,{timeout:20000});
await p.evaluate(()=>{window.ff.S.screen='brew'; window.ff.render();}); await p.waitForSelector('.brewscreen',{timeout:20000}); await p.waitForFunction(()=>window.ff.S.aiDecks!==undefined,{timeout:20000});
await p.click('#bw-decks'); await p.waitForSelector('[data-presetload="UW Standstill"]'); await p.click('[data-presetload="UW Standstill"]'); await p.waitForTimeout(150); await p.selectOption('#bw-opp','Reanimator'); await p.click('#bw-playtest');
await p.waitForFunction(()=>window.ff.S.screen==='duel'&&window.ff.S.duel?.duel,{timeout:30000}); await p.waitForTimeout(600); if (await p.$('#b-mull-keep')) await p.click('#b-mull-keep');
const atMain=()=>p.evaluate(()=>{const d=window.ff.S.duel.duel;return d.pending?.type==='priority'&&d.priority===0&&d.active===0&&d.step==='main1'&&!d.stack.length;});
for(let i=0;i<40&&!(await atMain());i++){await p.waitForTimeout(200); if(await p.$('#b-pass')) await p.click('#b-pass').catch(()=>{});}
// set up: Fact or Fiction in hand, five known cards on top, plenty of mana
const st=await p.evaluate(()=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf;
  d.players[0].pool={W:0,U:4,B:0,R:0,G:0,C:0};
  const ff=d.instance(D('Fact or Fiction'),0); ff.zone='hand'; d.players[0].hand.push(ff);
  for(const n of ['Island','Counterspell','Standstill','Wrath of God','Swords to Plowshares']){const c=d.instance(D(n),0);c.zone='library';d.players[0].library.push(c);}
  d.jobs.length=0; d.stack.length=0; d.events.length=0; d.active=0; d.priority=0; d.step='main1'; d.pending={type:'priority'}; d.emit();
  return { ff: ff.id }; });
await p.waitForTimeout(300);
await p.click(`.card[data-zone="hand"][data-id="${st.ff}"]`); await p.waitForTimeout(1200);
// the piles UI should appear
const piles = await p.$$('.pile');
ok(piles.length===2, `two piles are shown (${piles.length})`);
const pileText = await p.$$eval('.pile', els=>els.map(e=>e.innerText.replace(/\s+/g,' ')));
ok(pileText.every(t=>/Take pile/.test(t)) && pileText.join(' ').match(/Island|Counterspell|Standstill|Wrath|Swords/), `piles list their card names and a take button (${pileText.join(' || ').slice(0,120)})`);
const cardsShown = await p.$$eval('.pile .pile-card', els=>els.length);
ok(cardsShown===5, `all five revealed cards are shown across the piles (${cardsShown})`);
await p.click('.pile[__marker] , [data-pile="0"]').catch(async()=>{ await p.click('[data-pile="0"]'); }); await p.waitForTimeout(600);
const after = await p.evaluate(()=>{const d=window.ff.S.duel.duel; return { hand: d.players[0].hand.map(c=>c.def.name), gy: d.players[0].graveyard.map(c=>c.def.name) };});
ok(!(await p.$('.pile')), 'the pile chooser closes after taking one');
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.stack.split('\n').slice(0,5).join('\n'));fail++;}finally{try{await b.close()}catch{}try{relay.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
