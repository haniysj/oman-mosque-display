/**
 * Power-saving black screen: extra periods not tied to a prayer (e.g. 10 pm → 3 am).
 * Times are Muscat local time; a daily period whose end is not after its start crosses midnight.
 */
import type { AppConfig, SleepPeriod } from '../domain/types';
import { addDays, MINUTE, muscatDateKey, muscatTimestamp, parseHHMM } from './time';

export interface SleepWindow { id: string; start: number; end: number }

/** The window of `p` that contains `now`, or null. */
export function sleepWindowAt(p: SleepPeriod, now: number): SleepWindow | null {
  if (!p.enabled) return null;
  const f = parseHHMM(p.from), t = parseHHMM(p.to);
  if (f === null || t === null) return null;
  if (p.repeat === 'once') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(p.toDate)) return null;
    const start = muscatTimestamp(p.fromDate, f), end = muscatTimestamp(p.toDate, t);
    return end > start && now >= start && now < end ? { id: `${p.id}@${start}`, start, end } : null;
  }
  if (f === t) return null;
  const today = muscatDateKey(now);
  for (const d of [addDays(today, -1), today]) {
    const start = muscatTimestamp(d, f);
    const end = muscatTimestamp(t > f ? d : addDays(d, 1), t);
    if (now >= start && now < end) return { id: `${p.id}@${start}`, start, end };
  }
  return null;
}

/** The active power-saving window (if any) for this config at `now`. */
export function activeSleep(cfg: AppConfig, now: number): SleepWindow | null {
  const s = cfg.quiet.sleep;
  if (!s?.enabled) return null;
  for (const p of s.periods ?? []) {
    const w = sleepWindowAt(p, now);
    if (w) return w;
  }
  return null;
}

/** How long before each adhan the normal screen comes back during a power-saving period. */
export const SLEEP_WAKE_BEFORE_ADHAN_MS = 10 * MINUTE;
