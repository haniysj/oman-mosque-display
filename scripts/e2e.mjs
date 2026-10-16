// End-to-end checks + screenshots against the production build.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/e2e.mjs
import { chromium, devices } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = process.env.OUT || 'shots';
mkdirSync(OUT, { recursive: true });
const backup = JSON.parse(readFileSync(new URL('../public/data/sample-backup-DEMO.json', import.meta.url)));
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

// Muscat local → ISO UTC
const muscat = (d, t) => new Date(`${d}T${t}+04:00`);

async function seed(page, mutate) {
  await page.goto(BASE + '/');
  await page.waitForTimeout(300);
  await page.evaluate(async (b) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('oman-mosque-display', 1); r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('logs', { keyPath: 'id', autoIncrement: true }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(b.config, 'config'); tx.objectStore('kv').put(b.schedule, 'schedule'); tx.objectStore('kv').put(b.adhkar, 'adhkar'); tx.oncomplete = res; });
    db.close();
  }, mutate ? mutate(structuredClone(backup)) : backup);
}

// Settings are behind the administrator password: mock the server and sign in.
async function adminLogin(ctx, page) {
  if (!page) await ctx.route(/supabase\.co\/rest\/v1\/rpc\//, async (route) => {
    const fn = route.request().url().split('/rpc/')[1];
    const a = JSON.parse(route.request().postData() || '{}');
    const ok200 = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (fn === 'mosque_admin_status') return ok200({ initialized: true });
    if (fn === 'mosque_admin_login') return a.p_password === 'test1234' ? ok200(true) : route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'BAD_PASSWORD' }) });
    if (fn === 'mosque_auth') return a.p_password === 'test1234' ? ok200({ role: 'super' }) : route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'BAD_PASSWORD' }) });
    if (fn === 'mosque_list' || fn === 'mosque_timetables_summary') return ok200([]);
    return ok200(null);
  });
  if (page) {
    await page.getByPlaceholder('كلمة المرور', { exact: true }).fill('test1234');
    await page.getByRole('button', { name: 'دخول', exact: true }).click();
  }
}

async function shot(browser, { name, w, h, at, ua, mutate, hash = '', isMobile = false, check }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, userAgent: ua, isMobile, hasTouch: isMobile, serviceWorkers: 'block', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: at });
  await seed(page, mutate);
  await page.goto(BASE + '/' + hash);
  await page.clock.runFor(1500);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  ok(`${name}: no JS errors`, errors.length === 0, errors.join(' | '));
  if (!hash) ok(`${name}: no horizontal overflow`, !overflow);
  if (check) await check(page);
  await ctx.close();
}

const browser = await chromium.launch();

// Offline from the real cloud: no mosque exists, so the display keeps the demo data (no auto-linking).
{ const nc = browser.newContext.bind(browser); browser.newContext = async (o) => { const c = await nc(o); await c.route(/supabase\.co\/rest\/v1\/rpc\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: /mosque_list|mosque_timetables_summary/.test(r.request().url()) ? '[]' : 'null' })); return c; }; }
const SAT = '2026-10-10', FRI = '2026-10-09';
const TV_UA = 'Mozilla/5.0 (Linux; Android 11; BRAVIA 4K VH2 Build/RTT2.220308.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IPHONE = devices['iPhone 13'];

