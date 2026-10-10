// Renders MARA-style monthly tables from research/mara-muscat-2026-10.csv as PNG images (OCR test fixtures).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const rows = readFileSync(new URL('../research/mara-muscat-2026-10.csv', import.meta.url), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const WD = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const ar = (s) => s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
function html(arabicDigits, scale) {
  const f = arabicDigits ? ar : (s) => s;
  const body = rows.map(([d, ...t], i) => { const [y, m, dd] = d.split('-'); const wd = WD[new Date(d + 'T12:00:00Z').getUTCDay()]; return `<tr class="${i % 2 ? 'odd' : ''}"><td>${wd}</td><td>${f(`${dd}/${m}/${y}`)}</td><td>${f(`${String(i + 19).padStart(2, '0')}/04/1448`)}</td>${t.map((x) => `<td>${f(x)}</td>`).join('')}</tr>`; }).join('');
  return `<html dir="rtl"><body style="margin:0;font-family:Arial;background:#fff;zoom:${scale}"><h2 style="text-align:center;color:#0a5">مواقيت الصلاة لشهر أكتوبر 2026 — مسقط</h2>
  <style>table{border-collapse:collapse;margin:0 auto}td,th{border:1px solid #9bb;padding:4px 10px;text-align:center;font-size:15px}th{background:#0a6a4f;color:#fff}.odd{background:#eef6f2}</style>
  <table><tr><th>اليوم</th><th>التاريخ الميلادي</th><th>التاريخ الهجري</th><th>الفجر</th><th>الشروق</th><th>الظهر</th><th>العصر</th><th>المغرب</th><th>العشاء</th></tr>${body}</table></body></html>`;
}
const b = await chromium.launch();
for (const [name, ard, scale, w] of [['mara-latin', false, 1, 1000], ['mara-small', false, 0.8, 800]]) {
  const p = await b.newPage({ viewport: { width: w, height: 600 } });
  await p.setContent(html(ard, scale));
  await p.screenshot({ path: `scripts/ocr-fixtures/${name}.png`, fullPage: true });
}
await b.close();
console.log('ok');
