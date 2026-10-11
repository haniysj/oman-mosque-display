import { describe, expect, it } from 'vitest';
import { computeState, EventTracker, type EngineInput } from './engine';
import { buildDayPlan } from './iqamah';
import { coverage, getDay } from './timetable';
import { calculateYear } from './calc';
import { DEFAULT_CALC } from './calc';
import { adhkar, at, cfg, rec, schedule, yearSchedule } from '../test/fixtures';
import { classifyDevice, isPhone } from './device';
import { MINUTE } from './time';

const SAT = '2026-10-10'; // Saturday
const FRI = '2026-10-09'; // Friday

const input = (now: number, over: Partial<EngineInput> = {}): EngineInput => ({
  now, config: cfg(), schedule: yearSchedule(), adhkar: adhkar(), isMobile: false, ...over,
});

describe('1. timetable lookup', () => {
  it('returns the record for the selected date', () => {
    const s = schedule(['2026-10-09', SAT], (d) => (d === SAT ? { fajr: '04:31' } : {}));
    expect(getDay(s, SAT)?.fajr).toBe('04:31');
    expect(getDay(s, '2026-10-09')?.fajr).toBe('04:30');
    expect(getDay(s, '2026-10-11')).toBeNull();
  });
});

describe('2. leap-year coverage', () => {
  it('a calculated leap year has 366 days including 29 February', () => {
    const s = calculateYear(2028, { ...DEFAULT_CALC, lat: 23.6, lng: 58.4 }, 'x', 'x', '2026-01-01T00:00:00Z');
    expect(s.meta.dayCount).toBe(366);
    expect(s.days['2028-02-29']).toBeTruthy();
    expect(Object.keys(yearSchedule(2026).days).length).toBe(365);
  });
  it('coverage counts the days remaining through the year end', () => {
    const s = yearSchedule(2028);
    expect(coverage(s, '2028-12-30')).toMatchObject({ coversToday: true, daysRemaining: 1 });
  });
});

describe('3. missing schedule data', () => {
  it('without a record for today there is no plan, no countdown and no sequence', () => {
    const st = computeState(input(at(SAT, '11:50'), { schedule: schedule(['2026-10-01']) }));
    expect(st.plan).toBeNull();
    expect(st.countdown).toBeNull();
    expect(st.phase).toBe('normal');
    expect(coverage(schedule(['2026-10-01']), SAT).coversToday).toBe(false);
  });
  it('a missing tomorrow does not break tonight (next adhan becomes null after Isha)', () => {
    const st = computeState(input(at(SAT, '20:00'), { schedule: schedule([SAT]) }));
    expect(st.plan).not.toBeNull();
    expect(st.nextAdhan).toBeNull();
  });
});

describe('4b. frozen (locked) iqamah', () => {
  it('holds the iqamah at the locked time, overriding weekday rules and timetable overrides', () => {
    const c = cfg();
    c.iqamah.weekdayRules[6] = { asr: { mode: 'delay', delay: 25, fixedTime: '' } };
    c.iqamah.locks = { asr: { enabled: true, time: '15:45' } };
    const p = buildDayPlan(rec(SAT, { iqamah: { asr: '15:40' } }), c);
    expect(p.iqamah.asr.at).toBe(at(SAT, '15:45'));
    expect(p.iqamah.asr.how).toBe('lock');
    expect(p.iqamah.fajr.how).not.toBe('lock'); // other prayers unaffected
  });
  it('a date exception still wins; a disabled lock is ignored', () => {
    const c = cfg();
    c.iqamah.locks = { asr: { enabled: true, time: '15:45' } };
    c.iqamah.dateExceptions = [{ id: 'x', date: SAT, prayer: 'asr', time: '15:50' }];
    expect(buildDayPlan(rec(SAT), c).iqamah.asr.at).toBe(at(SAT, '15:50'));
    const c2 = cfg(); c2.iqamah.locks = { asr: { enabled: false, time: '15:45' } };
    expect(buildDayPlan(rec(SAT), c2).iqamah.asr.how).not.toBe('lock');
  });
  it('a lock before the adhan falls back to the usual rule with an admin warning', () => {
    const c = cfg();
    c.iqamah.locks = { asr: { enabled: true, time: '14:00' } };
    const p = buildDayPlan(rec(SAT), c);
    expect(p.iqamah.asr.how).toBe('delay');
    expect(p.warnings.join(' ')).toContain('تثبيت إقامة');
  });
});

