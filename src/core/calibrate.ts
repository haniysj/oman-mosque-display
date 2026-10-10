/**
 * Calibration against the official ministry (MARA) timetable.
 *
 * The ministry publishes tables per city but not its exact method. Given official days
 * that the administrator imported, this finds — for the chosen reference coordinates —
 * the Fajr/Isha angles and a per-prayer offset (to 0.1 min) + rounding rule that reproduce
 * those days most exactly. The resulting profile then generates any future date offline.
 *
 * Findings on MARA Muscat, October 2026 (research/mara-muscat-2026-10.csv): Fajr ≈ 18°,
 * Isha ≈ 18°, Asr = Shafi (shadow 1×), and roughly +5 minutes of precaution on Dhuhr,
 * Asr and Maghrib. One month cannot separate angle from offset; calibrate with months
 * from different seasons (e.g. January + June + October) for year-round accuracy.
 */
import type { DailyPrayerTimes, TimeKey } from '../domain/types';
import { TIME_KEYS } from '../domain/types';
import { rawDay, roundMin, type CalcOptions, type RoundMode } from './calc';
import { parseHHMM } from './time';

export interface CalibrationStats {
  days: number;
  exact: number; // prayer-times that match to the minute
  total: number; // days × 6
  maxError: number; // minutes
  perPrayer: Record<TimeKey, { exact: number; maxError: number }>;
}

export interface CalibrationProfile {
  version: 1;
  lat: number;
  lng: number;
  fajrAngle: number;
  ishaAngle: number;
  adjust: Record<TimeKey, number>;
  rounding: Record<TimeKey, RoundMode>;
  reference: { wilayatId: string; label: string; firstDate: string; lastDate: string; days: number; months: string[] };
  stats: CalibrationStats;
  /** false when the reference covers a single season (angles kept at 18°). */
  multiSeason: boolean;
  createdAt: string;
}

const MODES: RoundMode[] = ['nearest', 'ceil', 'floor'];
const ANGLES = [16, 16.5, 17, 17.25, 17.5, 17.75, 18, 18.25, 18.5, 18.75, 19, 19.5, 20];

interface Fit { offset: number; mode: RoundMode; exact: number; maxError: number; absSum: number }

function fitOne(raw: number[], official: number[]): Fit {
  let best: Fit | null = null;
  for (const mode of MODES) {
    for (let i = -150; i <= 150; i++) {
      const offset = i / 10;
      let exact = 0, maxError = 0, absSum = 0;
      for (let d = 0; d < raw.length; d++) {
        const e = Math.abs(roundMin(raw[d] + offset, mode) - official[d]);
        if (e === 0) exact++;
        if (e > maxError) maxError = e;
        absSum += e;
      }
      const better = !best || exact > best.exact || (exact === best.exact && (maxError < best.maxError
        || (maxError === best.maxError && (absSum < best.absSum || (absSum === best.absSum && Math.abs(offset) < Math.abs(best.offset))))));
      if (better) best = { offset, mode, exact, maxError, absSum };
    }
  }
  return best!;
}

