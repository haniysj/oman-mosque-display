// Cloud sync end-to-end with an in-memory fake of the Supabase RPC API (route interception).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = process.env.OUT || 'shots';
const results = [];
const ok = (n, c, x = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };

// ---- fake backend (mirrors supabase/mosque-cloud.sql semantics)
const db = { pw: null, mosques: new Map(), tables: new Map() };
const calls = [];
function handle(fn, a) {
  calls.push(fn);
  const auth = () => { if (!db.pw) throw 'ADMIN_NOT_INITIALIZED'; if (a.p_password !== db.pw) throw 'BAD_PASSWORD'; };
  switch (fn) {
    case 'mosque_admin_status': return { initialized: !!db.pw };
    case 'mosque_admin_init': if (db.pw) throw 'ALREADY_INITIALIZED'; db.pw = a.p_password; return true;
    case 'mosque_admin_login': auth(); return true;
    case 'mosque_list': return [...db.mosques.values()].map((m) => ({ code: m.code, name_ar: m.name_ar, governorate_id: m.governorate_id, wilayat_id: m.wilayat_id, version: m.version, updated_at: new Date().toISOString(), timetable_version: db.tables.get(m.wilayat_id)?.version ?? null, timetable_days: Object.keys(db.tables.get(m.wilayat_id)?.schedule.days ?? {}).length }));
    case 'mosque_timetables_summary': return [...db.tables.values()].map((t) => ({ wilayat_id: t.wilayat_id, governorate_id: t.governorate_id, version: t.version, updated_at: new Date().toISOString(), days: Object.keys(t.schedule.days).length, calibrated: !!t.calibration, mosques: [...db.mosques.values()].filter((m) => m.wilayat_id === t.wilayat_id).length }));
    case 'mosque_versions': { const m = db.mosques.get(a.p_code); if (!m) return null; return { mosque_version: m.version, wilayat_id: m.wilayat_id, timetable_version: db.tables.get(m.wilayat_id)?.version ?? null }; }
    case 'mosque_bundle': { const m = db.mosques.get(a.p_code); if (!m) return null; const t = db.tables.get(m.wilayat_id); return { mosque: { ...m }, timetable: t ? { ...t } : null }; }
    case 'mosque_admin_upsert_mosque': { auth(); const prev = db.mosques.get(a.p_code); const m = { code: a.p_code, name_ar: a.p_name_ar, governorate_id: a.p_governorate_id, wilayat_id: a.p_wilayat_id, config: a.p_config ?? prev?.config, adhkar: a.p_adhkar ?? prev?.adhkar, version: (prev?.version ?? 0) + 1 }; db.mosques.set(a.p_code, m); return { version: m.version }; }
    case 'mosque_admin_upsert_timetable': { auth(); const prev = db.tables.get(a.p_wilayat_id); const t = { wilayat_id: a.p_wilayat_id, governorate_id: a.p_governorate_id, schedule: a.p_schedule, calibration: a.p_calibration, version: (prev?.version ?? 0) + 1 }; db.tables.set(a.p_wilayat_id, t); return { version: t.version }; }
    case 'mosque_admin_delete_mosque': auth(); return db.mosques.delete(a.p_code);
    case 'mosque_timetable_get': { const t = db.tables.get(a.p_wilayat_id); return t ? { ...t, updated_at: new Date().toISOString() } : null; }
    case 'mosque_admin_delete_timetable': auth(); return db.tables.delete(a.p_wilayat_id);
    default: throw `unknown ${fn}`;
  }
}
async function wire(ctx) {
  await ctx.route(/supabase\.co\/rest\/v1\/rpc\//, async (route) => {
    const fn = route.request().url().split('/rpc/')[1];
    try { const body = handle(fn, JSON.parse(route.request().postData() || '{}')); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); }
    catch (e) { await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: String(e) }) }); }
  });
}

const b = await chromium.launch();
const at = new Date('2026-10-10T15:20:00+04:00');