describe('4. iqamah delay calculation', () => {
  it('iqamah = adhan + configured delay, independently per prayer', () => {
    const c = cfg();
    c.iqamah.rules.asr.delay = 15;
    c.iqamah.rules.maghrib.delay = 7;
    const p = buildDayPlan(rec(SAT), c);
    expect(p.iqamah.fajr.at - p.adhan.fajr).toBe(20 * MINUTE);
    expect(p.iqamah.asr.at - p.adhan.asr).toBe(15 * MINUTE);
    expect(p.iqamah.maghrib.at - p.adhan.maghrib).toBe(7 * MINUTE);
  });
  it('handles a midnight crossing for Isha', () => {
    const c = cfg();
    c.iqamah.rules.isha.delay = 30;
    const p = buildDayPlan(rec(SAT, { isha: '23:45' }), c);
    expect(p.iqamah.isha.at).toBe(at('2026-10-11', '00:15'));
  });
  it('priority: date exception > record override > weekday rule > standard', () => {
    const c = cfg();
    c.iqamah.weekdayRules[6] = { asr: { mode: 'delay', delay: 25, fixedTime: '' } };
    expect(buildDayPlan(rec(SAT), c).iqamah.asr.at).toBe(at(SAT, '15:35'));
    expect(buildDayPlan(rec(SAT, { iqamah: { asr: '15:40' } }), c).iqamah.asr.at).toBe(at(SAT, '15:40'));
    c.iqamah.dateExceptions.push({ id: 'x', date: SAT, prayer: 'asr', time: '15:45' });
    expect(buildDayPlan(rec(SAT, { iqamah: { asr: '15:40' } }), c).iqamah.asr.at).toBe(at(SAT, '15:45'));
  });
  it('a fixed iqamah before the adhan is rejected with a warning', () => {
    const c = cfg();
    c.iqamah.rules.asr = { mode: 'fixed', delay: 20, fixedTime: '15:00' };
    const p = buildDayPlan(rec(SAT), c);
    expect(p.iqamah.asr.at).toBe(at(SAT, '15:30'));
    expect(p.warnings.length).toBeGreaterThan(0);
  });
});

describe('5. Friday-specific iqamah', () => {
  it('uses the Friday configuration, not the Dhuhr settings', () => {
    const c = cfg();
    c.friday = { ...c.friday, configured: true, startMode: 'fixed', startTime: '12:15', iqamah: { mode: 'fixed', delay: 0, fixedTime: '12:45' } };
    c.iqamah.rules.dhuhr.delay = 20;
    const p = buildDayPlan(rec(FRI), c);
    expect(p.isFriday).toBe(true);
    expect(p.adhan.dhuhr).toBe(at(FRI, '12:15'));
    expect(p.iqamah.dhuhr.at).toBe(at(FRI, '12:45'));
    expect(p.iqamah.dhuhr.how).toBe('friday');
  });
  it('warns when Friday settings were never configured', () => {
    const p = buildDayPlan(rec(FRI), cfg());
    expect(p.iqamah.dhuhr.how).toBe('friday-fallback');
    expect(p.warnings.join()).toContain('الجمعة');
  });
  it('returns to normal Dhuhr on Saturday automatically', () => {
    const c = cfg();
    c.friday = { ...c.friday, configured: true, startMode: 'fixed', startTime: '12:15' };
    const p = buildDayPlan(rec(SAT), c);
    expect(p.isFriday).toBe(false);
    expect(p.adhan.dhuhr).toBe(at(SAT, '11:50'));
  });
  it('labels the slot الجمعة on Friday', () => {
    const st = computeState(input(at(FRI, '11:00')));
    expect(st.nextAdhan?.label).toBe('الجمعة');
  });
});

describe('6–7. countdown', () => {
  it('starts at 60 seconds, not before', () => {
    expect(computeState(input(at(SAT, '15:08', 59))).countdown).toBeNull(); // 61 s before Asr
    const c = computeState(input(at(SAT, '15:09', 0))).countdown; // 60 s before
    expect(c?.seconds).toBe(60);
    expect(c?.event.kind).toBe('adhan');
    expect(computeState(input(at(SAT, '15:09', 1))).countdown?.seconds).toBe(59);
  });
  it('counts down to the iqamah as well', () => {
    const c = computeState(input(at(SAT, '15:29', 30))).countdown;
    expect(c?.event.kind).toBe('iqamah');
    expect(c?.seconds).toBe(30);
  });
  it('completes exactly at the event time and never early', () => {
    const asr = at(SAT, '15:10');
    expect(computeState(input(asr - 1)).countdown?.seconds).toBe(1);
    const st = computeState(input(asr));
    expect(st.countdown).toBeNull();
    expect(st.nextAdhan?.slot).toBe('maghrib');
    expect(st.currentIqamahSlot).toBe('asr');
    expect(st.nextPrayerSlot).toBeNull(); // "next" tag waits until the Asr iqamah has passed
    // …and until the prayer is over (black screen + adhkar after the iqamah), then Maghrib is «next»
    expect(computeState(input(at(SAT, '15:30'))).nextPrayerSlot).toBeNull();
    expect(computeState(input(at(SAT, '15:39'))).nextPrayerSlot).toBeNull();
    expect(computeState(input(at(SAT, '15:40'))).nextPrayerSlot).toBe('maghrib');
  });
});