// Demo timetable 2026-10-10: Asr 15:14, iqamah 15:34 (20 min)
for (const [w, h] of [[1920, 1080], [3840, 2160], [1366, 768], [1024, 768]]) {
  await shot(browser, { name: `display-${w}x${h}`, w, h, at: muscat(SAT, '15:20:07'), ua: TV_UA,
    check: async (p) => {
      ok(`display-${w}x${h}: clock visible`, await p.locator('.clock-time').isVisible());
      ok(`display-${w}x${h}: 6 + 6 rows`, (await p.locator('.panel .row').count()) === 12);
      ok(`display-${w}x${h}: demo badge`, await p.locator('.source-badge--demo').isVisible());
      const nb = await p.locator('.tv-name').boundingBox(); const bb = await p.locator('.source-badge').boundingBox();
      ok(`display-${w}x${h}: badge clear of name`, !(nb && bb && bb.y < nb.y + nb.height && bb.y + bb.height > nb.y));
      const mid = await p.locator('.tv-foot > :nth-child(2)').boundingBox(); const arch = await p.locator('.mihrab').boundingBox();
      ok(`display-${w}x${h}: footer middle mark under the arch centre`, Math.abs((mid.x + mid.width / 2) - (arch.x + arch.width / 2)) < 2, `${mid.x + mid.width / 2} vs ${arch.x + arch.width / 2}`);
      ok(`display-${w}x${h}: ornament inside the arch`, (await p.locator('.arch-orn .arch-orn-tile').count()) === 1);
      const txt = await p.locator('.tv').textContent();
      ok(`display-${w}x${h}: 12-hour times without ص / م`, (await p.locator('.period, .clock-period').count()) === 0 && !/\d\s*[صم](?![\u0600-\u06FF])/.test(txt), (txt.match(/\d\s*[صم](?![\u0600-\u06FF])/) || [''])[0]);
    } });
}
for (const [w, h] of [[1920, 1080], [1366, 768]]) {
  await shot(browser, { name: `foot-dot-${w}x${h}`, w, h, at: muscat(SAT, '15:20:07'), ua: TV_UA,
    mutate: (b) => { b.schedule.meta.source = 'official'; for (const d of Object.values(b.schedule.days)) d.source = 'official'; return b; },
    check: async (p) => {
      const dot = await p.locator('.tv-foot > .foot-dot').boundingBox(); const arch = await p.locator('.mihrab').boundingBox();
      ok(`foot-dot-${w}x${h}: ◇ exactly under the arch centre`, !!dot && Math.abs((dot.x + dot.width / 2) - (arch.x + arch.width / 2)) < 2, dot ? `${dot.x + dot.width / 2} vs ${arch.x + arch.width / 2}` : 'no dot');
    } });
}
for (const [name, dev] of [['phone-390x844', IPHONE], ['phone-375x667', devices['iPhone SE']]]) {
  await shot(browser, { name, w: dev.viewport.width, h: dev.viewport.height, at: muscat(SAT, '15:20:07'), ua: dev.userAgent, isMobile: true,
    check: async (p) => ok(`${name}: table visible`, await p.locator('.m-table').isVisible()) });
}

// Longest weekday + longest Hijri month: day | dates row must stay inside the arch
for (const [w, h] of [[1920, 1080], [1024, 768]]) {
  await shot(browser, { name: `display-long-date-${w}`, w, h, at: muscat('2026-11-25', '20:10:00'), ua: TV_UA,
    check: async (p) => {
      const c = await p.locator('.tv-center').boundingBox(); const m = await p.locator('.clock-meta').boundingBox();
      ok(`long date row inside centre (${w})`, c && m && m.x >= c.x + 20 * Math.min(w / 1920, h / 1080) && m.x + m.width <= c.x + c.width - 20 * Math.min(w / 1920, h / 1080), JSON.stringify({ c, m }));
      const t = await p.locator('.clock-row').boundingBox();
      const mg = 30 * Math.min(w / 1920, h / 1080); ok(`clock row inside centre (${w})`, c && t && t.x >= c.x + mg && t.x + t.width <= c.x + c.width - mg, JSON.stringify({ c, t }));
    } });
}

// Long mosque name wraps without clipping
await shot(browser, { name: 'display-long-name', w: 1920, h: 1080, at: muscat(SAT, '09:00:00'), ua: TV_UA,
  mutate: (b) => { b.config.mosque.nameAr = 'جامع السلطان قابوس الأكبر بولاية بوشر — مسجد الجمعة والعيدين ومركز تحفيظ القرآن الكريم'; return b; },
  check: async (p) => {
    const box = await p.locator('.tv-name').boundingBox();
    ok('long name stays within header', box && box.height <= 250, JSON.stringify(box));
  } });

