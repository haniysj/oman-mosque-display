// Cloud sync end-to-end with an in-memory fake of the Supabase RPC API (route interception).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = process.env.OUT || 'shots';
const results = [];
const ok = (n, c, x = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };

// ---- fake backend (mirrors supabase/mosque-cloud.sql semantics)
const db = { pw: null, mosques: new Map(), tables: new Map(), def: null, mpw: new Map() };
const calls = [];
function handle(fn, a) {
  calls.push(fn);
  const auth = () => { if (!db.pw) throw 'ADMIN_NOT_INITIALIZED'; if (a.p_password !== db.pw) throw 'BAD_PASSWORD'; };
  switch (fn) {
    case 'mosque_admin_status': return { initialized: !!db.pw };
    case 'mosque_admin_init': if (db.pw) throw 'ALREADY_INITIALIZED'; db.pw = a.p_password; return true;
    case 'mosque_admin_login': auth(); return true;
    case 'mosque_auth': { if (db.pw && a.p_password === db.pw) return { role: 'super' }; const codes = [...db.mpw].filter(([, v]) => v === a.p_password).map(([k]) => k).sort(); if (!codes.length) throw 'BAD_PASSWORD'; return { role: 'mosque', codes }; }
    case 'mosque_manager_update': { if (!(a.p_password === db.pw || db.mpw.get(a.p_code) === a.p_password)) throw 'BAD_PASSWORD'; const m = db.mosques.get(a.p_code); if (!m) throw 'mosque_not_found'; if (a.p_config) m.config = a.p_config; if (a.p_adhkar) m.adhkar = a.p_adhkar; m.version++; return { version: m.version }; }
    case 'mosque_admin_set_mosque_password': auth(); if (!a.p_new) db.mpw.delete(a.p_code); else { if (a.p_new.length < 4) throw 'PASSWORD_TOO_SHORT'; db.mpw.set(a.p_code, a.p_new); } return true;
    case 'mosque_admin_mosque_passwords': auth(); return [...db.mpw.keys()].map((code) => ({ code, updated_at: '' }));
    case 'mosque_admin_change_password': if (a.p_old !== db.pw) throw 'BAD_PASSWORD'; if (!a.p_new || a.p_new.length < 6) throw 'PASSWORD_TOO_SHORT'; db.pw = a.p_new; return true;
    case 'mosque_default_get': { const m = db.def && db.mosques.get(db.def); return m ? { code: m.code, name_ar: m.name_ar, governorate_id: m.governorate_id, wilayat_id: m.wilayat_id } : null; }
    case 'mosque_admin_set_default': auth(); if (a.p_code && !db.mosques.has(a.p_code)) throw 'mosque_not_found'; db.def = a.p_code || null; return true;
    case 'mosque_list': return [...db.mosques.values()].sort((x, y) => (x.governorate_id + x.wilayat_id + x.name_ar).localeCompare(y.governorate_id + y.wilayat_id + y.name_ar)).map((m) => ({ code: m.code, name_ar: m.name_ar, governorate_id: m.governorate_id, wilayat_id: m.wilayat_id, version: m.version, updated_at: new Date().toISOString(), timetable_version: db.tables.get(m.wilayat_id)?.version ?? null, timetable_days: Object.keys(db.tables.get(m.wilayat_id)?.schedule.days ?? {}).length }));
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
await p.getByPlaceholder('كلمة المرور', { exact: true }).fill('wrong-pass'); await p.getByRole('button', { name: 'دخول', exact: true }).click(); await p.clock.runFor(800);
ok('wrong password refused', (await p.getByText('كلمة المرور غير صحيحة').count()) === 1 && (await p.getByText('المساجد والمزامنة').count()) === 0);
await p.getByPlaceholder('كلمة المرور', { exact: true }).fill('secret123'); await p.getByRole('button', { name: 'دخول', exact: true }).click(); await p.clock.runFor(1200);
ok('right password opens settings', (await p.getByText('المساجد والمزامنة').count()) > 0);
// offline sign-in uses the verifier saved on this device (no password stored)
const stored = await p.evaluate(() => JSON.stringify(localStorage));
ok('password itself is not stored on the device', !stored.includes('secret123'));
{ // offline: sign in with the on-device verifier
  const off = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await wire(off);
  const q = await off.newPage();
  await q.goto(BASE + '/#/admin'); await q.waitForTimeout(800);
  await q.getByPlaceholder('كلمة المرور', { exact: true }).fill('secret123'); await q.getByRole('button', { name: 'دخول', exact: true }).click(); await q.waitForTimeout(1500);
  await q.evaluate(async () => { await navigator.serviceWorker.ready; });
  await q.reload(); await q.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await off.setOffline(true); await q.reload(); await q.waitForTimeout(1500);
  await q.getByPlaceholder('كلمة المرور', { exact: true }).fill('nope-nope'); await q.getByRole('button', { name: 'دخول', exact: true }).click(); await q.waitForTimeout(500);
  const refused = (await q.getByText('كلمة المرور غير صحيحة').count()) === 1;
  await q.getByPlaceholder('كلمة المرور', { exact: true }).fill('secret123'); await q.getByRole('button', { name: 'دخول', exact: true }).click(); await q.waitForTimeout(800);
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
// stored years: what is official (Ministry file), what is calibrated, what is empty — and generate a later year
{
  const y26 = await p.getByTestId('year-2026').textContent(), y27 = await p.getByTestId('year-2027').textContent();
  ok('years: 2026 = official October + rest calibrated', y26.includes('رسمي جزئياً') && y26.includes('أكتوبر') && y26.includes('رسمي 31'), y26.slice(0, 200));
  ok('years: 2027 = official October only, rest empty', y27.includes('رسمي جزئياً') && y27.includes('فارغ 334'), y27.slice(0, 200));
  await p.getByTestId('years-coverage').screenshot({ path: `${OUT}/timetable-years.png` });
  await p.getByRole('button', { name: 'توليد 2027 بالمعايرة' }).click(); await p.clock.runFor(4000);
  const t = db.tables.get('muscat');
  const d27 = Object.keys(t.schedule.days).filter((d) => d.startsWith('2027'));
  ok('years: 2027 generated by calibration (365 days), official days kept', d27.length === 365 && t.schedule.days['2027-10-10'].source === 'official' && t.schedule.days['2027-10-10'].fajr === '04:47' && t.schedule.days['2027-03-01'].source === 'calibrated' && Object.keys(t.schedule.days).filter((d) => d.startsWith('2026')).length === 365, `${d27.length}`);
  ok('years: 2027 now shows no empty days', !(await p.getByTestId('year-2027').textContent()).includes('فارغ '));
  await p.getByRole('button', { name: 'إضافة سنة تالية' }).click(); await p.clock.runFor(200);
  ok('years: «add next year» shows 2028 as empty', (await p.getByTestId('year-2028').textContent()).includes('فارغة'));
}
const mt2 = db.tables.get('muscat');
const muscatDays = Object.keys(mt2.schedule.days).length;
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
ok('Muscat table untouched', Object.keys(db.tables.get('muscat').schedule.days).length === muscatDays && db.tables.get('muscat').version === mt2.version);
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
await p.getByTestId('enter-sq-muscat').click(); await p.clock.runFor(300);
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

// Default mosque: the admin stars «جامع سمائل»; any NEW device (no sign-in, no settings) links itself to it
await p.getByRole('button', { name: 'المساجد والمزامنة' }).first().click(); await p.clock.runFor(1500);
ok('mosques page shows the default-mosque note', (await p.getByTestId('default-mosque-note').textContent()).includes('غير محدد'));
await p.getByRole('button', { name: 'جعل جامع سمائل المسجد الافتراضي' }).click(); await p.clock.runFor(300);
await p.getByRole('button', { name: 'تأكيد' }).click(); await p.clock.runFor(1500);
ok('default mosque saved in the cloud', db.def === 'samail-jami');
ok('mosques page marks the default', (await p.getByTestId('default-mosque-note').textContent()).includes('جامع سمائل'));
await p.screenshot({ path: `${OUT}/default-mosque.png` });
{
  const { devices } = await import('playwright');
  const ph = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  await wire(ph);
  const q = await ph.newPage(); const qerrs = []; q.on('pageerror', (e) => qerrs.push(e.message));
  await q.clock.setFixedTime(at);
  await q.goto(BASE + '/'); await q.waitForTimeout(3500);
  ok('new phone: linked to the default mosque automatically (no list, no settings)', (await q.locator('.mp-sheet').count()) === 0 && (await q.locator('.m-table tbody tr').count()) === 6 && (await q.locator('.m-name').textContent()).includes('جامع سمائل'));
  ok('new phone: address becomes /m/<default> (for «Add to Home Screen»)', new URL(q.url()).pathname === '/m/samail-jami', q.url());
  ok('new phone: no JS errors', qerrs.length === 0, qerrs.join('|'));
  await ph.close();
  // a new TV too
  const tv3 = await b.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
  await wire(tv3);
  const r = await tv3.newPage(); await r.clock.setFixedTime(at);
  await r.goto(BASE + '/'); await r.waitForTimeout(3500);
  ok('new TV: linked to the default mosque automatically', (await r.locator('.tv-name').textContent()).includes('جامع سمائل') && (await r.locator('.panel .row').count()) === 12);
  await tv3.close();
}
await p.bringToFront();

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
  if (await p.getByTestId('profile-bar').count()) { await p.getByRole('button', { name: 'الخروج من ملف المسجد' }).click(); await p.clock.runFor(800); }
  const picker = p.locator('section[aria-label="اختيار ملف المسجد"]');
  const pickText = await picker.textContent();
  ok('profile: per-mosque page asks to enter a mosque profile first', pickText.includes('مسجد النور الكبير') && pickText.includes('هذه الشاشة') && (await p.getByTestId('profile-bar').count()) === 0 && (await p.getByText('العصر', { exact: true }).count()) === 0, pickText.slice(0, 160));
  const side = await p.locator('aside nav').textContent();
  ok('profile: sidebar separates «إعدادات عامة» and «ملف المسجد»', side.includes('إعدادات عامة') && side.includes('ملف المسجد'), side);
  await p.screenshot({ path: `${OUT}/profile-picker.png` });
  const muscatBefore = JSON.stringify(db.mosques.get('sq-muscat').config.iqamah);
  const localAsrBefore = await p.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('oman-mosque-display', 1); r.onsuccess = () => res(r.result); });
    return new Promise((res) => { const g = db.transaction('kv').objectStore('kv').get('config'); g.onsuccess = () => res(g.result.iqamah.rules.asr.delay); });
  });
  await p.getByTestId('enter-noor-muttrah').click(); await p.clock.runFor(1500);
  ok('profile: inside «مسجد النور» with a clear banner', (await p.getByTestId('profile-name').textContent()).includes('مسجد النور') && (await p.getByTestId('profile-bar').textContent()).includes('تُحفظ لهذا المسجد فقط'));
  const asrRow2 = p.locator('div.grid', { has: p.getByText('العصر', { exact: true }) }).first();
  const inp2 = asrRow2.locator('input[inputmode=numeric]').first(); await inp2.fill('25'); await inp2.press('Enter'); await p.clock.runFor(300);
  // freeze Fajr at 05:10 for this mosque only
  const fajrRow = p.locator('div.grid', { has: p.getByText('الفجر', { exact: true }) }).first();
  await fajrRow.locator('input[type=checkbox]').check(); await p.clock.runFor(200);
  await fajrRow.locator('input[type=time]').fill('05:10'); await p.clock.runFor(300);
  await p.screenshot({ path: `${OUT}/profile-inside.png` });
  await p.clock.runFor(3000); // saved automatically for this mosque
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
  // leave the profile, then enter this screen's mosque: shows its own values
  await p.getByRole('button', { name: 'الخروج من ملف المسجد' }).click(); await p.clock.runFor(800);
  ok('profile: leaving shows the mosque list again', (await p.locator('section[aria-label="اختيار ملف المسجد"]').count()) === 1);
  await p.getByTestId('enter-sq-muscat').click(); await p.clock.runFor(800);
  const back = await p.locator('div.grid', { has: p.getByText('العصر', { exact: true }) }).first().locator('input[inputmode=numeric]').first().inputValue();
  ok("switching back shows this mosque's own values", back === String(localAsrBefore), back);
}
ok('laptop: still no JS errors', errs.length === 0, errs.join('|'));

