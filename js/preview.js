// Large hover preview for any card element on the page.
// Works on .card elements (data-name) and anything carrying data-preview="Card Name".
import { defOf, artFor, hasOwnArt } from './collection.js';
import { costString } from './cards.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let el = null, current = null;

export function initPreview() {
  if (el) return;
  el = document.createElement('div'); el.id = 'bigcard'; el.hidden = true;
  document.body.appendChild(el);
  document.addEventListener('mouseover', ev => {
    const host = ev.target.closest('.card, [data-preview]');
    if (!host || host === current) return;
    const name = host.dataset.preview || host.dataset.name;
    const def = name ? defOf(name) : null;
    if (!def) return;
    current = host;
    show(def, host, ev);
  });
  document.addEventListener('mouseout', ev => {
    const host = ev.target.closest('.card, [data-preview]');
    if (!host || host !== current) return;
    if (ev.relatedTarget && host.contains(ev.relatedTarget)) return;
    hide();
  });
  document.addEventListener('mousemove', ev => { if (!el.hidden) place(ev); });
  document.addEventListener('scroll', hide, true);
}

function show(def, host, ev) {
  const art = artFor(def);
  const own = hasOwnArt(def);
  const pt = host.querySelector('.card-pt')?.textContent || (def.kind === 'creature' ? `${def.power}/${def.toughness}` : '');
  const kws = def.keywords?.length ? def.keywords.join(', ') : '';
  const showText = !art || own; // Scryfall's image already carries the rules text
  el.innerHTML = `
    <div class="bc-img${art ? '' : ' none'}" style="${art ? `background-image:url('${art}')` : ''}">
      ${!art ? `<div class="bc-fallback"><b>${esc(def.name)}</b><span>${esc(def.typeLine)}</span></div>` : ''}
    </div>
    ${showText ? `<div class="bc-text">
      <div class="bc-name">${esc(def.name)}<span>${def.kind === 'land' ? '' : esc(costString(def.cost))}</span></div>
      <div class="bc-type">${esc(def.typeLine)}</div>
      <div class="bc-oracle">${esc(def.oracle).replace(/\n/g, '<br>')}</div>
      ${pt || kws ? `<div class="bc-pt">${esc(pt)}${kws ? (pt ? ' · ' : '') + esc(kws) : ''}</div>` : ''}
    </div>` : ''}
    ${def.notes?.length ? `<div class="bc-notes">Demo engine: ${def.notes.map(esc).join('; ')}</div>` : ''}`;
  el.hidden = false;
  place(ev);
}

function place(ev) {
  const pad = 18, w = el.offsetWidth, h = el.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY - h / 2;
  if (x + w > window.innerWidth - 8) x = ev.clientX - pad - w;
  if (x < 8) x = 8;
  y = Math.max(8, Math.min(window.innerHeight - h - 8, y));
  el.style.left = x + 'px'; el.style.top = y + 'px';
}

export function hide() { if (el) { el.hidden = true; } current = null; }
