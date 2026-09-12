// Admin view of the global game log: every match the collector has received (or this browser holds, or an
// exported file), one row each, with the full turn-by-turn record, flagged moments and errors behind it.
// Reading from the relay needs its LOG_TOKEN; the token is remembered in this browser only.
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = { games: [], source: '', token: localStorage.getItem('ff.admin.token') || '', endpoint: '', open: null, filter: { mode: '', only: '', q: '' }, sort: 'newest', err: '' };
const fmtDate = t => t ? new Date(t).toLocaleString() : '—';
const mins = g => g.endedAt && g.startedAt ? Math.max(1, Math.round((g.endedAt - g.startedAt) / 60000)) : null;
const parseJsonl = text => text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const dedupe = list => { const seen = new Set(); return list.filter(g => g && g.id && !seen.has(g.id) && seen.add(g.id)); };

async function config() { try { const c = await (await fetch('content/config.json')).json(); return c; } catch { return {}; } }
async function loadRelay() {
  S.err = '';
  const base = S.endpoint.replace(/\/api\/log\/?$/, '');
  try {
    const r = await fetch(`${base}/api/logs`, { headers: { Authorization: 'Bearer ' + S.token } });   // header, not URL: keeps the token out of request logs
    if (!r.ok) { S.err = r.status === 403 ? 'The relay refused the token.' : `The relay answered ${r.status}.`; S.games = []; S.source = ''; return render(); }
    S.games = dedupe(parseJsonl(await r.text())); S.source = `relay ${base}`; localStorage.setItem('ff.admin.token', S.token);
  } catch (e) { S.err = 'Could not reach the relay: ' + e.message; }
  render();
}
function loadBrowser() { try { S.games = dedupe(JSON.parse(localStorage.getItem('ff.gamelogs.v1') || '[]')); } catch { S.games = []; } S.source = 'this browser'; S.err = ''; S.open = null; render(); }
function loadFile(file) { const rd = new FileReader(); rd.onload = () => { S.games = dedupe(parseJsonl(String(rd.result))); S.source = file.name; S.err = ''; S.open = null; render(); }; rd.readAsText(file); }

function visible() {
  const f = S.filter, q = f.q.trim().toLowerCase();
  let list = S.games.filter(g => (!f.mode || g.mode === f.mode) && (f.only !== 'flags' || (g.flags || []).length) && (f.only !== 'errors' || (g.errors || []).length) && (f.only !== 'abandoned' || g.result?.abandoned));
  if (q) list = list.filter(g => JSON.stringify([g.players?.map(p => [p.name, Object.keys(p.deck || {})]), g.meta, g.flags?.map(x => x.note)]).toLowerCase().includes(q));
  const key = { newest: g => -(g.startedAt || 0), oldest: g => g.startedAt || 0, longest: g => -(g.result?.turns || 0), flags: g => -((g.flags || []).length * 100 + (g.errors || []).length) }[S.sort];
  return list.sort((a, b) => key(a) - key(b));
}
const who = g => (g.players || []).map(p => `${esc(p.name)}${p.ai ? ' <span class="ai">AI</span>' : ''}`).join(' vs ');
const decks = g => g.meta?.playerDeck || g.meta?.opponentDeck ? `${esc(g.meta.playerDeck || '—')} vs ${esc(g.meta.opponentDeck || g.meta.opponent || '—')}` : esc(g.meta?.opponent || '');
const result = g => !g.result ? '<span class="warn">in progress</span>' : g.result.abandoned ? `<span class="warn">abandoned${g.result.why ? ` (${esc(g.result.why)})` : ''}</span>` : `${esc(g.result.winnerName || (g.players || [])[g.result.winner]?.name || '?')} won${g.result.why ? ` · ${esc(g.result.why)}` : ''}`;

