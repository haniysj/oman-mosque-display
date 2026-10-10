/**
 * Fills a timetable with calibrated (or plain calculated) days WITHOUT touching days that
 * already exist — official or administrator-entered days always win.
 */
import { DATA_VERSION, type AppConfig, type DailyPrayerTimes, type PrayerSchedule } from '../domain/types';
import { findWilayat, locationLabel } from '../domain/oman';
import { calculateDay, DEFAULT_CALC, type CalcOptions } from './calc';
import { profileToOptions } from './calibrate';
import { addDays } from './time';
import { buildMeta, coverage } from './timetable';

export function targetCoords(cfg: AppConfig): { lat: number; lng: number; label: string } {
  const loc = cfg.mosque.location;
  const w = findWilayat(loc.governorateId, loc.wilayatId);
  if (cfg.calc.useMosqueCoords && loc.customLat != null && loc.customLng != null) {
    return { lat: loc.customLat, lng: loc.customLng, label: `${locationLabel(loc.governorateId, loc.wilayatId)} (إحداثيات المسجد)` };
  }
  return { lat: w?.lat ?? 23.6, lng: w?.lng ?? 58.4, label: locationLabel(loc.governorateId, loc.wilayatId) };
}

export function generationOptions(cfg: AppConfig): { opts: CalcOptions; kind: 'calibrated' | 'calculated'; label: string } {
  const t = targetCoords(cfg);
  if (cfg.calc.profile) return { opts: profileToOptions(cfg.calc.profile, t.lat, t.lng), kind: 'calibrated', label: t.label };
  return { opts: { ...DEFAULT_CALC, lat: t.lat, lng: t.lng }, kind: 'calculated', label: t.label };
}

export function sourceCounts(s: PrayerSchedule | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!s) return out;
  for (const d of Object.values(s.days)) { const k = d.source ?? s.meta.source; out[k] = (out[k] ?? 0) + 1; }
  return out;
}

/** Returns a new schedule with every missing date in [from, to] generated. Existing days are kept as they are. */
export function fillMissing(current: PrayerSchedule | null, from: string, to: string, cfg: AppConfig, nowIso: string): { schedule: PrayerSchedule; added: number } {
  const { opts, kind, label } = generationOptions(cfg);
  const days: Record<string, DailyPrayerTimes> = current ? { ...current.days } : {};
  let added = 0, d = from, guard = 0;
  while (d <= to && guard++ < 1200) {
    if (!days[d]) { days[d] = { ...calculateDay(d, opts), source: kind }; added++; }
    d = addDays(d, 1);
  }
  const note = kind === 'calibrated' ? 'أيام محسوبة ومعايرة على جدول الوزارة' : 'أيام محسوبة فلكياً — غير رسمية';
  const meta = buildMeta(days, {
    ...(current ? { id: current.meta.id, version: current.meta.version, importedAt: current.meta.importedAt, calcMethod: current.meta.calcMethod } : {}),
    source: current?.meta.source ?? kind,
    sourceNote: current ? (current.meta.sourceNote.includes(note) ? current.meta.sourceNote : `${current.meta.sourceNote} + ${note}`) : note,
    locationLabel: current?.meta.locationLabel ?? label,
    wilayatId: current?.meta.wilayatId ?? cfg.mosque.location.wilayatId,
  }, nowIso);
  return { schedule: { dataVersion: DATA_VERSION, meta, days }, added };
}

/** Auto-extension rule: keep at least `minDays` ahead; when short, fill the next `aheadDays`. */
export function needsExtension(s: PrayerSchedule | null, today: string, minDays = 60): boolean {
  const c = coverage(s, today);
  return !c.coversToday || c.daysRemaining < minDays;
}

export function extendAhead(s: PrayerSchedule | null, today: string, cfg: AppConfig, nowIso: string, aheadDays = 400) {
  return fillMissing(s, today, addDays(today, aheadDays), cfg, nowIso);
}
