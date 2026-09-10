// Sound. Short effects (cards, combat, the map) are synthesised with Web Audio; the music is a set of
// mp3 tracks played in a shuffled, continuous playlist for ambiance. Everything obeys one mute toggle in
// the top bar, remembered across sessions. Both the effect context and the music start on the first
// click or key (browsers block audio until a gesture).
const KEY = 'ff.audio.v1';
let ctx = null, master = null;
let muted = (() => { try { return localStorage.getItem(KEY) === 'off'; } catch { return false; } })();
let mode = null;

export const audioMuted = () => muted;
export function toggleAudio() {
  muted = !muted;
  try { localStorage.setItem(KEY, muted ? 'off' : 'on'); } catch { /* ignore */ }
  if (!muted) unlock();
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
  applyMusicMute();
  return muted;
}
function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}
// Call from a user gesture. Unlocks the effect context and (re)starts the music playlist if it's wanted.
export function unlock() { ensure(); if (wantMusic || mode) startMusic(); }

// ---- effects ----------------------------------------------------------------------
function tone(freq, { type = 'sine', t = 0, dur = 0.15, gain = 0.25, slide = 0, attack = 0.005 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain(); const at = ctx.currentTime + t;
  o.type = type; o.frequency.setValueAtTime(freq, at); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), at + dur);
  g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + attack); g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
  o.connect(g); g.connect(master); o.start(at); o.stop(at + dur + 0.05);
}
let noiseBuf = null;
function noise({ t = 0, dur = 0.2, gain = 0.2, freq = 1200, q = 0.7, type = 'bandpass', slide = 0 } = {}) {
  if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const at = ctx.currentTime + t; if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), at + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(at); s.stop(at + dur + 0.05);
}
const SFX = {
  click: () => tone(880, { type: 'square', dur: 0.05, gain: 0.06 }),
  step: () => noise({ dur: 0.07, gain: 0.12, freq: 500, type: 'lowpass' }),
  card: () => noise({ dur: 0.12, gain: 0.18, freq: 3000, q: 0.5, slide: 0.4 }),
  draw: () => noise({ dur: 0.1, gain: 0.12, freq: 4000, q: 0.5, slide: 0.5 }),
  cast: () => { tone(523, { dur: 0.25, gain: 0.12 }); tone(784, { t: 0.06, dur: 0.3, gain: 0.12 }); tone(1046, { t: 0.12, dur: 0.4, gain: 0.1 }); },
  land: () => tone(196, { type: 'triangle', dur: 0.25, gain: 0.18, slide: 0.7 }),
  attack: () => noise({ dur: 0.28, gain: 0.25, freq: 600, q: 1.2, slide: 4 }),
  block: () => { noise({ dur: 0.12, gain: 0.25, freq: 900, q: 2 }); tone(220, { type: 'square', dur: 0.08, gain: 0.08 }); },
  hit: () => { tone(90, { type: 'triangle', dur: 0.25, gain: 0.35, slide: 0.5 }); noise({ dur: 0.15, gain: 0.2, freq: 250, type: 'lowpass' }); },
  die: () => { tone(330, { type: 'sawtooth', dur: 0.5, gain: 0.1, slide: 0.35 }); noise({ t: 0.05, dur: 0.3, gain: 0.12, freq: 700, slide: 0.3 }); },
  coin: () => { tone(1568, { dur: 0.12, gain: 0.12 }); tone(2093, { t: 0.08, dur: 0.35, gain: 0.12 }); },
  right: () => { tone(659, { dur: 0.15, gain: 0.12 }); tone(880, { t: 0.12, dur: 0.3, gain: 0.12 }); },
  wrong: () => { tone(300, { type: 'square', dur: 0.2, gain: 0.08 }); tone(220, { type: 'square', t: 0.18, dur: 0.35, gain: 0.08 }); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, { t: i * 0.13, dur: 0.5, gain: 0.14 })),
  lose: () => [440, 392, 349, 262].forEach((f, i) => tone(f, { type: 'triangle', t: i * 0.22, dur: 0.6, gain: 0.14 })),
  open: () => { noise({ dur: 0.25, gain: 0.15, freq: 300, type: 'lowpass' }); tone(140, { type: 'triangle', dur: 0.3, gain: 0.15, slide: 0.6 }); },
};
export function sfx(name) { if (muted || !ctx) return; const f = SFX[name]; if (f) { try { f(); } catch { /* ignore */ } } }

// ---- music: a shuffled mp3 playlist --------------------------------------------------
// A handful of tracks play back to back in random order for ambiance, the same across every screen.
// The files sit at the site root; resolve them against the page base so it also works under a GitHub
// Pages sub-path. Streamed through a plain <audio> element (independent of the effects context).
const TRACKS = [
  '1classicSkaraBrae.mp3', '1classicStones.mp3', '1classicTavern01.mp3',
  '1classicThejourney.mp3', '1classicVesper.mp3', '1classicWind.mp3',
];
const MUSIC_VOL = 0.5;
let audioEl = null, queue = [], lastTrack = null, wantMusic = false;
const musicPath = f => { try { return new URL(f, document.baseURI).href; } catch { return f; } };
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function nextTrack() {
  if (!queue.length) { queue = shuffle(TRACKS.slice()); if (queue.length > 1 && queue[0] === lastTrack) queue.push(queue.shift()); }
  return (lastTrack = queue.shift());
}
function applyMusicMute() {
  if (!audioEl) return;
  if (muted) audioEl.pause();
  else { audioEl.volume = MUSIC_VOL; if (wantMusic) { const p = audioEl.play(); if (p && p.catch) p.catch(() => {}); } }
}
function ensureMusicEl() {
  if (audioEl) return audioEl;
  audioEl = new Audio();
  audioEl.preload = 'auto';
  audioEl.volume = muted ? 0 : MUSIC_VOL;
  audioEl.addEventListener('ended', playNext);
  audioEl.addEventListener('error', () => { if (wantMusic && !muted) setTimeout(playNext, 600); });   // skip a bad/interrupted file
  return audioEl;
}
function playNext() {
  if (!wantMusic || muted) return;
  const el = ensureMusicEl();
  el.src = musicPath(nextTrack());
  el.volume = MUSIC_VOL;
  const p = el.play(); if (p && p.catch) p.catch(() => {});   // autoplay may be blocked until a gesture; unlock() retries
}
function startMusic() {
  wantMusic = true;
  if (muted) return;
  const el = ensureMusicEl();
  if (!el.src) playNext();
  else { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
}
// Kept for the render loop's per-screen calls: the playlist is continuous, so this just marks that music
// is wanted and (re)starts it once audio is permitted. A null mode is ignored — ambiance never stops.
export function music(newMode) {
  mode = newMode;
  if (!newMode) return;
  wantMusic = true;
  startMusic();
}