// Countdown (iqamah at 15:34:00, 45 s before)
await shot(browser, { name: 'countdown-iqamah', w: 1920, h: 1080, at: muscat(SAT, '15:33:15'), ua: TV_UA,
  check: async (p) => ok('countdown shown ≤60s', (await p.locator('.countdown-digits').textContent())?.includes('00:4')) });
await shot(browser, { name: 'countdown-61s-none', w: 1920, h: 1080, at: muscat(SAT, '15:32:45'), ua: TV_UA,
  check: async (p) => ok('no countdown at 61s', (await p.locator('.countdown').count()) === 0) });

// Quiet black screen at iqamah + 1 min (TV) — and NOT on the phone
// Black screen starts 5 s after the iqamah (Asr iqamah 15:34:00)
await shot(browser, { name: 'quiet-delay', w: 1920, h: 1080, at: muscat(SAT, '15:34:00'), ua: TV_UA,
  check: async (p) => ok('quiet: not yet black 2 s after iqamah', (await p.locator('.quiet-screen').count()) === 0) });
await shot(browser, { name: 'quiet-tv', w: 1920, h: 1080, at: muscat(SAT, '15:35:00'), ua: TV_UA,
  check: async (p) => {
    ok('quiet: black screen', await p.locator('.quiet-screen').isVisible());
    ok('quiet: nothing else rendered', (await p.locator('.clock, .panel, .ctrl-bar').count()) === 0);
    ok('quiet: only the time, white-grey', (await p.locator('.quiet-clock').textContent()).includes('3:35') && (await p.locator('.quiet-clock').evaluate((e) => getComputedStyle(e).color)) === 'rgb(207, 207, 207)');
  } });
await shot(browser, { name: 'quiet-phone-exception', w: IPHONE.viewport.width, h: IPHONE.viewport.height, at: muscat(SAT, '15:35:00'), ua: IPHONE.userAgent, isMobile: true,
  check: async (p) => ok('phone: no black screen', (await p.locator('.quiet-screen').count()) === 0 && (await p.locator('.m-table').isVisible())) });

// Adhkar at iqamah + 5 min + 70 s → second dhikr
await shot(browser, { name: 'adhkar', w: 1920, h: 1080, at: muscat(SAT, '15:40:10'), ua: TV_UA,
  check: async (p) => {
    ok('adhkar visible', await p.locator('.adhkar-text').isVisible());
    ok('adhkar 2nd item at +70s', (await p.locator('.adhkar-dots span.on').count()) === 1 && (await p.locator('.adhkar-dots span').nth(1).getAttribute('class')) === 'on');
    ok('adhkar text uses Thmanyah Serif Text (bundled)', await p.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some((f) => f.family.includes('Thmanyah Serif Text') && f.status === 'loaded'); }));
    ok('adhkar text: regular weight, wide line spacing', (await p.locator('.adhkar-text').evaluate((e) => { const c = getComputedStyle(e); return +c.fontWeight <= 500 && parseFloat(c.lineHeight) / parseFloat(c.fontSize) >= 1.75; })));
  } });

