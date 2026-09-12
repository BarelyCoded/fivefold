// Browser check of the home screen: two modes (Adventure, Constructed Premodern), the adventure screen with the
// new-journey form, and a top bar whose tabs follow the mode you are in.
//   node tools/decktests/home-ui.mjs   (needs playwright installed: npm i playwright)
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { chromium } from 'playwright';
const PORT=8851, BASE=`http://localhost:${PORT}`; const here='/home/user/fivefold/tools'; const all=new Map();
for(const f of fs.readdirSync(path.join(here,'.sets'))) for(const c of JSON.parse(fs.readFileSync(path.join(here,'.sets',f),'utf8'))) if(!all.has(c.name.toLowerCase())) all.set(c.name.toLowerCase(),c);
const stub=n=>({name:n,id:'s'+Math.random(),set:'x',mana_cost:'{1}',cmc:1,type_line:'Artifact',oracle_text:'',colors:[],keywords:[],rarity:'common',image_uris:null});
const relay=spawn('node',['/home/user/fivefold/relay.js'],{env:{...process.env,PORT:String(PORT)},stdio:['ignore','pipe','pipe']});
await new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('to')),4000);relay.stdout.on('data',d=>{if(String(d).includes('relay at')){clearTimeout(t);res();}});});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
let pass=0,fail=0; const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  FAIL',m);}};
const SP='/tmp/claude-0/-home-user-fivefold/21e168b5-057b-5db2-a0b6-f8e813273fa5/scratchpad';
try{ const p=await b.newPage({viewport:{width:1280,height:900}}); p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.route('https://api.scryfall.com/**',async r=>{const q=r.request();if(q.url().includes('/cards/collection')){const ids=JSON.parse(q.postData()||'{}').identifiers||[];return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:ids.map(i=>all.get(i.name.toLowerCase())||stub(i.name)),not_found:[]})});}return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[],has_more:false})});});
await p.route('**/*.mp3',r=>r.fulfill({status:200,contentType:'audio/mpeg',body:Buffer.alloc(0)}));
await p.goto(BASE); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000}); await p.evaluate(()=>{try{localStorage.clear()}catch{}}); await p.reload(); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000}); await p.waitForTimeout(400);
const home = await p.evaluate(()=>({ screen: window.ff.S.screen, txt: document.body.innerText, tabs: [...document.querySelectorAll('#topbar .tab')].map(t=>t.textContent.trim()), brand: document.querySelector('.brand')?.innerText }));
ok(home.screen==='title' && /Adventure/i.test(home.txt) && /CONSTRUCTED . PREMODERN/i.test(home.txt.toUpperCase()) && /Begin a journey/.test(home.txt) && /Deck builder/.test(home.txt), 'home shows both modes');
ok(home.tabs.length===1 && /demo/i.test(home.brand), `home top bar has no mode tabs (${home.tabs.join('|')})`);
ok(/logged to improve the rules engine/.test(home.txt) && /New to Magic\?/.test(home.txt), 'home keeps the lessons box and the logging notice');
await p.screenshot({path:`${SP}/home.png`});
// adventure
await p.click('[data-go="adventure"]'); await p.waitForTimeout(300);
const adv = await p.evaluate(()=>({ screen: window.ff.S.screen, txt: document.body.innerText, tabs: [...document.querySelectorAll('#topbar .tab')].map(t=>t.textContent.trim()), brand: document.querySelector('.brand')?.innerText, form: !!document.querySelector('#newgame') }));
ok(adv.screen==='adventure' && adv.form && /New journey/.test(adv.txt) && /Home/.test(adv.txt), 'adventure screen has the new-journey form and a way home');
ok(adv.tabs.join('|')==='Adventure|Map|Collection|Deck|🔊' && /adventure/i.test(adv.brand), `adventure top bar (${adv.tabs.join('|')})`);
await p.screenshot({path:`${SP}/adventure.png`});
// start a journey to check the map + stats
await p.fill('#newgame input[name=name]','Tess'); await p.click('#newgame button[type=submit]'); await p.waitForFunction(()=>window.ff.S.screen==='map',{timeout:30000}); await p.waitForTimeout(300);
const map = await p.evaluate(()=>({ tabs: [...document.querySelectorAll('#topbar .tab')].map(t=>t.textContent.trim()), stats: !!document.querySelector('#topbar .stats') }));
ok(map.stats && map.tabs[0]==='Adventure', `map keeps the stats bar (${map.tabs.join('|')})`);
// home again shows Continue
await p.click('.brand'); await p.waitForTimeout(300);
const home2 = await p.evaluate(()=>document.body.innerText);
ok(/Continue — Tess, day 1/.test(home2) && /New journey/.test(home2), 'home offers Continue and New journey once a game exists');
// constructed
await p.click('[data-go="brew"]'); await p.waitForSelector('.brewscreen',{timeout:20000}); await p.waitForTimeout(300);
const con = await p.evaluate(()=>({ tabs: [...document.querySelectorAll('#topbar .tab')].map(t=>t.textContent.trim()), brand: document.querySelector('.brand')?.innerText, stats: !!document.querySelector('#topbar .stats') }));
ok(con.tabs.join('|')==='Deck builder|Multiplayer|🔊' && /premodern/i.test(con.brand) && !con.stats, `constructed top bar (${con.tabs.join('|')}, stats=${con.stats})`);
await p.screenshot({path:`${SP}/brewtop.png`, clip:{x:0,y:0,width:1280,height:120}});
// My decks from home opens the builder with the deck list open
await p.click('.brand'); await p.waitForTimeout(200); await p.click('#b-my-decks'); await p.waitForSelector('.brewscreen',{timeout:20000}); await p.waitForTimeout(300);
ok(!!(await p.$('.bw-decksbox')), 'My decks opens the builder with the deck list showing');
// playtest duel: constructed mode in the top bar
await p.waitForFunction(()=>window.ff.S.aiDecks!==undefined,{timeout:20000}); await p.waitForSelector('[data-presetload="Goblins"]'); await p.click('[data-presetload="Goblins"]'); await p.waitForTimeout(150); await p.click('#bw-playtest');
await p.waitForFunction(()=>window.ff.S.screen==='duel'&&window.ff.S.duel?.duel,{timeout:30000}); await p.waitForTimeout(500);
const dl = await p.evaluate(()=>({ brand: document.querySelector('.brand')?.innerText, stats: !!document.querySelector('#topbar .stats') }));
ok(/premodern/i.test(dl.brand) && !dl.stats, `playtest duel shows as constructed (${dl.brand})`);
// phone width
await p.setViewportSize({width:400,height:800}); await p.click('.brand'); await p.waitForTimeout(300);
const narrow = await p.evaluate(()=>({ scrollW: document.documentElement.scrollWidth, w: window.innerWidth, cols: getComputedStyle(document.querySelector('.home .modes')).gridTemplateColumns.split(' ').length }));
ok(narrow.scrollW<=narrow.w+1 && narrow.cols===1, `home stacks to one column at phone width (${narrow.cols} col, scroll ${narrow.scrollW}/${narrow.w})`);
await p.screenshot({path:`${SP}/home-phone.png`, fullPage:true});
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.stack.split('\n').slice(0,4).join('\n'));fail++;}finally{try{await b.close()}catch{}try{relay.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