function render() {
  const list = visible();
  const modes = [...new Set(S.games.map(g => g.mode))].sort();
  const g = S.open && S.games.find(x => x.id === S.open);
  app.innerHTML = `<section class="screen admin">
    <div class="box">
      <div class="rowhead"><h2>Match log</h2><span class="small">${S.games.length} match${S.games.length === 1 ? '' : 'es'}${S.source ? ` from ${esc(S.source)}` : ''} · <a href="index.html">back to the game</a></span></div>
      <div class="adm-src">
        <label>Relay token <input id="adm-token" type="password" value="${esc(S.token)}" placeholder="LOG_TOKEN from the Render service"></label>
        <button class="btn small primary" id="adm-load">Load from relay</button>
        <button class="btn small" id="adm-browser">This browser's games</button>
        <label class="btn small">Open a .jsonl file <input id="adm-file" type="file" accept=".jsonl,.json,.txt" hidden></label>
        ${S.token ? '<button class="btn small ghost" id="adm-forget" title="Remove the remembered token from this browser">Forget token</button>' : ''}
        <span class="small">${S.endpoint ? `relay: ${esc(S.endpoint.replace(/\/api\/log\/?$/, ''))}` : ''}</span>
      </div>
      ${S.err ? `<p class="msg">${esc(S.err)}</p>` : ''}
    </div>
    ${S.games.length ? `<div class="box">
      <div class="adm-filters">
        <input id="adm-q" placeholder="Search players, decks, cards, notes…" value="${esc(S.filter.q)}">
        <select id="adm-mode"><option value="">all modes</option>${modes.map(m => `<option value="${esc(m)}" ${S.filter.mode === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
        <select id="adm-only"><option value="">everything</option><option value="flags" ${S.filter.only === 'flags' ? 'selected' : ''}>flagged only</option><option value="errors" ${S.filter.only === 'errors' ? 'selected' : ''}>with errors</option><option value="abandoned" ${S.filter.only === 'abandoned' ? 'selected' : ''}>abandoned</option></select>
        <select id="adm-sort"><option value="newest" ${S.sort === 'newest' ? 'selected' : ''}>newest first</option><option value="oldest" ${S.sort === 'oldest' ? 'selected' : ''}>oldest first</option><option value="longest" ${S.sort === 'longest' ? 'selected' : ''}>most turns</option><option value="flags" ${S.sort === 'flags' ? 'selected' : ''}>most flags/errors</option></select>
        <span class="small">${list.length} shown · ${S.games.reduce((a, x) => a + (x.flags || []).length, 0)} ⚑ · ${S.games.reduce((a, x) => a + (x.errors || []).length, 0)} errors</span>
      </div>
      <div class="tablewrap"><table class="coll adm-table"><tr><th>When</th><th>Mode</th><th>Players</th><th>Decks</th><th>Result</th><th>Turns</th><th>Min</th><th>⚑</th><th>Err</th></tr>
      ${list.map(x => `<tr class="adm-row${x.id === S.open ? ' open' : ''}${(x.flags || []).length || (x.errors || []).length ? ' hot' : ''}" data-open="${esc(x.id)}"><td>${fmtDate(x.startedAt)}</td><td>${esc(x.mode)}</td><td>${who(x)}</td><td>${decks(x)}</td><td>${result(x)}</td><td>${x.result?.turns ?? '—'}</td><td>${mins(x) ?? '—'}</td><td>${(x.flags || []).length || ''}</td><td>${(x.errors || []).length || ''}</td></tr>`).join('')}</table></div>
    </div>` : ''}
    ${g ? detail(g) : ''}
  </section>`;
}

const pt = c => c.power != null ? ` ${c.power}/${c.toughness}` : '';
const cardLine = c => `${esc(c.name)}${pt(c)}${c.tapped ? ' (tapped)' : ''}${c.damage ? ` ${c.damage} dmg` : ''}${Object.keys(c.counters || {}).length ? ' [' + Object.entries(c.counters).map(([k, v]) => `${v} ${k}`).join(', ') + ']' : ''}`;
function board(b) {
  if (!b) return '<p class="small">No board snapshot.</p>';
  return `<div class="adm-board">${(b.players || []).map(p => `<div class="adm-side"><b>${esc(p.name)}</b> · ${p.life} life · ${p.handCount} in hand · ${p.libraryCount} in library${p.poison ? ` · ${p.poison} poison` : ''}
    <div class="small">Battlefield: ${p.battlefield.length ? p.battlefield.map(cardLine).join(', ') : 'empty'}</div>
    ${p.hand.some(c => !c.hidden) ? `<div class="small">Hand: ${p.hand.filter(c => !c.hidden).map(c => esc(c.name)).join(', ')}</div>` : ''}
    <div class="small">Graveyard: ${p.graveyard.length ? p.graveyard.map(c => esc(c.name)).join(', ') : 'empty'}</div></div>`).join('')}
    <div class="small">Turn ${b.turn}, ${esc(b.step)}; ${b.stack?.length ? 'stack: ' + b.stack.map(s => esc(s.name)).join(' > ') : 'stack empty'}${b.attackers?.length ? `; ${b.attackers.length} attacking` : ''}</div></div>`;
}
function detail(g) {
  const ev = g.events || [];
  const byTurn = []; for (const e of ev) { const last = byTurn[byTurn.length - 1]; if (!last || last.turn !== e.turn) byTurn.push({ turn: e.turn, items: [] }); byTurn[byTurn.length - 1].items.push(e); }
  const line = e => e.k === 'log' ? esc(e.msg) : e.k === 'act' ? `<i class="k">you</i> ${esc(e.a)} ${esc(e.card || '')}${e.opts?.targets?.length ? ' → ' + e.opts.targets.map(esc).join(', ') : ''}${e.ok ? '' : ' <span class="warn">(refused)</span>'}` : e.k === 'req' ? `<i class="k">asked</i> ${esc(e.kind)}: ${esc(e.text || '')}` : e.k === 'answer' ? `<i class="k">answered</i> ${esc(e.kind || '')} → ${esc(Array.isArray(e.value) ? e.value.join(', ') : String(e.value))}` : e.k === 'flag' ? `<b class="flag">⚑ ${esc(e.note)}</b>` : e.k === 'error' ? `<b class="warn">error: ${esc(e.message)}</b>` : esc(JSON.stringify(e));
  return `<div class="box adm-detail">
    <div class="rowhead"><h3>${who(g)} · ${esc(g.mode)} · ${fmtDate(g.startedAt)}</h3><span class="small">id ${esc(g.id)} · ${result(g)} · <button class="btn tiny" id="adm-close">Close</button></span></div>
    <p class="small">${decks(g)}${g.meta?.opponentTier ? ` · tier ${g.meta.opponentTier}` : ''} · ${ev.length} events${g.truncated ? ' (earliest trimmed)' : ''} · ${esc((g.ua || '').split(') ')[0].replace(/^Mozilla\/5\.0 \(/, ''))}</p>
    ${(g.flags || []).length ? `<h4>⚑ Flagged moments</h4>${g.flags.map(f => `<div class="adm-flag"><b>Turn ${f.turn}, ${esc(f.step)}</b>${f.category ? ` <span class="adm-cat">${esc(f.category)}</span>` : ''}${f.card ? ` <b>${esc(f.card)}</b>` : ''}: ${esc(f.note)}<div class="small adm-recent">${(f.recent || []).map(esc).join('<br>')}</div>${f.stack?.length ? `<div class="small">Stack: ${f.stack.map(esc).join(' > ')}</div>` : ''}${board(f.board)}</div>`).join('')}` : ''}
    ${(g.errors || []).length ? `<h4>Errors</h4>${g.errors.map(e => `<div class="adm-flag"><b>Turn ${e.turn}, ${esc(e.step)}:</b> ${esc(e.message)}<pre class="small">${esc(e.stack || '')}</pre></div>`).join('')}` : ''}
    ${Object.keys(g.approximations || {}).length ? `<h4>Approximated cards in this match</h4><ul class="small">${Object.entries(g.approximations).map(([n, a]) => `<li><b>${esc(n)}</b>${a.notes?.length ? ': ' + a.notes.map(esc).join('; ') : ` (${esc(a.status)})`}</li>`).join('')}</ul>` : ''}
    <h4>Decks</h4><div class="adm-decks">${(g.players || []).map(p => `<div><b>${esc(p.name)}</b> <span class="small">(${Object.values(p.deck || {}).reduce((a, b) => a + b, 0)} cards)</span><div class="small">${Object.entries(p.deck || {}).sort((a, b) => a[0].localeCompare(b[0])).map(([n, c]) => `${c} ${esc(n)}`).join(', ')}</div>${p.sideboard?.length ? `<div class="small">Sideboard: ${p.sideboard.map(esc).join(', ')}</div>` : ''}</div>`).join('')}</div>
    <h4>Full log</h4>
    <div class="adm-log">${byTurn.map(t => `<div class="adm-turn"><div class="adm-turn-h">Turn ${t.turn}</div>${t.items.map(e => `<div class="adm-ev k-${e.k}"><span class="step">${esc(e.step)}</span>${line(e)}</div>`).join('')}</div>`).join('')}</div>
  </div>`;
}

document.addEventListener('click', ev => {
  const row = ev.target.closest('[data-open]'); if (row) { S.open = S.open === row.dataset.open ? null : row.dataset.open; render(); if (S.open) document.querySelector('.adm-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  switch (ev.target.id) {
    case 'adm-load': S.token = document.getElementById('adm-token').value.trim(); S.open = null; loadRelay(); break;
    case 'adm-browser': loadBrowser(); break;
    case 'adm-close': S.open = null; render(); break;
    case 'adm-forget': S.token = ''; localStorage.removeItem('ff.admin.token'); loadBrowser(); break;
  }
});
document.addEventListener('change', ev => {
  if (ev.target.id === 'adm-file' && ev.target.files[0]) loadFile(ev.target.files[0]);
  if (ev.target.id === 'adm-mode') { S.filter.mode = ev.target.value; render(); }
  if (ev.target.id === 'adm-only') { S.filter.only = ev.target.value; render(); }
  if (ev.target.id === 'adm-sort') { S.sort = ev.target.value; render(); }
});
document.addEventListener('input', ev => { if (ev.target.id === 'adm-q') { S.filter.q = ev.target.value; render(); const el = document.getElementById('adm-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); } if (ev.target.id === 'adm-token') S.token = ev.target.value; });
document.addEventListener('keydown', ev => { if (ev.target.id === 'adm-token' && ev.key === 'Enter') { S.token = ev.target.value.trim(); loadRelay(); } });

(async () => {
  const c = await config();
  S.endpoint = (c.logEndpoint || '').trim() || new URL('api/log', location.href).href;
  render();
  if (S.token) loadRelay(); else loadBrowser();
})();