// Adhkar groups (settings): suggested morning adhkar, group shown after chosen prayers, order
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.clock.install({ time: muscat(SAT, '15:20:00') });
  await seed(page);
  await page.evaluate(() => sessionStorage.setItem('omd-admin-tab', 'adhkar'));
  await adminLogin(ctx);
  await page.goto(BASE + '/#/admin'); await page.reload(); await page.clock.runFor(800);
  await adminLogin(ctx, page); await page.clock.runFor(800);
  const names = await page.locator('input[aria-label="اسم المجموعة"]').evaluateAll((els) => els.map((e) => e.value));
  ok('adhkar groups: after prayer, morning, evening', names.join('|') === 'أذكار بعد الصلاة|أذكار الصباح|أذكار المساء', names.join('|'));
  ok('morning group shown after Fajr, evening after Asr', (await page.getByTestId('group-morning').textContent()).includes('بعد صلاة الفجر') && (await page.getByTestId('group-evening').textContent()).includes('بعد صلاة العصر'));
  const morning = page.getByRole('region', { name: 'أذكار الصباح' });
  await morning.getByRole('button', { name: 'إضافة الأذكار المقترحة' }).click(); await page.clock.runFor(500);
  ok('suggested morning adhkar added to the morning group', (await morning.locator('li').count()) === 2);
  // show the morning group after Asr too, and move it before the after-prayer group
  await page.getByTestId('group-morning').getByRole('button', { name: 'العصر', exact: true }).click(); await page.clock.runFor(300);
  await page.getByRole('button', { name: 'تقديم أذكار الصباح' }).click(); await page.clock.runFor(500);
  const saved = await page.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('oman-mosque-display', 1); q.onsuccess = () => r(q.result); }); const get = (k) => new Promise((r) => { const g = db.transaction('kv').objectStore('kv').get(k); g.onsuccess = () => r(g.result); }); return { cfg: await get('config'), adhkar: await get('adhkar') }; });
  ok('group order + prayers saved', saved.cfg.adhkar.groups[0].id === 'morning' && saved.cfg.adhkar.groups[0].prayers.asr === true, JSON.stringify(saved.cfg.adhkar.groups.map((g) => g.id)));
  ok('morning items saved with their group', saved.adhkar.filter((a) => a.groupId === 'morning').length === 2);
  await page.screenshot({ path: `${OUT}/admin-adhkar-groups.png`, fullPage: true });
  // the screen after Asr now starts with the morning group
  await page.goto(BASE + '/'); await page.clock.setFixedTime(muscat(SAT, '15:39:05')); await page.reload(); await page.clock.runFor(1500);
  ok('after Asr: first dhikr comes from the morning group (title = group name)', (await page.locator('.adhkar-title').textContent()).includes('أذكار الصباح'), await page.locator('.adhkar-title').textContent());
  ok('adhkar groups: no JS errors', !errs.length, errs.join('|'));
  await ctx.close();
}
// back to normal after 10 minutes
await shot(browser, { name: 'after-sequence', w: 1920, h: 1080, at: muscat(SAT, '15:44:01'), ua: TV_UA,
  check: async (p) => ok('returns to main display', await p.locator('.clock-time').isVisible()) });

// Friday (configured: Dhuhr + 30)
await shot(browser, { name: 'friday', w: 1920, h: 1080, at: muscat(FRI, '11:30:00'), ua: TV_UA,
  mutate: (b) => { b.config.friday.announcement = 'خطبة الجمعة: فضل صلة الرحم'; return b; },
  check: async (p) => {
    ok('friday label', (await p.locator('.panel').first().textContent()).includes('الجمعة'));
    ok('friday iqamah row', (await p.locator('.panel').nth(1).locator('.row-name').allTextContents()).some((t) => t.includes('الجمعة')));
  } });

// Arabic digits + navy theme
await shot(browser, { name: 'navy-arabic-digits', w: 1920, h: 1080, at: muscat(SAT, '05:10:30'), ua: TV_UA,
  mutate: (b) => { b.config.display.theme = 'navy'; b.config.display.digits = 'arabic'; return b; } });
await shot(browser, { name: 'high-contrast', w: 1920, h: 1080, at: muscat(SAT, '19:30:30'), ua: TV_UA,
  mutate: (b) => { b.config.display.highContrast = true; return b; } });

