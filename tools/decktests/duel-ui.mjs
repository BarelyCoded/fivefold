// Browser check of the duel view: land-target prompts, hover text on opponent lands, cycling confirmation.
//   node tools/decktests/duel-ui.mjs   (needs playwright + the bundled chromium)
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT=8811, BASE=`http://localhost:${PORT}`;
const here='/home/user/fivefold/tools'; const all=new Map();
for(const f of fs.readdirSync(path.join(here,'.sets'))) for(const c of JSON.parse(fs.readFileSync(path.join(here,'.sets',f),'utf8'))) if(!all.has(c.name.toLowerCase())) all.set(c.name.toLowerCase(),c);
const stub=n=>({name:n,id:'s'+Math.random(),set:'x',mana_cost:'{1}',cmc:1,type_line:'Artifact',oracle_text:'',colors:[],keywords:[],rarity:'common',image_uris:null});
const relay=spawn('node',['/home/user/fivefold/relay.js'],{env:{...process.env,PORT:String(PORT)},stdio:['ignore','pipe','pipe']});
await new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('to')),4000);relay.stdout.on('data',d=>{if(String(d).includes('relay at')){clearTimeout(t);res();}});});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
let pass=0,fail=0; const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  FAIL',m);}};
try{
const p=await b.newPage({viewport:{width:1280,height:900}});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.route('https://api.scryfall.com/**',async r=>{const q=r.request();if(q.url().includes('/cards/collection')){const ids=JSON.parse(q.postData()||'{}').identifiers||[];return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:ids.map(i=>all.get(i.name.toLowerCase())||stub(i.name)),not_found:[]})});}return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[],has_more:false})});});
await p.route('**/*.mp3',r=>r.fulfill({status:200,contentType:'audio/mpeg',body:Buffer.alloc(0)}));
await p.goto(BASE); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000});
await p.evaluate(()=>{try{localStorage.clear()}catch{}}); await p.reload(); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000});
await p.evaluate(()=>{window.ff.S.screen='brew'; window.ff.render();});
await p.waitForSelector('.brewscreen',{timeout:20000}); await p.waitForFunction(()=>window.ff.S.aiDecks!==undefined,{timeout:20000});
await p.click('#bw-decks'); await p.waitForSelector('[data-presetload="UW Standstill"]');
await p.click('[data-presetload="UW Standstill"]'); await p.waitForTimeout(150);
await p.selectOption('#bw-opp','Recurring Survival');
await p.click('#bw-playtest'); await p.waitForFunction(()=>window.ff.S.screen==='duel'&&window.ff.S.duel?.duel,{timeout:30000});
await p.waitForTimeout(600);
if (await p.$('#b-mull-keep')) await p.click('#b-mull-keep');
// get to my main phase with the UI idle
const atMain = () => p.evaluate(()=>{const d=window.ff.S.duel.duel; return d.pending?.type==='priority'&&d.priority===0&&d.active===0&&d.step==='main1'&&!d.stack.length;});
for (let i=0;i<80 && !(await atMain());i++){ await p.waitForTimeout(250); if (await p.$('#b-pass')) { const mine = await p.evaluate(()=>{const d=window.ff.S.duel.duel; return d.pending?.type==='priority'&&d.priority===0;}); if (mine && !(await atMain())) await p.click('#b-pass').catch(()=>{}); } }
ok(await atMain(), 'reached my main phase');
// inject: Riders in my hand, red mana, opponent City of Brass + Forest
const inj = await p.evaluate(()=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf; const mk=(n,i)=>{const c=d.instance(D(n),i); c.zone='limbo'; return c;};
  const city=mk('City of Brass',1); d.moveTo(city,'battlefield',{controller:1}); city.sick=false; const forest=mk('Forest',1); d.moveTo(forest,'battlefield',{controller:1});
  const rid=mk('Avalanche Riders',0); rid.zone='hand'; d.players[0].hand.push(rid); d.players[0].pool.R=4; d.events.length=0; d.refresh(); d.emit();
  return { city: city.id, rid: rid.id, defs: { riders: !!D('Avalanche Riders'), city: !!D('City of Brass') } }; });
