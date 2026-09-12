import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { chromium } from 'playwright';
const PORT=8835, BASE=`http://localhost:${PORT}`; const here='/home/user/fivefold/tools'; const all=new Map();
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
// Reanimator: Unmask, Putrid Imp (black) — play it vs Sligh
await p.click('#bw-decks'); await p.waitForSelector('[data-presetload="Reanimator"]'); await p.click('[data-presetload="Reanimator"]'); await p.waitForTimeout(150); await p.selectOption('#bw-opp','Sligh'); await p.click('#bw-playtest');
await p.waitForFunction(()=>window.ff.S.screen==='duel'&&window.ff.S.duel?.duel,{timeout:30000}); await p.waitForTimeout(800); if (await p.$('#b-mull-keep')) await p.click('#b-mull-keep');
const atMain = () => p.evaluate(()=>{const d=window.ff.S.duel.duel; return d.pending?.type==='priority'&&d.priority===0&&d.active===0&&d.step==='main1'&&!d.stack.length;});
for (let i=0;i<80 && !(await atMain());i++){ await p.waitForTimeout(250); const mine = await p.evaluate(()=>{const d=window.ff.S.duel.duel; return d.pending?.type==='priority'&&d.priority===0&&!d.stack.length;}); if (mine && !(await atMain()) && await p.$('#b-pass')) await p.click('#b-pass').catch(()=>{}); }
if (!(await atMain())) await p.evaluate(()=>{const d=window.ff.S.duel.duel; d.jobs.length=0; d.stack.length=0; d.events.length=0; d.active=0; d.priority=0; d.step='main1'; d.pending={type:'priority'}; d.emit();});
// no mana at all; Unmask + a black card (Putrid Imp) in hand; opponent holds Lightning Bolt + Mountain
const ids = await p.evaluate(()=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf; const mk=(n,i)=>{const c=d.instance(D(n),i); c.zone='hand'; d.players[i].hand.push(c); return c;};
  for (const l of d.players[0].battlefield.slice()) d.moveTo(l,'graveyard'); d.players[0].pool={W:0,U:0,B:0,R:0,G:0,C:0};
  const um=mk('Unmask',0), imp=mk('Putrid Imp',0), bolt=mk('Lightning Bolt',1), mtn=mk('Mountain',1); d.emit(); return { um: um.id, imp: imp.id, bolt: bolt.id }; });
