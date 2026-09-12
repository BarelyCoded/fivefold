// Browser check of log delivery: the game in progress is synced to the collector when the tab is hidden, the
// finished record replaces it (one file per game, no duplicates), a late partial never overwrites a finished
// game, legacy games.jsonl lines are still listed, api/log/status is public, and the admin page shows what
// the relay holds plus a Send now button for records it never got.
//   node tools/decktests/logsync-ui.mjs   (needs playwright installed: npm i playwright)
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { chromium } from 'playwright';
const A=8841, B=8843, BASE=`http://localhost:${A}`, CDIR='/tmp/claude-0/-home-user-fivefold/21e168b5-057b-5db2-a0b6-f8e813273fa5/scratchpad/synclogs';
const here='/home/user/fivefold/tools'; const all=new Map();
for(const f of fs.readdirSync(path.join(here,'.sets'))) for(const c of JSON.parse(fs.readFileSync(path.join(here,'.sets',f),'utf8'))) if(!all.has(c.name.toLowerCase())) all.set(c.name.toLowerCase(),c);
const stub=n=>({name:n,id:'s'+Math.random(),set:'x',mana_cost:'{1}',cmc:1,type_line:'Artifact',oracle_text:'',colors:[],keywords:[],rarity:'common',image_uris:null});
const up=(port,env)=>{const pr=spawn('node',['/home/user/fivefold/relay.js'],{env:{...process.env,PORT:String(port),...env},stdio:['ignore','pipe','pipe']}); return new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('to')),4000);pr.stdout.on('data',d=>{if(String(d).includes('relay at')){clearTimeout(t);res(pr);}});});};
fs.rmSync(CDIR,{recursive:true,force:true});   // a clean collector for every run
const ra=await up(A,{}), rb=await up(B,{LOG_DIR:CDIR, LOG_TOKEN:'secret'});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
let pass=0,fail=0; const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  FAIL',m);}};
const endpoint=`http://localhost:${B}/api/log`;
const gd=path.join(CDIR,'games'); const files=()=>fs.existsSync(gd)?fs.readdirSync(gd).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(gd,f),'utf8'))):[];
// a legacy append-only record from before per-game files
fs.mkdirSync(CDIR,{recursive:true}); fs.writeFileSync(path.join(CDIR,'games.jsonl'), JSON.stringify({id:'legacy1',startedAt:1,endedAt:2,mode:'playtest',players:[{name:'Old',deck:{}},{name:'Older',ai:true,deck:{}}],events:[],flags:[],errors:[],result:{winner:0}})+'\n');
try{ const p=await b.newPage({viewport:{width:1280,height:900}}); p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.route('https://api.scryfall.com/**',async r=>{const q=r.request();if(q.url().includes('/cards/collection')){const ids=JSON.parse(q.postData()||'{}').identifiers||[];return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:ids.map(i=>all.get(i.name.toLowerCase())||stub(i.name)),not_found:[]})});}return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[],has_more:false})});});
await p.route('**/*.mp3',r=>r.fulfill({status:200,contentType:'audio/mpeg',body:Buffer.alloc(0)}));
await p.route('**/content/config.json',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({logEndpoint:endpoint})}));
await p.goto(BASE); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000}); await p.evaluate(()=>{try{localStorage.clear()}catch{}}); await p.reload(); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000}); await p.waitForTimeout(400);
await p.evaluate(()=>{window.ff.S.screen='brew'; window.ff.render();}); await p.waitForSelector('.brewscreen',{timeout:20000}); await p.waitForFunction(()=>window.ff.S.aiDecks!==undefined,{timeout:20000});
await p.click('#bw-decks'); await p.waitForSelector('[data-presetload="Goblins"]'); await p.click('[data-presetload="Goblins"]'); await p.waitForTimeout(150); await p.selectOption('#bw-opp','Sligh'); await p.click('#bw-playtest');
await p.waitForFunction(()=>window.ff.S.screen==='duel'&&window.ff.S.duel?.duel,{timeout:30000}); await p.waitForTimeout(800); if (await p.$('#b-mull-keep')) await p.click('#b-mull-keep'); await p.waitForTimeout(1500);
ok(files().length===0, `nothing synced yet, right after the start (${files().length})`);
// hiding the tab (switching away, closing) syncs the game in progress
const id = await p.evaluate(()=>window.ff.currentGameLog().id);
await p.evaluate(()=>{ Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true}); document.dispatchEvent(new Event('visibilitychange')); });
await p.waitForTimeout(800);
let f = files();
ok(f.length===1 && f[0].id===id && f[0].partial===true && !f[0].result, `the game in progress is on the relay, marked partial (${f.length}, partial=${f[0]?.partial})`);
const st1 = await (await fetch(`http://localhost:${B}/api/log/status`)).json();
ok(st1.games===2 && st1.persistent, `status counts the legacy record too (${st1.games})`);
// finishing the game replaces the partial with the final record: still one file, no duplicate
await p.evaluate(()=>{ Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true}); window.confirm=()=>true; });
await p.click('#b-concede'); await p.waitForTimeout(2500);
f = files();
ok(f.length===1 && f[0].id===id && !f[0].partial && f[0].result && f[0].result.winner===1 && f[0].firstReceivedAt, `final record replaced the partial one (${f.length}, result=${JSON.stringify(f[0]?.result)})`);
// a stale partial arriving late (a retry) does not overwrite the finished game
const stale = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...f[0], partial:true, result:null, events:[]})});
ok(stale.ok && files()[0].result && files()[0].events.length>0, 'a late partial cannot overwrite the finished record');
// GET api/logs lists both, one line each, newest version
const lines=(await (await fetch(`http://localhost:${B}/api/logs?token=secret`)).text()).trim().split('\n').map(l=>JSON.parse(l));
ok(lines.length===2 && lines.some(x=>x.id==='legacy1') && lines.find(x=>x.id===id)?.result, `api/logs returns the legacy line and the per-game file (${lines.map(x=>x.id).join(',')})`);
ok((await p.evaluate(()=>JSON.parse(localStorage.getItem('ff.gamelogs.v1')).map(g=>g.sent)))[0]===true, 'browser copy marked as sent');
// admin page: status line and the Sent column
await p.goto(`${BASE}/admin.html`); await p.waitForSelector('#adm-token',{timeout:15000}); await p.waitForTimeout(600);
const body = await p.evaluate(()=>document.body.innerText);
ok(/The relay holds 2 games/.test(body), `admin shows what the relay holds (${(body.match(/The relay holds[^.]*\./)||[''])[0]})`);
ok(/This browser keeps 1\./.test(body) && !/not yet delivered/.test(body), 'admin shows the browser count with nothing pending');
const sentCol = await p.$$eval('.adm-table th', th=>th.map(t=>t.textContent)); ok(sentCol.includes('Sent'), 'browser view has a Sent column');
ok((await p.$$eval('.adm-row td:last-child', td=>td.map(t=>t.innerText)))[0]==='✓', 'the game shows as sent');
// a record the relay never got: queue it, the admin page offers Send now, and it goes
await p.evaluate(()=>{ const r=JSON.parse(localStorage.getItem('ff.gamelogs.v1'))[0]; const q={...r,id:'gqueued01',sent:false}; localStorage.setItem('ff.gamelog.unsent.v1',JSON.stringify([q])); const l=JSON.parse(localStorage.getItem('ff.gamelogs.v1')); l.push(q); localStorage.setItem('ff.gamelogs.v1',JSON.stringify(l)); });
await p.reload(); await p.waitForSelector('#adm-send',{timeout:5000});
ok(/1 not yet delivered/.test(await p.evaluate(()=>document.body.innerText)), 'admin flags the undelivered game');
await p.click('#adm-send'); await p.waitForTimeout(1000);
const b2 = await p.evaluate(()=>document.body.innerText);
ok(/Sent 1 game to the relay/.test(b2) && /The relay holds 3 games/.test(b2) && files().some(x=>x.id==='gqueued01'), `Send now delivers it (${(b2.match(/The relay holds[^.]*\./)||[''])[0]})`);
ok((await p.evaluate(()=>JSON.parse(localStorage.getItem('ff.gamelog.unsent.v1')).length))===0, 'queue drained');
// the relay without LOG_DIR warns at startup and in status
const rc = spawn('node',['/home/user/fivefold/relay.js'],{env:{...process.env,PORT:'8845'},stdio:['ignore','pipe','pipe']});
const note = await new Promise(res=>{let s=''; rc.stdout.on('data',d=>{s+=String(d); if(/Game logs:/.test(s)) res(s);}); setTimeout(()=>res(s),4000);});
ok(/NOT persistent/.test(note), `relay warns when LOG_DIR is unset (${(note.match(/Game logs:[^\n]*/)||[''])[0].slice(0,80)})`);
const st2 = await (await fetch('http://localhost:8845/api/log/status')).json(); ok(st2.persistent===false, 'status reports persistent:false without LOG_DIR');
rc.kill('SIGKILL');
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.stack.split('\n').slice(0,4).join('\n'));fail++;}finally{try{await b.close()}catch{}try{ra.kill('SIGKILL');rb.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
