// Fivefold multiplayer transport. A thin wrapper over a WebSocket to the relay (relay.js): connect,
// host/join a room, and pass opaque game payloads to the other peer. It knows nothing about Magic —
// mp.js drives the game on top of this. DOM-free, so it can be unit-tested in Node too.
//
//   const net = new Net();                     // same-origin relay at /ws
//   await net.connect('Alice');
//   net.on('lobby', rooms => …); net.on('peer', data => …); net.on('peerLeft', info => …);
//   const { code } = await net.host('My duel');   // or: await net.join('ABCD')
//   net.relay({ kind: 'snapshot', … });            // -> delivered to the peer as an 'peer' event

// Default relay URL: same host as the page, /ws, ws or wss to match the page's protocol.
function defaultUrl() {
  if (typeof location !== 'undefined' && location.host) {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }
  return 'ws://localhost:8642/ws';
}

export class Net {
  constructor(url) {
    this.url = url || defaultUrl();
    this.ws = null;
    this.id = null;
    this.name = 'Player';
    this.room = null;      // { code, name, role: 'host'|'guest' }
    this.state = 'idle';   // idle | connecting | open | closed
    this._handlers = {};   // event -> Set<cb>
    this._keepalive = null;
  }

  // ---- event emitter ----
  on(event, cb) { (this._handlers[event] ||= new Set()).add(cb); return () => this.off(event, cb); }
  off(event, cb) { this._handlers[event]?.delete(cb); }
  _emit(event, ...args) { for (const cb of this._handlers[event] || []) { try { cb(...args); } catch (e) { console.error('net handler error', event, e); } } }

  // Open the socket and identify. Resolves once the relay welcomes us.
  connect(name = 'Player') {
    this.name = String(name || 'Player').slice(0, 24);
    this.state = 'connecting';
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { this.state = 'closed'; return reject(e); }
      this.ws = ws;
      ws.addEventListener('open', () => { this._send({ t: 'hello', name: this.name }); this._startKeepalive(); });
      ws.addEventListener('message', ev => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        this._onMessage(m);
        if (!settled && m.t === 'welcome') { settled = true; this.state = 'open'; this.id = m.id; this._emit('open'); resolve(this); }
      });
      ws.addEventListener('error', e => { this._emit('error', e); if (!settled) { settled = true; this.state = 'closed'; reject(new Error('connection failed')); } });
      ws.addEventListener('close', () => { this.state = 'closed'; this._stopKeepalive(); this._emit('close'); if (!settled) { settled = true; reject(new Error('connection closed')); } });
    });
  }

  _onMessage(m) {
    switch (m.t) {
      case 'welcome': this.id = m.id; break;
      case 'lobby': this._emit('lobby', m.rooms || []); break;
      case 'hosted': this.room = { code: m.code, name: m.name, role: 'host' }; this._emit('hosted', this.room); break;
      case 'joined': this.room = { code: m.code, name: m.name, role: 'guest', host: m.host }; this._emit('joined', this.room); break;
      case 'joinError': this._emit('joinError', m.reason); break;
      case 'peerJoined': this._emit('peerJoined', { name: m.name }); break;
      case 'peerLeft': if (m.roomClosed) this.room = null; this._emit('peerLeft', { reason: m.reason, roomClosed: !!m.roomClosed }); break;
      case 'peer': this._emit('peer', m.data); break;
      case 'pong': break;
      default: break;
    }
  }

  list() { this._send({ t: 'list' }); }

  // Host a room; resolves with { code, name, role } once the relay confirms.
  host(roomName) {
    return new Promise((resolve, reject) => {
      if (this.state !== 'open') return reject(new Error('not connected'));
      const off = this.on('hosted', room => { off(); resolve(room); });
      this._send({ t: 'host', name: this.name, roomName });
    });
  }

  // Join a room by code; resolves on success, rejects with the reason on failure.
  join(code) {
    return new Promise((resolve, reject) => {
      if (this.state !== 'open') return reject(new Error('not connected'));
      const offOk = this.on('joined', room => { offOk(); offErr(); resolve(room); });
      const offErr = this.on('joinError', reason => { offOk(); offErr(); reject(new Error(reason)); });
      this._send({ t: 'join', name: this.name, code: String(code || '').toUpperCase().trim() });
    });
  }

  // Forward an opaque game payload to the peer in our room.
  relay(data) { this._send({ t: 'relay', data }); }

  leave() { this.room = null; this._send({ t: 'leave' }); }

  close() { this._stopKeepalive(); try { this.ws?.close(); } catch { /* already gone */ } this.state = 'closed'; }

  _send(obj) { if (this.ws && this.ws.readyState === 1) { try { this.ws.send(JSON.stringify(obj)); } catch { /* dropped */ } } }
  _startKeepalive() { this._stopKeepalive(); this._keepalive = setInterval(() => this._send({ t: 'ping', ts: Date.now() }), 25000); if (this._keepalive.unref) this._keepalive.unref(); }
  _stopKeepalive() { if (this._keepalive) { clearInterval(this._keepalive); this._keepalive = null; } }
}