await p.waitForTimeout(300);
ok(!!(await p.$(`.card[data-zone="hand"][data-id="${ids.um}"].castable`)), 'Unmask is shown as castable with no mana (alternative cost)');
await p.click(`.card[data-zone="hand"][data-id="${ids.um}"]`); await p.waitForTimeout(400);
const menu = await p.$$eval('[data-menu]', els=>els.map(e=>e.innerText.trim()));
ok(menu.some(t=>/Exile Putrid Imp/.test(t)) && !menu.some(t=>/Pay .* instead/.test(t)), `pitch menu offers the black card, no mana option (${menu.join(' | ')})`);
await p.click(`[data-menu="${menu.findIndex(t=>/Exile Putrid Imp/.test(t))}"]`); await p.waitForTimeout(400);
// target: the opponent (player). The prompt lists players as buttons.
const st1 = await p.evaluate(({um})=>{const d=window.ff.S.duel.duel; return { hint: document.querySelector('.hint')?.innerText||'', wiz: [...document.querySelectorAll('[data-wizref]')].map(e=>e.dataset.wizref), um: d.card(um)?.zone, stack: d.stack.map(i=>i.card?.def.name), pending: d.pending?.type, msg: document.querySelector('.msg,.message')?.innerText||'' };}, ids);
const oppRef = st1.wiz.find(r=>/^player:1$/.test(r));
if (oppRef) await p.click(`[data-wizref="${oppRef}"]`); else await p.click('.pbox[data-player="1"]');
await p.waitForTimeout(1200);
const after = await p.evaluate(({um,imp,bolt})=>{const d=window.ff.S.duel.duel; const z=id=>{const c=d.card(id); return c?c.zone:null;}; return { um: z(um), imp: z(imp), impEx: d.players[0].exile.filter(c=>c.def.name==='Putrid Imp').length, bolt: z(bolt), stack: d.stack.map(i=>i.card?.def.name), pending: d.pending?.type+':'+(d.pending?.req?.kind||''), log: d.log.slice(-5).join(' / ') };}, ids);
ok(after.impEx>=1, `a Putrid Imp was exiled as the cost (${after.impEx})`);
ok(/casts Unmask targeting Sligh/.test(after.log) && after.pending==='request:choose', `Unmask cast via the alternative cost and is resolving (${after.pending})`);
// answer the card picker: choose Lightning Bolt from the revealed hand
const pickCard = await p.$(`.card[data-zone="pick"][data-id="${ids.bolt}"]`);
if (pickCard) await pickCard.click(); else { const ch = await p.$(`[data-choice="${ids.bolt}"]`); if (ch) await ch.click(); }
await p.waitForTimeout(150); await p.click('#b-choose'); await p.waitForTimeout(800);
const fin = await p.evaluate(({bolt,um})=>{const d=window.ff.S.duel.duel; const z=id=>{const c=d.card(id); return c?c.zone:null;}; return { bolt: z(bolt), um: z(um), log: d.log.slice(-3).join(' / ') };}, ids);
ok(fin.bolt==='graveyard' && fin.um==='graveyard', `Lightning Bolt discarded, Unmask in the graveyard (${fin.bolt}/${fin.um}; ${fin.log})`);
// with mana available the menu offers both, mana as default
const ids2 = await p.evaluate(()=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf; d.jobs.length=0; d.stack.length=0; d.events.length=0; d.active=0; d.priority=0; d.step='main1'; d.pending={type:'priority'}; const mk=(n,i)=>{const c=d.instance(D(n),i); c.zone='hand'; d.players[i].hand.push(c); return c;}; const um=mk('Unmask',0), imp=mk('Putrid Imp',0); d.players[0].pool={W:0,U:0,B:4,R:0,G:0,C:0}; const dump=d.players[0].hand.map(c=>[c.id,c.def?c.def.name:null,c.zone]); try { d.emit(); } catch(e) { return { um: um.id, err: e.message, dump }; } return { um: um.id, dump }; });
await p.waitForTimeout(300); await p.click(`.card[data-zone="hand"][data-id="${ids2.um}"]`); await p.waitForTimeout(400);
const menu2 = await p.$$eval('[data-menu]', els=>els.map(e=>e.innerText.trim()));
ok(menu2.some(t=>/Exile Putrid Imp/.test(t)) && menu2.some(t=>/Pay .* instead/.test(t)), `with mana: both options offered (${menu2.join(' | ')})`);
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
await p.evaluate(async()=>{ const m=await import('/js/collection.js'); await m.importNames([{name:'Force of Will',count:1},{name:'Counterspell',count:1}]); });
// ---- Force of Will: counter the opponent's Bolt with no mana by pitching a blue card and paying 1 life ----
await p.evaluate(()=>{ const d=window.ff.S.duel.duel; d.jobs.length=0; d.stack.length=0; d.events.length=0; for (const c of d.players[0].hand.slice()) d.moveTo(c,'graveyard'); d.players[0].pool={W:0,U:0,B:0,R:0,G:0,C:0}; d.players[1].pool={W:0,U:0,B:0,R:1,G:0,C:0}; d.active=1; d.priority=1; d.step='main1'; d.pending=null; });
const fw = await p.evaluate(()=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf; const mk=(n,i)=>{const c=d.instance(D(n),i); c.zone='hand'; d.players[i].hand.push(c); return c;}; const fow=mk('Force of Will',0), blue=mk('Counterspell',0), bolt=mk('Lightning Bolt',1);
  const cast = d.cast(d.players[1], bolt, { targets: [{ type: 'player', idx: 0 }] }); d.priority=0; d.pending={type:'priority'}; d.emit(); return { fow: fow.id, blue: blue.id, bolt: bolt.id, cast, stackId: d.stack[d.stack.length-1]?.id, life: d.players[0].life, def: !!D('Force of Will') }; });
ok(fw.def && fw.cast, `opponent's Bolt is on the stack (${fw.cast})`);
await p.waitForTimeout(300);
ok(!!(await p.$(`.card[data-zone="hand"][data-id="${fw.fow}"].castable`)), 'Force of Will is castable with no mana');
await p.click(`.card[data-zone="hand"][data-id="${fw.fow}"]`); await p.waitForTimeout(400);
const m3 = await p.$$eval('[data-menu]', els=>els.map(e=>e.innerText.trim()));
ok(m3.some(t=>/Exile Counterspell/.test(t)), `pitch menu offers the blue card (${m3.join(' | ')})`);
await p.click(`[data-menu="${m3.findIndex(t=>/Exile Counterspell/.test(t))}"]`); await p.waitForTimeout(400);
const wiz3 = await p.$$eval('[data-wizref]', els=>els.map(e=>e.dataset.wizref)); const spellRef = wiz3.find(r=>/^spell:/.test(r));
if (spellRef) await p.click(`[data-wizref="${spellRef}"]`); else await p.click('.stack-item');
await p.waitForTimeout(1500);
const fin3 = await p.evaluate(({fow,blue,bolt})=>{const d=window.ff.S.duel.duel; const z=id=>{const c=d.card(id); return c?c.zone:null;}; return { fow: z(fow), blue: z(blue), bolt: z(bolt), life: d.players[0].life, log: d.log.slice(-4).join(' / ') };}, fw);
ok(fin3.blue==='exile' && fin3.life===fw.life-1, `blue card exiled and 1 life paid (${fin3.blue}, life ${fin3.life})`);
ok(fin3.bolt==='graveyard' && fin3.life===fw.life-1, `Bolt countered, no damage taken (${fin3.bolt}; ${fin3.log})`);
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.stack.split('\n').slice(0,6).join('\n'));fail++;}finally{try{await b.close()}catch{}try{relay.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
