/**
 * Offline Hijri date conversion.
 *
 * Primary: the browser's built-in Umm al-Qura calendar (Intl, no network needed).
 * Fallback: tabular (arithmetical) Islamic calendar for older TV browsers without it.
 * Oman's official Hijri dates follow local moon sighting, so the administrator's
 * adjustment (± days) is applied on top of either method. The adjustment only changes
 * the DISPLAYED Hijri date — never the Gregorian date or the prayer timetable.
 */
import { addDays, parseDateKey, toDigits } from './time';
import type { DigitStyle } from '../domain/types';

export const HIJRI_MONTHS_AR = [
  'محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
  'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة',
];

export interface HijriDate {
  year: number;
  month: number; // 1-12
  day: number;
  method: 'umalqura' | 'tabular';
}

let intlFormatter: Intl.DateTimeFormat | null | undefined;
function getIntl(): Intl.DateTimeFormat | null {
  if (intlFormatter !== undefined) return intlFormatter;
  try {
    const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric',
    });
    const cal = f.resolvedOptions().calendar;
    intlFormatter = cal === 'islamic-umalqura' ? f : null;
  } catch {
    intlFormatter = null;
  }
  return intlFormatter;
}

/** For tests: force the tabular fallback. */
export function _forceTabular(on: boolean) {
  intlFormatter = on ? null : undefined;
}

function gregorianToJD(y: number, m: number, d: number): number {
  if (m < 3) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}
function islamicToJD(y: number, m: number, d: number): number {
  return d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + 1948439.5 - 1;
}
function tabular(y: number, m: number, d: number): HijriDate {
  const jd = Math.floor(gregorianToJD(y, m, d)) + 0.5;
  const year = Math.floor((30 * (jd - 1948439.5) + 10646) / 10631);
  const month = Math.min(12, Math.ceil((jd - (29 + islamicToJD(year, 1, 1))) / 29.5) + 1);
  const day = jd - islamicToJD(year, month, 1) + 1;
  return { year, month, day, method: 'tabular' };
}

export function toHijri(dateKey: string, adjustment = 0): HijriDate {
  const key = adjustment ? addDays(dateKey, adjustment) : dateKey;
  const p = parseDateKey(key);
  if (!p) throw new Error(`Invalid date ${dateKey}`);
  const f = getIntl();
  if (f) {
    try {
      const parts = f.formatToParts(new Date(Date.UTC(p.y, p.m - 1, p.d, 12)));
      const get = (t: string) => Number(parts.find((x) => x.type === t)?.value);
      const year = get('year'), month = get('month'), day = get('day');
      if (year > 1300 && month >= 1 && month <= 12 && day >= 1 && day <= 30) {
        return { year, month, day, method: 'umalqura' };
      }
    } catch {
      /* fall through */
    }
  }
  return tabular(p.y, p.m, p.d);
}

export function formatHijriAr(h: HijriDate, digits: DigitStyle): string {
  return `${toDigits(h.day, digits)} ${HIJRI_MONTHS_AR[h.month - 1]} ${toDigits(h.year, digits)}هـ`;
}