// 1) Laptop: create admin password, add mosque + bind, import official timetable, change iqamah
const lap = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
await wire(lap);
const p = await lap.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.clock.install({ time: at });
await p.goto(BASE + '/#/admin'); await p.clock.runFor(800);
// The settings are locked behind the administrator password (first use: create it)
ok('settings hidden before sign-in', (await p.getByRole('dialog', { name: 'دخول المشرف' }).count()) === 1 && (await p.getByText('المساجد والمزامنة').count()) === 0);
await p.getByPlaceholder('كلمة المرور (6 أحرف على الأقل)').fill('secret123');
await p.getByPlaceholder('تأكيد كلمة المرور').fill('secret123');
await p.getByRole('button', { name: 'إنشاء والدخول' }).click(); await p.clock.runFor(1200);
ok('admin password created', db.pw === 'secret123');
ok('settings open after sign-in', (await p.getByText('المساجد والمزامنة').count()) > 0);
// reload → locked again; wrong password refused; right password opens
await p.reload(); await p.clock.runFor(1200);
ok('reload → locked again', (await p.getByRole('dialog', { name: 'دخول المشرف' }).count()) === 1);
await p.getByPlaceholder('كلمة مرور المشرف').fill('wrong-pass'); await p.getByRole('button', { name: 'دخول', exact: true }).click(); await p.clock.runFor(800);
ok('wrong password refused', (await p.getByText('كلمة المرور غير صحيحة').count()) === 1 && (await p.getByText('المساجد والمزامنة').count()) === 0);
await p.getByPlaceholder('كلمة مرور المشرف').fill('secret123'); await p.getByRole('button', { name: 'دخول', exact: true }).click(); await p.clock.runFor(1200);
ok('right password opens settings', (await p.getByText('المساجد والمزامنة').count()) > 0);
// offline sign-in uses the verifier saved on this device (no password stored)
const stored = await p.evaluate(() => JSON.stringify(localStorage));
ok('password itself is not stored on the device', !stored.includes('secret123'));
{ // offline: sign in with the on-device verifier
  const off = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await wire(off);
  const q = await off.newPage();
  await q.goto(BASE + '/#/admin'); await q.waitForTimeout(800);
  await q.getByPlaceholder('كلمة مرور المشرف').fill('secret123'); await q.getByRole('button', { name: 'دخول', exact: true }).click(); await q.waitForTimeout(1500);
  await q.evaluate(async () => { await navigator.serviceWorker.ready; });
  await q.reload(); await q.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await off.setOffline(true); await q.reload(); await q.waitForTimeout(1500);
  await q.getByPlaceholder('كلمة مرور المشرف').fill('nope-nope'); await q.getByRole('button', { name: 'دخول', exact: true }).click(); await q.waitForTimeout(500);
  const refused = (await q.getByText('كلمة المرور غير صحيحة').count()) === 1;
  await q.getByPlaceholder('كلمة مرور المشرف').fill('secret123'); await q.getByRole('button', { name: 'دخول', exact: true }).click(); await q.waitForTimeout(800);
  ok('offline sign-in: wrong refused, right opens (on-device check)', refused && (await q.getByText('المساجد والمزامنة').count()) > 0);
  await off.close();
}
await p.getByPlaceholder('جامع النور').fill('جامع السلطان قابوس');
await p.getByPlaceholder('noor-bawshar').fill('sq-muscat');
const addCard = p.getByText('إضافة مسجد').locator('xpath=ancestor::section[1]');
await addCard.locator('select').nth(1).selectOption('muscat');
await addCard.getByText('ربط هذا الجهاز بالمسجد الجديد').click();
await p.getByRole('button', { name: 'إضافة المسجد' }).click(); await p.clock.runFor(1500);
ok('mosque created in cloud', db.mosques.has('sq-muscat') && db.mosques.get('sq-muscat').wilayat_id === 'muscat');
ok('laptop bound to mosque', (await p.evaluate(() => localStorage.getItem('omd-cloud-binding')))?.includes('sq-muscat'));
// Timetable page: create Muscat wilayat table, add the Ministry month, calibrate & complete the year
await p.getByRole('button', { name: 'جدول المواقيت' }).first().click(); await p.clock.runFor(1200);
ok('timetable page is simple: no old location/active/calc cards', (await p.getByText('الجدول النشط').count()) === 0 && (await p.getByText('جدول محسوب دون معايرة').count()) === 0);
await p.getByRole('button', { name: 'جدول ولاية جديد' }).click();
const addBox = p.getByRole('button', { name: /إنشاء الجدول|فتح الجدول الموجود/ }).locator('xpath=ancestor::div[2]');
await addBox.locator('select').nth(1).selectOption('muscat');
await p.getByRole('button', { name: 'إنشاء الجدول' }).click(); await p.clock.runFor(1200);
ok('editor opens for Muscat wilayat', (await p.getByText('جدول ولاية مسقط').count()) > 0);
await p.locator('input[type=file][accept*=csv]').setInputFiles(new URL('../research/mara-muscat-2026-10.csv', import.meta.url).pathname);
await p.clock.runFor(300);
await p.getByRole('button', { name: 'إضافة إلى جدول مسقط' }).click(); await p.clock.runFor(1500);
ok('timetable uploaded for wilayat', db.tables.get('muscat')?.schedule?.days?.['2026-10-10']?.fajr === '04:47');
// the same Ministry month added again as next year's times (year chosen at upload)
await p.locator('input[type=file][accept*=csv]').setInputFiles(new URL('../research/mara-muscat-2026-10.csv', import.meta.url).pathname);
await p.clock.runFor(300);
await p.getByText('سنة المواقيت:').locator('xpath=..').locator('select').selectOption('2027'); await p.clock.runFor(300);
await p.getByRole('button', { name: 'إضافة إلى جدول مسقط' }).click(); await p.clock.runFor(1500);
ok('upload for another year (2027) kept 2026 too', db.tables.get('muscat')?.schedule?.days?.['2027-10-10']?.fajr === '04:47' && !!db.tables.get('muscat')?.schedule?.days?.['2026-10-10']);
await p.getByRole('button', { name: /معايرة وإكمال سنة 2026/ }).click(); await p.clock.runFor(4000);
const mt = db.tables.get('muscat');
ok('calibrated & completed the whole year in the cloud', Object.keys(mt.schedule.days).filter((d) => d.startsWith('2026')).length === 365 && !!mt.calibration && mt.schedule.days['2026-10-10'].source === 'official', `${Object.keys(mt.schedule.days).length} days`);
const muscatDays = Object.keys(mt.schedule.days).length;
await p.screenshot({ path: `${OUT}/timetable-editor.png`, fullPage: true });
// Second, independent wilayat: Samail — uses Muscat's calibration (no official days yet)
await p.getByRole('button', { name: '→ كل الجداول' }).click(); await p.clock.runFor(1200);
await p.getByRole('button', { name: 'جدول ولاية جديد' }).click();
const addBox2 = p.getByRole('button', { name: /إنشاء الجدول|فتح الجدول الموجود/ }).locator('xpath=ancestor::div[2]');
await addBox2.locator('select').nth(0).selectOption('dakhiliyah');
await addBox2.locator('select').nth(1).selectOption('samail');
await p.getByRole('button', { name: 'إنشاء الجدول' }).click(); await p.clock.runFor(1500);
const otherSel = p.getByText('أو احسب سمائل بمعايرة جدول ولاية أخرى').locator('xpath=..').locator('select');
await otherSel.selectOption('muscat'); await p.getByRole('button', { name: 'استخدام' }).click(); await p.clock.runFor(4000);
const st = db.tables.get('samail');
ok('Samail stored as its own table (365 days)', st && Object.keys(st.schedule.days).length === 365 && st.schedule.days['2026-10-10'].fajr !== db.tables.get('muscat').schedule.days['2026-10-10'].fajr, st ? `samail fajr ${st.schedule.days['2026-10-10'].fajr} vs muscat ${db.tables.get('muscat').schedule.days['2026-10-10'].fajr}` : 'missing');
ok('Muscat table untouched', Object.keys(db.tables.get('muscat').schedule.days).length === muscatDays && db.tables.get('muscat').version === mt.version);
// edit one day in Samail
await p.getByRole('button', { name: 'تعديل 2026-10-12' }).click(); await p.clock.runFor(200);
const dlgDay = p.getByRole('dialog', { name: 'تعديل مواقيت يوم' });
await dlgDay.locator('input[type=time]').first().fill('04:50');
await dlgDay.getByRole('button', { name: 'حفظ التعديل' }).click(); await p.clock.runFor(1500);
ok('edit a day of the Samail table', db.tables.get('samail').schedule.days['2026-10-12'].fajr === '04:50' && db.tables.get('samail').schedule.days['2026-10-12'].source === 'admin');
await p.getByRole('button', { name: '→ كل الجداول' }).click(); await p.clock.runFor(1200);
const homeText = await p.locator('main, body').first().textContent();
ok('home lists both wilayat tables', homeText.includes('مسقط') && homeText.includes('سمائل'));
await p.screenshot({ path: `${OUT}/timetable-home.png` });
// change Asr iqamah delay to 15
await p.getByRole('button', { name: 'الإقامة' }).first().click(); await p.clock.runFor(300);
const asrRow = p.locator('div.grid', { has: p.getByText('العصر', { exact: true }) }).first();
const inp = asrRow.locator('input[inputmode=numeric]').first(); await inp.fill('15'); await inp.press('Enter');
await p.clock.runFor(2500);
ok('iqamah change uploaded', db.mosques.get('sq-muscat')?.config?.iqamah?.rules?.asr?.delay === 15, JSON.stringify(db.mosques.get('sq-muscat')?.config?.iqamah?.rules?.asr));
ok('laptop: no JS errors', errs.length === 0, errs.join('|'));

