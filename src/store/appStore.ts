/**
 * Application state: a tiny external store (no framework dependency) consumed with
 * React's useSyncExternalStore. Every mutation is persisted to IndexedDB first and only
 * then published, so the UI never shows data that was not saved.
 */
import { useSyncExternalStore } from 'react';
import type { AdhkarItem, AppConfig, DailyPrayerTimes, PrayerSchedule } from '../domain/types';
import { defaultAdhkar, defaultConfig, mergeConfig } from '../domain/defaults';
import * as store from './db';
import { editDay } from '../core/timetable';
import type { ApplicationBackup } from '../domain/types';
import { now, setClockOffset } from '../services/clock';
import { extendAhead, needsExtension } from '../core/generate';
import { muscatDateKey } from '../core/time';

export interface AppState {
  loaded: boolean;
  loadError: string | null;
  config: AppConfig;
  schedule: PrayerSchedule | null;
  previousSchedule: PrayerSchedule | null;
  adhkar: AdhkarItem[];
}

let state: AppState = {
  loaded: false, loadError: null, config: defaultConfig(), schedule: null, previousSchedule: null, adhkar: defaultAdhkar(),
};
const subs = new Set<() => void>();
const publish = (next: Partial<AppState>) => { state = { ...state, ...next }; subs.forEach((s) => s()); };

export const getState = () => state;
export function useApp<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => sel(state));
}

export function log(level: 'info' | 'warn' | 'error', message: string) {
  void store.addLog({ at: new Date().toISOString(), level, message });
}

export async function loadApp() {
  try {
    const p = await store.loadAll();
    const config = mergeConfig(p.config);
    const adhkar = p.adhkar ?? defaultAdhkar();
    if (!p.config) await store.saveConfig(config);
    if (!p.adhkar) await store.saveAdhkar(adhkar);
    setClockOffset(config.display.clockOffsetMs);
    publish({ loaded: true, config, schedule: p.schedule, previousSchedule: p.previousSchedule, adhkar });
    log('info', `تشغيل التطبيق — جدول: ${p.schedule ? p.schedule.meta.locationLabel + ' v' + p.schedule.meta.version : 'لا يوجد'}`);
    void autoExtendIfNeeded(muscatDateKey(now()));
  } catch (e) {
    // IndexedDB unavailable (private mode / blocked): keep running in memory with defaults
    publish({ loaded: true, loadError: (e as Error).message });
  }
}

export async function updateConfig(mut: (c: AppConfig) => AppConfig | void) {
  const draft = JSON.parse(JSON.stringify(state.config)) as AppConfig; // structuredClone is missing on older TV browsers
  const res = mut(draft) ?? draft;
  await store.saveConfig(res);
  if (res.display.clockOffsetMs !== state.config.display.clockOffsetMs) setClockOffset(res.display.clockOffsetMs);
  publish({ config: res });
}

/** Commits an already-validated schedule; the current one becomes "previous". */
export async function commitSchedule(next: PrayerSchedule) {
  const prev = state.schedule;
  await store.commitSchedule(next, prev);
  publish({ schedule: next, previousSchedule: prev ?? state.previousSchedule });
  log('info', `اعتماد جدول مواقيت: ${next.meta.locationLabel} (${next.meta.source}) — ${next.meta.dayCount} يوماً`);
}

export async function saveDayEdit(rec: DailyPrayerTimes) {
  if (!state.schedule) throw new Error('لا يوجد جدول نشط');
  const next = editDay(state.schedule, rec, new Date().toISOString());
  await store.saveSchedule(next);
  publish({ schedule: next });
  log('info', `تعديل يدوي لمواقيت ${rec.date}`);
}

export async function restorePreviousSchedule(): Promise<boolean> {
  const ok = await store.swapWithPrevious();
  if (ok) {
    publish({ schedule: state.previousSchedule, previousSchedule: state.schedule });
    log('warn', 'استعادة الجدول السابق');
  }
  return ok;
}

export async function setAdhkar(list: AdhkarItem[]) {
  const ordered = list.map((a, i) => ({ ...a, order: i }));
  await store.saveAdhkar(ordered);
  publish({ adhkar: ordered });
}

export async function restoreBackup(b: ApplicationBackup) {
  const prev = state.schedule;
  await store.restoreAll(b.config, b.schedule, b.adhkar, b.schedule ? prev : null);
  setClockOffset(b.config.display.clockOffsetMs);
  publish({
    config: b.config, adhkar: b.adhkar,
    ...(b.schedule ? { schedule: b.schedule, previousSchedule: prev ?? state.previousSchedule } : {}),
  });
  log('warn', `استعادة نسخة احتياطية (${b.createdAt})`);
}

let extending = false;
/** Keeps the timetable filled ahead with calibrated days (never overwrites existing days). */
export async function autoExtendIfNeeded(today: string): Promise<number> {
  const { config, schedule } = state;
  if (extending || !config.calc.autoExtend || !config.calc.profile) return 0;
  if (!needsExtension(schedule, today)) return 0;
  extending = true;
  try {
    const { schedule: next, added } = extendAhead(schedule, today, config, new Date().toISOString());
    if (!added) return 0;
    await store.saveSchedule(next);
    publish({ schedule: next });
    log('info', `تمديد تلقائي للجدول: أُضيف ${added} يوماً محسوباً ومعايراً`);
    return added;
  } finally {
    extending = false;
  }
}

/** Saves a schedule produced by filling missing days (keeps the "previous" slot untouched). */
export async function saveFilledSchedule(next: PrayerSchedule, what: string) {
  await store.saveSchedule(next);
  publish({ schedule: next });
  log('info', what);
}