// 6e) Display / theme per mosque: the general admin changes «مسجد النور» only
{
  await p.getByRole('button', { name: 'العرض', exact: true }).first().click(); await p.clock.runFor(800);
  const muscatTheme = db.mosques.get('sq-muscat').config.display.theme;
  ok('profile: stays inside the same mosque across pages', (await p.getByTestId('profile-name').textContent()).includes('جامع السلطان قابوس'));
  await p.getByRole('button', { name: 'الخروج من ملف المسجد' }).click(); await p.clock.runFor(800);
  await p.getByTestId('enter-noor-muttrah').click(); await p.clock.runFor(1500);
  const themeSel = p.locator('select', { has: p.locator('option', { hasText: 'عنابي' }) }).first();
  await themeSel.selectOption('maroon'); await p.clock.runFor(100);
  // leaving right away still saves the pending change first
  await p.getByRole('button', { name: 'الخروج من ملف المسجد' }).click(); await p.clock.runFor(1500);
  ok('display: theme saved for the chosen mosque only', db.mosques.get('noor-muttrah').config.display.theme === 'maroon' && db.mosques.get('sq-muscat').config.display.theme === muscatTheme, `${db.mosques.get('noor-muttrah').config.display.theme} / ${db.mosques.get('sq-muscat').config.display.theme}`);
  const localTheme = await p.evaluate(async () => { const d = await new Promise((r) => { const q = indexedDB.open('oman-mosque-display', 1); q.onsuccess = () => r(q.result); }); return new Promise((r) => { const g = d.transaction('kv').objectStore('kv').get('config'); g.onsuccess = () => r(g.result.display.theme); }); });
  ok("display: this screen's own theme untouched", localTheme !== 'maroon', localTheme);
}

