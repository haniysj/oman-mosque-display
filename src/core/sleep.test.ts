import { describe, expect, it } from 'vitest';
import { computeState, type EngineInput } from './engine';
import { sleepWindowAt } from './sleep';
import { adhkar, at, cfg, yearSchedule } from '../test/fixtures';
import type { SleepPeriod } from '../domain/types';

const once: SleepPeriod = { id: 'a', enabled: true, repeat: 'once', fromDate: '2026-10-16', from: '22:00', toDate: '2026-10-17', to: '03:00' };
const daily: SleepPeriod = { ...once, id: 'd', repeat: 'daily' };
const withSleep = (p: SleepPeriod, wake = true) => { const c = cfg(); c.quiet.sleep = { enabled: true, wakeForPrayers: wake, periods: [p] }; return c; };
const input = (now: number, c = cfg(), over: Partial<EngineInput> = {}): EngineInput => ({ now, config: c, schedule: yearSchedule(), adhkar: adhkar(), isMobile: false, ...over });

describe('power-saving black screen', () => {
  it('once: 16 Oct 22:00 → 17 Oct 03:00 only', () => {
    expect(sleepWindowAt(once, at('2026-10-16', '21:59'))).toBeNull();
    expect(sleepWindowAt(once, at('2026-10-16', '22:00'))).not.toBeNull();
    expect(sleepWindowAt(once, at('2026-10-17', '02:59'))).not.toBeNull();
    expect(sleepWindowAt(once, at('2026-10-17', '03:00'))).toBeNull();
    expect(sleepWindowAt(once, at('2026-10-17', '23:00'))).toBeNull();
  });
  it('daily crosses midnight every day', () => {
    expect(sleepWindowAt(daily, at('2026-10-20', '23:30'))).not.toBeNull();
    expect(sleepWindowAt(daily, at('2026-10-21', '01:00'))).not.toBeNull();
    expect(sleepWindowAt(daily, at('2026-10-21', '12:00'))).toBeNull();
    expect(sleepWindowAt({ ...daily, enabled: false }, at('2026-10-20', '23:30'))).toBeNull();
  });
  it('the display shows the black clock screen during the period, not on phones', () => {
    const c = withSleep(once);
    const st = computeState(input(at('2026-10-16', '23:00'), c));
    expect(st.phase).toBe('quiet');
    expect(st.sleep).not.toBeNull();
    expect(computeState(input(at('2026-10-16', '21:00'), c)).phase).toBe('normal');
    expect(computeState(input(at('2026-10-16', '23:00'), c, { isMobile: true })).phase).toBe('normal');
    const off = withSleep(once); off.quiet.sleep!.enabled = false;
    expect(computeState(input(at('2026-10-16', '23:00'), off)).phase).toBe('normal');
  });
  it('wakes 10 minutes before a prayer inside the period (unless turned off)', () => {
    const p: SleepPeriod = { ...once, from: '03:00', to: '07:00', fromDate: '2026-10-10', toDate: '2026-10-10' };
    const fajr = at('2026-10-10', '04:30'); // fixtures: Fajr 04:30
    expect(computeState(input(fajr - 11 * 60_000, withSleep(p))).phase).toBe('quiet');
    expect(computeState(input(fajr - 9 * 60_000, withSleep(p))).phase).toBe('normal');
    expect(computeState(input(fajr - 9 * 60_000, withSleep(p, false))).phase).toBe('quiet');
  });
  it('emergency exit dismisses the current period only', () => {
    const c = withSleep(once);
    const st = computeState(input(at('2026-10-16', '23:00'), c));
    expect(computeState(input(at('2026-10-16', '23:05'), c, { dismissed: new Set([st.sleep!.id]) })).phase).toBe('normal');
  });
});
