/**
 * IndexedDB persistence (offline, survives restarts).
 *   kv store:   config · schedule (active) · schedule-previous (last valid, for restore) · adhkar
 *   logs store: ring buffer of local application events
 * Multi-key changes (import, restore) are written in ONE transaction: either everything
 * is saved or nothing changes.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { AdhkarItem, AppConfig, LogEntry, PrayerSchedule } from '../domain/types';

const DB_NAME = 'oman-mosque-display';
const DB_VERSION = 1;
const MAX_LOGS = 500;

let dbp: Promise<IDBPDatabase> | null = null;

export function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('logs')) d.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
      },
    });
  }
  return dbp;
}

/** Test helper. */
export async function _resetDbHandle() {
  if (dbp) { try { (await dbp).close(); } catch { /* ignore */ } }
  dbp = null;
}

export interface Persisted {
  config: unknown;
  schedule: PrayerSchedule | null;
  previousSchedule: PrayerSchedule | null;
  adhkar: AdhkarItem[] | null;
}

export async function loadAll(): Promise<Persisted> {
  const d = await db();
  const tx = d.transaction('kv', 'readonly');
  const [config, schedule, previousSchedule, adhkar] = await Promise.all([
    tx.store.get('config'), tx.store.get('schedule'), tx.store.get('schedule-previous'), tx.store.get('adhkar'),
  ]);
  await tx.done;
  return { config: config ?? null, schedule: schedule ?? null, previousSchedule: previousSchedule ?? null, adhkar: adhkar ?? null };
}

export async function saveConfig(c: AppConfig) { await (await db()).put('kv', c, 'config'); }
export async function saveAdhkar(a: AdhkarItem[]) { await (await db()).put('kv', a, 'adhkar'); }

/** Replaces the active schedule; the old one is kept as "previous" so it can be restored. */
export async function commitSchedule(next: PrayerSchedule | null, keepPrevious: PrayerSchedule | null) {
  const d = await db();
  const tx = d.transaction('kv', 'readwrite');
  if (keepPrevious) await tx.store.put(keepPrevious, 'schedule-previous');
  if (next) await tx.store.put(next, 'schedule'); else await tx.store.delete('schedule');
  await tx.done;
}

/** Saves an edit without touching the "previous" slot. */
export async function saveSchedule(s: PrayerSchedule) { await (await db()).put('kv', s, 'schedule'); }

export async function swapWithPrevious(): Promise<boolean> {
  const d = await db();
  const tx = d.transaction('kv', 'readwrite');
  const [cur, prev] = await Promise.all([tx.store.get('schedule'), tx.store.get('schedule-previous')]);
  if (!prev) { await tx.done; return false; }
  await tx.store.put(prev, 'schedule');
  if (cur) await tx.store.put(cur, 'schedule-previous'); else await tx.store.delete('schedule-previous');
  await tx.done;
  return true;
}

export async function restoreAll(config: AppConfig, schedule: PrayerSchedule | null, adhkar: AdhkarItem[], previous: PrayerSchedule | null) {
  const d = await db();
  const tx = d.transaction('kv', 'readwrite');
  await tx.store.put(config, 'config');
  await tx.store.put(adhkar, 'adhkar');
  if (previous) await tx.store.put(previous, 'schedule-previous');
  if (schedule) await tx.store.put(schedule, 'schedule');
  await tx.done;
}

export async function addLog(entry: Omit<LogEntry, 'id'>) {
  try {
    const d = await db();
    const tx = d.transaction('logs', 'readwrite');
    await tx.store.add(entry);
    const count = await tx.store.count();
    if (count > MAX_LOGS) {
      let cursor = await tx.store.openCursor();
      let toDelete = count - MAX_LOGS;
      while (cursor && toDelete-- > 0) { await cursor.delete(); cursor = await cursor.continue(); }
    }
    await tx.done;
  } catch {
    /* logging must never break the display */
  }
}

export async function readLogs(limit = 200): Promise<LogEntry[]> {
  const d = await db();
  const all = (await d.getAll('logs')) as LogEntry[];
  return all.slice(-limit).reverse();
}

export async function clearLogs() { await (await db()).clear('logs'); }

export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return null;
}
