# Fivefold Multiplayer (1v1)

Fivefold has an optional 1v1 duel mode. It's **host‑authoritative**: one player's browser
runs the real game engine and streams the board to the other; a tiny relay only introduces
the two players and forwards messages between them. All the Magic rules stay in the browser,
so the relay never needs updating when cards change.

`relay.js` is a single, zero‑dependency Node process that serves **both** the game and the
lobby on one port. That means you can deploy it once and hand friends a single link.

---

## Recommended: host it on Render (one always‑on link)

This gives you a permanent `https://…onrender.com` URL. Players open the link, click
**Multiplayer → Host / Join**, and play — no address to type, no tunnel.

### One‑click (Blueprint)
1. Push this repo to your own GitHub account (or fork it).
2. In [Render](https://render.com): **New + → Blueprint**, pick the repo. It reads
   [`render.yaml`](./render.yaml) and creates a web service named `fivefold-relay`.
3. Click **Apply**. When the deploy finishes, open the service URL.

### Manual (if you'd rather not use the blueprint)
Create a **New + → Web Service** from the repo with:
- **Runtime:** Node
- **Build command:** `npm install` (there are no dependencies, so this is a no‑op)
- **Start command:** `node relay.js`
- **Health check path:** `/`

Render injects a `PORT` environment variable, which `relay.js` already uses, and terminates
TLS for you — so the in‑game WebSocket automatically upgrades to secure `wss://`.

### Playing on the hosted URL
1. Both players open the Render URL (e.g. `https://fivefold-relay.onrender.com`).
2. One clicks **Multiplayer → Connect → Host a duel** and shares the 4‑letter room code.
3. The other clicks **Multiplayer → Connect → Join a duel**, enters the code (or picks the
   room from the open‑rooms list).
4. Each builds a deck → **I'm ready** → keep/mulligan → duel.

> **Free‑tier note:** Render's free plan spins the service down after ~15 minutes idle, so the
> first visitor after a quiet spell waits ~30–60s for it to wake. Upgrade the service to the
> **Starter** plan to keep it always‑on.

---

## Local / LAN (no hosting)

You can also just run it yourself:

```bash
npm run relay          # serves the game + lobby on http://localhost:8642
PORT=9000 npm run relay # custom port
```

- **Same computer:** open two browser tabs at `http://localhost:8642`.
- **Same network:** everyone opens `http://<your-lan-ip>:8642` (e.g. `http://192.168.1.50:8642`);
  you may need to allow the port through your firewall.
- **Over the internet without deploying:** run the relay locally and expose it with a tunnel,
  e.g. `cloudflared tunnel --url http://localhost:8642` or `ngrok http 8642`, then share the
  https URL the tunnel prints.

In every case, **load the game from the relay's URL** — the lobby defaults to connecting back
to wherever the page was served from. (There's a "Relay address" field on the connect screen
if you ever need to point somewhere else.)

---

## Notes & limitations

- **Cards still come from Scryfall** at runtime, so players need internet for card data/art —
  the relay only serves the app and pairs players.
- **Trust:** the host's browser holds the full game state, so this is friendly‑play trust, not
  tournament‑proof.
- **Disconnects:** if the guest drops, the room reopens for a new challenger; if the host drops,
  the room closes. Reconnecting into an in‑progress game isn't supported yet.
- **Single instance:** rooms live in the relay's memory, so run exactly one relay instance (don't
  scale it horizontally). The Render free/Starter single instance is exactly right.
- The static single‑player game on GitHub Pages can't host multiplayer by itself (it's static and
  HTTPS‑only), which is why the relay is a separate, tiny service.
