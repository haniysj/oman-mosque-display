// Smart-TV check: loads the display with a Tizen user agent and with newer JS APIs removed
// (as on Chromium 56–68 TV browsers). The app must still render the prayer panels.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = process.env.OUT || 'shots';
const backup = JSON.parse(readFileSync(new URL('../public/data/sample-backup-DEMO.json', import.meta.url)));
const results = [];
const ok = (n, c, x = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };
const b = await chromium.launch();
for (const strip of [false, true]) {
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.2 Chrome/63.0.3239.84 TV Safari/537.36' });
  if (strip) await ctx.addInitScript(() => {
    for (const [o, k] of [[Array.prototype, 'flatMap'], [Array.prototype, 'flat'], [Object, 'fromEntries'], [String.prototype, 'replaceAll'], [String.prototype, 'matchAll'],
      [Array.prototype, 'at'], [String.prototype, 'at'], [window, 'structuredClone'], [Promise, 'allSettled'], [Array.prototype, 'findLast'], [Object, 'hasOwn']]) {
      try { delete o[k]; } catch { /* ignore */ }
    }
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-10-10T15:20:00+04:00') });
  await p.goto(BASE + '/'); await p.waitForTimeout(500);
  await p.evaluate(async (bk) => {
    const db = await new Promise((res) => { const r = indexedDB.open('oman-mosque-display', 1); r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('logs', { keyPath: 'id', autoIncrement: true }); }; r.onsuccess = () => res(r.result); });
    await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(bk.config, 'config'); tx.objectStore('kv').put(bk.schedule, 'schedule'); tx.objectStore('kv').put(bk.adhkar, 'adhkar'); tx.oncomplete = res; });
    db.close();
  }, backup);
  await p.reload(); await p.clock.runFor(1500); await p.waitForTimeout(500);
  const label = strip ? 'old-TV APIs' : 'Tizen UA';
  ok(`${label}: prayer panels render`, (await p.locator('.panel .row').count()) === 12);
  ok(`${label}: no error screen`, (await p.getByText('حدث خلل مؤقت').count()) === 0);
  ok(`${label}: no JS errors`, errs.length === 0, errs.join(' | '));
  if (strip) await p.screenshot({ path: `${OUT}/old-tv.png` });
  await ctx.close();
}
await b.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} TV checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
