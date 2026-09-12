// Browser check of the global game log: a playtest is recorded, a flagged moment carries a board snapshot,
// the finished record lands in the browser store and in logs/games.jsonl via the relay.
//   node tools/decktests/gamelog-ui.mjs   (needs playwright installed: npm i playwright)
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT=8813, BASE=`http://localhost:${PORT}`;
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
await p.evaluate(()=>{try{localStorage.clear()}catch{}}); await p.reload(); await p.waitForFunction(()=>window.ff&&window.ff.S&&window.ff.S.ready!==undefined,{timeout:30000});
await p.waitForTimeout(500);
const titleTxt = await p.evaluate(()=>document.querySelector('.gamelogs')?.innerText||'');
ok(/logged to improve the rules engine/.test(titleTxt) && /\b0\b kept in this browser/.test(titleTxt), `title panel shows the notice and 0 logs (${titleTxt.slice(0,70)})`);
await p.evaluate(()=>{window.ff.S.screen='brew'; window.ff.render();}); await p.waitForSelector('.brewscreen',{timeout:20000}); await p.waitForFunction(()=>window.ff.S.aiDecks!==undefined,{timeout:20000});
await p.click('#bw-decks'); await p.waitForSelector('[data-presetload="Goblins"]'); await p.click('[data-presetload="Goblins"]'); await p.waitForTimeout(150);
await p.selectOption('#bw-opp','Sligh'); await p.click('#bw-playtest'); await p.waitForFunction(()=>window.ff.S.screen==='duel'&&window.ff.S.duel?.duel,{timeout:30000});
await p.waitForTimeout(800); if (await p.$('#b-mull-keep')) await p.click('#b-mull-keep');
await p.waitForTimeout(1500);
const partial = await p.evaluate(()=>JSON.parse(localStorage.getItem('ff.gamelog.partial.v1')||'null'));
ok(partial && partial.mode==='playtest' && partial.meta.opponentDeck==='Sligh' && partial.meta.playerDeck && partial.players.length===2 && Object.keys(partial.players[0].deck).length>3, `in-progress record saved (mode=${partial?.mode}, vs ${partial?.meta?.opponentDeck}, my deck ${partial?.meta?.playerDeck})`);
ok(partial.events.some(e=>e.k==='log'), `engine lines captured (${partial.events.length} events so far)`);
// flag an issue
await p.click('#b-flag'); await p.waitForSelector('.modal.repform',{timeout:3000});
ok(await p.$('#rep-send[disabled]'), 'send is disabled until something is written');
await p.check('input[name="rep-kind"][value="mechanic"]');
const cardOpts = await p.$$eval('#rep-card option', os=>os.map(o=>o.value)); ok(cardOpts.length>2, `card picker lists cards on the table (${cardOpts.length})`);
await p.selectOption('#rep-card', cardOpts[1]); await p.waitForTimeout(100);
await p.fill('#rep-text','Test flag: the Piledriver should have gotten +2/+0'); await p.waitForTimeout(100);
await p.click('#rep-send'); await p.waitForTimeout(40);
const msg = await p.evaluate(()=>document.body.innerText.includes('Report saved'));
ok(msg, 'report acknowledged in the UI');
const afterFlag = await p.evaluate(()=>JSON.parse(localStorage.getItem('ff.gamelog.partial.v1')||'null'));
ok(afterFlag.flags.length===1 && afterFlag.flags[0].board && afterFlag.flags[0].board.players && typeof afterFlag.flags[0].turn==='number' && afterFlag.flags[0].category==='mechanic' && afterFlag.flags[0].card===cardOpts[1], `flag stored with category, card and board snapshot (${afterFlag.flags[0]?.category}, ${afterFlag.flags[0]?.card}, turn ${afterFlag.flags[0]?.turn})`);
// concede to finish
await p.evaluate(()=>{ window.confirm = () => true; });
await p.click('#b-concede'); await p.waitForTimeout(2500);
const done = await p.evaluate(()=>({ list: JSON.parse(localStorage.getItem('ff.gamelogs.v1')||'[]'), partial: localStorage.getItem('ff.gamelog.partial.v1') }));
ok(done.list.length===1 && done.partial===null, `finished record stored in the browser, partial cleared (${done.list.length})`);
const rec = done.list[0];
ok(rec.result && rec.result.winner===1 && rec.endedAt && rec.flags.length===1 && rec.events.some(e=>e.k==='log'), `result recorded (winner=${rec.result?.winner}, why=${rec.result?.why}), ${rec.events.length} events, approximations: ${Object.keys(rec.approximations||{}).length}`);
// server side
await p.waitForTimeout(500);
const file = '/home/user/fivefold/logs/games.jsonl';
ok(fs.existsSync(file) && fs.readFileSync(file,'utf8').trim().split('\n').length===1, 'one line appended to logs/games.jsonl by the relay');
const srvRec = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8').trim().split('\n')[0]) : null;
ok(srvRec && srvRec.id===rec.id && srvRec.receivedAt, `server record matches (${srvRec?.id})`);
// back on the title screen the count updates and export is enabled
await p.waitForFunction(()=>window.ff.S.screen!=='duel',{timeout:10000}).catch(()=>{});
await p.evaluate(()=>{window.ff.S.screen='title'; window.ff.render();}); await p.waitForTimeout(200);
const t2 = await p.evaluate(()=>({ txt: document.querySelector('.gamelogs')?.innerText||'', disabled: document.querySelector('#b-logs-export')?.disabled }));
ok(/\b1\b kept in this browser/.test(t2.txt) && t2.disabled===false, `title shows 1 log, export enabled`);
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.message.split('\n')[0]);fail++;}finally{try{await b.close()}catch{}try{relay.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
