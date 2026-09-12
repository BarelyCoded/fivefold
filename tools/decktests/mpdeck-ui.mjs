// Browser check: the multiplayer deck screen offers the vs-AI preset archetypes and the player's saved
// decks as one-click selectable options, loading them into the MP deck slot.
//   node tools/decktests/mpdeck-ui.mjs   (needs playwright installed: npm i playwright)
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { chromium } from 'playwright';
const PORT=8879, BASE=`http://localhost:${PORT}`; const here='/home/user/fivefold/tools'; const all=new Map();
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
// save a deck so "Your saved decks" shows too
await p.evaluate(()=>{ try{ localStorage.setItem('ff.decks.v1', JSON.stringify([{ id:'d1', name:'My Brew', savedAt:Date.now(), deck:{ 'Lightning Bolt':4, 'Mountain':20 }, side:{} }])); }catch{} });
// enter the multiplayer deck screen directly with a stub mp state (no peer needed to render mpdeck)
await p.evaluate(()=>{ const S=window.ff.S; S.decks=undefined; const mp={ addr:'', name:'Tester', status:'online', view:'deck', rooms:[], role:'host', room:{code:'ABCD',host:'Tester'}, deckColor:'G', deckDiff:'apprentice', deck:{}, ready:false, oppReady:false, net:{ relay(){}, list(){}, leave(){} } }; S.mp=mp; });
// reuse the app's own path so aiDecks/decks load and mpdeck renders
await p.evaluate(()=>{ window.ff.S.screen='mpdeck'; if (window.ff.S.decks===undefined) { try{ window.ff.S.decks=JSON.parse(localStorage.getItem('ff.decks.v1'))||[]; }catch{ window.ff.S.decks=[]; } } window.ff.render(); });
await p.waitForSelector('.mpdeck',{timeout:20000}); await p.waitForTimeout(300);
const presets = await p.$$eval('[data-mppreset]', els=>els.map(e=>e.textContent.trim()));
ok(presets.length>=10 && presets.some(t=>/Goblins/.test(t)), `preset archetypes are listed (${presets.length}: ${presets.slice(0,4).join(', ')})`);
const saved = await p.$$eval('[data-mpsaved]', els=>els.map(e=>e.textContent.trim()));
ok(saved.some(t=>/My Brew/.test(t)), `saved decks are listed (${saved.join(', ')})`);
// click the Goblins preset
await p.click('[data-mppreset="Goblins"]'); await p.waitForFunction(()=>Object.keys(window.ff.S.mp.deck||{}).length>10,{timeout:20000}); await p.waitForTimeout(300);
const deck = await p.evaluate(()=>window.ff.S.mp.deck);
const total = Object.values(deck).reduce((a,b)=>a+b,0);
ok(total>=40 && Object.keys(deck).some(n=>/Goblin/.test(n)), `Goblins preset loaded into the MP deck (${total} cards, ${Object.keys(deck).length} distinct)`);
// the deck panel now reflects it
const header = await p.$eval('.mpdeck .box:nth-child(2) .rowhead h2, .mpdeck h2', el=>el.textContent).catch(()=>'');
ok(/cards/.test(await p.evaluate(()=>document.querySelector('.mpdeck').innerText)), 'deck view shows a card count');
// load a saved deck
await p.click('[data-mpsaved="d1"]'); await p.waitForFunction(()=>{const d=window.ff.S.mp.deck; return d['Lightning Bolt']===4;},{timeout:20000}).catch(()=>{});
const deck2 = await p.evaluate(()=>window.ff.S.mp.deck);
ok(deck2['Lightning Bolt']===4 && deck2['Mountain']===20, `saved deck loaded (Bolt ${deck2['Lightning Bolt']}, Mountain ${deck2['Mountain']})`);
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.stack.split('\n').slice(0,5).join('\n'));fail++;}finally{try{await b.close()}catch{}try{relay.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
