import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/home/claude/mosque-display/package.json');
const { Coordinates, CalculationParameters, PrayerTimes, Madhab, Rounding } = require('adhan');
const rows = readFileSync(new URL('./mara-muscat-2026-10.csv', import.meta.url), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const keys = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
const PM = { asr: 1, maghrib: 1, isha: 1 };
const off = (t, k) => { let [h, m] = t.split(':').map(Number); if (PM[k] && h < 12) h += 12; return h * 60 + m; };
const official = rows.map((r) => ({ date: r[0], ...Object.fromEntries(keys.map((k, i) => [k, off(r[i + 1], k)])) }));
const mm = (d) => ((d.getTime() / 60000 + 240) % 1440 + 1440) % 1440;
export function evalCfg({ lat, lng, fa = 18, ia = 18, adj, mode = 'nearest' }) {
  const res = Object.fromEntries(keys.map((k) => [k, { miss: 0, max: 0, sum: 0 }]));
  for (const o of official) {
    const [y, m, d] = o.date.split('-').map(Number);
    const p = new CalculationParameters('Other', fa, ia); p.madhab = Madhab.Shafi; p.rounding = Rounding.None;
    const pt = new PrayerTimes(new Coordinates(lat, lng), new Date(y, m - 1, d, 12), p);
    for (const k of keys) {
      const v = mm(pt[k]) + (adj[k] || 0);
      const t = mode === 'nearest' ? Math.round(v) : mode === 'ceil' ? Math.ceil(v) : Math.floor(v);
      const e = t - o[k]; res[k].sum += e; if (e) res[k].miss++; res[k].max = Math.max(res[k].max, Math.abs(e));
    }
  }
  return res;
}
const show = (name, cfg) => { const r = evalCfg(cfg); const tot = Object.values(r).reduce((a, b) => a + b.miss, 0);
  console.log(name.padEnd(34), 'mismatch days:', tot, '/', 31 * 6, keys.map((k) => `${k}:${r[k].miss}(max${r[k].max},bias${(r[k].sum / 31).toFixed(1)})`).join(' ')); };
const z = { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
if (process.argv[1].endsWith("eval.mjs")) for (const [n, lat, lng] of [['Muscat old town', 23.614, 58.593], ['Ruwi', 23.597, 58.545], ['Bawshar', 23.577, 58.400], ['Seeb', 23.67, 58.189], ['MARA HQ area (Al Khuwair)', 23.592, 58.410]]) {
  show(`${n} raw 18/18`, { lat, lng, adj: z });
  for (const mode of ['nearest', 'ceil'])
    show(`${n} +5/+5/+5 ${mode}`, { lat, lng, adj: { ...z, dhuhr: 5, asr: 5, maghrib: 5 }, mode });
}
