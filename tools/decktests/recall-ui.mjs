// Browser check of Recall ({X}{X}{U}: the X prompt, discard, then a pick from the graveyard) and Frantic Search
// (draw two, discard two, untap up to three lands with "Take none" allowed).
//   node tools/decktests/recall-ui.mjs   (needs playwright installed: npm i playwright)
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { chromium } from 'playwright';
const PORT=8861, BASE=`http://localhost:${PORT}`; const here='/home/user/fivefold/tools'; const all=new Map();
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
await p.evaluate(async()=>{ const m=await import('/js/collection.js'); await m.importNames([{name:'Recall',count:1},{name:'Frantic Search',count:1},{name:'Island',count:1}]); });
const ids = await p.evaluate(()=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf; const mk=(n,i,z='hand')=>{const c=d.instance(D(n),i); c.zone=z; d.players[i][z==='hand'?'hand':z].push(c); if(z==='battlefield'){c.sick=false;c.tapped=true;} return c;};
  for (const c of d.players[0].battlefield.slice()) d.moveTo(c,'graveyard'); for (const c of d.players[0].hand.slice()) d.moveTo(c,'graveyard');
  const rc=mk('Recall',0), keep=mk('Putrid Imp',0), fs=mk('Frantic Search',0); const isl=[mk('Island',0,'battlefield'),mk('Island',0,'battlefield'),mk('Island',0,'battlefield')];
  d.players[0].pool={W:0,U:3,B:0,R:0,G:0,C:0}; d.refresh(); d.emit(); return { rc: rc.id, keep: keep.id, fs: fs.id, isl: isl.map(c=>c.id), gy: d.players[0].graveyard.length }; });
await p.waitForTimeout(300);
ok(!!(await p.$(`.card[data-zone="hand"][data-id="${ids.rc}"].castable`)), 'Recall shows as castable');
const costTxt = await p.$eval(`.card[data-zone="hand"][data-id="${ids.rc}"]`, el=>el.innerText.replace(/\s+/g,''));
ok(/XXU/.test(costTxt), `cost shown as XXU (${costTxt.slice(0,40)})`);
await p.click(`.card[data-zone="hand"][data-id="${ids.rc}"]`); await p.waitForTimeout(300);
const xmax = await p.evaluate(()=>({ input: document.querySelector('#xval')?.max, hint: document.querySelector('.hint')?.innerText||'' }));
ok(xmax.input==='1', `X prompt caps at 1 with three mana (${JSON.stringify(xmax)})`);
await p.fill('#xval','1'); await p.click('[data-wiz="x"]'); await p.waitForTimeout(600);
let st = await p.evaluate(()=>{const d=window.ff.S.duel.duel; return { pending: d.pending?.type+':'+(d.pending?.req?.kind||''), text: d.pending?.req?.text||'', log: d.log.slice(-2).join(' / ') };});
ok(st.pending==='request:choose' && /Discard 1 card/.test(st.text), `cast with X=1 and asked to discard one (${st.text}; ${st.log})`);
await p.click(`[data-choice="${ids.fs}"], .card[data-zone="pick"][data-id="${ids.fs}"]`).catch(()=>{}); await p.waitForTimeout(150); await p.click('#b-choose'); await p.waitForTimeout(500);
st = await p.evaluate(()=>{const d=window.ff.S.duel.duel; return { pending: d.pending?.type+':'+(d.pending?.req?.kind||''), text: d.pending?.req?.text||'', n: d.pending?.req?.options?.length };});
ok(st.pending==='request:choose' && /return 1 card/.test(st.text), `then asked to pick one card from the graveyard (${st.text}, ${st.n} options)`);
const pick = await p.evaluate(()=>{const d=window.ff.S.duel.duel; return d.pending.req.options[0].id;});
await p.click(`[data-choice="${pick}"], .card[data-zone="pick"][data-id="${pick}"]`).catch(()=>{}); await p.waitForTimeout(150); await p.click('#b-choose'); await p.waitForTimeout(800);
const fin = await p.evaluate(({rc,pick,fs})=>{const d=window.ff.S.duel.duel; const z=id=>d.card(id)?.zone||null; return { rc: z(rc), pick: z(pick), fs: z(fs), pool: d.players[0].pool.U, log: d.log.slice(-4).join(' / ') };}, {...ids, pick});
ok(fin.rc==='exile' && fin.pick==='hand' && fin.fs==='graveyard' && fin.pool===0, `Recall resolved: Search discarded, a card returned, Recall exiled, mana spent (${JSON.stringify(fin)})`);
// Frantic Search: three tapped Islands, no mana in pool → cast from the returned card? Put a fresh Search in hand with UUU in pool.
const ids2 = await p.evaluate(({isl})=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf; const c=d.instance(D('Frantic Search'),0); c.zone='hand'; d.players[0].hand.push(c); for (const id of isl) d.card(id).tapped=true; for (let i=0;i<2;i++){ const b=d.instance(D('Putrid Imp'),0); b.zone='library'; d.players[0].library.unshift(b);} d.players[0].pool={W:0,U:3,B:0,R:0,G:0,C:0}; d.emit(); return { fs: c.id }; }, ids);
await p.waitForTimeout(300); await p.click(`.card[data-zone="hand"][data-id="${ids2.fs}"]`); await p.waitForTimeout(700);
st = await p.evaluate(()=>{const d=window.ff.S.duel.duel; return { pending: d.pending?.type+':'+(d.pending?.req?.kind||''), text: d.pending?.req?.text||'' };});
ok(st.pending==='request:choose' && /Discard 2 cards/.test(st.text), `Search: asked to discard two (${st.text})`);
const two = await p.evaluate(()=>{const d=window.ff.S.duel.duel; return d.pending.req.options.slice(0,2).map(o=>o.id);});
for (const id of two) { await p.click(`[data-choice="${id}"], .card[data-zone="pick"][data-id="${id}"]`).catch(()=>{}); await p.waitForTimeout(100); }
await p.click('#b-choose'); await p.waitForTimeout(500);
st = await p.evaluate(()=>{const d=window.ff.S.duel.duel; return { pending: d.pending?.type+':'+(d.pending?.req?.kind||''), text: d.pending?.req?.text||'', min: d.pending?.req?.min, max: d.pending?.req?.max, btn: document.querySelector('#b-choose')?.disabled };});
ok(st.pending==='request:choose' && /untap up to 3 of your lands/.test(st.text) && st.min===0 && st.btn===false, `then asked which lands to untap, confirm allowed with none picked (${JSON.stringify(st)})`);
await p.click(`[data-choice="${ids.isl[0]}"], .card[data-zone="pick"][data-id="${ids.isl[0]}"]`).catch(()=>{}); await p.waitForTimeout(100); await p.click('#b-choose'); await p.waitForTimeout(600);
const tapped = await p.evaluate(({isl})=>{const d=window.ff.S.duel.duel; return isl.map(id=>d.card(id).tapped);}, ids);
ok(tapped[0]===false && tapped[1]===true && tapped[2]===true, `the chosen Island untapped (${tapped.join(',')})`);
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.stack.split('\n').slice(0,6).join('\n'));fail++;}finally{try{await b.close()}catch{}try{relay.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
