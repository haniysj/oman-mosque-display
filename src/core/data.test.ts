import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyImport, editDay, exportCsv, parseCsvTimetable, parseJsonTimetable } from './timetable';
import { _forceTabular, formatHijriAr, toHijri } from './hijri';
import { createBackup, validateBackup } from './backup';
import { schedule, yearSchedule, cfg, adhkar } from '../test/fixtures';
import { demoSchedule } from './calc';
import { now, setClockOffset, startSimulation, stopSimulation, simulationInfo } from '../services/clock';
import { computeState } from './engine';
import { WILAYAT_COUNT, GOVERNORATES } from '../domain/oman';

const HEAD = 'date,fajr,sunrise,dhuhr,asr,maghrib,isha';
const opt = { mode: 'replace' as const, source: 'official' as const, sourceNote: 'MARA', locationLabel: 'مسقط — بوشر', wilayatId: 'bawshar', nowIso: '2026-10-10T00:00:00Z' };

describe('16. import validation', () => {
  it('accepts a clean CSV with Arabic headers, Arabic-Indic digits and DD/MM/YYYY dates', () => {
    const csv = 'التاريخ,الفجر,الشروق,الظهر,العصر,المغرب,العشاء\n١٠/١٠/٢٠٢٦,٤:٣٠,٥:٤٥,١١:٥٠,١٥:١٠,١٧:٤٠,١٩:٠٠\n';
    const r = parseCsvTimetable(csv);
    expect(r.errors).toEqual([]);
    expect(r.records[0]).toMatchObject({ date: '2026-10-10', fajr: '04:30', isha: '19:00' });
    expect(r.stats.kind).toBe('daily');
  });
  it('reads Excel-saved dates: DD-MM-YY, US M/D/YYYY and serial numbers, with 12-hour times', () => {
    const ministry = (dates: string[]) => parseCsvTimetable(['تاريخ,الفجر,الشروق,الظهر,العصر,المغرب,العشاء', ...dates.map((d) => `${d},04:43,05:58,12:02,03:26,06:00,07:10`)].join('\n'));
    const a = ministry(['01-10-26', '02-10-26', '03-10-26', '13-10-26']);
    expect(a.errors).toEqual([]);
    expect(a.records.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-13']);
    expect(a.records[0]).toMatchObject({ asr: '15:26', maghrib: '18:00', isha: '19:10' });
    const b = ministry(['10/1/2026', '10/2/2026', '10/3/2026']);
    expect(b.records.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(b.warnings.some((w) => w.message.includes('شهر/يوم'))).toBe(true);
    const c = ministry(['1/10/2026', '2/10/2026', '3/10/2026']);
    expect(c.records.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    const d = ministry(['46296', '46297']);
    expect(d.records.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-02']);
    const e = ministry(['01/10/2026 00:00', '02/10/2026 00:00']);
    expect(e.records.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-02']);
  });
  it('resolves 12-hour times without AM/PM and reports the conversion', () => {
    const r = parseCsvTimetable(`${HEAD}\n2026-10-10,4:30,5:45,11:50,3:10,5:40,7:00\n2026-10-11,4:31,5:46,11:50,3:09,5:39,6:59`);
    expect(r.errors).toEqual([]);
    expect(r.records[0]).toMatchObject({ asr: '15:10', maghrib: '17:40', isha: '19:00' });
    expect(r.warnings.some((w) => w.message.includes('12 ساعة'))).toBe(true);
  });
  it('accepts explicit AM/PM and ص/م markers', () => {
    const r = parseCsvTimetable(`${HEAD}\n2026-10-10,4:30 ص,5:45 AM,12:05 م,3:10 PM,5:40 مساءً,7:00 pm`);
    expect(r.errors).toEqual([]);
    expect(r.records[0]).toMatchObject({ dhuhr: '12:05', asr: '15:10', maghrib: '17:40', isha: '19:00' });
  });
  it('rejects invalid dates, invalid times, wrong order and conflicting duplicates', () => {
    const r = parseCsvTimetable([
      HEAD,
      '2026-02-30,04:30,05:45,11:50,15:10,17:40,19:00',
      '2026-10-10,04:3x,05:45,11:50,15:10,17:40,19:00',
      '2026-10-11,04:30,05:45,11:50,15:10,15:00,19:00',
      '2026-10-12,04:30,05:45,11:50,15:10,17:40,19:00',
      '2026-10-12,04:31,05:45,11:50,15:10,17:40,19:00',
    ].join('\n'));
    const msgs = r.errors.map((e) => e.message).join('\n');
    expect(msgs).toContain('تاريخ غير صالح');
    expect(msgs).toContain('الفجر');
    expect(msgs).toContain('ترتيب غير منطقي');
    expect(msgs).toContain('مكرر بقيم مختلفة');
    expect(r.stats.duplicates).toBe(1);
  });
  it('reports missing columns and missing days', () => {
    expect(parseCsvTimetable('date,fajr\n2026-10-10,04:30').errors[0].message).toContain('أعمدة ناقصة');
    const r = parseCsvTimetable(`${HEAD}\n2026-10-10,04:30,05:45,11:50,15:10,17:40,19:00\n2026-10-13,04:30,05:45,11:50,15:10,17:40,19:00`);
    expect(r.stats.missingDates).toEqual(['2026-10-11', '2026-10-12']);
  });
  it('imports only the months that have times; empty and half-filled days stay empty', () => {
    const rows = [HEAD];
    for (let d = 1; d <= 31; d++) rows.push(`2027-01-${String(d).padStart(2, '0')},05:30,06:50,12:20,15:30,17:50,19:05`);
    for (let d = 1; d <= 28; d++) rows.push(`2027-02-${String(d).padStart(2, '0')},,,,,,`); // February not filled yet
    rows.push('2027-03-01,05:20,,12:25,,,'); // half-filled day
    rows.push('2027-03-02,hh:mm,hh:mm,hh:mm,hh:mm,hh:mm,hh:mm'); // template placeholder
    rows.push(',,,,,,');
    const r = parseCsvTimetable(rows.join('\n'));
    expect(r.errors).toEqual([]);
    expect(r.stats.count).toBe(31);
    expect(r.stats.skippedEmpty).toBe(29);
    expect(r.stats.skippedPartial).toEqual(['2027-03-01']);
    expect(r.stats.months.slice(0, 3)).toEqual([
      { month: '2027-01', days: 31, total: 31 }, { month: '2027-02', days: 0, total: 28 }, { month: '2027-03', days: 0, total: 31 },
    ]);
    expect(r.stats.months).toHaveLength(12);
    const next = applyImport(null, r, opt);
    expect(Object.keys(next.days)).toHaveLength(31);
    expect(next.days['2027-02-01']).toBeUndefined();
  });
  it('a file with no completed day at all is rejected', () => {
    const r = parseCsvTimetable(`${HEAD}\n2027-01-01,,,,,,\n2027-01-02,,,,,,`);
    expect(r.errors[0].message).toContain('مكتمل');
  });
  it('a single-day edit still requires every time', () => {
    const s = schedule(['2026-10-10']);
    expect(() => editDay(s, { date: '2026-10-10', fajr: '04:30', sunrise: '', dhuhr: '11:50', asr: '15:10', maghrib: '17:40', isha: '19:00' }, 'x')).toThrow();
  });
  it('detects a complete annual timetable', () => {
    const r = parseJsonTimetable(JSON.stringify(yearSchedule(2028)));
    expect(r.errors).toEqual([]);
    expect(r.stats.kind).toBe('annual');
    expect(r.stats.count).toBe(366);
  });
  it('never applies an import with errors', () => {
    const bad = parseCsvTimetable(`${HEAD}\n2026-10-10,xx,05:45,11:50,15:10,17:40,19:00`);
    expect(() => applyImport(yearSchedule(), bad, opt)).toThrow();
  });
  it('merge keeps existing days and replaces imported ones', () => {
    const cur = schedule(['2026-10-10', '2026-10-11']);
    const imp = parseCsvTimetable(`${HEAD}\n2026-10-11,04:35,05:45,11:50,15:10,17:40,19:00\n2026-10-12,04:35,05:45,11:50,15:10,17:40,19:00`);
    const next = applyImport(cur, imp, { ...opt, mode: 'merge' });
    expect(Object.keys(next.days)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12']);
    expect(next.days['2026-10-11'].fajr).toBe('04:35');
    expect(next.meta.id).toBe(cur.meta.id);
    expect(next.meta.version).toBe(cur.meta.version + 1);
  });
  it('exports CSV that re-imports identically', () => {
    const s = yearSchedule(2026);
    const back = parseCsvTimetable(exportCsv(s));
    expect(back.errors).toEqual([]);
    expect(back.records).toHaveLength(365);
    expect(back.records[100].fajr).toBe(s.days[back.records[100].date].fajr);
  });
  it('demo data is always labelled DEMO', () => {
    const d = demoSchedule(2026, '2026-01-01T00:00:00Z');
    expect(d.meta.source).toBe('demo');
    expect(d.meta.sourceNote).toContain('DEMO DATA');
    expect(Object.values(d.days).every((x) => x.source === 'demo')).toBe(true);
  });
});

describe('18. Hijri date and adjustment', () => {
  it('converts with Umm al-Qura (1 Ramadan 1445 = 11 March 2024)', () => {
    expect(toHijri('2024-03-11')).toMatchObject({ year: 1445, month: 9, day: 1, method: 'umalqura' });
  });
  it('applies the administrator adjustment to the Hijri date only', () => {
    expect(toHijri('2024-03-11', 1)).toMatchObject({ month: 9, day: 2 });
    expect(toHijri('2024-03-11', -1)).toEqual(toHijri('2024-03-10'));
    expect(toHijri('2024-03-11', -1).month).toBe(8);
    expect(formatHijriAr(toHijri('2024-03-11'), 'western')).toBe('1 رمضان 1445هـ');
  });
  it('tabular fallback stays within ±2 days of Umm al-Qura', () => {
    const u = toHijri('2026-10-10');
    _forceTabular(true);
    const t = toHijri('2026-10-10');
    _forceTabular(false);
    expect(t.method).toBe('tabular');
    expect(t.year).toBe(u.year);
    const diff = (t.month - u.month) * 30 + (t.day - u.day);
    expect(Math.abs(diff)).toBeLessThanOrEqual(2);
  });
  it('can advance the Hijri date at Maghrib', () => {
    const c = cfg();
    c.hijri.changeAtMaghrib = true;
    const s = yearSchedule();
    const before = computeState({ now: Date.UTC(2026, 9, 10, 13, 39), config: c, schedule: s, adhkar: adhkar(), isMobile: false });
    const after = computeState({ now: Date.UTC(2026, 9, 10, 13, 40), config: c, schedule: s, adhkar: adhkar(), isMobile: false });
    expect(before.hijriDate).toBe('2026-10-10');
    expect(after.hijriDate).toBe('2026-10-11');
  });
});

describe('17. backup and restoration', () => {
  it('round-trips a full backup', () => {
    const c = cfg(); c.mosque.nameAr = 'جامع السلطان قابوس — اختبار';
    const b = createBackup(c, yearSchedule(), adhkar(), '2026-10-10T08:00:00Z');
    const v = validateBackup(JSON.stringify(b));
    expect(v.ok).toBe(true);
    expect(v.summary).toMatchObject({ days: 365, adhkar: 10, mosque: c.mosque.nameAr });
    expect(v.backup!.schedule!.days['2026-03-01']).toMatchObject({ fajr: '04:30' });
  });
  it('rejects corrupt or foreign files', () => {
    expect(validateBackup('{oops').ok).toBe(false);
    expect(validateBackup(JSON.stringify({ hello: 1 })).ok).toBe(false);
    const b = createBackup(cfg(), yearSchedule(), adhkar(), 'x');
    b.schedule!.days['2026-01-05'].fajr = '99:99';
    const v = validateBackup(JSON.stringify(b));
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toContain('جدول المواقيت');
  });
});

describe('15/17. IndexedDB persistence works offline and a failed restore changes nothing', () => {
  beforeEach(async () => {
    const { _resetDbHandle } = await import('../store/db');
    await _resetDbHandle();
    await new Promise<void>((res) => { const r = indexedDB.deleteDatabase('oman-mosque-display'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  });
  it('persists and reloads without any network', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchSpy);
    const app = await import('../store/appStore');
    await app.loadApp();
    await app.updateConfig((c) => { c.mosque.nameAr = 'مسجد الرحمة'; });
    await app.commitSchedule(yearSchedule());
    const db = await import('../store/db');
    await db._resetDbHandle();
    const persisted = await db.loadAll();
    expect((persisted.config as { mosque: { nameAr: string } }).mosque.nameAr).toBe('مسجد الرحمة');
    expect(persisted.schedule?.meta.dayCount).toBe(365);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('keeps the previous valid schedule and can restore it', async () => {
    const app = await import('../store/appStore');
    await app.loadApp();
    const first = schedule(['2026-10-10']);
    const second = schedule(['2026-10-10', '2026-10-11']);
    await app.commitSchedule(first);
    await app.commitSchedule(second);
    expect(app.getState().schedule?.meta.id).toBe(second.meta.id);
    expect(await app.restorePreviousSchedule()).toBe(true);
    expect(app.getState().schedule?.meta.id).toBe(first.meta.id);
  });
  it('an invalid backup is rejected before anything is written', async () => {
    const app = await import('../store/appStore');
    await app.loadApp();
    await app.commitSchedule(yearSchedule());
    const before = app.getState().schedule?.meta.id;
    const v = validateBackup('{"kind":"oman-mosque-display-backup","dataVersion":99}');
    expect(v.ok).toBe(false);
    expect(app.getState().schedule?.meta.id).toBe(before);
  });
});

describe('19. incorrect device clock correction and simulation safety', () => {
  it('applies the configured correction to the shared clock', () => {
    setClockOffset(0);
    const a = now();
    setClockOffset(90_000);
    expect(now() - a).toBeGreaterThanOrEqual(89_990);
    setClockOffset(0);
  });
  it('simulation is in-memory only and stops cleanly', () => {
    startSimulation(Date.UTC(2026, 9, 10, 11, 29), 10);
    expect(simulationInfo().active).toBe(true);
    expect(Math.abs(now() - Date.UTC(2026, 9, 10, 11, 29))).toBeLessThan(2000);
    stopSimulation();
    expect(simulationInfo().active).toBe(false);
  });
});

describe('administrative list', () => {
  it('has 11 governorates and 63 wilayats with unique ids', () => {
    expect(GOVERNORATES).toHaveLength(11);
    expect(WILAYAT_COUNT).toBe(63);
    const ids = GOVERNORATES.flatMap((g) => g.wilayats.map((w) => `${g.id}/${w.id}`));
    expect(new Set(ids).size).toBe(63);
  });
});

describe('import for another year', () => {
  it('re-dates a single-year file to the chosen year with full validation', async () => {
    const { parseCsvTimetable, withYear } = await import('./timetable');
    const csv = 'date,fajr,sunrise,dhuhr,asr,maghrib,isha\n2026-10-01,04:43,05:58,12:02,03:26,06:00,07:10\n2026-10-02,04:44,05:59,12:01,03:25,05:59,07:09\n';
    const r = withYear(parseCsvTimetable(csv), 2027);
    expect(r.errors).toEqual([]);
    expect(r.records.map((x) => x.date)).toEqual(['2027-10-01', '2027-10-02']);
    expect(r.records[0]).toMatchObject({ fajr: '04:43', asr: '15:26' });
    expect(r.stats.years).toEqual([2027]);
  });
  it('drops 29 February when the target year is not a leap year', async () => {
    const { parseCsvTimetable, withYear } = await import('./timetable');
    const r = withYear(parseCsvTimetable('date,fajr,sunrise,dhuhr,asr,maghrib,isha\n2028-02-29,05:20,06:35,12:30,15:45,18:20,19:35\n2028-03-01,05:19,06:34,12:30,15:45,18:21,19:36\n'), 2027);
    expect(r.records.map((x) => x.date)).toEqual(['2027-03-01']);
    expect(r.warnings[0].message).toContain('29 فبراير');
  });
});