describe('8–11. quiet mode and adhkar', () => {
  const iq = at(SAT, '15:30');
  it('8. black screen starts 5 seconds after the iqamah, not before', () => {
    expect(computeState(input(iq - 1)).phase).toBe('normal');
    expect(computeState(input(iq)).phase).toBe('normal');
    expect(computeState(input(iq + 4_999)).phase).toBe('normal');
    expect(computeState(input(iq + 5_000)).phase).toBe('quiet');
  });
  it('9. quiet lasts exactly five minutes, then adhkar', () => {
    expect(computeState(input(iq + 5 * MINUTE - 1)).phase).toBe('quiet');
    expect(computeState(input(iq + 5 * MINUTE)).phase).toBe('adhkar');
  });
  it('10. adhkar rotate every 60 seconds', () => {
    const start = iq + 5 * MINUTE;
    const a0 = computeState(input(start));
    const a1 = computeState(input(start + 59_999));
    const a2 = computeState(input(start + 60_000));
    const a3 = computeState(input(start + 120_000));
    expect(a0.adhkarIndex).toBe(0);
    expect(a1.adhkarIndex).toBe(0);
    expect(a2.adhkarIndex).toBe(1);
    expect(a3.adhkarIndex).toBe(2);
    expect(a0.adhkarItemEndsAt).toBe(start + 60_000);
  });
  it('disabled or empty adhkar are never shown', () => {
    const list = adhkar().map((a, i) => (i === 0 ? { ...a, enabled: false } : i === 1 ? { ...a, text: '  ' } : a));
    const st = computeState(input(iq + 5 * MINUTE, { adhkar: list }));
    expect(st.adhkarItem?.id).toBe('dhikr-3');
  });
  it('11. returns to the main display after the adhkar period', () => {
    expect(computeState(input(iq + 10 * MINUTE - 1)).phase).toBe('adhkar');
    expect(computeState(input(iq + 10 * MINUTE)).phase).toBe('normal');
  });
  it('respects per-prayer selection, custom durations and the Friday duration', () => {
    const c = cfg();
    c.quiet.prayers.asr = false;
    expect(computeState(input(iq, { config: c })).phase).toBe('normal');
    const c2 = cfg();
    c2.quiet.minutes = 8;
    expect(computeState(input(iq + 7 * MINUTE, { config: c2 })).phase).toBe('quiet');
    const c3 = cfg();
    c3.friday = { ...c3.friday, configured: true, startMode: 'dhuhr', iqamah: { mode: 'delay', delay: 30, fixedTime: '' }, quietMinutes: 12 };
    const fIq = at(FRI, '12:20');
    expect(computeState(input(fIq + 11 * MINUTE, { config: c3 })).phase).toBe('quiet');
  });
  it('emergency exit dismisses only the current sequence', () => {
    const st = computeState(input(iq + 10_000));
    const dismissed = new Set([st.sequence!.id]);
    expect(computeState(input(iq + MINUTE, { dismissed })).phase).toBe('normal');
    expect(computeState(input(at(SAT, '17:50', 30), { dismissed })).phase).toBe('quiet'); // Maghrib still works
  });
});

