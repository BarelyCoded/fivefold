// Browser check: a card with two tap abilities (Llanowar Wastes: {C} vs {B}/{G}) taps only once for one mana,
// and a player's own draws are named in the log while the opponent's show only a count.
//   node tools/decktests/painland-ui.mjs   (needs playwright installed: npm i playwright)
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { chromium } from 'playwright';
const PORT=8871, BASE=`http://localhost:${PORT}`; const here='/home/user/fivefold/tools'; const all=new Map();
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
await p.click('#bw-decks'); await p.waitForSelector('[data-presetload="Recurring Survival"]'); await p.click('[data-presetload="Recurring Survival"]'); await p.waitForTimeout(150); await p.selectOption('#bw-opp','4-Colour Control'); await p.click('#bw-playtest');
await p.waitForFunction(()=>window.ff.S.screen==='duel'&&window.ff.S.duel?.duel,{timeout:30000}); await p.waitForTimeout(600); if (await p.$('#b-mull-keep')) await p.click('#b-mull-keep');
const atMain = () => p.evaluate(()=>{const d=window.ff.S.duel.duel; return d.pending?.type==='priority'&&d.priority===0&&d.active===0&&d.step==='main1'&&!d.stack.length;});
for (let i=0;i<40 && !(await atMain());i++){ await p.waitForTimeout(200); if (await p.$('#b-pass')) await p.click('#b-pass').catch(()=>{}); }
// set up a clean board: one Llanowar Wastes untapped, Survival ({1}{G}) in hand
const st = await p.evaluate(()=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf;
  for (const c of d.players[0].battlefield.slice()) d.moveTo(c,'graveyard'); d.players[0].pool={W:0,U:0,B:0,R:0,G:0,C:0};
  const mk=(n,z)=>{const c=d.instance(D(n),0); c.zone=z; if(z==='battlefield'){c.sick=false;d.players[0].battlefield.push(c);}else d.players[0].hand.push(c); return c;};
  const lw=mk('Llanowar Wastes','battlefield'); const surv=d.players[0].hand.find(c=>c.def.name==='Survival of the Fittest') || mk('Survival of the Fittest','hand');
  d.jobs.length=0; d.stack.length=0; d.events.length=0; d.active=0; d.priority=0; d.step='main1'; d.pending={type:'priority'}; d.emit();
  return { lw: lw.id, surv: surv.id, life: d.players[0].life }; });
await p.waitForTimeout(300);
ok(!(await p.$(`.card[data-zone="hand"][data-id="${st.surv}"].castable`)), 'Survival ({1}{G}) is not castable off a single Llanowar Wastes');
// add a second Llanowar Wastes → now castable
await p.evaluate(()=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf; const c=d.instance(D('Llanowar Wastes'),0); c.zone='battlefield'; c.sick=false; d.players[0].battlefield.push(c); d.emit(); });
await p.waitForTimeout(200);
ok(!!(await p.$(`.card[data-zone="hand"][data-id="${st.surv}"].castable`)), 'with two Llanowar Wastes it is castable');
const after = await p.evaluate(({surv,life})=>{const d=window.ff.S.duel.duel; const c=d.card(surv); const okc=d.cast(d.players[0], c, {}); while(d.stack.length){ const g=d.resolveTop(); let r=g.next(); while(!r.done) r=g.next(r.value.kind==='yesno'?true:undefined); } return { okc, z: d.card(surv)?.zone, pool: d.players[0].pool, life: d.players[0].life, tapped: d.players[0].battlefield.filter(c=>c.def.name==='Llanowar Wastes').map(c=>c.tapped) };}, st);
ok(after.okc && after.z!=='hand', 'Survival was cast');
ok(Object.values(after.pool).reduce((a,b)=>a+b,0)===0, `no mana floated (${JSON.stringify(after.pool)})`);
ok(after.tapped.filter(Boolean).length===2, `both Llanowar Wastes tapped (${after.tapped})`);
ok(after.life<=st.life-1, `pain-land damage taken (${st.life} -> ${after.life})`);
// draw log: I draw a card, my draw is named
const drew = await p.evaluate(()=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf; const c=d.instance(D('Wall of Roots'),0); c.zone='library'; d.players[0].library.push(c); d.drawCards(d.players[0], 1); d.emit(); return { log: d.log.slice(-1)[0] }; });
ok(/draws Wall of Roots/.test(drew.log), `my own draw is named in the log (${drew.log})`);
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.stack.split('\n').slice(0,5).join('\n'));fail++;}finally{try{await b.close()}catch{}try{relay.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
