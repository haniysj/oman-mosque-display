// Fit astronomical parameters to the official MARA timetable (Muscat, Oct 2026).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/home/claude/mosque-display/package.json');
const { Coordinates, CalculationParameters, PrayerTimes, Madhab, Rounding } = require('adhan');
const rows = readFileSync(new URL('./mara-muscat-2026-10.csv', import.meta.url), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const PM = { asr: 12, maghrib: 12, isha: 12 };
const keys = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
const off = (t, k) => { let [h, m] = t.split(':').map(Number); if (PM[k] && h < 12) h += 12; return h * 60 + m; };
const official = rows.map((r) => ({ date: r[0], ...Object.fromEntries(keys.map((k, i) => [k, off(r[i + 1], k)])) }));
const muscatMin = (d) => ((d.getTime() / 60000 + 240) % 1440 + 1440) % 1440; // fractional minutes, UTC+4
function raw(lat, lng, fa, ia) {
  return official.map((o) => {
    const [y, m, d] = o.date.split('-').map(Number);
    const p = new CalculationParameters('Other', fa, ia); p.madhab = Madhab.Shafi; p.rounding = Rounding.None;
    const pt = new PrayerTimes(new Coordinates(lat, lng), new Date(y, m - 1, d, 12), p);
    return Object.fromEntries(keys.map((k) => [k, muscatMin(pt[k])]));
  });
}
// best constant offset (0.1 min steps) + rounding for one prayer
function bestFor(k, R) {
  let best = null;
  for (const mode of ['nearest', 'ceil', 'floor']) for (let c = -10; c <= 10; c += 0.1) {
    let miss = 0, maxe = 0;
    R.forEach((r, i) => {
      const v = r[k] + c; const t = mode === 'nearest' ? Math.round(v) : mode === 'ceil' ? Math.ceil(v) : Math.floor(v);
      const e = Math.abs(t - official[i][k]); if (e) miss++; maxe = Math.max(maxe, e);
    });
    if (!best || miss < best.miss || (miss === best.miss && Math.abs(c) < Math.abs(best.c))) best = { mode, c: +c.toFixed(1), miss, maxe };
  }
  return best;
}
const results = [];
for (let lat = 23.55; lat <= 23.65; lat += 0.02) for (let lng = 58.30; lng <= 58.62; lng += 0.02) {
  const R = raw(lat, lng, 18, 18);
  const s = bestFor('sunrise', R), m = bestFor('maghrib', R), d = bestFor('dhuhr', R);
  results.push({ lat: +lat.toFixed(2), lng: +lng.toFixed(2), score: s.miss + m.miss + d.miss, s, m, d });
}
results.sort((a, b) => a.score - b.score);
console.log('top coords', JSON.stringify(results.slice(0, 5)));
const { lat, lng } = results[0];
// angles
let fb = null, ib = null;
for (let a = 14; a <= 20.01; a += 0.25) {
  const R = raw(lat, lng, a, a);
  const f = bestFor('fajr', R), i = bestFor('isha', R);
  if (!fb || f.miss < fb.miss || (f.miss === fb.miss && Math.abs(f.c) < Math.abs(fb.c))) fb = { a, ...f };
  if (!ib || i.miss < ib.miss || (i.miss === ib.miss && Math.abs(i.c) < Math.abs(ib.c))) ib = { a, ...i };
}
console.log('fajr', JSON.stringify(fb)); console.log('isha', JSON.stringify(ib));
const R = raw(lat, lng, fb.a, ib.a);
for (const k of ['sunrise', 'dhuhr', 'asr', 'maghrib']) console.log(k, JSON.stringify(bestFor(k, R)));
// angle-only (zero offset) check for fajr/isha
for (const a of [17, 17.5, 18, 18.5, 19]) { const R2 = raw(lat, lng, a, a); console.log('angle', a, 'fajr', JSON.stringify(bestFor('fajr', R2)), 'isha', JSON.stringify(bestFor('isha', R2))); }
