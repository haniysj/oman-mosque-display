/**
 * Date & clock services for Asia/Muscat.
 *
 * Oman uses UTC+04:00 all year (no daylight saving), so local Muscat time is derived
 * from the absolute timestamp with a fixed offset. This deliberately does NOT depend on
 * the device's timezone setting or on Intl timezone data (missing on some smart TVs).
 */
import type { DigitStyle } from '../domain/types';

export const MUSCAT_OFFSET_MS = 4 * 60 * 60 * 1000;
export const MINUTE = 60_000;
export const SECOND = 1000;
export const DAY_MS = 86_400_000;

export interface MuscatParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday … 6 = Saturday
  dateKey: string; // YYYY-MM-DD
}

const pad = (n: number, l = 2) => String(n).padStart(l, '0');

export function muscatParts(ms: number): MuscatParts {
  const t = new Date(ms + MUSCAT_OFFSET_MS);
  const year = t.getUTCFullYear();
  const month = t.getUTCMonth() + 1;
  const day = t.getUTCDate();
  return {
    year, month, day,
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    second: t.getUTCSeconds(),
    weekday: t.getUTCDay(),
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
  };
}

export const muscatDateKey = (ms: number) => muscatParts(ms).dateKey;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateKey(key: string): { y: number; m: number; d: number } | null {
  const mt = DATE_RE.exec(key);
  if (!mt) return null;
  const y = +mt[1], m = +mt[2], d = +mt[3];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInYear = (y: number) => (isLeapYear(y) ? 366 : 365);
export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Absolute timestamp of 00:00 Muscat on the given date. */
export function muscatMidnight(dateKey: string): number {
  const p = parseDateKey(dateKey);
  if (!p) throw new Error(`Invalid date: ${dateKey}`);
  return Date.UTC(p.y, p.m - 1, p.d) - MUSCAT_OFFSET_MS;
}

/** Absolute timestamp for a Muscat date + minutes since midnight (may exceed 1440 → next day). */
export function muscatTimestamp(dateKey: string, minutesOfDay: number): number {
  return muscatMidnight(dateKey) + minutesOfDay * MINUTE;
}

export function addDays(dateKey: string, n: number): string {
  return muscatDateKey(muscatMidnight(dateKey) + n * DAY_MS + 12 * 3600_000);
}

export function weekdayOf(dateKey: string): number {
  const p = parseDateKey(dateKey);
  if (!p) return -1;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

/** Every date of a Gregorian year (365 or 366 entries). */
export function datesOfYear(y: number): string[] {
  const out: string[] = [];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= daysInMonth(y, m); d++) out.push(`${y}-${pad(m)}-${pad(d)}`);
  return out;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
export function parseHHMM(s: string | undefined | null): number | null {
  if (typeof s !== 'string') return null;
  const mt = TIME_RE.exec(s.trim());
  return mt ? +mt[1] * 60 + +mt[2] : null;
}
export function toHHMM(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

// ---------- Arabic formatting ----------

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
export function toDigits(s: string | number, style: DigitStyle): string {
  const str = String(s);
  return style === 'arabic' ? str.replace(/[0-9]/g, (d) => ARABIC_DIGITS[+d]) : str;
}
/** Converts Arabic-Indic / Persian digits to Western digits (for imports). */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const GREGORIAN_MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export interface FormattedTime {
  text: string; // "4:52" or "16:52"
  seconds: string; // "07"
  period: string; // "صباحاً" | "مساءً" | ""
}

export function formatClock(minutesOfDay: number, seconds: number, fmt: '12' | '24', digits: DigitStyle): FormattedTime {
  const m = ((Math.floor(minutesOfDay) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  if (fmt === '24') {
    return { text: toDigits(`${pad(h24)}:${pad(mm)}`, digits), seconds: toDigits(pad(seconds), digits), period: '' };
  }
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return {
    text: toDigits(`${h12}:${pad(mm)}`, digits),
    seconds: toDigits(pad(seconds), digits),
    period: h24 < 12 ? 'صباحاً' : 'مساءً',
  };
}

/** Formats an absolute timestamp as Muscat time. */
export function formatTimestamp(ms: number, fmt: '12' | '24', digits: DigitStyle): FormattedTime {
  const p = muscatParts(ms);
  return formatClock(p.hour * 60 + p.minute, p.second, fmt, digits);
}

export function formatGregorianAr(dateKey: string, digits: DigitStyle): string {
  const p = parseDateKey(dateKey);
  if (!p) return '';
  return `${toDigits(p.d, digits)} ${GREGORIAN_MONTHS_AR[p.m - 1]} ${toDigits(p.y, digits)}م`;
}

/** mm:ss countdown text, e.g. "00:59". */
export function formatCountdown(totalSeconds: number, digits: DigitStyle): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const txt = h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  return toDigits(txt, digits);
}
