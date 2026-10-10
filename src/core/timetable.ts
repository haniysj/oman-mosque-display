/**
 * Prayer timetable: lookup, import parsing (CSV / JSON), validation, merge and export.
 * A valid schedule is NEVER replaced by data that fails validation.
 */
import {
  DATA_VERSION, PRAYER_KEYS, TIME_KEYS,
  type DailyPrayerTimes, type DataSourceKind, type PrayerSchedule, type TimeKey, type TimetableMetadata,
} from '../domain/types';
import { addDays, daysInYear, normalizeDigits, parseDateKey, parseHHMM, toHHMM } from './time';

// ------------------------------------------------------------------ lookup

export function getDay(schedule: PrayerSchedule | null, dateKey: string): DailyPrayerTimes | null {
  return schedule?.days[dateKey] ?? null;
}

export interface Coverage {
  coversToday: boolean;
  daysRemaining: number; // days after today still covered (−1 when today is not covered)
  firstDate: string | null;
  lastDate: string | null;
}

export function coverage(schedule: PrayerSchedule | null, today: string): Coverage {
  if (!schedule) return { coversToday: false, daysRemaining: -1, firstDate: null, lastDate: null };
  const covers = !!schedule.days[today];
  let remaining = -1;
  if (covers) {
    remaining = 0;
    let d = addDays(today, 1);
    while (schedule.days[d] && remaining < 4000) { remaining++; d = addDays(d, 1); }
  }
  return { coversToday: covers, daysRemaining: remaining, firstDate: schedule.meta.firstDate, lastDate: schedule.meta.lastDate };
}

// ------------------------------------------------------------------ parsing helpers

const HEADER_ALIASES: Record<string, string[]> = {
  date: ['date', 'day', 'gregorian', 'التاريخ', 'تاريخ', 'اليوم', 'التاريخ الميلادي'],
  fajr: ['fajr', 'subh', 'الفجر', 'فجر', 'الصبح'],
  sunrise: ['sunrise', 'shuruq', 'shurooq', 'الشروق', 'شروق'],
  dhuhr: ['dhuhr', 'zuhr', 'duhr', 'الظهر', 'ظهر'],
  asr: ['asr', 'العصر', 'عصر'],
  maghrib: ['maghrib', 'المغرب', 'مغرب'],
  isha: ['isha', "isha'a", 'العشاء', 'عشاء'],
  jumuah: ['jumuah', 'jumua', 'friday', 'الجمعة', 'جمعة'],
  iqamah_fajr: ['iqamah_fajr', 'إقامة الفجر'],
  iqamah_dhuhr: ['iqamah_dhuhr', 'إقامة الظهر'],
  iqamah_asr: ['iqamah_asr', 'إقامة العصر'],
  iqamah_maghrib: ['iqamah_maghrib', 'إقامة المغرب'],
  iqamah_isha: ['iqamah_isha', 'إقامة العشاء'],
  iqamah_jumuah: ['iqamah_jumuah', 'إقامة الجمعة'],
};

const normHeader = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/[\s_-]+/g, '_');

function mapHeader(h: string): string | null {
  const n = normHeader(h);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((a) => normHeader(a) === n)) return key;
  }
  return null;
}