// 2) TV / phone: open /m/sq-muscat → gets the same timetable and settings
const tv = await b.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: 'Mozilla/5.0 (Linux; Android 11; BRAVIA 4K) Chrome/120' });
await wire(tv);
const t = await tv.newPage(); await t.clock.setFixedTime(at); const terrs = []; t.on('pageerror', (e) => terrs.push(e.message));
await t.goto(BASE + '/m/sq-muscat'); await t.waitForTimeout(2500);
ok('TV shows mosque name from cloud', (await t.locator('.tv-name').textContent())?.includes('جامع السلطان قابوس'));
const rows = await t.locator('.panel').first().textContent();
ok('TV shows official Fajr of the wilayat', rows.includes('4:') , rows.slice(0, 80));
await t.screenshot({ path: `${OUT}/cloud-tv.png` });
// offline restart keeps bound data
await t.evaluate(async () => { await navigator.serviceWorker.ready; });
await t.reload(); await t.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
await tv.setOffline(true); await t.reload(); await t.waitForTimeout(1500);
ok('TV offline: still bound & shows timetable', (await t.locator('.panel .row').count()) === 12 && (await t.locator('.tv-name').textContent())?.includes('جامع السلطان قابوس'));
await tv.setOffline(false);
// 3) Admin edits again → TV picks it up on next sync
db.mosques.get('sq-muscat').config.mosque.nameAr = 'تجربة'; // name comes from record, so change the record name
db.mosques.get('sq-muscat').name_ar = 'جامع السلطان قابوس الأكبر'; db.mosques.get('sq-muscat').version++;
await t.evaluate(() => window.dispatchEvent(new Event('online'))); await t.waitForTimeout(2500);
ok('TV auto-updates from cloud', (await t.locator('.tv-name').textContent())?.includes('الأكبر'));
ok('TV: no JS errors', terrs.length === 0, terrs.join('|'));
// 4) Second mosque in the same wilayat gets the same timetable
handle('mosque_admin_upsert_mosque', { p_password: 'secret123', p_code: 'noor-muttrah', p_name_ar: 'مسجد النور', p_governorate_id: 'muscat', p_wilayat_id: 'muscat', p_config: db.mosques.get('sq-muscat').config, p_adhkar: [] });
const t2 = await tv.newPage(); await t2.clock.setFixedTime(at); await t2.goto(BASE + '/m/noor-muttrah'); await t2.waitForTimeout(2500);
const fajr2 = await t2.locator('.panel .row').first().textContent();
ok('same wilayat → same timetable', fajr2.includes('4:') && (await t2.locator('.tv-name').textContent()).includes('مسجد النور'), fajr2);