// Admin panel pages
for (const tab of ['timetable', 'iqamah', 'friday', 'quiet', 'adhkar', 'diagnostics']) {
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block', isMobile: w < 500, hasTouch: w < 500 });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.clock.install({ time: muscat(SAT, '15:20:00') });
    await seed(page);
    await page.evaluate((t) => sessionStorage.setItem('omd-admin-tab', t), tab);
    await adminLogin(ctx);
    await page.goto(BASE + '/#/admin');
    await page.reload();
    await page.clock.runFor(800);
    await adminLogin(ctx, page); await page.clock.runFor(800);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/admin-${tab}-${w}.png`, fullPage: true });
    const of = await page.evaluate(() => { const el = document.querySelector('[aria-label="لوحة الإدارة"]'); return el ? el.scrollWidth > el.clientWidth + 1 : false; });
    ok(`admin-${tab}-${w}: no errors / overflow`, !errs.length && !of, errs.join('|'));
    await ctx.close();
  }
}

// Frozen iqamah: admin locks Asr at 15:45 → the screen shows 3:45 with no marker
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.clock.install({ time: muscat(SAT, '15:20:00') });
  await seed(page);
  await page.evaluate(() => sessionStorage.setItem('omd-admin-tab', 'iqamah'));
  await adminLogin(ctx);
  await page.goto(BASE + '/#/admin'); await page.reload(); await page.clock.runFor(800);
  await adminLogin(ctx, page); await page.clock.runFor(800);
  const daily = page.getByText('الإقامة اليومية').locator('xpath=ancestor::section[1]');
  const asrBox = daily.locator('div.grid', { has: page.getByText('العصر', { exact: true }) }).first();
  await asrBox.getByText('تثبيت موعد الإقامة').click(); await page.clock.runFor(300);
  await asrBox.locator('input[type=time]').fill('15:45'); await page.clock.runFor(300);
  await page.screenshot({ path: `${OUT}/admin-iqamah-lock.png`, fullPage: true });
  const prev = await page.getByText('معاينة').first().locator('xpath=ancestor::section[1]').textContent();
  ok('lock: admin preview shows 3:45 مثبّت', prev.includes('3:45') && prev.includes('مثبّت'), prev.slice(0, 200));
  const cfgSaved = await page.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('oman-mosque-display', 1); q.onsuccess = () => r(q.result); }); return new Promise((r) => { const g = db.transaction('kv').objectStore('kv').get('config'); g.onsuccess = () => r(g.result.iqamah.locks); }); });
  ok('lock: saved in settings', cfgSaved?.asr?.enabled === true && cfgSaved?.asr?.time === '15:45', JSON.stringify(cfgSaved));
  await page.goto(BASE + '/'); await page.clock.runFor(1500);
  const iqRows = await page.locator('.panel').nth(1).textContent();
  ok('lock: screen shows Asr iqamah 3:45, no lock marker', iqRows.includes('3:45') && !iqRows.includes('مثبت') && !iqRows.includes('مثبّت'), iqRows);
  ok('lock: no JS errors', errs.length === 0, errs.join('|'));
  await ctx.close();
}

await shot(browser, { name: 'footer-normal', w: 1920, h: 1080, at: muscat(SAT, '16:10:00'), ua: TV_UA,
  check: async (p) => { const foot = await p.locator('.tv-foot').textContent(); ok('footer: «أذان صلاة …» and «إقامة صلاة …»', foot.includes('أذان صلاة المغرب') && foot.includes('إقامة صلاة المغرب'), foot);
    ok('iqamah list says «الضحى»', (await p.locator('.panel').nth(1).textContent()).includes('الضحى') && !(await p.locator('.panel').nth(1).textContent()).includes('صلاة الضحى')); } });
// Labels: iqamah rows show only the prayer name; footer shows «أذان صلاة …» and «إقامة صلاة …»
await shot(browser, { name: 'labels', w: 1920, h: 1080, at: muscat(SAT, '15:20:07'), ua: TV_UA,
  check: async (p) => {
    const names = await p.locator('.panel').nth(1).locator('.row-name').allTextContents();
    ok('iqamah rows without «إقامة»', names.length === 6 && names.every((t) => !t.includes('إقامة')) && names[0].includes('الفجر'), names.join(' | '));
    const foot = await p.locator('.tv-foot').textContent();
    ok('TV footer between adhan and iqamah: minutes on the right, «switch off phone» on the left', foot.includes('الإقامة بعد:') && foot.includes('14') && foot.includes('يرجى إغلاق الهاتف النقال'), foot);
    const r = await p.locator('.foot-iqwait').boundingBox(), l = await p.locator('.foot-phone').boundingBox();
    ok('TV footer: minutes right, phone left', !!r && !!l && r.x > l.x);
  } });

// Screen shapes: the layout fills landscape screens of any aspect and large portrait screens
for (const [w, h] of [[1440, 900], [1280, 1024], [2560, 1080], [1080, 1920], [820, 1180]]) {
  await shot(browser, { name: `shape-${w}x${h}`, w, h, at: muscat(SAT, '15:20:07'), ua: TV_UA,
    check: async (p) => {
      const r = await p.locator('.stage').first().boundingBox();
      ok(`${w}x${h}: stage fills the screen`, !!r && Math.abs(r.width - w) <= 3 && Math.abs(r.height - h) <= 3 + (w / h < 4 / 3 && w > h ? h : 0), r ? `${Math.round(r.width)}x${Math.round(r.height)}` : 'no stage');
    } });
}

// Name position «centre» with a logo: the name is centred on the screen (logo does not push it)
for (const [name, w, h, ua, isMobile] of [['name-center-tv', 1920, 1080, TV_UA, false], ['name-center-phone', IPHONE.viewport.width, IPHONE.viewport.height, IPHONE.userAgent, true]]) {
  await shot(browser, { name, w, h, at: muscat(SAT, '15:20:07'), ua, isMobile,
    mutate: (b) => { b.config.display.namePosition = 'center'; b.config.mosque.logoDataUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Ccircle cx='50' cy='50' r='48' fill='%23D4AF61'/%3E%3C/svg%3E"; return b; },
    check: async (p) => {
      const c = await p.evaluate((sel) => { const el = document.querySelector(sel); const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return (b.left + b.right) / 2; }, isMobile ? '.m-name' : '.tv-name');
      ok(`${name}: name centred`, Math.abs(c - w / 2) <= 4, `${Math.round(c)} vs ${w / 2}`);
    } });
}

// Split screen: a third / a half for the prayer times, the rest shows adhkar (countdown replaces them)
for (const [layout, side, t, name] of [['third', 'right', '15:20:07', 'split-third-right'], ['half', 'left', '15:20:07', 'split-half-left'], ['third', 'right', '15:33:30', 'split-third-countdown'], ['half', 'right', '15:33:30', 'split-half-countdown']]) {
  await shot(browser, { name, w: 1920, h: 1080, at: muscat(SAT, t), ua: TV_UA,
    mutate: (b) => { b.config.display.screenLayout = layout; b.config.display.layoutSide = side; return b; },
    check: async (p) => {
      const times = await p.locator('.split-times').boundingBox();
      const want = layout === 'third' ? 640 : 960;
      ok(`${name}: times take ${layout} on the ${side}`, !!times && Math.abs(times.width - want) <= 3 && (side === 'right' ? times.x > 900 : times.x < 10), times ? `${Math.round(times.x)}+${Math.round(times.width)}` : 'none');
      if (layout === 'third') ok(`${name}: all prayers listed`, (await p.locator('.split-times .m-table tbody tr').count()) === 6);
      else ok(`${name}: half uses the full TV design (arch + both panels)`, (await p.locator('.split-times .mihrab').count()) === 1 && (await p.locator('.split-times .panel .row').count()) === 12);
      if (t === '15:33:30' && layout === 'third') ok(`${name}: countdown replaces adhkar`, (await p.locator('.split-countdown').count()) === 1 && (await p.locator('.split-adhkar').count()) === 0);
      else if (t === '15:33:30') ok(`${name}: countdown in the arch, adhkar dimmed`, (await p.locator('.split-times .countdown').count()) === 1 && (await p.locator('.split.is-countdown').count()) === 1);
      else ok(`${name}: adhkar shown`, ((await p.locator('.split-adhkar-text').textContent()) || '').length > 10);
      if (layout === 'third') ok(`${name}: times column fits without scrolling`, await p.locator('.split-times-inner .m-root').evaluate((e) => e.scrollHeight <= e.clientHeight + 2));
    } });
}

// Badges: «الآن» on the adhan row until 1 min before the iqamah (iqamah row «القادمة»), then «الآن» on
// the iqamah row; «القادمة» on the next prayer 1 min after the iqamah (Asr: adhan 15:14, iqamah 15:34)
for (const [t, adhanAsr, iqAsr, adhanMaghrib] of [['15:20:00', 'الآن', 'القادمة', ''], ['15:33:30', '', 'الآن', ''], ['15:35:05', '', '', 'القادمة']]) {
  await shot(browser, { name: `badges-${t.replace(/:/g, '')}`, w: 1920, h: 1080, at: muscat(SAT, t), ua: TV_UA,
    mutate: (b) => { b.config.quiet.enabled = false; b.config.adhkar.enabled = false; return b; }, // keep the panels visible after the iqamah
    check: async (p) => {
      const rowText = async (panel, name) => (await p.locator('.panel').nth(panel).locator('.row', { has: p.locator('.row-name', { hasText: name }) }).first().locator('.row-name').textContent()).replace(name, '').trim();
      const a = await rowText(0, 'العصر'), i = await rowText(1, 'العصر'), m = await rowText(0, 'المغرب');
      ok(`badges ${t}: adhan «${adhanAsr || '—'}», iqamah «${iqAsr || '—'}», maghrib «${adhanMaghrib || '—'}»`, a === adhanAsr && i === iqAsr && m === adhanMaghrib, `${a}|${i}|${m}`);
    } });
}

// Phone, between adhan and iqamah: minutes to the iqamah + «please switch off the phone» (Asr 15:14 → 15:34)
await shot(browser, { name: 'phone-iqwait', w: IPHONE.viewport.width, h: IPHONE.viewport.height, at: muscat(SAT, '15:20:30'), ua: IPHONE.userAgent, isMobile: true,
  check: async (p) => {
    const t = (await p.locator('.m-iqwait').textContent()) || '';
    ok('phone: iqamah wait shows minutes only + phone notice', t.includes('الإقامة بعد:') && t.includes('14') && t.includes('يرجى إغلاق الهاتف النقال') && !/\d+:\d{2}:\d{2}/.test(t), t);
    ok('phone: the two «next» lines are hidden meanwhile', (await p.locator('.m-next:not(.m-iqwait)').count()) === 0);
    await p.locator('.m-iqwait').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${OUT}/phone-iqwait.png` });
  } });
