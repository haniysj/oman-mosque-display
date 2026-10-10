import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsvTimetable } from './timetable';
import { calibrate, profileToOptions, verifyProfile } from './calibrate';
import { calculateDay } from './calc';

// Official MARA timetable, Muscat, October 2026 (transcribed from mara.gov.om, 12-hour times)
const official = parseCsvTimetable(readFileSync(new URL('../../research/mara-muscat-2026-10.csv', import.meta.url), 'utf8'));
const ref = { wilayatId: 'muscat', label: 'مسقط' };

describe('calibration against the official MARA timetable', () => {
  it('parses the transcribed official month without errors', () => {
    expect(official.errors).toEqual([]);
    expect(official.records).toHaveLength(31);
    expect(official.records[9]).toMatchObject({ date: '2026-10-10', fajr: '04:47', asr: '15:21', maghrib: '17:51', isha: '19:01' });
  });

  for (const [name, lat, lng] of [['Muscat (wilayat centre)', 23.614, 58.593], ['Bawshar', 23.577, 58.4]] as const) {
    it(`reproduces October to the minute from ${name} coordinates`, () => {
      const p = calibrate(official.records, lat, lng, ref, 'x');
      // eslint-disable-next-line no-console
      console.log(name, JSON.stringify({ fa: p.fajrAngle, ia: p.ishaAngle, adjust: p.adjust, rounding: p.rounding, stats: p.stats }));
      expect(p.stats.maxError).toBeLessThanOrEqual(1);
      expect(p.stats.exact / p.stats.total).toBeGreaterThan(0.97);
      const d = calculateDay('2026-10-10', profileToOptions(p));
      expect(d).toMatchObject({ fajr: '04:47', sunrise: '06:02', dhuhr: '11:59', asr: '15:21', maghrib: '17:51', isha: '19:01' });
    });
  }

  it('cross-validation: fitted on 1–15 Oct, predicts 16–31 Oct', () => {
    const train = official.records.slice(0, 15), test = official.records.slice(15);
    const p = calibrate(train, 23.614, 58.593, ref, 'x');
    const v = verifyProfile(p, test);
    // eslint-disable-next-line no-console
    console.log('holdout', JSON.stringify(v));
    expect(v.maxError).toBeLessThanOrEqual(1);
    expect(v.exact / v.total).toBeGreaterThan(0.9);
  });

  it('refuses to calibrate on fewer than 7 days', () => {
    expect(() => calibrate(official.records.slice(0, 3), 23.6, 58.5, ref, 'x')).toThrow();
  });
});

import { fillMissing, extendAhead, needsExtension } from './generate';
import { applyImport } from './timetable';
import { defaultConfig } from '../domain/defaults';

describe('calibrated generation', () => {
  const base = applyImport(null, official, { mode: 'replace', source: 'official', sourceNote: 'MARA', locationLabel: 'مسقط', wilayatId: 'muscat', nowIso: 'x' });
  const cfg = defaultConfig();
  cfg.mosque.location = { governorateId: 'muscat', wilayatId: 'muscat', customLat: null, customLng: null };
  cfg.calc.profile = calibrate(official.records, 23.614, 58.593, ref, 'x');

  it('fills only missing days and never overwrites official days', () => {
    const { schedule, added } = fillMissing(base, '2026-01-01', '2026-12-31', cfg, 'x');
    expect(added).toBe(365 - 31);
    expect(schedule.days['2026-10-10']).toMatchObject({ fajr: '04:47', source: 'official' });
    expect(schedule.days['2026-06-21'].source).toBe('calibrated');
    expect(schedule.meta.dayCount).toBe(365);
  });

  it('auto-extends ahead only when coverage is short', () => {
    expect(needsExtension(base, '2026-10-10')).toBe(true); // only 21 days left
    const { schedule } = extendAhead(base, '2026-10-10', cfg, 'x');
    expect(needsExtension(schedule, '2026-10-10')).toBe(false);
    expect(schedule.days['2027-10-10']?.source).toBe('calibrated');
  });

  it('calibrated days for another wilayat shift with its own coordinates', () => {
    const c2 = { ...cfg, mosque: { ...cfg.mosque, location: { governorateId: 'dhofar', wilayatId: 'salalah', customLat: null, customLng: null } } };
    const { schedule } = fillMissing(null, '2026-10-10', '2026-10-10', c2, 'x');
    const d = schedule.days['2026-10-10'];
    // Salalah is ~4.5° west of Muscat → Dhuhr about 18 minutes later
    expect(Math.abs((+d.dhuhr.slice(0, 2) * 60 + +d.dhuhr.slice(3)) - (11 * 60 + 59) - 18)).toBeLessThanOrEqual(2);
  });
});
