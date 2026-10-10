/** Versioned backup / restore. A restore is validated completely BEFORE anything is written. */
import { DATA_VERSION, type AdhkarItem, type AppConfig, type ApplicationBackup, type PrayerSchedule } from '../domain/types';
import { mergeConfig } from '../domain/defaults';
import { buildMeta, parseJsonTimetable } from './timetable';

declare const __APP_VERSION__: string;
const appVersion = () => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev');

export function createBackup(config: AppConfig, schedule: PrayerSchedule | null, adhkar: AdhkarItem[], nowIso: string): ApplicationBackup {
  return {
    kind: 'oman-mosque-display-backup',
    dataVersion: DATA_VERSION,
    appVersion: appVersion(),
    createdAt: nowIso,
    config: { ...config, display: { ...config.display, adminPinHash: config.display.adminPinHash } },
    schedule,
    adhkar,
  };
}

export interface BackupValidation {
  ok: boolean;
  errors: string[];
  backup: ApplicationBackup | null;
  summary: { days: number; adhkar: number; mosque: string; createdAt: string } | null;
}

export function validateBackup(text: string): BackupValidation {
  const fail = (m: string): BackupValidation => ({ ok: false, errors: [m], backup: null, summary: null });
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { return fail(`الملف ليس JSON صالحاً: ${(e as Error).message}`); }
  if (!raw || typeof raw !== 'object') return fail('بنية الملف غير صالحة');
  const b = raw as Partial<ApplicationBackup>;
  if (b.kind !== 'oman-mosque-display-backup') return fail('هذا ليس ملف نسخة احتياطية لهذا التطبيق');
  if (typeof b.dataVersion !== 'number' || b.dataVersion > DATA_VERSION) return fail(`إصدار بيانات غير مدعوم (${String(b.dataVersion)})`);
  if (!b.config || typeof b.config !== 'object') return fail('إعدادات المسجد مفقودة في النسخة');
  const errors: string[] = [];

  let schedule: PrayerSchedule | null = null;
  if (b.schedule) {
    const imp = parseJsonTimetable(JSON.stringify({ days: Object.values(b.schedule.days ?? {}) }));
    if (imp.errors.length) errors.push(...imp.errors.slice(0, 5).map((e) => `جدول المواقيت: ${e.message}${e.date ? ` (${e.date})` : ''}`));
    else {
      const days = Object.fromEntries(imp.records.map((r) => {
        const orig = b.schedule!.days[r.date];
        return [r.date, { ...r, source: orig?.source ?? b.schedule!.meta?.source }];
      }));
      const m = b.schedule.meta ?? ({} as PrayerSchedule['meta']);
      schedule = {
        dataVersion: DATA_VERSION,
        meta: buildMeta(days, {
          id: m.id, version: (m.version ?? 1) - 1, importedAt: m.importedAt,
          source: m.source ?? 'admin', sourceNote: m.sourceNote ?? 'مستعاد من نسخة احتياطية',
          locationLabel: m.locationLabel ?? '', wilayatId: m.wilayatId ?? '', calcMethod: m.calcMethod,
        }, m.lastUpdated ?? new Date().toISOString()),
        days,
      };
    }
  }

  const adhkar: AdhkarItem[] = [];
  if (b.adhkar !== undefined && !Array.isArray(b.adhkar)) errors.push('قائمة الأذكار تالفة');
  (b.adhkar ?? []).forEach((a, i) => {
    if (!a || typeof a.text !== 'string' || !a.text.trim()) { errors.push(`ذكر رقم ${i + 1} فارغ أو تالف`); return; }
    adhkar.push({
      id: String(a.id ?? `dhikr-r${i}`), text: a.text, category: String(a.category ?? ''), source: String(a.source ?? ''),
      seconds: typeof a.seconds === 'number' ? a.seconds : null, enabled: a.enabled !== false, order: typeof a.order === 'number' ? a.order : i,
    });
  });

  if (errors.length) return { ok: false, errors, backup: null, summary: null };
  const config = mergeConfig(b.config);
  const backup: ApplicationBackup = {
    kind: 'oman-mosque-display-backup', dataVersion: DATA_VERSION, appVersion: String(b.appVersion ?? ''),
    createdAt: String(b.createdAt ?? ''), config, schedule, adhkar,
  };
  return {
    ok: true, errors: [], backup,
    summary: { days: schedule ? Object.keys(schedule.days).length : 0, adhkar: adhkar.length, mosque: config.mosque.nameAr, createdAt: backup.createdAt },
  };
}
