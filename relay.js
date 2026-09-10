// Fivefold multiplayer relay: static file server (like server.js) PLUS a tiny WebSocket room broker
// for 1v1 duels. Zero dependencies — the WebSocket handshake and framing are done by hand so you can
// just `node relay.js` with nothing to install.
//
//   node relay.js             -> http://localhost:8642  (game)  +  ws://localhost:8642/ws  (lobby)
//   PORT=9000 node relay.js   -> custom port
//
// The broker is deliberately dumb: it matches two players into a room and forwards opaque JSON between
// them. It knows nothing about Magic — all game rules live in the (host) browser's engine.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

// ---- static server (same behaviour as server.js) -----------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let p = decodeURIComponent(url.pathname);
  if (p === '/api/art') return send(res, 200, JSON.stringify(listArt()), MIME['.json']);
  if (p === '/api/collection') {
    const file = path.join(ROOT, 'collection.csv');
    if (!fs.existsSync(file)) return send(res, 404, 'No collection.csv found next to relay.js');
    return send(res, 200, fs.readFileSync(file, 'utf8'), MIME['.csv']);
  }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found: ' + p);
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
});

// ---- minimal WebSocket (RFC 6455, server side, no deps) ----------------------------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function accept(key) { return crypto.createHash('sha1').update(key + WS_GUID).digest('base64'); }
function frame(data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  const len = payload.length;
  let hdr;
  if (len < 126) hdr = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { hdr = Buffer.alloc(4); hdr[0] = 0x80 | opcode; hdr[1] = 126; hdr.writeUInt16BE(len, 2); }
  else { hdr = Buffer.alloc(10); hdr[0] = 0x80 | opcode; hdr[1] = 127; hdr.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([hdr, payload]);
}
// A live connection with a JSON send() and message/close callbacks. Reassembles fragmented frames.
function wrap(socket) {
  const conn = { socket, id: crypto.randomBytes(6).toString('hex'), room: null, role: null, name: 'Player', alive: true,
    send(obj) { if (conn.alive) try { socket.write(frame(JSON.stringify(obj))); } catch { /* gone */ } },
    close() { if (conn.alive) { conn.alive = false; try { socket.write(frame(Buffer.alloc(0), 0x8)); socket.end(); } catch { /* gone */ } } },
    onmessage: null, onclose: null };
  let buf = Buffer.alloc(0);
  let frag = null;   // {opcode, chunks:[]}
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) break;
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, hdr = 2;
      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); hdr = 4; }
      else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); hdr = 10; }
      const need = hdr + (masked ? 4 : 0) + len;
      if (buf.length < need) break;
      let payload = buf.subarray(hdr + (masked ? 4 : 0), need);
      if (masked) { const m = buf.subarray(hdr, hdr + 4); const out = Buffer.allocUnsafe(len); for (let i = 0; i < len; i++) out[i] = payload[i] ^ m[i & 3]; payload = out; }
      buf = buf.subarray(need);
      if (opcode === 0x8) { conn.alive = false; try { socket.end(); } catch {} conn.onclose?.(); return; }
      if (opcode === 0x9) { try { socket.write(frame(payload, 0xA)); } catch {} continue; }   // ping -> pong
      if (opcode === 0xA) continue;                                                            // pong
      // text / continuation
      if (opcode === 0x0 && frag) frag.chunks.push(payload);
      else frag = { opcode, chunks: [payload] };
      if (fin && frag) {
        const full = Buffer.concat(frag.chunks); frag = null;
        let obj; try { obj = JSON.parse(full.toString('utf8')); } catch { continue; }
        conn.onmessage?.(obj);
      }
    }
  });
  socket.on('error', () => { conn.alive = false; conn.onclose?.(); });
  socket.on('close', () => { if (conn.alive) { conn.alive = false; conn.onclose?.(); } });
  return conn;
}

// ---- room broker -------------------------------------------------------------------
const rooms = new Map();   // code -> { code, name, host, guest }
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no easily-confused chars
function newCode() { let c; do { c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); } while (rooms.has(c)); return c; }
function openRooms() { return [...rooms.values()].filter(r => r.host && !r.guest).map(r => ({ code: r.code, name: r.name, host: r.host.name })); }
function broadcastLobby() { for (const c of conns) if (c.alive && !c.room) c.send({ t: 'lobby', rooms: openRooms() }); }
const conns = new Set();

function leaveRoom(conn, reason) {
  const r = conn.room; if (!r) return;
  conn.room = null;
  const peer = r.host === conn ? r.guest : r.host;
  if (r.host === conn) {
    // Host left: tear the room down; a guest, if any, is bumped back to the lobby.
    rooms.delete(r.code);
    if (peer) { peer.room = null; peer.role = null; peer.send({ t: 'peerLeft', reason: reason || 'host-left', roomClosed: true }); }
  } else if (r.guest === conn) {
    // Guest left: the room re-opens with the host waiting.
    r.guest = null;
    if (peer) peer.send({ t: 'peerLeft', reason: reason || 'guest-left', roomClosed: false });
  }
  broadcastLobby();
}

function handle(conn, msg) {
  switch (msg.t) {
    case 'hello': { conn.name = String(msg.name || 'Player').slice(0, 24); conn.send({ t: 'welcome', id: conn.id }); broadcastLobby(); break; }
    case 'list': conn.send({ t: 'lobby', rooms: openRooms() }); break;
    case 'host': {
      if (conn.room) leaveRoom(conn, 'rehosting');
      if (msg.name) conn.name = String(msg.name).slice(0, 24);
      const code = newCode();
      const room = { code, name: String(msg.roomName || `${conn.name}'s duel`).slice(0, 40), host: conn, guest: null };
      rooms.set(code, room); conn.room = room; conn.role = 'host';
      conn.send({ t: 'hosted', code, name: room.name });
      broadcastLobby(); break;
    }
    case 'join': {
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) { conn.send({ t: 'joinError', reason: 'no-such-room' }); break; }
      if (room.guest) { conn.send({ t: 'joinError', reason: 'room-full' }); break; }
      if (conn.room) leaveRoom(conn, 'rejoining');
      if (msg.name) conn.name = String(msg.name).slice(0, 24);
      room.guest = conn; conn.room = room; conn.role = 'guest';
      room.host.send({ t: 'peerJoined', name: conn.name, role: 'host' });
      conn.send({ t: 'joined', code: room.code, name: room.name, host: room.host.name, role: 'guest' });
      broadcastLobby(); break;
    }
    case 'relay': {   // opaque game payload -> the other peer in the room
      const r = conn.room; if (!r) break;
      const peer = r.host === conn ? r.guest : r.host;
      if (peer) peer.send({ t: 'peer', data: msg.data });
      break;
    }
    case 'leave': leaveRoom(conn, 'left'); break;
    default: break;
  }
}

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept(key)}`, '\r\n'].join('\r\n'));
  socket.setNoDelay(true);
  const conn = wrap(socket);
  conns.add(conn);
  conn.onmessage = m => { try { handle(conn, m); } catch (e) { /* never let one bad message kill the relay */ } };
  conn.onclose = () => { leaveRoom(conn, 'disconnect'); conns.delete(conn); };
  conn.send({ t: 'welcome', id: conn.id });
});

server.listen(PORT, () => {
  console.log(`Fivefold relay at http://localhost:${PORT}  (multiplayer lobby on ws://localhost:${PORT}/ws)`);
  console.log(`Art folder: ${path.join(ROOT, 'art')} (${listArt().length} images)`);
});