// 6f) Mosque passwords: set by the general admin; a mosque supervisor edits only that mosque
{
  await p.getByRole('button', { name: 'كلمات المرور' }).first().click(); await p.clock.runFor(1200);
  const row = p.getByTestId('mpw-noor-muttrah');
  await row.getByRole('button', { name: 'تعيين' }).click(); await p.clock.runFor(200);
  await row.locator('input').fill('noor55'); await row.getByRole('button', { name: 'حفظ' }).click(); await p.clock.runFor(1200);
  ok('general admin set a password for «مسجد النور»', db.mpw.get('noor-muttrah') === 'noor55' && (await row.textContent()).includes('لها كلمة مرور'));
  await p.screenshot({ path: `${OUT}/admin-mosque-passwords.png`, fullPage: true });

  const mc = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await wire(mc);
  const q = await mc.newPage(); const qerrs = []; q.on('pageerror', (e) => qerrs.push(e.message));
  await q.clock.setFixedTime(at);
  await q.goto(BASE + '/#/admin'); await q.waitForTimeout(1500);
  await q.getByPlaceholder('كلمة المرور', { exact: true }).fill('wrong'); await q.getByRole('button', { name: 'دخول', exact: true }).click(); await q.waitForTimeout(800);
  ok('mosque supervisor: wrong password refused', (await q.getByText('كلمة المرور غير صحيحة').count()) === 1);
  // typing the right password signs in by itself (no «دخول» press)
  await q.getByPlaceholder('كلمة المرور', { exact: true }).fill('noor55'); await q.waitForTimeout(2500);
  ok('sign-in: automatic after typing the password', (await q.getByPlaceholder('كلمة المرور', { exact: true }).count()) === 0 && (await q.locator('aside nav').count()) === 1);
  const navText = await q.locator('aside nav').textContent();
  ok('mosque supervisor: only this mosque\'s pages (timetable, iqamah, display… — no mosques / passwords)', navText.includes('جدول المواقيت') && navText.includes('الإقامة') && navText.includes('العرض') && !navText.includes('المساجد والمزامنة') && !navText.includes('كلمات المرور'), navText);
  ok('mosque supervisor: enters «مسجد النور» profile directly (no other mosque, no exit)', (await q.getByTestId('profile-name').textContent()).includes('مسجد النور') && (await q.getByRole('button', { name: 'الخروج من ملف المسجد' }).count()) === 0);
  // «جدول المواقيت»: edit today's Fajr for this mosque only
  const todayKey = '2026-10-10';
  const wilBefore = JSON.stringify(db.tables.get('muscat').schedule.days[todayKey]);
  await q.getByRole('button', { name: `تعديل ${todayKey}` }).click(); await q.waitForTimeout(300);
  const dlg = q.getByRole('dialog', { name: 'تعديل مواقيت يوم' });
  await dlg.locator('input[type=time]').first().fill('04:55'); await dlg.getByRole('button', { name: 'حفظ التعديل' }).click(); await q.waitForTimeout(300);
  ok('timetable: day marked as changed for this mosque', (await q.locator('tr', { has: q.getByRole('button', { name: `تعديل ${todayKey}` }) }).textContent()).includes('المسجد'));
  await q.waitForTimeout(3000);
  ok('timetable: change saved as this mosque\'s own (Fajr 04:55)', db.mosques.get('noor-muttrah').config.timeOverrides?.[todayKey]?.fajr === '04:55', JSON.stringify(db.mosques.get('noor-muttrah').config.timeOverrides));
  ok('timetable: wilayat table and other mosques untouched', JSON.stringify(db.tables.get('muscat').schedule.days[todayKey]) === wilBefore && !db.mosques.get('sq-muscat').config.timeOverrides?.[todayKey]);
  await q.screenshot({ path: `${OUT}/admin-mosque-times.png` });
  await q.getByRole('button', { name: 'الإقامة' }).first().click(); await q.waitForTimeout(800);
  const asrRow = q.locator('div.grid', { has: q.getByText('العصر', { exact: true }) }).first();
  const inp = asrRow.locator('input[inputmode=numeric]').first(); await inp.fill('30'); await inp.press('Enter'); await q.waitForTimeout(300);
  const before = JSON.stringify(db.mosques.get('sq-muscat').config);
  await q.waitForTimeout(3000);
  ok('mosque supervisor: saved to «مسجد النور» (asr 30)', db.mosques.get('noor-muttrah').config.iqamah.rules.asr.delay === 30 && db.mosques.get('noor-muttrah').config.display.theme === 'maroon');
  ok('mosque supervisor: other mosques untouched', JSON.stringify(db.mosques.get('sq-muscat').config) === before);
  await q.screenshot({ path: `${OUT}/admin-mosque-supervisor.png` });
  ok('mosque supervisor: no JS errors', qerrs.length === 0, qerrs.join('|'));
  await mc.close();
}
// the screen of «مسجد النور» shows its own Fajr (4:55); the wilayat's other mosque keeps 4:47
await t2.bringToFront(); await t2.reload(); await t2.waitForTimeout(2500);
ok('mosque TV shows the mosque\'s own Fajr time (4:55)', (await t2.locator('.panel').first().textContent()).includes('4:55'));
await p.bringToFront();

