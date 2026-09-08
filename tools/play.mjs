// Drive the real game in a headless browser with Scryfall answered from the local set cache.
//   node tools/play.mjs            (needs `npm i playwright` somewhere on NODE_PATH and a running `node server.js`)
// Starts a new game, walks around the map and reports how long each keypress takes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const here = process.env.FIVEFOLD_TOOLS || path.dirname(fileURLToPath(import.meta.url));
const all = new Map();
for (const f of fs.readdirSync(path.join(here, '.sets'))) for (const c of JSON.parse(fs.readFileSync(path.join(here, '.sets', f), 'utf8'))) if (!all.has(c.name.toLowerCase())) all.set(c.name.toLowerCase(), c);
const stub = name => ({ name, id: 'stub-' + name, set: 'stub', mana_cost: '{1}{G}', cmc: 2, type_line: 'Creature — Stub', oracle_text: '', power: '2', toughness: '2', colors: ['G'], keywords: [], image_uris: null });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.route('https://api.scryfall.com/**', async route => {
  const req = route.request(); const url = req.url();
  if (url.includes('/cards/collection')) {
    const ids = JSON.parse(req.postData() || '{}').identifiers || [];
    const data = ids.map(i => all.get(i.name.toLowerCase()) || stub(i.name));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, not_found: [] }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], has_more: false }) });
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { window.__long = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); });
await page.goto('http://localhost:8642/');
await page.fill('input[name=name]', 'Tester');
await page.click('button[type=submit]');
await page.waitForSelector('#map', { timeout: 60000 });
await page.waitForTimeout(1500);
const times = [];
const walk = [...Array(10).fill('ArrowRight'), ...Array(8).fill('ArrowDown'), ...Array(10).fill('ArrowLeft'), ...Array(8).fill('ArrowUp'), ...Array(6).fill('ArrowRight')];
for (let i = 0; i < walk.length; i++) {
  const key = walk[i];
  if (await page.$('.screen:not(.mapscreen) button.btn.primary')) { const leave = await page.$('button.btn.primary'); if (leave && (await leave.textContent()).includes('Leave')) { await leave.click(); await page.waitForTimeout(100); } }
  const t = await page.evaluate(async k => {
    const t0 = performance.now();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    const t1 = performance.now();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return [Math.round(t1 - t0), Math.round(performance.now() - t0)];
  }, key);
  times.push(t);
  const overlay = await page.$('.overlay .mbtns button:last-child');
  if (overlay) { await overlay.click(); await page.waitForTimeout(50); times[times.length - 1].push('modal'); }
}
const long = await page.evaluate(() => window.__long);
console.log('handler ms / to next frame ms per key:', times.map(t => t.join('/')).join(' '));
console.log('long tasks (ms):', long, 'errors:', errors);
await page.screenshot({ path: process.env.SHOT || '/tmp/play.png' });
await browser.close();
