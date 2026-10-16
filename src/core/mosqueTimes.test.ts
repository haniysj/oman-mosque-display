import { describe, expect, it } from 'vitest';
import { buildDayPlan, withMosqueTimes } from './iqamah';
import { defaultConfig } from '../domain/defaults';
import { formatTimestamp } from './time';

const rec = { date: '2026-10-10', fajr: '04:47', sunrise: '06:01', dhuhr: '11:59', asr: '15:21', maghrib: '17:51', isha: '19:01' };

describe("a mosque's own timetable changes", () => {
  it('replace only the changed times of that day', () => {
    const cfg = defaultConfig();
    cfg.timeOverrides = { '2026-10-10': { fajr: '04:50' } };
    expect(withMosqueTimes(rec, cfg)).toMatchObject({ fajr: '04:50', dhuhr: '11:59' });
    expect(withMosqueTimes({ ...rec, date: '2026-10-11' }, cfg).fajr).toBe('04:47');
  });
  it('the day plan (adhan + iqamah) follows the mosque time; the wilayat record is unchanged', () => {
    const cfg = defaultConfig();
    cfg.timeOverrides = { '2026-10-10': { fajr: '04:50' } };
    const plan = buildDayPlan(rec, cfg);
    expect(formatTimestamp(plan.adhan.fajr, '24', 'western').text).toBe('04:50');
    expect(rec.fajr).toBe('04:47');
  });
  it('ignores malformed values', () => {
    const cfg = defaultConfig();
    cfg.timeOverrides = { '2026-10-10': { fajr: '4:5x' } };
    expect(withMosqueTimes(rec, cfg).fajr).toBe('04:47');
  });
});