// 6b) Main page: choosing a mosque in another wilayat switches the timetable to that wilayat
handle('mosque_admin_upsert_mosque', { p_password: 'secret123', p_code: 'samail-jami', p_name_ar: 'جامع سمائل', p_governorate_id: 'dakhiliyah', p_wilayat_id: 'samail', p_config: db.mosques.get('sq-muscat').config, p_adhkar: [] });
const tvToday = await t.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date()));
const fmt12 = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`; };
const fajrMus = db.tables.get('muscat').schedule.days[tvToday]?.fajr, fajrSam = db.tables.get('samail').schedule.days[tvToday]?.fajr;
await t.bringToFront(); await t.reload(); await t.waitForTimeout(2000);
const before = await t.locator('.panel .row').first().textContent();
await t.locator('.name-tap').first().dblclick(); await t.waitForTimeout(1500);
await t.locator('.mp-item', { hasText: 'جامع سمائل' }).click(); await t.waitForTimeout(3000);
const after = await t.locator('.panel .row').first().textContent();
ok('TV before: Muscat fajr', !!fajrMus && before.includes(fmt12(fajrMus)), `${before} / ${fajrMus}`);
ok('choose Samail mosque → TV shows Samail timetable', !!fajrSam && after.includes(fmt12(fajrSam)) && (await t.locator('.tv-name').textContent()).includes('جامع سمائل'), `${after} / ${fajrSam}`);
// a mosque in a wilayat without a timetable → no stale times from another wilayat
handle('mosque_admin_upsert_mosque', { p_password: 'secret123', p_code: 'nizwa-jami', p_name_ar: 'جامع نزوى', p_governorate_id: 'dakhiliyah', p_wilayat_id: 'nizwa', p_config: db.mosques.get('sq-muscat').config, p_adhkar: [] });
await t.locator('.name-tap').first().dblclick(); await t.waitForTimeout(1500);
await t.locator('.mp-item', { hasText: 'جامع نزوى' }).click(); await t.waitForTimeout(3000);
ok('wilayat without a timetable → old times cleared', (await t.locator('.panel .row').count()) === 0, String(await t.locator('.panel .row').count()));
await p.bringToFront();

// Installed phone app opened for the first time (empty storage, e.g. iPhone home-screen app): mosque list opens itself
{
  const { devices } = await import('playwright');
  const ph = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  await wire(ph);
  const q = await ph.newPage(); const qerrs = []; q.on('pageerror', (e) => qerrs.push(e.message));
  await q.clock.setFixedTime(at);
  await q.goto(BASE + '/'); await q.waitForTimeout(2500);
  ok('phone first run: mosque list opens automatically', (await q.locator('.mp-sheet').count()) === 1);
  await q.locator('.mp-item', { hasText: 'جامع سمائل' }).click(); await q.waitForTimeout(3000);
  ok('phone first run: choosing a mosque shows its times and keeps /m/<code> for «Add to Home Screen»', (await q.locator('.m-table tbody tr').count()) === 6 && new URL(q.url()).pathname === '/m/samail-jami', q.url());
  ok('phone first run: no JS errors', qerrs.length === 0, qerrs.join('|'));
  await ph.close();
}

// 5) Admin tabs: no separate «المسجد» tab; edit a mosque from the list (name + wilayat)
ok('no «المسجد» admin tab', (await p.getByRole('button', { name: 'المسجد', exact: true }).count()) === 0);
await p.getByRole('button', { name: 'المساجد والمزامنة' }).first().click(); await p.clock.runFor(1500);
await p.getByRole('button', { name: 'تعديل مسجد النور' }).click(); await p.clock.runFor(1500);
const dlg = p.getByRole('dialog', { name: 'تعديل بيانات المسجد' });
ok('edit dialog opens with current name', (await dlg.locator('input').first().inputValue()) === 'مسجد النور');
await dlg.locator('input').first().fill('مسجد النور الكبير');
await dlg.locator('select').nth(1).selectOption('seeb'); await p.clock.runFor(200);
ok('dialog warns: wilayat has no stored timetable', (await dlg.textContent()).includes('لا يوجد جدول مخزن لولاية'));
await dlg.locator('select').nth(1).selectOption('muscat'); await p.clock.runFor(200);
ok('dialog confirms auto-link to stored timetable', (await dlg.textContent()).includes('يرتبط المسجد تلقائياً بجدول ولاية'));
await p.screenshot({ path: `${OUT}/mosque-edit-dialog.png` });
await dlg.getByRole('button', { name: 'حفظ' }).click(); await p.clock.runFor(1500);
ok('mosque edited in cloud', db.mosques.get('noor-muttrah')?.name_ar === 'مسجد النور الكبير' && db.mosques.get('noor-muttrah')?.version === 2, JSON.stringify(db.mosques.get('noor-muttrah')?.name_ar));
// 6) Timetable home lists tables with their mosques
await p.getByRole('button', { name: 'جدول المواقيت' }).first().click(); await p.clock.runFor(1500);
const wtText = await p.getByText('جداول الولايات', { exact: true }).locator('xpath=ancestor::section[1]').textContent();
ok('stored timetables list wilayat + mosques', wtText.includes('مسقط') && wtText.includes('مسجد النور الكبير') && wtText.includes('يوماً'), wtText.slice(0, 160));
// 6c) Iqamah page: pick a mosque at the top — edits go to THAT mosque only
{
  await p.getByRole('button', { name: 'الإقامة' }).first().click(); await p.clock.runFor(1500);
  const sel = p.locator('select').first();
  const optTexts = await sel.locator('option').allTextContents();
  ok('iqamah page: mosque selector lists the mosques', optTexts.some((x) => x.includes('مسجد النور الكبير')) && optTexts.some((x) => x.includes('(هذه الشاشة)')), optTexts.join(' | '));
  const muscatBefore = JSON.stringify(db.mosques.get('sq-muscat').config.iqamah);
  const localAsrBefore = await p.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('oman-mosque-display', 1); r.onsuccess = () => res(r.result); });
    return new Promise((res) => { const g = db.transaction('kv').objectStore('kv').get('config'); g.onsuccess = () => res(g.result.iqamah.rules.asr.delay); });
  });
  await sel.selectOption('noor-muttrah'); await p.clock.runFor(1500);
  ok('iqamah page: other mosque loaded (not this screen)', (await p.getByText('ليس مسجد هذه الشاشة').count()) === 1);
  const asrRow2 = p.locator('div.grid', { has: p.getByText('العصر', { exact: true }) }).first();
  const inp2 = asrRow2.locator('input[inputmode=numeric]').first(); await inp2.fill('25'); await inp2.press('Enter'); await p.clock.runFor(300);
  // freeze Fajr at 05:10 for this mosque only
  const fajrRow = p.locator('div.grid', { has: p.getByText('الفجر', { exact: true }) }).first();
  await fajrRow.locator('input[type=checkbox]').check(); await p.clock.runFor(200);
  await fajrRow.locator('input[type=time]').fill('05:10'); await p.clock.runFor(300);
  ok('not saved before pressing «حفظ»', db.mosques.get('noor-muttrah').config.iqamah.rules.asr.delay !== 25);
  await p.getByRole('button', { name: /^حفظ إقامة/ }).click(); await p.clock.runFor(2000);
  const noor = db.mosques.get('noor-muttrah').config.iqamah;
  ok('saved to the chosen mosque (asr 25 + Fajr frozen 05:10)', noor.rules.asr.delay === 25 && noor.locks?.fajr?.enabled === true && noor.locks.fajr.time === '05:10', JSON.stringify({ asr: noor.rules.asr, lock: noor.locks?.fajr }));
  ok('other mosque untouched in the cloud', JSON.stringify(db.mosques.get('sq-muscat').config.iqamah) === muscatBefore);
  const localAsrAfter = await p.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('oman-mosque-display', 1); r.onsuccess = () => res(r.result); });
    return new Promise((res) => { const g = db.transaction('kv').objectStore('kv').get('config'); g.onsuccess = () => res(g.result); });
  });
  ok("this screen's own iqamah untouched", localAsrAfter.iqamah.rules.asr.delay === localAsrBefore && !localAsrAfter.iqamah.locks?.fajr?.enabled);
  await p.screenshot({ path: `${OUT}/iqamah-per-mosque.png`, fullPage: false });
  // the TV of «مسجد النور» picks up its own iqamah; the Muscat TV keeps its own
  await t2.bringToFront(); await t2.reload(); await t2.waitForTimeout(2500);
  const iq2 = await t2.locator('.panel').nth(1).textContent();
  ok('mosque TV shows its frozen Fajr iqamah (5:10)', iq2.includes('5:10'), iq2.slice(0, 120));
  await p.bringToFront();
  // back to this screen's mosque: shows its own values
  await sel.selectOption('sq-muscat'); await p.clock.runFor(800);
  const back = await p.locator('div.grid', { has: p.getByText('العصر', { exact: true }) }).first().locator('input[inputmode=numeric]').first().inputValue();
  ok("switching back shows this mosque's own values", back === String(localAsrBefore), back);
}
ok('laptop: still no JS errors', errs.length === 0, errs.join('|'));

// 7) Import a timetable from an image (real OCR, no fake clock)
const ocx = await b.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
await wire(ocx);
const o = await ocx.newPage(); const oerrs = []; o.on('pageerror', (e) => oerrs.push(e.message));
await o.goto(BASE + '/#/admin'); await o.waitForTimeout(800);
await o.getByPlaceholder('كلمة مرور المشرف').fill('secret123'); await o.getByRole('button', { name: 'دخول', exact: true }).click(); await o.waitForTimeout(1200);
await o.getByRole('button', { name: 'جدول المواقيت' }).first().click(); await o.waitForTimeout(300);
await o.getByRole('button', { name: 'فتح جدول الجهاز' }).click(); await o.waitForTimeout(300);
const t0 = Date.now();
await o.locator('input[type=file][accept*=image]').setInputFiles(new URL('./ocr-fixtures/mara-latin.png', import.meta.url).pathname);
await o.getByText('قراءة الصورة', { exact: true }).waitFor({ timeout: 180000 });
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const grid = await o.locator('input[aria-label^="الفجر"]').count();
const truth = readFileSync(new URL('../research/mara-muscat-2026-10.csv', import.meta.url), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
let exact = 0;
for (let i = 0; i < truth.length; i++) {
  const vals = await Promise.all(['الفجر', 'الشروق', 'الظهر', 'العصر', 'المغرب', 'العشاء'].map((n) => o.locator(`input[aria-label="${n} ${truth[i][0]}"]`).inputValue().catch(() => '')));
  if (vals.join() === truth[i].slice(1).join()) exact++;
}
ok(`OCR read ${grid} rows in ${secs}s`, grid === 31);
ok('OCR values match the source table', exact === 31, `${exact}/31 rows exact`);
await o.screenshot({ path: `${OUT}/image-import-review.png`, fullPage: false });
await o.getByRole('button', { name: 'متابعة إلى فحص الاستيراد' }).click(); await o.waitForTimeout(300);
const prev = await o.getByText('صورة: mara-latin.png').locator('xpath=ancestor::div[2]').textContent();
ok('image rows pass the regular import validation', prev.includes('صالح') && prev.includes('31 يوماً'), prev.slice(0, 120));
await o.getByRole('button', { name: /^إضافة إلى جدول/ }).click(); await o.waitForTimeout(1200);
const saved = await o.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('oman-mosque-display', 1); q.onsuccess = () => r(q.result); }); return new Promise((r) => { const g = db.transaction('kv').objectStore('kv').get('schedule'); g.onsuccess = () => r(g.result?.days?.['2026-10-01']); }); });
ok('imported from image: 1 Oct asr = 15:26 (12h converted)', saved?.asr === '15:26' && saved?.fajr === '04:43', JSON.stringify(saved));
ok('image import: no JS errors', oerrs.length === 0, oerrs.join('|'));

await b.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} cloud checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
