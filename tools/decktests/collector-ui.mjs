// Browser check of the automatic collector: a page served by one relay reports finished games to the
// collector named in content/config.json (cross-origin), reads back need LOG_TOKEN, and records the
// collector could not accept wait in the browser and go on the next visit.
//   node tools/decktests/collector-ui.mjs   (needs playwright installed: npm i playwright)
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { chromium } from 'playwright';
const A=8821, B=8823, DEAD=8899, BASE=`http://localhost:${A}`, CDIR='/tmp/claude-0/-home-user-fivefold/21e168b5-057b-5db2-a0b6-f8e813273fa5/scratchpad/collector';
const here='/home/user/fivefold/tools'; const all=new Map();
for(const f of fs.readdirSync(path.join(here,'.sets'))) for(const c of JSON.parse(fs.readFileSync(path.join(here,'.sets',f),'utf8'))) if(!all.has(c.name.toLowerCase())) all.set(c.name.toLowerCase(),c);
const stub=n=>({name:n,id:'s'+Math.random(),set:'x',mana_cost:'{1}',cmc:1,type_line:'Artifact',oracle_text:'',colors:[],keywords:[],rarity:'common',image_uris:null});
const up=(port,env)=>{const pr=spawn('node',['/home/user/fivefold/relay.js'],{env:{...process.env,PORT:String(port),...env},stdio:['ignore','pipe','pipe']}); return new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('to')),4000);pr.stdout.on('data',d=>{if(String(d).includes('relay at')){clearTimeout(t);res(pr);}});});};
const ra=await up(A,{}), rb=await up(B,{LOG_DIR:CDIR, LOG_TOKEN:'secret'});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
let pass=0,fail=0; const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  FAIL',m);}};
let endpoint=`http://localhost:${B}/api/log`;
try{ const p=await b.newPage({viewport:{width:1280,height:900}}); p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.route('https://api.scryfall.com/**',async r=>{const q=r.request();if(q.url().includes('/cards/collection')){const ids=JSON.parse(q.postData()||'{}').identifiers||[];return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:ids.map(i=>all.get(i.name.toLowerCase())||stub(i.name)),not_found:[]})});}return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[],has_more:false})});});
await p.route('**/*.mp3',r=>r.fulfill({status:200,contentType:'audio/mpeg',body:Buffer.alloc(0)}));
await p.route('**/content/config.json',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({logEndpoint:endpoint})}));
const playOne=async()=>{ await p.evaluate(()=>{window.ff.S.screen='brew'; window.ff.render();}); await p.waitForSelector('.brewscreen',{timeout:20000}); await p.waitForFunction(()=>window.ff.S.aiDecks!==undefined,{timeout:20000});
  await p.click('#bw-decks'); await p.waitForSelector('[data-presetload="Goblins"]'); await p.click('[data-presetload="Goblins"]'); await p.waitForTimeout(150); await p.selectOption('#bw-opp','Sligh'); await p.click('#bw-playtest');
  await p.waitForFunction(()=>window.ff.S.screen==='duel'&&window.ff.S.duel?.duel,{timeout:30000}); await p.waitForTimeout(800); if (await p.$('#b-mull-keep')) await p.click('#b-mull-keep'); await p.waitForTimeout(800);
  await p.evaluate(()=>{ window.confirm=()=>true; }); await p.click('#b-concede'); await p.waitForTimeout(2500); };
await p.goto(BASE); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000}); await p.evaluate(()=>{try{localStorage.clear()}catch{}}); await p.reload(); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000}); await p.waitForTimeout(400);
const notice = await p.evaluate(()=>document.querySelector('.gamelogs')?.innerText||''); ok(/logged to improve the rules engine/.test(notice), 'title screen carries the logging notice');
await playOne();
const bf=path.join(CDIR,'games.jsonl'); const bl=()=>fs.existsSync(bf)?fs.readFileSync(bf,'utf8').trim().split('\n').filter(Boolean):[];
ok(bl().length===1, `collector B received the game cross-origin (${bl().length})`);
ok(fs.existsSync('/home/user/fivefold/logs/games.jsonl'), 'the serving relay A kept its own copy too');
ok((await p.evaluate(()=>JSON.parse(localStorage.getItem('ff.gamelog.unsent.v1')||'[]').length))===0, 'nothing queued as unsent');
// reading back needs the token
const r1=await fetch(`http://localhost:${B}/api/logs`); const r2=await fetch(`http://localhost:${B}/api/logs?token=secret`);
ok(r1.status===403 && r2.ok && (await r2.text()).trim().split('\n').length===1, `GET api/logs is token-gated (${r1.status}/${r2.status})`);
// collector unreachable: the record waits in the browser, then goes on the next visit
endpoint=`http://localhost:${DEAD}/api/log`; await p.goto(BASE); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000}); await p.waitForTimeout(400);
await playOne();
ok(bl().length===1, 'collector still has one (endpoint was dead)');
const queued = await p.evaluate(()=>JSON.parse(localStorage.getItem('ff.gamelog.unsent.v1')||'[]').length); ok(queued===1, `record queued as unsent (${queued})`);
endpoint=`http://localhost:${B}/api/log`; await p.goto(BASE); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000}); await p.waitForTimeout(1500);
ok(bl().length===2, `queued record delivered on the next visit (${bl().length})`);
ok((await p.evaluate(()=>JSON.parse(localStorage.getItem('ff.gamelog.unsent.v1')||'[]').length))===0, 'queue drained');
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.message.split('\n')[0]);fail++;}finally{try{await b.close()}catch{}try{ra.kill('SIGKILL');rb.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
