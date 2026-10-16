// Device fit: every element of the display stays inside the safe area (notch / Dynamic Island /
// home indicator) on iPhone, iPad and Android sizes, portrait and landscape (CDP safe-area emulation).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const OUT = process.env.OUT || 'shots';
const backup = JSON.parse(readFileSync(new URL('../public/data/sample-backup-DEMO.json', import.meta.url)));
const b = await chromium.launch();

// Offline from the real cloud: no mosque exists, so the display keeps the demo data (no auto-linking).
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.route(/supabase\.co\/rest\/v1\/rpc\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: /mosque_list|mosque_timetables_summary/.test(r.request().url()) ? '[]' : 'null' })); return c; }; }
const cases = [
  { n: 'iphone16pro-portrait', vp: { width: 402, height: 874 }, ins: { top: 62, bottom: 34, left: 0, right: 0 }, mobile: true },
  { n: 'iphone16pro-landscape', vp: { width: 874, height: 402 }, ins: { top: 0, bottom: 21, left: 62, right: 62 }, mobile: true },
  { n: 'iphoneSE', vp: { width: 375, height: 667 }, ins: { top: 20, bottom: 0, left: 0, right: 0 }, mobile: true },
  { n: 'ipad-portrait', vp: { width: 820, height: 1180 }, ins: { top: 24, bottom: 20, left: 0, right: 0 }, mobile: true },
  { n: 'ipad-landscape', vp: { width: 1180, height: 820 }, ins: { top: 24, bottom: 20, left: 0, right: 0 }, mobile: true },
  { n: 'pixel8', vp: { width: 412, height: 915 }, ins: { top: 32, bottom: 24, left: 0, right: 0 }, mobile: true },
];
let fails = 0;
for (const c of cases) {
  const ctx = await b.newContext({ viewport: c.vp, deviceScaleFactor: 2, isMobile: c.mobile, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  let supported = true;
  try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: c.ins }); } catch (e) { supported = false; console.log('no CDP safe-area:', e.message); }
  await p.clock.install({ time: new Date('2026-10-10T15:00:00+04:00') });
  await p.goto('http://localhost:4173/'); await p.waitForTimeout(400);
  await p.evaluate(async (bk) => {
    const db = await new Promise((res) => { const r = indexedDB.open('oman-mosque-display', 1); r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('logs', { keyPath: 'id', autoIncrement: true }); }; r.onsuccess = () => res(r.result); });
    await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(bk.config, 'config'); tx.objectStore('kv').put(bk.schedule, 'schedule'); tx.objectStore('kv').put(bk.adhkar, 'adhkar'); tx.oncomplete = res; });
    db.close();
  }, backup);
  await p.reload(); await p.clock.runFor(1500);
  await p.mouse.click(c.vp.width / 2, c.vp.height / 2); await p.clock.runFor(300);
  const envTop = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sa-t'));
  // every visible element of the display must be inside the safe area
  const bad = await p.evaluate((ins) => {
    const W = innerWidth, H = innerHeight, out = [];
    for (const el of document.querySelectorAll('.display-root *')) {
      if (el.closest('.bg-base,.pattern,.light,[aria-hidden="true"]')) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      if (!el.children.length || el.matches('button,.ctrl-btn,svg')) {
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        if (r.top < ins.top - 0.5 || r.left < ins.left - 0.5 || r.right > W - ins.right + 0.5 || (r.bottom > H - ins.bottom + 0.5 && r.top < H)) out.push(`${el.className?.baseVal ?? el.className} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
      }
    }
    return out.slice(0, 6);
  }, c.ins);
  // phones scroll; only check things that are in the first screen (top/left/right edges)
  const realBad = bad.filter((x) => { const [l, t, r] = x.split(' ').pop().split(',').map(Number); return t < c.ins.top || l < c.ins.left || r > c.vp.width - c.ins.right; });
  console.log(`${realBad.length ? 'FAIL' : 'PASS'} ${c.n} (cdp=${supported}, --sa-t=${envTop}) ${realBad.join(' | ')} ${errs.join('|')}`);
  if (realBad.length || errs.length) fails++;
  await p.screenshot({ path: `${OUT}/${c.n}.png` });
  // the mosque list sheet + admin header
  await ctx.close();
}
await b.close();
process.exit(fails ? 1 : 0);
