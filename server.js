// Fivefold dev server: static files + two tiny endpoints so the game can read
// your own collection list and card art straight from disk. No dependencies.
//
//   node server.js            -> http://localhost:8642
//   PORT=9000 node server.js  -> custom port
//
// Folders it exposes:
//   art/            drop images named after cards, e.g. art/lightning-bolt.jpg
//   collection.csv  your card list (see collection.example.csv)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8642;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function listArt() {
  const dir = path.join(ROOT, 'art');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => IMAGE_EXT.has(path.extname(f).toLowerCase()));
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let p = decodeURIComponent(url.pathname);

  if (p === '/api/art') return send(res, 200, JSON.stringify(listArt()), MIME['.json']);

  // Game logs (js/gamelog.js). Any origin may POST — the GitHub Pages build reports to the hosted relay —
  // and reading them back needs LOG_TOKEN. LOG_DIR moves the file onto a persistent disk.
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
  const logFile = () => { const dir = process.env.LOG_DIR || path.join(ROOT, 'logs'); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, 'games.jsonl'); };
  if (p === '/api/log' && req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (p === '/api/logs' && req.method === 'GET') {
    const token = process.env.LOG_TOKEN; const given = url.searchParams.get('token') || (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token || given !== token) { res.writeHead(403, CORS); return res.end('LOG_TOKEN required'); }
    const f = logFile(); res.writeHead(200, { ...CORS, 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    return fs.existsSync(f) ? fs.createReadStream(f).pipe(res) : res.end('');
  }
  if (p === '/api/log' && req.method === 'POST') {   // one game record per line, appended by js/gamelog.js
    let body = ''; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 8e6) { req.destroy(); return; } body += chunk; });
    req.on('end', () => {
      let rec; try { rec = JSON.parse(body); } catch { return send(res, 400, 'bad json'); }
      const line = JSON.stringify({ ...rec, receivedAt: new Date().toISOString() }) + '\n';
      fs.appendFile(logFile(), line, err => { res.writeHead(err ? 500 : 200, { ...CORS, 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); res.end(err ? '{"ok":false}' : '{"ok":true}'); });
    });
    return;
  }
  if (p === '/api/collection') {
    const file = path.join(ROOT, 'collection.csv');
    if (!fs.existsSync(file)) return send(res, 404, 'No collection.csv found next to server.js');
    return send(res, 200, fs.readFileSync(file, 'utf8'), MIME['.csv']);
  }

  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found: ' + p);
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}).listen(PORT, () => {
  console.log(`Fivefold running at http://localhost:${PORT}`);
  console.log(`Art folder: ${path.join(ROOT, 'art')} (${listArt().length} images)`);
});
