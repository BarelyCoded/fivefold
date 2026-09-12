// Summarise the global game log: what was played, what broke, what players flagged, which approximated
// cards keep showing up. Reads logs/games.jsonl (written by server.js / relay.js) or any exported file.
//   node tools/gamelogs.mjs [file.jsonl] [--flags] [--errors] [--game <id>]
import fs from 'node:fs';
const args = process.argv.slice(2);
// --pull <relay url> --token <LOG_TOKEN>: fetch the hosted relay's log into logs/games.jsonl (new games only).
const pi = args.indexOf('--pull');
if (pi >= 0) {
  const base = (args[pi + 1] || '').replace(/\/$/, ''); const ti = args.indexOf('--token'); const token = ti >= 0 ? args[ti + 1] : process.env.LOG_TOKEN;
  if (!base || !token) { console.log('usage: node tools/gamelogs.mjs --pull https://your-relay.onrender.com --token <LOG_TOKEN>'); process.exit(1); }
  const res = await fetch(`${base}/api/logs`, { headers: { Authorization: 'Bearer ' + token } }); if (!res.ok) { console.log('pull failed:', res.status, await res.text()); process.exit(1); }
  const dest = new URL('../logs/games.jsonl', import.meta.url).pathname; fs.mkdirSync(new URL('../logs', import.meta.url).pathname, { recursive: true });
  const have = new Set(fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l).id; } catch { return null; } }) : []);
  const lines = (await res.text()).split('\n').filter(Boolean); let added = 0;
  for (const l of lines) { let id = null; try { id = JSON.parse(l).id; } catch { continue; } if (have.has(id)) continue; fs.appendFileSync(dest, l + '\n'); have.add(id); added++; }
  console.log(`pulled ${lines.length} records, ${added} new -> ${dest}`); process.exit(0);
}
const gi = args.indexOf('--game');
const file = args.find((a, i) => !a.startsWith('--') && i !== gi + 1) || new URL('../logs/games.jsonl', import.meta.url).pathname;
if (!fs.existsSync(file)) { console.log(`No log file at ${file}. Play a game with node server.js (or relay.js) running, or export from the title screen.`); process.exit(0); }
const games = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const flag = f => args.includes(f); const gameId = gi >= 0 ? args[gi + 1] : null;
if (gameId) { const g = games.find(x => x.id === gameId); if (!g) { console.log('no such game'); process.exit(1); } for (const e of g.events) console.log(`T${e.turn} ${e.step.padEnd(11)} ${e.k.padEnd(6)} ${e.k === 'log' ? e.msg : e.k === 'act' ? `${e.a} ${e.card || ''} ${JSON.stringify(e.opts || {})} ${e.ok ? '' : '(refused)'}` : e.k === 'req' ? `${e.kind}: ${e.text}` : e.k === 'answer' ? `${e.kind} -> ${JSON.stringify(e.value)}` : e.k === 'flag' ? `⚑ ${e.note}` : JSON.stringify(e)}`); process.exit(0); }
const dur = g => g.endedAt && g.startedAt ? Math.round((g.endedAt - g.startedAt) / 60000) : null;
console.log(`${games.length} games in ${file}`);
const byMode = {}; for (const g of games) byMode[g.mode] = (byMode[g.mode] || 0) + 1;
console.log('by mode:', JSON.stringify(byMode));
const finished = games.filter(g => g.result && !g.result.abandoned);
console.log(`finished ${finished.length}, abandoned ${games.length - finished.length}; human won ${finished.filter(g => g.result.winner === 0).length}; median length ${(() => { const t = finished.map(g => g.result.turns || 0).sort((a, b) => a - b); return t[t.length >> 1] || 0; })()} turns`);
const flags = games.flatMap(g => (g.flags || []).map(f => ({ g, f })));
const errors = games.flatMap(g => (g.errors || []).map(e => ({ g, e })));
console.log(`\n⚑ flags: ${flags.length}   errors: ${errors.length}`);
if (flags.length) { console.log('\n== flagged moments =='); for (const { g, f } of flags.slice(0, flag('--flags') ? 1000 : 12)) { console.log(`- [${g.id}] ${g.mode} vs ${g.meta?.opponent || g.players?.[1]?.name} · turn ${f.turn} ${f.step} · ${f.category || 'other'}${f.card ? ' · ' + f.card : ''}: ${f.note}`); for (const l of (f.recent || []).slice(-5)) console.log(`      ${l}`); if (f.stack?.length) console.log(`      stack: ${f.stack.join(' > ')}`); } }
if (errors.length) { console.log('\n== errors =='); const grouped = {}; for (const { g, e } of errors) (grouped[e.message] ||= []).push({ g, e }); for (const [msg, list] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)) { console.log(`- ×${list.length} ${msg}`); if (flag('--errors')) console.log(list[0].e.stack.split('\n').map(l => '      ' + l).join('\n')); console.log(`      e.g. game ${list[0].g.id} turn ${list[0].e.turn} ${list[0].e.step}`); } }
const approx = {}; for (const g of games) for (const [n, a] of Object.entries(g.approximations || {})) { const x = (approx[n] ||= { games: 0, notes: new Set() }); x.games++; for (const note of a.notes || []) x.notes.add(note); }
const ap = Object.entries(approx).sort((a, b) => b[1].games - a[1].games);
if (ap.length) { console.log('\n== approximated cards seen (games) =='); for (const [n, x] of ap.slice(0, 25)) console.log(`- ${n} (${x.games}): ${[...x.notes].join('; ').slice(0, 140)}`); }
const refused = games.flatMap(g => g.events.filter(e => e.k === 'act' && !e.ok).map(e => `${e.a} ${e.card || ''}`)); const rc = {}; for (const r of refused) rc[r] = (rc[r] || 0) + 1;
const rr = Object.entries(rc).sort((a, b) => b[1] - a[1]); if (rr.length) { console.log('\n== actions the engine refused (a UI/engine mismatch worth a look) =='); for (const [k, n] of rr.slice(0, 15)) console.log(`- ×${n} ${k}`); }
console.log('\nreplay one game: node tools/gamelogs.mjs --game <id>');
