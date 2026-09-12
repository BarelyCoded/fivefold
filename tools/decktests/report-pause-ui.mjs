import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { chromium } from 'playwright';
const PORT=8833, BASE=`http://localhost:${PORT}`; const here='/home/user/fivefold/tools'; const all=new Map();
for(const f of fs.readdirSync(path.join(here,'.sets'))) for(const c of JSON.parse(fs.readFileSync(path.join(here,'.sets',f),'utf8'))) if(!all.has(c.name.toLowerCase())) all.set(c.name.toLowerCase(),c);
const stub=n=>({name:n,id:'s'+Math.random(),set:'x',mana_cost:'{1}',cmc:1,type_line:'Artifact',oracle_text:'',colors:[],keywords:[],rarity:'common',image_uris:null});
const relay=spawn('node',['/home/user/fivefold/relay.js'],{env:{...process.env,PORT:String(PORT)},stdio:['ignore','pipe','pipe']});
await new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('to')),4000);relay.stdout.on('data',d=>{if(String(d).includes('relay at')){clearTimeout(t);res();}});});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
let pass=0,fail=0; const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  FAIL',m);}};
try{ const p=await b.newPage({viewport:{width:1280,height:900}});
await p.route('https://api.scryfall.com/**',async r=>{const q=r.request();if(q.url().includes('/cards/collection')){const ids=JSON.parse(q.postData()||'{}').identifiers||[];return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:ids.map(i=>all.get(i.name.toLowerCase())||stub(i.name)),not_found:[]})});}return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[],has_more:false})});});
await p.route('**/*.mp3',r=>r.fulfill({status:200,contentType:'audio/mpeg',body:Buffer.alloc(0)}));
await p.goto(BASE); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000}); await p.evaluate(()=>{try{localStorage.clear()}catch{}}); await p.reload(); await p.waitForFunction(()=>window.ff&&window.ff.S,{timeout:30000});
await p.evaluate(()=>{window.ff.S.screen='brew'; window.ff.render();}); await p.waitForSelector('.brewscreen',{timeout:20000}); await p.waitForFunction(()=>window.ff.S.aiDecks!==undefined,{timeout:20000});
await p.click('#bw-decks'); await p.waitForSelector('[data-presetload="Goblins"]'); await p.click('[data-presetload="Goblins"]'); await p.waitForTimeout(150); await p.selectOption('#bw-opp','Sligh'); await p.click('#bw-playtest');
await p.waitForFunction(()=>window.ff.S.screen==='duel'&&window.ff.S.duel?.duel,{timeout:30000}); await p.waitForTimeout(800); if (await p.$('#b-mull-keep')) await p.click('#b-mull-keep'); await p.waitForTimeout(500);
// wait for my priority in main phase 1
const atMain = () => p.evaluate(()=>{const d=window.ff.S.duel.duel; return d.pending?.type==='priority'&&d.priority===0&&d.active===0&&!d.stack.length;});
for (let i=0;i<80 && !(await atMain());i++){ await p.waitForTimeout(250); if (await p.$('#b-pass')) await p.click('#b-pass').catch(()=>{}); }
if (!(await atMain())) await p.evaluate(()=>{const d=window.ff.S.duel.duel; d.jobs.length=0; d.stack.length=0; d.events.length=0; d.active=0; d.priority=0; d.step='main1'; d.pending={type:'priority'}; d.emit();});
const snap = () => p.evaluate(()=>{const d=window.ff.S.duel.duel; return { turn: d.turn, step: d.step, prio: d.priority, active: d.active, pending: d.pending?.type, logLen: d.log.length };});
const before = await snap();
await p.click('#b-flag'); await p.waitForSelector('.modal.repform');
await p.focus('#rep-text'); await p.keyboard.type('the game kept going while I typed   spaces'); await p.keyboard.press('Escape');
await p.waitForTimeout(300);
ok(!(await p.$('.modal.repform')), 'Escape closes the report form');
await p.click('#b-flag'); await p.waitForSelector('.modal.repform'); await p.focus('#rep-text');
for (let i=0;i<6;i++) await p.keyboard.press('Space');
await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
const during = await snap();
ok(during.turn===before.turn && during.step===before.step && during.prio===before.prio && during.pending==='priority', `typing Space/Enter in the form does not pass priority (${JSON.stringify(during)} vs ${JSON.stringify(before)})`);
ok(!!(await p.$('.modal.repform')), 'form still open after typing');
// the game is paused: even the AI opponent does not get to act while the form is up (loop halted)
await p.click('#rep-cancel'); await p.waitForTimeout(300);
ok(!(await p.$('.modal.repform')), 'Cancel closes the form');
// game resumes: pressing Space now passes priority
await p.keyboard.press('Space'); await p.waitForTimeout(800);
const after = await snap();
ok(after.logLen>=during.logLen && (after.step!==during.step || after.prio!==during.prio || after.turn!==during.turn || after.pending!=='priority'), `game resumes after the form closes (${JSON.stringify(after)})`);
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.stack.split('\n').slice(0,6).join('\n'));fail++;}finally{try{await b.close()}catch{}try{relay.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
