// Generates DEMO sample files and import templates in public/data (run: npx vite-node scripts/make-samples.ts)
import { writeFileSync } from 'node:fs';
import { demoSchedule } from '../src/core/calc';
import { exportCsv } from '../src/core/timetable';
import { createBackup } from '../src/core/backup';
import { defaultAdhkar, defaultConfig } from '../src/domain/defaults';

(globalThis as Record<string, unknown>).__APP_VERSION__ = '1.0.0';
const dir = new URL('../public/data/', import.meta.url).pathname;
const nowIso = '2026-01-01T00:00:00.000Z';
const demo = demoSchedule(2026, nowIso);

writeFileSync(dir + 'DEMO-DATA-muscat-2026.csv', exportCsv(demo));
const cfg = defaultConfig();
cfg.mosque.nameAr = 'جامع النور (مثال)';
cfg.mosque.nameEn = 'Al Noor Mosque (sample)';
cfg.friday = { ...cfg.friday, configured: true, startMode: 'dhuhr', iqamah: { mode: 'delay', delay: 30, fixedTime: '' } };
writeFileSync(dir + 'sample-backup-DEMO.json', JSON.stringify(createBackup(cfg, demo, defaultAdhkar(), nowIso), null, 2));

writeFileSync(dir + 'template.csv', '﻿' + [
  'date,fajr,sunrise,dhuhr,asr,maghrib,isha,jumuah,iqamah_fajr,iqamah_dhuhr,iqamah_asr,iqamah_maghrib,iqamah_isha,iqamah_jumuah',
  '2026-01-01,hh:mm,hh:mm,hh:mm,hh:mm,hh:mm,hh:mm,,,,,,,',
].join('\r\n') + '\r\n');
writeFileSync(dir + 'template.json', JSON.stringify({
  _readme: 'Replace hh:mm with the official MARA times (24-hour HH:MM, or 12-hour with AM/PM / ص / م). Optional: jumuah, iqamah.{fajr,dhuhr,asr,maghrib,isha,jumuah}. This _readme key is ignored on import.',
  days: [
    { date: '2026-01-01', fajr: 'hh:mm', sunrise: 'hh:mm', dhuhr: 'hh:mm', asr: 'hh:mm', maghrib: 'hh:mm', isha: 'hh:mm' },
    { date: '2026-01-02', fajr: 'hh:mm', sunrise: 'hh:mm', dhuhr: 'hh:mm', asr: 'hh:mm', maghrib: 'hh:mm', isha: 'hh:mm', iqamah: { fajr: 'hh:mm' } },
  ],
}, null, 2));
console.log('samples ok', Object.keys(demo.days).length);
