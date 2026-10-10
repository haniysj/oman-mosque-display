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
import { datesOfYear, toHHMM } from './time';
import { buildMeta } from './timetable';

export type RoundMode = 'nearest' | 'ceil' | 'floor';

export interface CalcOptions {
  lat: number;
  lng: number;
  fajrAngle: number;
  ishaAngle: number;
  /** Minutes (may be fractional) added to each computed time — precautions / alignment with the ministry. */
  adjust: Record<TimeKey, number>;
  /** How each time is rounded to the displayed minute (default: nearest). */
  rounding?: Partial<Record<TimeKey, RoundMode>>;
}

export const DEFAULT_CALC: Omit<CalcOptions, 'lat' | 'lng'> = {
  fajrAngle: 18,
  ishaAngle: 18,
  adjust: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
};

const KEYS: TimeKey[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
const muscatMinutes = (d: Date) => ((d.getTime() / 60000 + 240) % 1440 + 1440) % 1440;

/** Unrounded astronomical times in Muscat minutes-of-day (fractional). */
export function rawDay(dateKey: string, lat: number, lng: number, fajrAngle: number, ishaAngle: number): Record<TimeKey, number> {
  const [y, m, d] = dateKey.split('-').map(Number);
  const params = new CalculationParameters('Other', fajrAngle, ishaAngle);
  params.madhab = Madhab.Shafi;
  params.rounding = Rounding.None;
  // adhan reads the local Y/M/D components of the Date, so this is device-timezone independent.
  const pt = new PrayerTimes(new Coordinates(lat, lng), new Date(y, m - 1, d, 12), params);
  return { fajr: muscatMinutes(pt.fajr), sunrise: muscatMinutes(pt.sunrise), dhuhr: muscatMinutes(pt.dhuhr), asr: muscatMinutes(pt.asr), maghrib: muscatMinutes(pt.maghrib), isha: muscatMinutes(pt.isha) };
}

export function roundMin(v: number, mode: RoundMode = 'nearest'): number {
  // tiny epsilon guards against floating noise (e.g. 719.9999999 → 720)
  return mode === 'ceil' ? Math.ceil(v - 1e-6) : mode === 'floor' ? Math.floor(v + 1e-6) : Math.round(v);
}

export function calculateDay(dateKey: string, o: CalcOptions): DailyPrayerTimes {
  const raw = rawDay(dateKey, o.lat, o.lng, o.fajrAngle, o.ishaAngle);
  const out = { date: dateKey, source: 'calculated' } as DailyPrayerTimes;
  for (const k of KEYS) out[k] = toHHMM(roundMin(raw[k] + (o.adjust[k] ?? 0), o.rounding?.[k]));
  return out;
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