ok(inj.defs.riders && inj.defs.city, 'card data cached for both');
await p.waitForTimeout(200);
// preview on the opponent's nonbasic land
const pill = await p.$(`.pill[data-name="City of Brass"]`); ok(!!pill,'opponent land pill rendered');
await pill.hover(); await p.waitForTimeout(400);
const prev = await p.evaluate(()=>document.querySelector('#bigcard')?.innerText||'');
ok(/City of Brass/.test(prev) && /damage/i.test(prev), `hover preview shows the land's text (${prev.replace(/\s+/g,' ').slice(0,80)}…)`);
// double-click Riders to cast (auto-pay)
const card = await p.$(`.card[data-zone="hand"][data-name="Avalanche Riders"]`); ok(!!card,'Riders in hand');
await card.dblclick(); await p.waitForTimeout(600);
const req = await p.evaluate(()=>{const d=window.ff.S.duel.duel; return { kind: d.pending?.req?.kind, text: d.pending?.req?.text, n: d.pending?.req?.options?.length, hint: document.querySelector('.hint')?.innerText||'' };});
ok(req.kind==='target' && /target/.test(req.hint), `target request shown (${req.kind}: ${req.hint.slice(0,60)})`);
ok(await p.$(`.pill[data-name="City of Brass"].targetable`) , 'City of Brass pill is marked targetable');
await p.click(`.pill[data-name="City of Brass"]`); await p.waitForTimeout(600);
// the opponent's deck may hold its own City of Brass; the grouped pill targets whichever copy is legal first, so check the name, not the id
const after = await p.evaluate(()=>{const d=window.ff.S.duel.duel; return { dead: d.players[1].graveyard.filter(c=>c.def.name==='City of Brass').length, log: d.log.slice(-4) };});
ok(after.dead>=1 && /City of Brass #\d+ is destroyed/.test(after.log.join(' ')), `a City of Brass of the opponent's was destroyed by my click (${after.dead} in graveyard; log: ${after.log.join(' / ')})`);
// cycling confirmation: Decree of Justice with only cycling affordable
for (let i=0;i<80 && !(await atMain());i++){ await p.waitForTimeout(250); const mine = await p.evaluate(()=>{const d=window.ff.S.duel.duel; return d.pending?.type==='priority'&&d.priority===0&&!d.stack.length;}); if (mine && !(await atMain()) && await p.$('#b-pass')) await p.click('#b-pass').catch(()=>{}); }
if (!(await atMain())) await p.evaluate(()=>{const d=window.ff.S.duel.duel; d.jobs.length=0; d.stack.length=0; d.events.length=0; d.active=0; d.priority=0; d.step='main1'; d.pending={type:'priority'}; d.emit();});
ok(await atMain(), 'at my main phase for the cycling check');
const dec = await p.evaluate(()=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf; const c=d.instance(D('Decree of Justice'),0); c.zone='hand'; d.players[0].hand.push(c); d.players[0].pool={W:1,U:2,B:0,R:0,G:0,C:0}; d.emit(); return { id:c.id, canCast: d.canCast(d.players[0],c), canCycle: d.canCast(d.players[0],c,{cycling:true}), hand: d.players[0].hand.length }; });
ok(!dec.canCast && dec.canCycle, 'Decree can only be cycled');
await p.click(`.card[data-zone="hand"][data-id="${dec.id}"]`); await p.waitForTimeout(400);
const menu = await p.$$eval('[data-menu]', els=>els.map(e=>e.innerText.trim()));
ok(menu.some(t=>/^Cycle/.test(t)) && menu.some(t=>/Cancel/.test(t)), `confirmation menu offered (${menu.join(' | ')})`);
const stillInHand = await p.evaluate(({id})=>window.ff.S.duel.duel.card(id)?.zone,{id:dec.id}); ok(stillInHand==='hand','nothing happened yet');
const cancelIdx = menu.findIndex(t=>/Cancel/.test(t)); await p.click(`[data-menu="${cancelIdx}"]`); await p.waitForTimeout(200);
ok((await p.evaluate(({id})=>window.ff.S.duel.duel.card(id)?.zone,{id:dec.id}))==='hand','cancel keeps the card');
await p.click(`.card[data-zone="hand"][data-id="${dec.id}"]`); await p.waitForTimeout(400);
const menu2 = await p.$$eval('[data-menu]', els=>els.map(e=>e.innerText.trim())); const cyIdx = menu2.findIndex(t=>/^Cycle/.test(t));
console.log('  DBG menu2=', JSON.stringify(menu2), 'cyIdx=', cyIdx, 'pre=', JSON.stringify(await p.evaluate(({id})=>{const d=window.ff.S.duel.duel; const c=d.card(id); return {pending:d.pending?.type, prio:d.priority, canCycle:d.canCast(d.players[0],c,{cycling:true}), pool:d.players[0].pool, hasPri: d.hasPriority(0)};},{id:dec.id})));
await p.click(`[data-menu="${cyIdx}"]`); await p.waitForTimeout(500);
console.log('  DBG post=', JSON.stringify(await p.evaluate(({id})=>{const d=window.ff.S.duel.duel; return {zone:d.card(id)?.zone, log:d.log.slice(-3), pending:d.pending?.type, menuOpen: !!document.querySelector('[data-menu]')};},{id:dec.id})));
const cyc = await p.evaluate(({id, hand})=>{const d=window.ff.S.duel.duel; return { zone: d.card(id)?.zone, hand: d.players[0].hand.length, expect: hand };},{id:dec.id, hand: dec.hand});
ok(cyc.zone==='graveyard' && cyc.hand===cyc.expect, `confirmed cycle discards and draws (zone=${cyc.zone}, hand ${cyc.hand} vs ${cyc.expect})`);
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.message.split('\n')[0]);fail++;}finally{try{await b.close()}catch{}try{relay.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
