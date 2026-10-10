import { evalCfg } from './eval.mjs';
const keys = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
let best = [];
for (const fa of [18]) for (const ia of [18, 17.5, 17]) for (const mode of ['nearest', 'ceil'])
for (let lat = 23.50; lat <= 23.68; lat += 0.01) for (let lng = 58.25; lng <= 58.62; lng += 0.01) {
  // per prayer pick best integer offset 0..8 (sunrise -2..2)
  const adj = {}; let tot = 0; const detail = {};
  for (const k of keys) {
    let b = null;
    for (let c = (k === 'sunrise' ? -2 : -2); c <= 8; c++) {
      const r = evalCfg({ lat, lng, fa, ia, mode, adj: { [k]: c } })[k];
      if (!b || r.miss < b.miss) b = { c, miss: r.miss };
    }
    adj[k] = b.c; tot += b.miss; detail[k] = b.miss;
  }
  best.push({ fa, ia, mode, lat: +lat.toFixed(2), lng: +lng.toFixed(2), tot, adj, detail });
}
best.sort((a, b) => a.tot - b.tot);
for (const b of best.slice(0, 12)) console.log(JSON.stringify(b));