describe('12. mobile black-screen exception', () => {
  it('phones keep the normal interface during quiet and adhkar', () => {
    const iq = at(SAT, '15:30');
    const st = computeState(input(iq + MINUTE, { isMobile: true }));
    expect(st.phase).toBe('normal');
    expect(st.suppressedByMobile).toBe(true);
  });
  it('classifies phones, tablets and touch TVs correctly', () => {
    const base = { screenWidth: 390, screenHeight: 844, coarsePointer: true, maxTouchPoints: 5 };
    expect(classifyDevice({ ...base, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148' })).toBe('mobile');
    expect(classifyDevice({ ...base, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36' })).toBe('mobile');
    expect(classifyDevice({ ...base, screenWidth: 1920, screenHeight: 1080, userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0)' })).toBe('tv');
    expect(classifyDevice({ ...base, screenWidth: 960, screenHeight: 540, userAgent: 'Mozilla/5.0 (Linux; Android 11; BRAVIA 4K) Chrome' })).toBe('tv');
    expect(classifyDevice({ ...base, screenWidth: 1024, screenHeight: 1366, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari' })).toBe('tablet');
    expect(classifyDevice({ screenWidth: 1920, screenHeight: 1080, coarsePointer: false, maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130' })).toBe('desktop');
    expect(isPhone('auto', 'mobile')).toBe(true);
    expect(isPhone('tv', 'mobile')).toBe(false); // manual override wins
    expect(isPhone('mobile', 'tv')).toBe(true);
  });
});

describe('13. date rollover at midnight', () => {
  it('switches to the next day exactly at 00:00 Muscat', () => {
    const s = schedule(['2026-10-10', '2026-10-11'], (d) => (d === '2026-10-11' ? { fajr: '04:31' } : {}));
    const before = computeState(input(at(SAT, '23:59', 59), { schedule: s }));
    const after = computeState(input(at('2026-10-11', '00:00'), { schedule: s }));
    expect(before.today).toBe(SAT);
    expect(after.today).toBe('2026-10-11');
    expect(after.plan?.date).toBe('2026-10-11');
    expect(before.nextAdhan?.at).toBe(at('2026-10-11', '04:31'));
  });
  it('an Isha sequence that crosses midnight continues on the new day', () => {
    const s = schedule([SAT, '2026-10-11'], (d) => (d === SAT ? { isha: '23:50' } : {}));
    const st = computeState(input(at('2026-10-11', '00:12'), { schedule: s })); // iqamah 00:10
    expect(st.phase).toBe('quiet');
    expect(st.sequence?.id).toBe(`${SAT}:isha:seq`);
  });
});

describe('14. restart during a scheduled transition', () => {
  it('a fresh engine started mid-sequence lands in the right phase and does not replay events', () => {
    const iq = at(SAT, '15:30');
    const now = iq + 3 * MINUTE + 17_000;
    const st = computeState(input(now));
    expect(st.phase).toBe('quiet');
    const tr = new EventTracker();
    const r = tr.observe(st, yearSchedule(), cfg());
    expect(r.fired).toHaveLength(0); // everything in the past is reconciled, not fired
    expect(r.reconciled).toBeGreaterThan(0);
  });
});

describe('19–20. clock changes and duplicate prevention', () => {
  it('fires each event exactly once even with repeated observations', () => {
    const s = yearSchedule();
    const c = cfg();
    const tr = new EventTracker();
    tr.observe(computeState(input(at(SAT, '15:09'))), s, c);
    const r1 = tr.observe(computeState(input(at(SAT, '15:10'))), s, c);
    const r2 = tr.observe(computeState(input(at(SAT, '15:10', 1))), s, c);
    const r3 = tr.observe(computeState(input(at(SAT, '15:10', 1))), s, c);
    expect(r1.fired.map((e) => e.id)).toEqual([`${SAT}:asr:adhan`]);
    expect(r2.fired).toHaveLength(0);
    expect(r3.fired).toHaveLength(0);
  });
  it('a clock jumping backwards does not re-fire events', () => {
    const s = yearSchedule(); const c = cfg(); const tr = new EventTracker();
    tr.observe(computeState(input(at(SAT, '15:09'))), s, c);
    tr.observe(computeState(input(at(SAT, '15:10', 2))), s, c);
    tr.observe(computeState(input(at(SAT, '15:05'))), s, c); // device clock corrected backwards
    const r = tr.observe(computeState(input(at(SAT, '15:10', 3))), s, c);
    expect(r.fired).toHaveLength(0);
  });
  it('a large forward jump (sleep / wrong clock fixed) reconciles instead of firing late', () => {
    const s = yearSchedule(); const c = cfg(); const tr = new EventTracker();
    tr.observe(computeState(input(at(SAT, '12:00'))), s, c);
    const r = tr.observe(computeState(input(at(SAT, '16:00'))), s, c);
    expect(r.fired).toHaveLength(0);
    expect(r.reconciled).toBe(3); // dhuhr iqamah (12:10), asr adhan, asr iqamah
    expect(r.clockJump).toBe(4 * 60 * MINUTE);
  });
});