await shot(browser, { name: 'phone-after-iqamah', w: IPHONE.viewport.width, h: IPHONE.viewport.height, at: muscat(SAT, '15:50:00'), ua: IPHONE.userAgent, isMobile: true,
  check: async (p) => ok('phone: after the iqamah the next adhan / iqamah lines return', (await p.locator('.m-iqwait').count()) === 0 && (await p.locator('.m-next').textContent()).includes('أذان صلاة المغرب')) });

// Offline: install SW, go offline, reload → still renders from cache + IndexedDB
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.clock.install({ time: muscat(SAT, '15:20:07') }); // fixed time: never inside a quiet/adhkar period
  await seed(page);
  await page.goto(BASE + '/');
  await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(1500);
  const text = await page.locator('.clock-time').textContent().catch(() => null);
  const t1 = text;
  await page.clock.runFor(2100);
  const sec = await page.locator('.clock-sec').textContent().catch(() => null);
  ok('offline: app shell loads from cache', !!t1);
  ok('offline: timetable from IndexedDB', (await page.locator('.panel .row').count()) === 12);
  ok('offline: clock keeps ticking', !!sec);
  const fontsOk = await page.evaluate(() => document.fonts.check('700 40px Cairo'));
  ok('offline: Cairo font available locally', fontsOk);
  await page.screenshot({ path: `${OUT}/offline.png` });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
