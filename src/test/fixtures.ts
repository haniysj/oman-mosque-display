import type { DailyPrayerTimes, PrayerSchedule } from '../domain/types';
import { buildMeta } from '../core/timetable';
import { defaultConfig, defaultAdhkar } from '../domain/defaults';
import { datesOfYear, muscatTimestamp } from '../core/time';

export const T = { fajr: '04:30', sunrise: '05:45', dhuhr: '11:50', asr: '15:10', maghrib: '17:40', isha: '19:00' };

export function rec(date: string, over: Partial<DailyPrayerTimes> = {}): DailyPrayerTimes {
  return { date, ...T, ...over };
}

export function schedule(dates: string[], over: (d: string) => Partial<DailyPrayerTimes> = () => ({})): PrayerSchedule {
  const days = Object.fromEntries(dates.map((d) => [d, rec(d, over(d))]));
  return { dataVersion: 1, meta: buildMeta(days, { source: 'admin', sourceNote: 'test', locationLabel: 'test', wilayatId: 'test' }, '2026-01-01T00:00:00Z'), days };
}

export const yearSchedule = (y = 2026) => schedule(datesOfYear(y));
export const at = (date: string, hhmm: string, sec = 0) => {
  const [h, m] = hhmm.split(':').map(Number);
  return muscatTimestamp(date, h * 60 + m) + sec * 1000;
};
export const cfg = () => defaultConfig();
export const adhkar = () => defaultAdhkar();