export function calibrate(
  official: DailyPrayerTimes[],
  lat: number,
  lng: number,
  ref: { wilayatId: string; label: string },
  nowIso: string,
): CalibrationProfile {
  const days = official.filter((r) => TIME_KEYS.every((k) => parseHHMM(r[k]) !== null)).sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < 7) throw new Error('تحتاج المعايرة 7 أيام رسمية على الأقل');

  const target = (k: TimeKey) => days.map((r) => parseHHMM(r[k])!);
  const rawCache = new Map<string, Record<TimeKey, number>[]>();
  const raws = (fa: number, ia: number) => {
    const key = `${fa}/${ia}`;
    if (!rawCache.has(key)) rawCache.set(key, days.map((r) => rawDay(r.date, lat, lng, fa, ia)));
    return rawCache.get(key)!;
  };

  // Fajr / Isha: choose the angle that fits best; ties go to the angle closest to 18°.
  const pickAngle = (k: 'fajr' | 'isha') => {
    let best: { a: number; f: Fit } | null = null;
    for (const a of ANGLES) {
      const R = raws(k === 'fajr' ? a : 18, k === 'isha' ? a : 18).map((x) => x[k]);
      const f = fitOne(R, target(k));
      const better = !best || f.exact > best.f.exact || (f.exact === best.f.exact && (f.maxError < best.f.maxError
        || (f.maxError === best.f.maxError && Math.abs(a - 18) < Math.abs(best.a - 18))));
      if (better) best = { a, f };
    }
    return best!;
  };
  // Within a single season, an angle change and a constant offset are indistinguishable, and a
  // wrong angle drifts by several minutes in other seasons. So angles are only fitted when the
  // official data spans at least ~4 months; otherwise the standard 18° / 18° is kept.
  const spanDays = (Date.parse(days[days.length - 1].date) - Date.parse(days[0].date)) / 86_400_000;
  const multiSeason = spanDays >= 120;
  const fixed = (k: 'fajr' | 'isha') => ({ a: 18, f: fitOne(raws(18, 18).map((x) => x[k]), target(k)) });
  const fj = multiSeason ? pickAngle('fajr') : fixed('fajr');
  const is = multiSeason ? pickAngle('isha') : fixed('isha');
  const base = raws(18, 18);
  const fits = {} as Record<TimeKey, Fit>;
  fits.fajr = fj.f;
  fits.isha = is.f;
  for (const k of ['sunrise', 'dhuhr', 'asr', 'maghrib'] as TimeKey[]) fits[k] = fitOne(base.map((x) => x[k]), target(k));

  const perPrayer = {} as CalibrationStats['perPrayer'];
  let exact = 0, maxError = 0;
  for (const k of TIME_KEYS) {
    perPrayer[k] = { exact: fits[k].exact, maxError: fits[k].maxError };
    exact += fits[k].exact;
    maxError = Math.max(maxError, fits[k].maxError);
  }
  return {
    version: 1,
    lat, lng,
    fajrAngle: fj.a,
    ishaAngle: is.a,
    adjust: Object.fromEntries(TIME_KEYS.map((k) => [k, fits[k].offset])) as Record<TimeKey, number>,
    rounding: Object.fromEntries(TIME_KEYS.map((k) => [k, fits[k].mode])) as Record<TimeKey, RoundMode>,
    reference: {
      ...ref,
      firstDate: days[0].date,
      lastDate: days[days.length - 1].date,
      days: days.length,
      months: [...new Set(days.map((d) => d.date.slice(0, 7)))],
    },
    stats: { days: days.length, exact, total: days.length * 6, maxError, perPrayer },
    multiSeason,
    createdAt: nowIso,
  };
}

export function profileToOptions(p: CalibrationProfile, lat = p.lat, lng = p.lng): CalcOptions {
  return { lat, lng, fajrAngle: p.fajrAngle, ishaAngle: p.ishaAngle, adjust: { ...p.adjust }, rounding: { ...p.rounding } };
}

/** Re-checks a profile against official days (e.g. a newly imported month) without refitting. */
export function verifyProfile(p: CalibrationProfile, official: DailyPrayerTimes[], lat = p.lat, lng = p.lng): CalibrationStats {
  const o = profileToOptions(p, lat, lng);
  const perPrayer = Object.fromEntries(TIME_KEYS.map((k) => [k, { exact: 0, maxError: 0 }])) as CalibrationStats['perPrayer'];
  let exact = 0, maxError = 0;
  for (const r of official) {
    const raw = rawDay(r.date, lat, lng, o.fajrAngle, o.ishaAngle);
    for (const k of TIME_KEYS) {
      const e = Math.abs(roundMin(raw[k] + o.adjust[k], o.rounding?.[k]) - parseHHMM(r[k])!);
      if (e === 0) { exact++; perPrayer[k].exact++; }
      perPrayer[k].maxError = Math.max(perPrayer[k].maxError, e);
      maxError = Math.max(maxError, e);
    }
  }
  return { days: official.length, exact, total: official.length * 6, maxError, perPrayer };
}
