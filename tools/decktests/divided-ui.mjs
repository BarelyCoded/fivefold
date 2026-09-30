import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { chromium } from 'playwright';
const PORT=8845, BASE=`http://localhost:${PORT}`; const here='/home/user/fivefold/tools'; const all=new Map();
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
await p.evaluate(async()=>{ const m=await import('/js/collection.js'); await m.importNames([{name:'Arc Lightning',count:1},{name:'Grizzly Bears',count:1}]); });
const ids = await p.evaluate(()=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf; const mk=(n,i,z)=>{const c=d.instance(D(n),i); c.zone=z; d.players[i][z==='hand'?'hand':'battlefield'].push(c); if(z==='battlefield'){c.sick=false;} return c;};
  for (const c of d.players[1].battlefield.slice()) d.moveTo(c,'graveyard'); d.players[0].pool={W:0,U:0,B:0,R:1,G:0,C:2};
  const al=mk('Arc Lightning',0,'hand'), gb=mk('Grizzly Bears',1,'battlefield'); d.refresh(); d.emit(); return { al: al.id, gb: gb.id, life: d.players[1].life }; });
await p.waitForTimeout(300);
await p.dblclick(`.card[data-zone="hand"][data-id="${ids.al}"]`); await p.waitForTimeout(800);
for (let i=0;i<10;i++){ const k=await p.evaluate(()=>window.ff.S.duel.duel.pending?.req?.kind||window.ff.S.duel.duel.pending?.type); if (k==='choose') break; if (k==='priority' && await p.$('#b-pass')) await p.click('#b-pass').catch(()=>{}); await p.waitForTimeout(300); }
const req = await p.evaluate(()=>{ const r=window.ff.S.duel.duel.pending?.req; return r ? { kind: r.kind, opts: r.options.map(o=>[o.id,o.label]) } : null; });
ok(req?.kind==='choose' && req.opts.some(o=>o[0]===ids.gb) && req.opts.some(o=>o[0]===-2), `target prompt lists the Bears and the opponent (${JSON.stringify(req)})`);
await p.click(`[data-choice="${ids.gb}"]`); await p.click(`[data-choice="-2"]`); await p.waitForTimeout(100); await p.click('#b-choose'); await p.waitForTimeout(500);
const dv = await p.evaluate(()=>window.ff.S.duel.duel.pending?.req?.kind);
ok(dv==='divide', `divide panel shown (${dv})`);
const rows = await p.$$eval('.divrow', els=>els.map(e=>e.innerText.replace(/\s+/g,' ').trim()));
ok(rows.length===2, `two rows (${rows.join(' | ')})`);
// default split gives lethal (2) to the Bears first; the remaining 1 must go to the player
await p.click('[data-div="-2"][data-dir="1"]').catch(()=>{}); await p.waitForTimeout(150);
const dis = await p.$eval('#b-divide', e=>e.disabled);
ok(!dis, 'all damage assigned');
await p.click('#b-divide'); await p.waitForTimeout(800);
const fin = await p.evaluate(({gb})=>{const d=window.ff.S.duel.duel; return { gb: d.card(gb)?.zone, life: d.players[1].life, log: d.log.slice(-4).join(' / ') };}, ids);
ok(fin.gb==='graveyard' && fin.life===ids.life-1, `Bears dead, opponent took 1 (${fin.gb}, ${fin.life}; ${fin.log})`);
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.stack.split('\n').slice(0,6).join('\n'));fail++;}finally{try{await b.close()}catch{}try{relay.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
