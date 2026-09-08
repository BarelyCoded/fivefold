// Sound, synthesised with Web Audio: no audio files. Short effects for cards, combat and the map,
// and a quiet generative score that changes with the screen. Everything routes through one master
// gain so the toggle in the top bar silences it all. The context unlocks on the first click or key.
const KEY = 'ff.audio.v1';
let ctx = null, master = null, musicBus = null;
let muted = (() => { try { return localStorage.getItem(KEY) === 'off'; } catch { return false; } })();
let mode = null, nextBar = 0, barTimer = null, barIndex = 0;

export const audioMuted = () => muted;
export function toggleAudio() {
  muted = !muted;
  try { localStorage.setItem(KEY, muted ? 'off' : 'on'); } catch { /* ignore */ }
  if (!muted) unlock();
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
  return muted;
}
function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.35; musicBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}
// Call from a user gesture. Starts the score if one was requested before the gesture.
export function unlock() { if (!ensure()) return; if (mode && !barTimer) startScore(); }

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

// ---- score ------------------------------------------------------------------------
// Each screen has a mode: a scale, a tempo and a mood. One bar is scheduled at a time, just ahead of
// the clock, from a pad chord, a soft bass and a sparse pentatonic melody; nothing repeats exactly.
const MODES = {
  title: { root: 220, scale: [0, 2, 4, 7, 9], bar: 3.2, pad: 0.05, bass: 0.05, melody: 0.045, density: 0.5, wave: 'triangle' },
  map: { root: 261.6, scale: [0, 2, 4, 7, 9], bar: 2.6, pad: 0.045, bass: 0.06, melody: 0.05, density: 0.65, wave: 'triangle' },
  city: { root: 293.7, scale: [0, 2, 4, 5, 7, 9], bar: 2.2, pad: 0.04, bass: 0.05, melody: 0.06, density: 0.75, wave: 'triangle' },
  duel: { root: 196, scale: [0, 2, 3, 5, 7, 8, 10], bar: 2.0, pad: 0.05, bass: 0.08, melody: 0.04, density: 0.7, wave: 'sawtooth', pulse: true },
  dungeon: { root: 146.8, scale: [0, 1, 3, 5, 7, 8], bar: 3.4, pad: 0.06, bass: 0.07, melody: 0.03, density: 0.35, wave: 'sine', drone: true },
};
const chords = [[0, 2, 4], [3, 5, 0], [4, 6, 1], [1, 3, 5]];
function freqOf(m, degree, octave = 0) { const n = m.scale.length; const d = ((degree % n) + n) % n; const oct = Math.floor(degree / n) + octave; return m.root * Math.pow(2, (m.scale[d] + 12 * oct) / 12); }
function voice(freq, at, dur, gain, type, bus = musicBus) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + Math.min(0.4, dur * 0.3)); g.gain.setValueAtTime(gain, at + dur * 0.7); g.gain.linearRampToValueAtTime(0, at + dur);
  o.connect(g); g.connect(bus); o.start(at); o.stop(at + dur + 0.02);
}
function scheduleBar(m, at) {
  const ch = chords[barIndex % chords.length];
  for (const d of ch) { voice(freqOf(m, d, 0), at, m.bar, m.pad, 'sine'); voice(freqOf(m, d, 0) * 1.003, at, m.bar, m.pad * 0.6, 'triangle'); }
  voice(freqOf(m, ch[0], -1), at, m.pulse ? m.bar * 0.45 : m.bar * 0.9, m.bass, 'triangle');
  if (m.pulse) voice(freqOf(m, ch[0], -1), at + m.bar / 2, m.bar * 0.4, m.bass * 0.8, 'triangle');
  if (m.drone) voice(freqOf(m, ch[0], -2), at, m.bar, m.bass * 0.7, 'sine');
  const steps = 8; let last = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < steps; i++) {
    if (Math.random() > m.density) continue;
    last += [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]; last = Math.max(0, Math.min(m.scale.length * 2 - 1, last));
    const t = at + i * (m.bar / steps); const dur = m.bar / steps * (1 + Math.floor(Math.random() * 2));
    voice(freqOf(m, last, 1), t, dur, m.melody * (0.6 + Math.random() * 0.5), m.wave === 'sawtooth' ? 'triangle' : m.wave);
  }
  barIndex++;
}
function startScore() {
  if (barTimer) clearInterval(barTimer);
  nextBar = ctx.currentTime + 0.1;
  const tick = () => { const m = MODES[mode]; if (!m) return; while (nextBar < ctx.currentTime + 1.2) { scheduleBar(m, nextBar); nextBar += m.bar; } };
  tick(); barTimer = setInterval(tick, 400);
}
// Choose the score for a screen; null stops it.
export function music(newMode) {
  if (newMode === mode) return;
  mode = newMode;
  if (!ctx) return;                    // starts at unlock()
  if (!mode) { if (barTimer) clearInterval(barTimer); barTimer = null; return; }
  startScore();
}
