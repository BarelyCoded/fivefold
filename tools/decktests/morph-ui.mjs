import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { chromium } from 'playwright';
const PORT=8843, BASE=`http://localhost:${PORT}`; const here='/home/user/fivefold/tools'; const all=new Map();
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
await p.evaluate(async()=>{ const m=await import('/js/collection.js'); await m.importNames([{name:'Exalted Angel',count:1},{name:'Skinthinner',count:1}]); });
// Exalted Angel in hand, three colourless floating: cast it face down through the wizard
const ids = await p.evaluate(()=>{ const d=window.ff.S.duel.duel, D=window.ff.defOf; const mk=(n,i)=>{const c=d.instance(D(n),i); c.zone='hand'; d.players[i].hand.push(c); return c;};
  for (const l of d.players[0].battlefield.slice()) d.moveTo(l,'graveyard'); d.players[0].pool={W:0,U:0,B:0,R:0,G:0,C:3};
  const ea=mk('Exalted Angel',0); d.emit(); return { ea: ea.id, morph: !!D('Exalted Angel').morph }; });
ok(ids.morph, 'Exalted Angel compiles with a morph cost');
await p.waitForTimeout(300);
ok(!!(await p.$(`.card[data-zone="hand"][data-id="${ids.ea}"].castable`)), 'Angel shows as castable with three mana (face down)');
await p.click(`.card[data-zone="hand"][data-id="${ids.ea}"]`); await p.waitForTimeout(400);
const menu = await p.$$eval('[data-menu]', els=>els.map(e=>e.innerText.trim()));
ok(menu.some(t=>/Cast face down/.test(t)), `morph menu offered (${menu.join(' | ')})`);
await p.click(`[data-menu="${menu.findIndex(t=>/Cast face down/.test(t))}"]`); await p.waitForTimeout(600);
for (let i=0;i<20;i++){ const st=await p.evaluate(({ea})=>{const d=window.ff.S.duel.duel; return d.card(ea)?.zone;}, ids); if (st==='battlefield') break; if (await p.$('#b-pass')) await p.click('#b-pass').catch(()=>{}); await p.waitForTimeout(300); }
const st = await p.evaluate(({ea})=>{const d=window.ff.S.duel.duel; const c=d.card(ea); return { zone: c.zone, fd: !!c.faceDown, log: d.log.slice(-6).join(' / ') };}, ids);
ok(st.zone==='battlefield' && st.fd, `face-down Angel on the battlefield (${st.zone}, ${st.fd})`);
ok(!/Exalted Angel/.test(st.log), `log hides the name (${st.log})`);
const el = await p.$(`.card[data-zone="bf"][data-id="${ids.ea}"]`);
ok(!!el && (await el.getAttribute('class')).includes('facedown') && (await el.getAttribute('data-name'))==='Exalted Angel', 'its controller sees the Angel, marked face down');
ok(/face down/.test(await el.innerText()), 'face-down label shows the morph cost');
// turn it face up: {2}{W}{W}
await p.evaluate(()=>{ const d=window.ff.S.duel.duel; d.jobs.length=0; d.stack.length=0; d.active=0; d.priority=0; d.step='main1'; d.pending={type:'priority'}; d.players[0].pool={W:2,U:0,B:0,R:0,G:0,C:2}; d.emit(); });
await p.waitForTimeout(300); await p.click(`.card[data-zone="bf"][data-id="${ids.ea}"]`); await p.waitForTimeout(400);
const menu2 = await p.$$eval('[data-menu]', els=>els.map(e=>e.innerText.trim()));
const ti = menu2.findIndex(t=>/Turn face up/.test(t));
if (ti >= 0) { await p.click(`[data-menu="${ti}"]`); await p.waitForTimeout(500); }
const up = await p.evaluate(({ea})=>{const d=window.ff.S.duel.duel; const c=d.card(ea); return { fd: !!c.faceDown, name: c.def.name, stack: d.stack.length };}, ids);
ok(!up.fd && up.name==='Exalted Angel' && up.stack===0, `turned face up without using the stack (menu: ${menu2.join(' | ')}; fd=${up.fd})`);
console.log(`\n${pass} passed, ${fail} failed`);
}catch(e){console.log('THREW',e.stack.split('\n').slice(0,6).join('\n'));fail++;}finally{try{await b.close()}catch{}try{relay.kill('SIGKILL')}catch{}}
process.exit(fail?1:0);