/** Splits CSV text into rows, supporting quotes and , ; or tab delimiters. */
export function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = clean.split('\n').find((l) => l.trim()) ?? '';
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQ) {
      if (c === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** Accepts YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (Arabic digits allowed). */
export function normalizeDate(raw: string): string | null {
  const s = normalizeDigits(String(raw ?? '')).trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else {
    mt = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
    if (!mt) return null;
    d = +mt[1]; m = +mt[2]; y = +mt[3];
  }
  const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return parseDateKey(key) ? key : null;
}

/** Expected 24-hour ranges, used only to resolve 12-hour times written without AM/PM. */
const EXPECTED_HOURS: Record<string, [number, number]> = {
  fajr: [2, 7], sunrise: [4, 8], dhuhr: [11, 13], asr: [13, 17], maghrib: [16, 20], isha: [17, 22], jumuah: [11, 14],
};

export interface TimeParse { value: string | null; converted12h: boolean }

export function normalizeTime(raw: string, field: string): TimeParse {
  let s = normalizeDigits(String(raw ?? '')).trim().toLowerCase();
  if (!s) return { value: null, converted12h: false };
  let period: 'am' | 'pm' | null = null;
  if (/(am|a\.m\.|ص|صباحا|صباحاً)$/.test(s)) period = 'am';
  if (/(pm|p\.m\.|م|مساء|مساءً|مساءا)$/.test(s)) period = 'pm';
  s = s.replace(/(a\.m\.|p\.m\.|am|pm|صباحاً|صباحا|مساءً|مساءا|مساء|ص|م)$/u, '').trim();
  const mt = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(s);
  if (!mt) return { value: null, converted12h: false };
  let h = +mt[1];
  const min = +mt[2];
  if (min > 59 || h > 23) return { value: null, converted12h: false };
  let converted = false;
  if (period) {
    if (h > 12 || h === 0) return { value: null, converted12h: false };
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
  } else {
    const range = EXPECTED_HOURS[field.replace('iqamah_', '')];
    if (range && h < range[0] && h + 12 >= range[0] && h + 12 <= range[1] + 1) { h += 12; converted = true; }
  }
  return { value: toHHMM(h * 60 + min), converted12h: converted };
}

// ------------------------------------------------------------------ validation

export interface ImportIssue { row: number | null; date?: string; message: string }

export type ImportKind = 'daily' | 'monthly' | 'annual' | 'partial';

export interface ImportResult {
  records: DailyPrayerTimes[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  stats: {
    count: number;
    firstDate: string | null;
    lastDate: string | null;
    years: number[];
    kind: ImportKind;
    missingDates: string[];
    duplicates: number;
    converted12h: number;
  };
}

const LABEL_AR: Record<string, string> = {
  fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء', jumuah: 'الجمعة',
};

function emptyResult(): ImportResult {
  return {
    records: [], errors: [], warnings: [],
    stats: { count: 0, firstDate: null, lastDate: null, years: [], kind: 'partial', missingDates: [], duplicates: 0, converted12h: 0 },
  };
}

type RawRecord = Record<string, unknown> & { __row?: number };

function validateRaw(rawRecords: RawRecord[], result: ImportResult): void {
  const byDate = new Map<string, DailyPrayerTimes>();
  rawRecords.forEach((raw, idx) => {
    const row = raw.__row ?? idx + 1;
    const date = normalizeDate(String(raw.date ?? ''));
    if (!date) { result.errors.push({ row, message: `تاريخ غير صالح: «${String(raw.date ?? '')}»` }); return; }
    const rec: DailyPrayerTimes = { date, fajr: '', sunrise: '', dhuhr: '', asr: '', maghrib: '', isha: '' };
    let bad = false;
    for (const k of TIME_KEYS) {
      const t = normalizeTime(String(raw[k] ?? ''), k);
      if (!t.value) { result.errors.push({ row, date, message: `وقت ${LABEL_AR[k]} مفقود أو غير صالح: «${String(raw[k] ?? '')}»` }); bad = true; continue; }
      if (t.converted12h) result.stats.converted12h++;
      rec[k] = t.value;
    }
    if (raw.jumuah !== undefined && String(raw.jumuah).trim() !== '') {
      const t = normalizeTime(String(raw.jumuah), 'jumuah');
      if (t.value) rec.jumuah = t.value;
      else { result.errors.push({ row, date, message: `وقت الجمعة غير صالح: «${String(raw.jumuah)}»` }); bad = true; }
    }
    const iq: NonNullable<DailyPrayerTimes['iqamah']> = {};
    const nestedIq = (raw.iqamah && typeof raw.iqamah === 'object' ? raw.iqamah : {}) as Record<string, unknown>;
    for (const p of [...PRAYER_KEYS, 'jumuah'] as const) {
      const v = raw[`iqamah_${p}`] ?? nestedIq[p];
      if (v === undefined || String(v).trim() === '') continue;
      const t = normalizeTime(String(v), p);
      if (t.value) iq[p] = t.value;
      else { result.errors.push({ row, date, message: `وقت إقامة ${LABEL_AR[p]} غير صالح: «${String(v)}»` }); bad = true; }
    }
    if (Object.keys(iq).length) rec.iqamah = iq;
    if (bad) return;
    // chronological order within the day
    for (let i = 1; i < TIME_KEYS.length; i++) {
      const a = parseHHMM(rec[TIME_KEYS[i - 1]])!, b = parseHHMM(rec[TIME_KEYS[i]])!;
      if (b <= a) {
        result.errors.push({ row, date, message: `ترتيب غير منطقي: ${LABEL_AR[TIME_KEYS[i]]} (${rec[TIME_KEYS[i]]}) ليس بعد ${LABEL_AR[TIME_KEYS[i - 1]]} (${rec[TIME_KEYS[i - 1]]})` });
        bad = true; break;
      }
    }
    if (bad) return;
    const prev = byDate.get(date);
    if (prev) {
      result.stats.duplicates++;
      const same = TIME_KEYS.every((k) => prev[k] === rec[k]);
      if (same) result.warnings.push({ row, date, message: 'تاريخ مكرر بالقيم نفسها — تم تجاهل التكرار' });
      else result.errors.push({ row, date, message: 'تاريخ مكرر بقيم مختلفة — يجب حذف أحد السطرين' });
      return;
    }
    byDate.set(date, rec);
  });

  const records = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  result.records = records;
  const st = result.stats;
  st.count = records.length;
  if (!records.length) {
    if (!result.errors.length) result.errors.push({ row: null, message: 'الملف لا يحتوي على أي سجلات' });
    return;
  }
  st.firstDate = records[0].date;
  st.lastDate = records[records.length - 1].date;
  st.years = [...new Set(records.map((r) => +r.date.slice(0, 4)))];

  // gaps between first and last date
  const missing: string[] = [];
  let d = st.firstDate;
  let guard = 0;
  while (d <= st.lastDate && guard++ < 5000) { if (!byDate.has(d)) missing.push(d); d = addDays(d, 1); }
  st.missingDates = missing;
  if (missing.length) {
    result.warnings.push({ row: null, message: `أيام مفقودة داخل الفترة (${missing.length}): ${missing.slice(0, 6).join('، ')}${missing.length > 6 ? ' …' : ''}` });
  }

  // kind
  const y0 = +st.firstDate.slice(0, 4);
  if (st.count === 1) st.kind = 'daily';
  else if (st.years.length === 1 && st.firstDate === `${y0}-01-01` && st.lastDate === `${y0}-12-31` && st.count === daysInYear(y0)) st.kind = 'annual';
  else if (st.firstDate.slice(0, 7) === st.lastDate.slice(0, 7) && !missing.length) st.kind = 'monthly';
  else st.kind = 'partial';

  if (st.years.length === 1 && st.kind !== 'annual' && st.count > 300) {
    result.warnings.push({ row: null, message: `السنة ${y0} غير مكتملة: ${st.count} من ${daysInYear(y0)} يوماً` });
  }

  // implausible day-to-day jumps (likely typing errors)
  for (let i = 1; i < records.length; i++) {
    if (addDays(records[i - 1].date, 1) !== records[i].date) continue;
    for (const k of TIME_KEYS) {
      const diff = Math.abs(parseHHMM(records[i][k])! - parseHHMM(records[i - 1][k])!);
      if (diff > 10) {
        result.warnings.push({ row: null, date: records[i].date, message: `تغير كبير في ${LABEL_AR[k]} (${diff} دقيقة) مقارنة باليوم السابق — تحقق من صحة القيمة` });
      }
    }
  }
  if (st.converted12h) {
    result.warnings.push({ row: null, message: `تم تحويل ${st.converted12h} وقتاً من صيغة 12 ساعة (دون ص/م) إلى صيغة 24 ساعة اعتماداً على موضع الصلاة` });
  }
}

export function parseCsvTimetable(text: string): ImportResult {
  const result = emptyResult();
  const rows = parseCsvRows(text);
  if (rows.length < 2) { result.errors.push({ row: null, message: 'ملف CSV فارغ أو بلا سطر عناوين' }); return result; }
  const header = rows[0].map(mapHeader);
  const missingCols = ['date', ...TIME_KEYS].filter((k) => !header.includes(k));
  if (missingCols.length) {
    result.errors.push({ row: 1, message: `أعمدة ناقصة في سطر العناوين: ${missingCols.join(', ')}` });
    return result;
  }
  const raws: RawRecord[] = rows.slice(1).map((r, i) => {
    const o: RawRecord = { __row: i + 2 };
    header.forEach((k, c) => { if (k) o[k] = r[c] ?? ''; });
    return o;
  });
  validateRaw(raws, result);
  return result;
}

export function parseJsonTimetable(text: string): ImportResult {
  const result = emptyResult();
  let data: unknown;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch (e) {
    result.errors.push({ row: null, message: `ملف JSON غير صالح: ${(e as Error).message}` });
    return result;
  }
  let list: unknown[] | null = null;
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (o.kind === 'oman-mosque-display-backup') {
      result.errors.push({ row: null, message: 'هذا ملف نسخة احتياطية كاملة — استخدم قسم «النسخ الاحتياطي والاستعادة»' });
      return result;
    }
    if (Array.isArray(o.days)) list = o.days;
    else if (o.days && typeof o.days === 'object') list = Object.values(o.days);
    else if (Object.keys(o).every((k) => normalizeDate(k))) list = Object.entries(o).map(([date, v]) => ({ date, ...(v as object) }));
  }
  if (!list) { result.errors.push({ row: null, message: 'بنية JSON غير معروفة: يجب أن تكون مصفوفة سجلات أو كائناً يحتوي days' }); return result; }
  const raws: RawRecord[] = list.map((x, i) => {
    const o: RawRecord = { __row: i + 1 };
    if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) o[mapHeader(k) ?? k] = v;
    return o;
  });
  validateRaw(raws, result);
  return result;
}

export function parseTimetableFile(name: string, text: string): ImportResult {
  const t = text.trim();
  if (/\.json$/i.test(name) || t.startsWith('[') || t.startsWith('{')) return parseJsonTimetable(text);
  return parseCsvTimetable(text);
}

// ------------------------------------------------------------------ build / merge

export function newId(prefix = 'tt'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildMeta(
  days: Record<string, DailyPrayerTimes>,
  base: Pick<TimetableMetadata, 'source' | 'sourceNote' | 'locationLabel' | 'wilayatId'> & Partial<TimetableMetadata>,
  nowIso: string,
): TimetableMetadata {
  const keys = Object.keys(days).sort();
  return {
    id: base.id ?? newId(),
    version: (base.version ?? 0) + 1,
    source: base.source,
    sourceNote: base.sourceNote,
    locationLabel: base.locationLabel,
    wilayatId: base.wilayatId,
    years: [...new Set(keys.map((k) => +k.slice(0, 4)))],
    firstDate: keys[0] ?? '',
    lastDate: keys[keys.length - 1] ?? '',
    dayCount: keys.length,
    importedAt: base.importedAt ?? nowIso,
    lastUpdated: nowIso,
    calcMethod: base.calcMethod,
  };
}

export interface ApplyOptions {
  mode: 'replace' | 'merge';
  source: DataSourceKind;
  sourceNote: string;
  locationLabel: string;
  wilayatId: string;
  nowIso: string;
}

/**
 * Produces the schedule that WOULD result from an import. Throws when the import has errors —
 * callers keep the current schedule in that case.
 */
export function applyImport(current: PrayerSchedule | null, imp: ImportResult, opt: ApplyOptions): PrayerSchedule {
  if (imp.errors.length) throw new Error('لا يمكن تطبيق استيراد يحتوي على أخطاء');
  if (!imp.records.length) throw new Error('لا توجد سجلات للاستيراد');
  const days: Record<string, DailyPrayerTimes> = opt.mode === 'merge' && current ? { ...current.days } : {};
  for (const r of imp.records) days[r.date] = { ...r, source: opt.source };
  const keepIdentity = opt.mode === 'merge' && current;
  const meta = buildMeta(days, {
    ...(keepIdentity ? { id: current!.meta.id, version: current!.meta.version, importedAt: current!.meta.importedAt } : {}),
    source: keepIdentity && current!.meta.source !== opt.source ? 'admin' : opt.source,
    sourceNote: keepIdentity ? `${current!.meta.sourceNote} + ${opt.sourceNote}` : opt.sourceNote,
    locationLabel: opt.locationLabel,
    wilayatId: opt.wilayatId,
  }, opt.nowIso);
  return { dataVersion: DATA_VERSION, meta, days };
}

/** Edits a single day (admin correction). Validates order before accepting. */
export function editDay(schedule: PrayerSchedule, rec: DailyPrayerTimes, nowIso: string): PrayerSchedule {
  const imp = emptyResult();
  validateRaw([{ ...rec, __row: 1 } as unknown as RawRecord], imp);
  if (imp.errors.length) throw new Error(imp.errors.map((e) => e.message).join('\n'));
  const days = { ...schedule.days, [rec.date]: { ...imp.records[0], source: 'admin' as const } };
  const meta = buildMeta(days, { ...schedule.meta }, nowIso);
  return { ...schedule, meta, days };
}

// ------------------------------------------------------------------ export

export function exportCsv(schedule: PrayerSchedule): string {
  const head = ['date', ...TIME_KEYS, 'jumuah', 'iqamah_fajr', 'iqamah_dhuhr', 'iqamah_asr', 'iqamah_maghrib', 'iqamah_isha', 'iqamah_jumuah', 'source'];
  const lines = [head.join(',')];
  for (const k of Object.keys(schedule.days).sort()) {
    const r = schedule.days[k];
    lines.push([
      r.date, ...TIME_KEYS.map((t: TimeKey) => r[t]), r.jumuah ?? '',
      r.iqamah?.fajr ?? '', r.iqamah?.dhuhr ?? '', r.iqamah?.asr ?? '', r.iqamah?.maghrib ?? '', r.iqamah?.isha ?? '', r.iqamah?.jumuah ?? '',
      r.source ?? schedule.meta.source,
    ].join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function exportJson(schedule: PrayerSchedule): string {
  return JSON.stringify(schedule, null, 2);
}

export function isValidScheduleShape(x: unknown): x is PrayerSchedule {
  if (!x || typeof x !== 'object') return false;
  const s = x as PrayerSchedule;
  return !!s.meta && typeof s.meta.id === 'string' && !!s.days && typeof s.days === 'object';
}
