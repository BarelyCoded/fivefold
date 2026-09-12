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

  if (p === '/api/log' && req.method === 'POST') {   // one game record per line, appended by js/gamelog.js
    let body = ''; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 8e6) { req.destroy(); return; } body += chunk; });
    req.on('end', () => {
      let rec; try { rec = JSON.parse(body); } catch { return send(res, 400, 'bad json'); }
      const dir = path.join(ROOT, 'logs'); fs.mkdirSync(dir, { recursive: true });
      const line = JSON.stringify({ ...rec, receivedAt: new Date().toISOString() }) + '\n';
      fs.appendFile(path.join(dir, 'games.jsonl'), line, err => err ? send(res, 500, 'could not write log') : send(res, 200, JSON.stringify({ ok: true }), MIME['.json']));
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
