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

// Offline from the real cloud: no mosque exists, so the display keeps the demo data (no auto-linking).
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.route(/supabase\.co\/rest\/v1\/rpc\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: /mosque_list|mosque_timetables_summary/.test(r.request().url()) ? '[]' : 'null' })); return c; }; }
for (const strip of [false, true]) {
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.2 Chrome/63.0.3239.84 TV Safari/537.36' });
  if (strip) await ctx.addInitScript(() => {
    for (const [o, k] of [[Array.prototype, 'flatMap'], [Array.prototype, 'flat'], [Object, 'fromEntries'], [String.prototype, 'replaceAll'], [String.prototype, 'matchAll'],
      [Array.prototype, 'at'], [String.prototype, 'at'], [window, 'structuredClone'], [Promise, 'allSettled'], [Array.prototype, 'findLast'], [Object, 'hasOwn'], [window, 'AbortController'], [window, 'AbortSignal']]) {
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
// Fresh old TV (no data, no AbortController): links itself to the default mosque and shows its times;
// the settings open the administrator sign-in without errors.
{
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.1 Chrome/56.0.2924.0 TV Safari/537.36' });
  await ctx.addInitScript(() => { for (const k of ['AbortController', 'AbortSignal', 'structuredClone']) { try { delete window[k]; } catch { /* ignore */ } } });
  await ctx.route(/supabase\.co\/rest\/v1\/rpc\//, (r) => {
    const fn = r.request().url().split('/rpc/')[1];
    const m = { code: 'taqwa', name_ar: 'مسجد التقوى', governorate_id: 'dakhiliyah', wilayat_id: 'samail' };
    const body = {
      mosque_default_get: m,
      mosque_list: [{ ...m, version: 1, updated_at: '', timetable_version: 1, timetable_days: 365 }],
      mosque_versions: { mosque_version: 1, timetable_version: 1, wilayat_id: 'samail' },
      mosque_bundle: { mosque: { ...m, config: backup.config, adhkar: backup.adhkar, version: 1 }, timetable: { wilayat_id: 'samail', schedule: backup.schedule, calibration: null, version: 1 } },
      mosque_admin_status: { initialized: true },
    }[fn] ?? null;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-10-10T15:20:00+04:00') });
  await p.goto(BASE + '/'); await p.clock.runFor(4000); await p.waitForTimeout(800);
  ok('fresh old TV: linked to the default mosque', (await p.locator('.tv-name').textContent())?.includes('مسجد التقوى'));
  ok('fresh old TV: prayer times shown', (await p.locator('.panel .row').count()) === 12);
  await p.mouse.click(960, 540); await p.mouse.click(960, 540); await p.clock.runFor(300);
  await p.getByRole('button', { name: 'الإعدادات' }).click(); await p.clock.runFor(1500); await p.waitForTimeout(500);
  const body = await p.locator('body').textContent();
  ok('fresh old TV: settings open the admin sign-in (no AbortController error)', !body.includes('AbortController') && (await p.getByPlaceholder('كلمة مرور المشرف').count()) === 1, body.slice(0, 120));
  ok('fresh old TV: no JS errors', errs.length === 0, errs.join(' | '));
  await p.screenshot({ path: `${OUT}/old-tv-default.png` });
  await ctx.close();
}
await b.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} TV checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