// 6d) Change the administrator password from its own settings page
{
  await p.getByRole('button', { name: 'كلمات المرور' }).first().click(); await p.clock.runFor(500);
  const f = p.locator('form', { has: p.getByText('كلمة المرور الحالية') });
  const inputs = f.locator('input[type=password]');
  await inputs.nth(0).fill('wrong-one'); await inputs.nth(1).fill('newpass99'); await inputs.nth(2).fill('newpass99');
  await f.getByRole('button', { name: 'حفظ كلمة المرور الجديدة' }).click(); await p.clock.runFor(800);
  ok('password page: wrong current password refused', (await f.textContent()).includes('كلمة المرور غير صحيحة') && db.pw === 'secret123');
  await inputs.nth(0).fill('secret123'); await inputs.nth(2).fill('mismatch1');
  await f.getByRole('button', { name: 'حفظ كلمة المرور الجديدة' }).click(); await p.clock.runFor(300);
  ok('password page: confirmation must match', (await f.textContent()).includes('تأكيد كلمة المرور غير مطابق') && db.pw === 'secret123');
  await inputs.nth(2).fill('newpass99');
  await f.getByRole('button', { name: 'حفظ كلمة المرور الجديدة' }).click(); await p.clock.runFor(800);
  ok('password page: password changed on the server', db.pw === 'newpass99' && (await f.textContent()).includes('تم تغيير كلمة مرور المشرف'));
  await p.screenshot({ path: `${OUT}/admin-password.png` });
  db.pw = 'secret123'; // later steps sign in with the original password
}

