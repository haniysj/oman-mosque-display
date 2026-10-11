/**
 * Iqamah calculation engine.
 *
 * Priority for each prayer's iqamah on a given date (highest first):
 *   1. Date-specific exception set in the admin panel
 *   1b. Frozen (locked) iqamah time for the prayer
 *   2. Iqamah override stored in the timetable record for that date
 *   3. Weekday rule (e.g. a different Fajr iqamah on Thursdays)
 *   4. Standard rule: adhan + delay, or a fixed clock time
 * Friday (Jumu'ah) has its own independent configuration.
 * All results are absolute timestamps, so midnight crossings are handled naturally.
 */
import type { AppConfig, DailyPrayerTimes, IqamahRule, PrayerKey } from '../domain/types';
import { PRAYER_KEYS } from '../domain/types';
import { MINUTE, muscatTimestamp, parseHHMM, weekdayOf } from './time';

export type SlotKey = PrayerKey; // dhuhr slot becomes Jumu'ah on Fridays

export interface IqamahResult {
  at: number;
  how: 'exception' | 'lock' | 'record' | 'weekday' | 'fixed' | 'delay' | 'friday' | 'friday-fallback';
}

export interface DayPlan {
  date: string;
  weekday: number;
  isFriday: boolean; // Friday AND Friday mode enabled
  adhan: Record<SlotKey, number>;
  iqamah: Record<SlotKey, IqamahResult>;
  sunrise: number;
  duha: number;
  warnings: string[];
}

const NAMES: Record<PrayerKey, string> = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };

function applyRule(date: string, adhanMin: number, adhanTs: number, rule: IqamahRule, label: string, warnings: string[]): { at: number; fixed: boolean } {
  if (rule.mode === 'fixed') {
    let fixed = parseHHMM(rule.fixedTime);
    if (fixed !== null) {
      // a fixed time just after midnight for a late-evening prayer belongs to the next day
      if (fixed < adhanMin && adhanMin >= 20 * 60 && fixed < 3 * 60) fixed += 1440;
      if (fixed >= adhanMin) return { at: muscatTimestamp(date, fixed), fixed: true };
      warnings.push(`إقامة ${label} الثابتة (${rule.fixedTime}) قبل وقت الأذان — تم استخدام التأخير بالدقائق بدلاً منها`);
    } else if (rule.fixedTime) {
      warnings.push(`وقت إقامة ${label} الثابت غير صالح — تم استخدام التأخير بالدقائق`);
    }
  }
  const delay = Number.isFinite(rule.delay) ? Math.max(0, Math.min(180, Math.round(rule.delay))) : 0;
  return { at: adhanTs + delay * MINUTE, fixed: false };
}

export function buildDayPlan(rec: DailyPrayerTimes, cfg: AppConfig): DayPlan {
  const date = rec.date;
  const weekday = weekdayOf(date);
  const isFriday = weekday === 5 && cfg.friday.enabled;
  const warnings: string[] = [];
  const adhan = {} as Record<SlotKey, number>;
  const iqamah = {} as Record<SlotKey, IqamahResult>;

  for (const p of PRAYER_KEYS) {
    let adhanMin = parseHHMM(rec[p])!;
    if (p === 'dhuhr' && isFriday) {
      const fixedStart = cfg.friday.startMode === 'fixed' ? parseHHMM(cfg.friday.startTime) : null;
      const recJ = parseHHMM(rec.jumuah);
      adhanMin = fixedStart ?? recJ ?? adhanMin;
    }
    const adhanTs = muscatTimestamp(date, adhanMin);
    adhan[p] = adhanTs;
    const label = p === 'dhuhr' && isFriday ? cfg.friday.label || 'الجمعة' : NAMES[p];
    const slot = p === 'dhuhr' && isFriday ? 'jumuah' : p;

    // 1. date exception
    const ex = cfg.iqamah.dateExceptions.find((e) => e.date === date && e.prayer === slot);
    const exMin = ex ? parseHHMM(ex.time) : null;
    if (exMin !== null && exMin >= adhanMin) { iqamah[p] = { at: muscatTimestamp(date, exMin), how: 'exception' }; continue; }
    if (ex) warnings.push(`استثناء إقامة ${label} بتاريخ ${date} غير صالح أو قبل الأذان — تم تجاهله`);

    // 1b. frozen iqamah (daily lock) — not on Friday's Jumu'ah slot, which has its own settings
    const lock = slot === p ? cfg.iqamah.locks?.[p] : undefined;
    if (lock?.enabled) {
      let lm = parseHHMM(lock.time);
      if (lm !== null && lm < adhanMin && adhanMin >= 20 * 60 && lm < 3 * 60) lm += 1440;
      if (lm !== null && lm >= adhanMin) { iqamah[p] = { at: muscatTimestamp(date, lm), how: 'lock' }; continue; }
      warnings.push(lm === null ? `وقت تثبيت إقامة ${label} غير صالح — طُبّقت القاعدة المعتادة` : `تثبيت إقامة ${label} (${lock.time}) قبل وقت الأذان في ${date} — طُبّقت القاعدة المعتادة لهذا اليوم`);
    }

    // 2. timetable record override
    const recMin = parseHHMM(rec.iqamah?.[slot]);
    if (recMin !== null && recMin >= adhanMin) { iqamah[p] = { at: muscatTimestamp(date, recMin), how: 'record' }; continue; }

    // Friday has its own configuration
    if (p === 'dhuhr' && isFriday) {
      if (cfg.friday.configured) {
        const r = applyRule(date, adhanMin, adhanTs, cfg.friday.iqamah, label, warnings);
        iqamah[p] = { at: r.at, how: 'friday' };
      } else {
        warnings.push('لم تُضبط إعدادات صلاة الجمعة بعد — تُعرض إقامة الجمعة مؤقتاً بحسب إعداد الظهر. اضبطها من قسم الإقامة.');
        const r = applyRule(date, adhanMin, adhanTs, cfg.iqamah.rules.dhuhr, label, warnings);
        iqamah[p] = { at: r.at, how: 'friday-fallback' };
      }
      continue;
    }

    // 3. weekday rule, 4. standard rule
    const wr = cfg.iqamah.weekdayRules[weekday]?.[p];
    const r = applyRule(date, adhanMin, adhanTs, wr ?? cfg.iqamah.rules[p], label, warnings);
    iqamah[p] = { at: r.at, how: wr ? 'weekday' : r.fixed ? 'fixed' : 'delay' };
  }

  const sunrise = muscatTimestamp(date, parseHHMM(rec.sunrise)!);
  const duha = sunrise + Math.max(0, cfg.display.duhaMinutesAfterSunrise) * MINUTE;
  return { date, weekday, isFriday, adhan, iqamah, sunrise, duha, warnings };
}
