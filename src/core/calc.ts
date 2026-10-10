/**
 * On-device astronomical prayer-time calculator (fully offline).
 *
 * IMPORTANT: results are CALCULATED ESTIMATES, not the Ministry of Endowments and
 * Religious Affairs (MARA) timetable. They are always stored with source = 'calculated'
 * and labelled as such. Use them only until the official timetable is imported, or for
 * development. Parameters and per-prayer minute adjustments are configurable so the
 * administrator can align them with the official calendar.
 */
import { CalculationParameters, Coordinates, Madhab, PrayerTimes, Rounding } from 'adhan';
import { DATA_VERSION, type DailyPrayerTimes, type PrayerSchedule, type TimeKey } from '../domain/types';
import { datesOfYear, muscatParts } from './time';
import { buildMeta } from './timetable';

export interface CalcOptions {
  lat: number;
  lng: number;
  fajrAngle: number;
  ishaAngle: number;
  /** Minutes added to each computed time (precautionary/alignment adjustments). */
  adjust: Record<TimeKey, number>;
}

export const DEFAULT_CALC: Omit<CalcOptions, 'lat' | 'lng'> = {
  fajrAngle: 18,
  ishaAngle: 18,
  adjust: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
};

const hhmm = (d: Date) => {
  const p = muscatParts(d.getTime());
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};

export function calculateDay(dateKey: string, o: CalcOptions): DailyPrayerTimes {
  const [y, m, d] = dateKey.split('-').map(Number);
  const params = new CalculationParameters('Other', o.fajrAngle, o.ishaAngle);
  params.madhab = Madhab.Shafi;
  params.rounding = Rounding.Nearest;
  params.adjustments = { ...o.adjust };
  // adhan reads the local Y/M/D components of the Date, so this is device-timezone independent.
  const pt = new PrayerTimes(new Coordinates(o.lat, o.lng), new Date(y, m - 1, d, 12), params);
  return {
    date: dateKey,
    fajr: hhmm(pt.fajr), sunrise: hhmm(pt.sunrise), dhuhr: hhmm(pt.dhuhr),
    asr: hhmm(pt.asr), maghrib: hhmm(pt.maghrib), isha: hhmm(pt.isha),
    source: 'calculated',
  };
}

export function calculateYear(year: number, o: CalcOptions, label: string, wilayatId: string, nowIso: string): PrayerSchedule {
  const days: Record<string, DailyPrayerTimes> = {};
  for (const k of datesOfYear(year)) days[k] = calculateDay(k, o);
  const meta = buildMeta(days, {
    source: 'calculated',
    sourceNote: `محسوب فلكياً على الجهاز (فجر ${o.fajrAngle}°، عشاء ${o.ishaAngle}°، عصر شافعي) — غير رسمي`,
    locationLabel: label,
    wilayatId,
    calcMethod: `fajr=${o.fajrAngle};isha=${o.ishaAngle};asr=shafi;lat=${o.lat};lng=${o.lng}`,
  }, nowIso);
  return { dataVersion: DATA_VERSION, meta, days };
}

/** Development dataset — always labelled DEMO DATA. */
export function demoSchedule(year: number, nowIso: string): PrayerSchedule {
  const s = calculateYear(year, { ...DEFAULT_CALC, lat: 23.588, lng: 58.383 }, 'DEMO DATA — بيانات تجريبية (مسقط)', 'demo', nowIso);
  for (const d of Object.values(s.days)) d.source = 'demo';
  s.meta.source = 'demo';
  s.meta.sourceNote = 'DEMO DATA — بيانات تجريبية للتطوير فقط، ليست مواقيت رسمية';
  return s;
}