// 6g) Un-linking a device: it stays un-linked and its settings become its own again
{
  const nm = db.mosques.get('noor-muttrah');
  nm.config.quiet.sleep = { enabled: true, wakeForPrayers: true, periods: [{ id: 's1', enabled: true, repeat: 'daily', fromDate: '', from: '00:00', toDate: '', to: '23:59' }] };
  nm.version += 1;
  const uc = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await wire(uc);
  const u = await uc.newPage(); const uerrs = []; u.on('pageerror', (e) => uerrs.push(e.message));
  const cfgOf = () => u.evaluate(async () => { const d = await new Promise((r) => { const q = indexedDB.open('oman-mosque-display', 1); q.onsuccess = () => r(q.result); }); return new Promise((r) => { const g = d.transaction('kv').objectStore('kv').get('config'); g.onsuccess = () => r(g.result); }); });
  const bindingOf = () => u.evaluate(() => JSON.parse(localStorage.getItem('omd-cloud-binding') || 'null'));
  await u.goto(BASE + '/m/noor-muttrah'); await u.waitForTimeout(3000);
  const c1 = await cfgOf();
  ok('unlink: device linked from the mosque address takes its settings', (await bindingOf())?.code === 'noor-muttrah' && c1.display.theme === 'maroon' && c1.quiet.sleep?.enabled === true, `${c1.display.theme}`);
  await u.goto(BASE + '/m/noor-muttrah#/admin'); await u.waitForTimeout(1500);
  await u.getByPlaceholder('كلمة المرور', { exact: true }).fill('secret123'); await u.waitForTimeout(2500);
  await u.getByRole('button', { name: 'المساجد والمزامنة' }).first().click(); await u.waitForTimeout(500);
  await u.getByRole('button', { name: 'فك الربط' }).click(); await u.waitForTimeout(200);
  await u.getByRole('button', { name: 'تأكيد' }).click(); await u.waitForTimeout(1500);
  const c2 = await cfgOf();
  ok('unlink: settings are the device\'s own again (no mosque theme, no power-saving periods)', (await bindingOf()) === null && c2.display.theme !== 'maroon' && !c2.quiet.sleep?.enabled, `${c2.display.theme} sleep=${c2.quiet.sleep?.enabled}`);
  ok('unlink: the address no longer points to the mosque', !(await u.evaluate(() => location.pathname)).startsWith('/m/'));
  // opened again from the old mosque address (e.g. a home-screen icon) → stays un-linked
  await u.goto(BASE + '/m/noor-muttrah'); await u.waitForTimeout(3500);
  ok('unlink: opening the old mosque address does not link it again', (await bindingOf()) === null && (await cfgOf()).display.theme !== 'maroon');
  ok('unlink: no JS errors', !uerrs.length, uerrs.join('|'));
  await uc.close();
}

// 7) Import a timetable from an image (real OCR, no fake clock)
const ocx = await b.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
await wire(ocx);
await ocx.addInitScript(() => localStorage.setItem('omd-cloud-unbound-by-admin', '1')); // a device un-linked on purpose (local table)
const o = await ocx.newPage(); const oerrs = []; o.on('pageerror', (e) => oerrs.push(e.message));
await o.goto(BASE + '/#/admin'); await o.waitForTimeout(800);
await o.getByPlaceholder('كلمة المرور', { exact: true }).fill('secret123'); await o.getByRole('button', { name: 'دخول', exact: true }).click(); await o.waitForTimeout(1200);
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
