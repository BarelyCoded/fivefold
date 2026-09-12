// The game-log collector shared by server.js and relay.js: every player's browser POSTs its game records
// here (js/gamelog.js), and admin.html / tools/gamelogs.mjs read them back with LOG_TOKEN.
//
// Each game is one file, <dir>/games/<id>.json, rewritten whenever a newer version of the same record
// arrives — a game in progress is synced every couple of minutes and again when it ends, so a closed tab or
// a crashed browser still leaves the match on record, and re-sends never duplicate it. Older logs in the
// append-only <dir>/games.jsonl are still read. The directory is LOG_DIR or ./logs next to the server;
// on Render the blueprint mounts a disk at /data — without one the folder is wiped on every deploy.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const MAX_RECORD = 1.5e6, MAX_TOTAL = 900e6, RATE = 90, RATE_WINDOW = 10 * 60e3;
const rate = new Map();   // ip -> recent POST timestamps

export function makeLogStore(root) {
  const dir = () => process.env.LOG_DIR || path.join(root, 'logs');
  const gamesDir = () => { const d = path.join(dir(), 'games'); fs.mkdirSync(d, { recursive: true }); return d; };
  const legacy = () => path.join(dir(), 'games.jsonl');
  const persistent = !!process.env.LOG_DIR;
  const safeId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(id) ? id : null;

  function count() {
    let n = 0;
    try { n += fs.readdirSync(gamesDir()).filter(f => f.endsWith('.json')).length; } catch {}
    try { if (fs.existsSync(legacy())) { const ids = new Set(); for (const l of fs.readFileSync(legacy(), 'utf8').split('\n')) { if (!l) continue; try { ids.add(JSON.parse(l).id); } catch {} } n += ids.size; } } catch {}
    return n;
  }
  function totalBytes() {
    let n = 0;
    try { if (fs.existsSync(legacy())) n += fs.statSync(legacy()).size; } catch {}
    try { for (const f of fs.readdirSync(gamesDir())) n += fs.statSync(path.join(gamesDir(), f)).size; } catch {}
    return n;
  }
  // Every record as one JSON line, newest version of each game only (a per-game file beats a legacy line).
  function* lines() {
    const seen = new Set(); const out = [];
    try { for (const f of fs.readdirSync(gamesDir())) if (f.endsWith('.json')) { try { const t = fs.readFileSync(path.join(gamesDir(), f), 'utf8').trim(); const id = JSON.parse(t).id; if (id && !seen.has(id)) { seen.add(id); out.push(t); } } catch {} } } catch {}
    try { if (fs.existsSync(legacy())) for (const l of fs.readFileSync(legacy(), 'utf8').split('\n')) { if (!l) continue; let id = null; try { id = JSON.parse(l).id; } catch { continue; } if (id && !seen.has(id)) { seen.add(id); out.push(l.trim()); } } } catch {}
    yield* out;
  }
  function startupNote() {
    const n = count();
    const where = dir();
    if (persistent) return `Game logs: ${n} in ${where} (LOG_DIR)`;
    return `Game logs: ${n} in ${where} — NOT persistent. On Render set LOG_DIR to a mounted disk (render.yaml does: /data) or every deploy wipes them.`;
  }

  // Returns true when it handled the request.
  function handle(req, res, url) {
    const p = url.pathname;
    if (p === '/api/log' && req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return true; }
    if (p === '/api/log/status' && req.method === 'GET') {   // public, so the admin page can tell "the relay holds N games" from "nothing ever arrived"
      const body = JSON.stringify({ ok: true, games: count(), persistent, bytes: totalBytes() });
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body); return true;
    }
    if (p === '/api/logs' && req.method === 'GET') {
      const token = process.env.LOG_TOKEN || ''; const given = (req.headers.authorization || '').replace(/^Bearer /, '') || url.searchParams.get('token') || '';
      const same = token && given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
      if (!same) { res.writeHead(403, CORS); res.end('LOG_TOKEN required'); return true; }
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
      for (const l of lines()) res.write(l + '\n');
      res.end(); return true;
    }
    if (p === '/api/log' && req.method === 'POST') {
      // Anyone may post (every player's browser does), so keep it cheap to abuse-proof: a size cap, a per-address
      // rate limit, a shape check, and a ceiling on the folder so junk can't fill the disk.
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const nowT = Date.now(); const hits = (rate.get(ip) || []).filter(t => nowT - t < RATE_WINDOW); hits.push(nowT); rate.set(ip, hits);
      if (hits.length > RATE) { res.writeHead(429, CORS); res.end('too many records'); return true; }
      let body = ''; let size = 0;
      req.on('data', chunk => { size += chunk.length; if (size > MAX_RECORD) { res.writeHead(413, CORS); res.end('record too large'); req.destroy(); return; } body += chunk; });
      req.on('end', () => {
        if (size > MAX_RECORD) return;
        let rec; try { rec = JSON.parse(body); } catch { res.writeHead(400, CORS); return res.end('bad json'); }
        if (!rec || typeof rec !== 'object' || !safeId(rec.id) || !Array.isArray(rec.events) || !Array.isArray(rec.players)) { res.writeHead(400, CORS); return res.end('not a game record'); }
        try { if (totalBytes() > MAX_TOTAL) { res.writeHead(507, CORS); return res.end('log full'); } } catch {}
        const file = path.join(gamesDir(), rec.id + '.json');
        let prev = null; try { if (fs.existsSync(file)) prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
        // never let a stale partial overwrite the finished game (a retry from the unsent queue can arrive late)
        if (prev && prev.result && !rec.result) { res.writeHead(200, { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end('{"ok":true,"kept":true}'); }
        const out = JSON.stringify({ ...rec, receivedAt: new Date().toISOString(), firstReceivedAt: prev?.firstReceivedAt || prev?.receivedAt || new Date().toISOString() });
        const tmp = file + '.' + process.pid + '.tmp';
        fs.writeFile(tmp, out, err => {
          if (!err) { try { fs.renameSync(tmp, file); } catch (e) { err = e; } }
          res.writeHead(err ? 500 : 200, { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(err ? '{"ok":false}' : '{"ok":true}');
        });
      });
      return true;
    }
    return false;
  }
  return { handle, startupNote, count, lines, dir };
}
