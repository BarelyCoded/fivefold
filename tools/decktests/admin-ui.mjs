// Browser check of admin.html: loads matches from the relay with LOG_TOKEN, lists them, opens the detail
// (flags with board, full log, decks), filters and search. Needs a relay started with LOG_DIR holding a
// games.jsonl and LOG_TOKEN=secret — see tools/decktests/gamelog-ui.mjs for producing one.
//   node tools/decktests/admin-ui.mjs   (needs playwright installed: npm i playwright)
import { spawn } from 'node:child_process'; import { chromium } from 'playwright';
const PORT=8827, BASE=`http://localhost:${PORT}`, DIR='/tmp/claude-0/-home-user-fivefold/21e168b5-057b-5db2-a0b6-f8e813273fa5/scratchpad/admlogs';
const relay=spawn('node',['/home/user/fivefold/relay.js'],{env:{...process.env,PORT:String(PORT),LOG_DIR:DIR,LOG_TOKEN:'secret'},stdio:['ignore','pipe','pipe']});
await new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('to')),4000);relay.stdout.on('data',d=>{if(String(d).includes('relay at')){clearTimeout(t);res();}});});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
let pass=0,fail=0; const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  FAIL',m);}};
try{ const p=await b.newPage({viewport:{width:1280,height:900}}); p.on('pageerror',e=>console.log('PAGEERR',e.message));
// the page's config points at the real Render URL; make it point at this relay
await p.route('**/content/config.json',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({logEndpoint:`${BASE}/api/log`})}));
await p.goto(`${BASE}/admin.html`); await p.waitForSelector('#adm-token',{timeout:15000}); await p.waitForTimeout(300);
ok(/this browser/.test(await p.evaluate(()=>document.body.innerText)), 'without a token it shows this browser\'s (empty) games');
await p.fill('#adm-token','wrong'); await p.click('#adm-load'); await p.waitForTimeout(400);
ok(/refused the token/.test(await p.evaluate(()=>document.body.innerText)), 'wrong token is reported');
await p.fill('#adm-token','secret'); await p.click('#adm-load'); await p.waitForSelector('.adm-row',{timeout:5000});
const rows = await p.$$eval('.adm-row', r=>r.map(x=>x.innerText)); ok(rows.length===1 && /playtest/.test(rows[0]) && /Sligh/.test(rows[0]), `one match listed (${rows[0]?.replace(/\s+/g,' ').slice(0,90)})`);
ok((await p.evaluate(()=>localStorage.getItem('ff.admin.token')))==='secret','token remembered');
await p.click('.adm-row'); await p.waitForSelector('.adm-detail',{timeout:3000});
const det = await p.evaluate(()=>document.querySelector('.adm-detail').innerText);
ok(/Flagged moments/.test(det) && /Piledriver should have gotten/.test(det), 'flagged moment shown with its note');
ok(/Battlefield:/.test(det) && /life/.test(det), 'board snapshot rendered');
ok(/Full log/.test(det) && /Turn 1/.test(det) && /concede/i.test(det), 'turn-by-turn log with the concede');
ok(/Decks/.test(det) && /Goblin/.test(det), 'decks listed');
await p.selectOption('#adm-only','errors'); await p.waitForTimeout(200); ok((await p.$$('.adm-row')).length===0, 'filter: no matches with errors');
await p.selectOption('#adm-only','flags'); await p.waitForTimeout(200); ok((await p.$$('.adm-row')).length===1, 'filter: one flagged match');
await p.fill('#adm-q','nonexistentcardname'); await p.waitForTimeout(200); ok((await p.$$('.adm-row')).length===0, 'search narrows to nothing');
await p.fill('#adm-q','Sligh'); await p.waitForTimeout(200); ok((await p.$$('.adm-row')).length===1, 'search by deck name finds it');
// reload: token persists and auto-loads
await p.reload(); await p.waitForSelector('.adm-row',{timeout:8000}); ok(true,'auto-loads from the relay on return');
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.message.split('\n')[0]);fail++;}finally{try{await b.close()}catch{}try{relay.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
