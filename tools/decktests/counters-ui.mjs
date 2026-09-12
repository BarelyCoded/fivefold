// Browser check: counters are visible on land pills (split per count), on battlefield cards, and in the hover
// preview; mana abilities that add or remove counters say so in the log.
//   node tools/decktests/counters-ui.mjs   (needs playwright installed: npm i playwright)
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { chromium } from 'playwright';
const PORT=8831, BASE=`http://localhost:${PORT}`; const here='/home/user/fivefold/tools'; const all=new Map();
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
// Reanimator has Gemstone Mine; Mono Brown has Powder Keg
await p.click('#bw-decks'); await p.waitForSelector('[data-presetload="Reanimator"]'); await p.click('[data-presetload="Reanimator"]'); await p.waitForTimeout(150); await p.selectOption('#bw-opp','Mono Brown'); await p.click('#bw-playtest');
await p.waitForFunction(()=>window.ff.S.screen==='duel'&&window.ff.S.duel?.duel,{timeout:30000}); await p.waitForTimeout(800); if (await p.$('#b-mull-keep')) await p.click('#b-mull-keep'); await p.waitForTimeout(800);
const ids = await p.evaluate(()=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf; const mk=(n,i)=>{const c=d.instance(D(n),i); c.zone='limbo'; d.moveTo(c,'battlefield',{controller:i}); c.sick=false; return c;};
  const m1=mk('Gemstone Mine',0), m2=mk('Gemstone Mine',0); m2.counters.mining=1; const keg=mk('Powder Keg',1); keg.counters.fuse=2; d.events.length=0; d.refresh(); d.emit(); return { m1:m1.id, m2:m2.id, keg:keg.id }; });
await p.waitForTimeout(300);
const pills = await p.$$eval('.pill[data-name="Gemstone Mine"]', els=>els.map(e=>({ text: e.innerText.replace(/\s+/g,' '), counters: e.dataset.counters })));
ok(pills.length===2 && pills.some(x=>/3 mining/.test(x.text)) && pills.some(x=>/1 mining/.test(x.text)), `two pills, one per counter count (${pills.map(x=>x.text).join(' | ')})`);
const kegBadge = await p.evaluate(({id})=>document.querySelector(`.card[data-id="${id}"] .card-counters`)?.innerText, {id: ids.keg});
ok(kegBadge==='2 fuse', `Powder Keg shows its fuse counters (${kegBadge})`);
// hover preview shows counters
const pill3 = (await p.$$('.pill[data-name="Gemstone Mine"]')).find(async x => true);
await (await p.$('.pill[data-name="Gemstone Mine"][data-counters="3 mining"]')).hover(); await p.waitForTimeout(400);
const prev = await p.evaluate(()=>document.querySelector('#bigcard .bc-counters')?.innerText||'');
ok(/Counters: 3 mining/.test(prev), `hover preview lists the counters (${prev})`);
// tapping the mine logs the change and the pill updates
await p.evaluate(({id})=>{ const d=window.ff.S.duel.duel; const c=d.card(id); d.activateMana(d.players[0], c, 0, 'G'); d.emit(); }, {id: ids.m1}); await p.waitForTimeout(300);
const log = await p.evaluate(()=>window.ff.S.duel.duel.log.slice(-2).join(' / '));
ok(/loses a mining counter \(2 left\)/.test(log), `log explains the counter change (${log})`);
const pills2 = await p.$$eval('.pill[data-name="Gemstone Mine"]', els=>els.map(e=>e.innerText.replace(/\s+/g,' ')));
ok(pills2.some(t=>/2 mining/.test(t)), `pill now reads 2 mining (${pills2.join(' | ')})`);
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.message.split('\n')[0]);fail++;}finally{try{await b.close()}catch{}try{relay.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
