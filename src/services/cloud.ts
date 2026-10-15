/**
 * Optional cloud sync (Supabase) for many mosques across wilayats.
 *
 *  • Each mosque has a code (e.g. "noor-bawshar") and its own settings + adhkar.
 *  • Each wilayat has ONE shared timetable (+ calibration); every mosque in that wilayat uses it.
 *  • A display device is bound to one mosque (open /m/<code>). It keeps working offline with the
 *    last downloaded data and checks for newer versions every few minutes when online.
 *  • Uploads happen only from a device where the administrator is signed in (password kept in
 *    memory only — never stored).
 *
 * The app works fully without this module; nothing here is required for the display.
 */
import { useSyncExternalStore } from 'react';
import type { AdhkarItem, AppConfig, DisplayPreferences, PrayerSchedule } from '../domain/types';
import { mergeConfig } from '../domain/defaults';
import { findWilayat, locationLabel } from '../domain/oman';
import { applyCloudData, getState, log, onLocalChange } from '../store/appStore';
import { isValidScheduleShape } from '../core/timetable';
import type { CalibrationProfile } from '../core/calibrate';

const URL_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://gfuvletkmpdeykwlqtah.supabase.co';
const ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? 'sb_publishable_yJo_1cjKfA5y_40F88lw6g_1MyktLwU';
const POLL_MS = 5 * 60 * 1000;
const LS_BINDING = 'omd-cloud-binding';
const LS_META = 'omd-cloud-meta';

/** Fields that belong to the physical device, never synced. */
const DEVICE_KEYS: (keyof DisplayPreferences)[] = ['presentation', 'deviceMode', 'wakeLock', 'clockOffsetMs', 'autoClockCorrection'];

export interface MosqueSummary {
  code: string; name_ar: string; governorate_id: string; wilayat_id: string; version: number; updated_at: string;
  timetable_version: number | null; timetable_days: number;
}
export interface TimetableSummary { wilayat_id: string; governorate_id: string; version: number; updated_at: string; days: number; calibrated: boolean; mosques: number }

export interface CloudStatus {
  binding: { code: string; name: string } | null;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  mosqueVersion: number | null;
  timetableVersion: number | null;
  wilayatId: string | null;
  admin: boolean; // signed in on this device (this page session)
  pendingUpload: boolean;
}

const readJson = <T>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) || 'null') as T; } catch { return null; } };
const writeJson = (k: string, v: unknown) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

const meta0 = readJson<Pick<CloudStatus, 'lastSyncAt' | 'mosqueVersion' | 'timetableVersion' | 'wilayatId'>>(LS_META);
let status: CloudStatus = {
  binding: readJson(LS_BINDING),
  syncing: false, lastError: null, admin: false, pendingUpload: false,
  lastSyncAt: meta0?.lastSyncAt ?? null, mosqueVersion: meta0?.mosqueVersion ?? null,
  timetableVersion: meta0?.timetableVersion ?? null, wilayatId: meta0?.wilayatId ?? null,
};
let adminPassword: string | null = null;
const subs = new Set<() => void>();
const set = (p: Partial<CloudStatus>) => {
  status = { ...status, ...p };
  writeJson(LS_META, { lastSyncAt: status.lastSyncAt, mosqueVersion: status.mosqueVersion, timetableVersion: status.timetableVersion, wilayatId: status.wilayatId });
  subs.forEach((s) => s());
};
export const useCloud = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => status);
export const getCloud = () => status;

// ---------------------------------------------------------------- transport

const ERR_AR: Record<string, string> = {
  BAD_PASSWORD: 'كلمة المرور غير صحيحة',
  ADMIN_NOT_INITIALIZED: 'لم تُنشأ كلمة مرور الإدارة بعد',
  ALREADY_INITIALIZED: 'كلمة مرور الإدارة منشأة مسبقاً',
  PASSWORD_TOO_SHORT: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
  BAD_SCHEDULE: 'جدول المواقيت غير صالح',
};

/** The server is missing a database function (an SQL update was not run yet). */
export class MissingRpcError extends Error {
  constructor(public fn: string) { super('قاعدة بيانات المساجد على الخادم تحتاج تحديثاً — شغّل ملف SQL المرفق'); }
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('لا يوجد اتصال بالإنترنت');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = (JSON.parse(text) as { message?: string }).message ?? text; } catch { /* keep text */ }
      const code = Object.keys(ERR_AR).find((k) => msg.includes(k));
      if (res.status === 404 || /Could not find the function/i.test(msg)) throw new MissingRpcError(fn);
      if (/violates check constraint.*code/i.test(msg)) throw new Error('رمز المسجد غير صالح: أحرف إنجليزية صغيرة وأرقام وشرطة فقط (3–40)');
      throw new Error(code ? ERR_AR[code] : `خطأ من الخادم (${res.status})`);
    }
    return (text ? JSON.parse(text) : null) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالخادم');
    if (e instanceof TypeError) throw new Error('تعذّر الوصول إلى الخادم');
    if (e instanceof MissingRpcError) throw e;
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------- shared config mapping

export function sharedConfig(c: AppConfig): AppConfig {
  const copy = JSON.parse(JSON.stringify(c)) as AppConfig;
  for (const k of DEVICE_KEYS) delete (copy.display as unknown as Record<string, unknown>)[k];
  copy.calc = { ...copy.calc, profile: null }; // calibration travels with the wilayat timetable
  return copy;
}

function mergeRemoteConfig(local: AppConfig, remote: unknown, m: { name_ar: string; governorate_id: string; wilayat_id: string }, calibration: CalibrationProfile | null): AppConfig {
  const merged = mergeConfig(remote ?? {});
  for (const k of DEVICE_KEYS) (merged.display as unknown as Record<string, unknown>)[k] = local.display[k];
  merged.mosque.nameAr = m.name_ar;
  merged.mosque.location = { ...merged.mosque.location, governorateId: m.governorate_id, wilayatId: m.wilayat_id };
  merged.calc = { ...merged.calc, profile: calibration ?? merged.calc.profile ?? null };
  return merged;
}

// ---------------------------------------------------------------- binding + pull

export function bindingFromUrl(): string | null {
  const m = /^\/m\/([a-z0-9-]{3,40})\/?$/i.exec(location.pathname);
  if (m) return m[1].toLowerCase();
  const q = new URLSearchParams(location.search).get('m');
  return q && /^[a-z0-9-]{3,40}$/i.test(q) ? q.toLowerCase() : null;
}

/** Keeps the address bar on /m/<code> so «Add to Home Screen» installs this mosque's link. */
function syncUrl(code: string | null) {
  try {
    if (/^\/(#.*)?$/.test(location.pathname) || /^\/m\//.test(location.pathname)) {
      const path = code ? `/m/${code}` : '/';
      if (location.pathname !== path) history.replaceState(history.state, '', path + location.search + location.hash);
    }
  } catch { /* ignore */ }
}

export async function bindDevice(code: string, name = '') {
  syncUrl(code);
  const prev = status.binding?.code;
  writeJson(LS_BINDING, { code, name });
  set({ binding: { code, name }, ...(prev !== code ? { mosqueVersion: null, timetableVersion: null, wilayatId: null, lastSyncAt: null } : {}) });
  log('info', `ربط هذا الجهاز بالمسجد ${code}`);
  return syncNow(true);
}

export function unbindDevice() {
  syncUrl(null);
  writeJson(LS_BINDING, null);
  set({ binding: null, mosqueVersion: null, timetableVersion: null, wilayatId: null, lastSyncAt: null, lastError: null });
}

interface Bundle {
  mosque: { code: string; name_ar: string; governorate_id: string; wilayat_id: string; config: unknown; adhkar: AdhkarItem[] | null; version: number };
  timetable: { wilayat_id: string; schedule: PrayerSchedule; calibration: CalibrationProfile | null; version: number } | null;
}

let syncing: Promise<boolean> | null = null;

/** Downloads newer data for the bound mosque. Returns true when something changed. */
export function syncNow(force = false): Promise<boolean> {
  if (!status.binding) return Promise.resolve(false);
  if (syncing) return syncing;
  syncing = (async () => {
    set({ syncing: true });
    try {
      const code = status.binding!.code;
      const v = await rpc<{ mosque_version: number; timetable_version: number | null; wilayat_id: string } | null>('mosque_versions', { p_code: code });
      if (!v) throw new Error(`المسجد «${code}» غير موجود في السحابة`);
      const changed = force || v.mosque_version !== status.mosqueVersion || (v.timetable_version ?? null) !== status.timetableVersion || v.wilayat_id !== status.wilayatId;
      if (!changed) { set({ lastSyncAt: new Date().toISOString(), lastError: null }); return false; }
      const b = await rpc<Bundle | null>('mosque_bundle', { p_code: code });
      if (!b) throw new Error(`المسجد «${code}» غير موجود في السحابة`);
      const local = getState();
      const config = mergeRemoteConfig(local.config, b.mosque.config, b.mosque, b.timetable?.calibration ?? null);
      // No timetable for this wilayat → clear (never keep another wilayat's times on screen)
      const schedule = b.timetable && isValidScheduleShape(b.timetable.schedule) ? b.timetable.schedule : null;
      const adhkar = Array.isArray(b.mosque.adhkar) && b.mosque.adhkar.length ? b.mosque.adhkar : undefined;
      await applyCloudData({ config, adhkar, schedule });
      resetUploadBaseline();
      set({
        binding: { code, name: b.mosque.name_ar },
        mosqueVersion: b.mosque.version, timetableVersion: b.timetable?.version ?? null, wilayatId: b.mosque.wilayat_id,
        lastSyncAt: new Date().toISOString(), lastError: null,
      });
      writeJson(LS_BINDING, { code, name: b.mosque.name_ar });
      log('info', `تحديث من السحابة: إعدادات v${b.mosque.version}${b.timetable ? `، جدول ${locationLabel(b.mosque.governorate_id, b.mosque.wilayat_id)} v${b.timetable.version}` : ' (لا يوجد جدول للولاية بعد)'}`);
      return true;
    } catch (e) {
      set({ lastError: (e as Error).message });
      return false;
    } finally {
      set({ syncing: false });
      syncing = null;
    }
  })();
  return syncing;
}

// ---------------------------------------------------------------- admin

export const adminStatus = () => rpc<{ initialized: boolean }>('mosque_admin_status');
export const listMosques = () => rpc<MosqueSummary[]>('mosque_list');
export const listTimetables = () => rpc<TimetableSummary[]>('mosque_timetables_summary');

// Offline sign-in: after a successful online sign-in the device keeps only a salted SHA-256 verifier
// (never the password itself), so the settings can still be opened when the screen is offline.
const LS_VERIFIER = 'omd-admin-verifier';
async function sha256Hex(text: string): Promise<string | null> {
  try {
    if (!crypto?.subtle) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}
async function rememberVerifier(password: string) {
  const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const h = await sha256Hex(`omd-admin:${salt}:${password}`);
  if (h) writeJson(LS_VERIFIER, { salt, h });
}
export const hasOfflineVerifier = () => !!readJson<{ salt: string; h: string }>(LS_VERIFIER);
/** Opens the settings offline when the password matches the verifier saved at the last online sign-in. */
export async function adminLoginOffline(password: string) {
  const v = readJson<{ salt: string; h: string }>(LS_VERIFIER);
  if (!v) throw new Error('أول دخول على هذا الجهاز يحتاج اتصالاً بالإنترنت');
  if ((await sha256Hex(`omd-admin:${v.salt}:${password}`)) !== v.h) throw new Error('كلمة المرور غير صحيحة');
  adminPassword = password; set({ admin: true });
}

export async function adminInit(password: string) { await rpc('mosque_admin_init', { p_password: password }); adminPassword = password; set({ admin: true }); void rememberVerifier(password); }
export async function adminLogin(password: string) { await rpc('mosque_admin_login', { p_password: password }); adminPassword = password; set({ admin: true }); void rememberVerifier(password); }
export function adminLogout() { adminPassword = null; set({ admin: false, pendingUpload: false }); }
export async function adminChangePassword(oldP: string, newP: string) { await rpc('mosque_admin_change_password', { p_old: oldP, p_new: newP }); adminPassword = newP; void rememberVerifier(newP); }

const requirePw = () => { if (!adminPassword) throw new Error('سجّل الدخول كمشرف أولاً'); return adminPassword; };

export async function createMosque(code: string, nameAr: string, governorateId: string, wilayatId: string, template: AppConfig, adhkar: AdhkarItem[]) {
  const cfg = sharedConfig(template);
  cfg.mosque.nameAr = nameAr;
  cfg.mosque.nameEn = '';
  cfg.mosque.logoDataUrl = '';
  cfg.mosque.location = { governorateId, wilayatId, customLat: null, customLng: null };
  return rpc<{ version: number }>('mosque_admin_upsert_mosque', {
    p_password: requirePw(), p_code: code, p_name_ar: nameAr, p_governorate_id: governorateId, p_wilayat_id: wilayatId, p_config: cfg, p_adhkar: adhkar,
  });
}

/** Reads one mosque's shared settings (for the edit dialog). */
export async function getMosqueConfig(code: string): Promise<AppConfig> {
  const b = await rpc<Bundle | null>('mosque_bundle', { p_code: code });
  if (!b) throw new Error(`المسجد «${code}» غير موجود في السحابة`);
  const c = mergeConfig(b.mosque.config ?? {});
  c.mosque.nameAr = b.mosque.name_ar;
  c.mosque.location = { ...c.mosque.location, governorateId: b.mosque.governorate_id, wilayatId: b.mosque.wilayat_id };
  return c;
}

/** Updates a mosque's name / wilayat / logo / coordinates (adhkar untouched). The mosque is linked
 *  to its wilayat's timetable automatically, so changing the wilayat switches the timetable too. */
export async function updateMosque(code: string, cfg: AppConfig) {
  const loc = cfg.mosque.location;
  if (!findWilayat(loc.governorateId, loc.wilayatId)) throw new Error('حدد المحافظة والولاية');
  const r = await rpc<{ version: number }>('mosque_admin_upsert_mosque', {
    p_password: requirePw(), p_code: code, p_name_ar: cfg.mosque.nameAr.trim(), p_governorate_id: loc.governorateId, p_wilayat_id: loc.wilayatId,
    p_config: sharedConfig(cfg), p_adhkar: null,
  });
  if (status.binding?.code === code) await syncNow(true);
  return r;
}

// ---------------------------------------------------------------- wilayat timetables (each one independent)

export interface WilayatTimetable { wilayat_id: string; governorate_id: string; schedule: PrayerSchedule; calibration: CalibrationProfile | null; version: number; updated_at: string }

/** Reads one wilayat's stored timetable (null when none is stored). */
export async function getWilayatTimetable(wilayatId: string): Promise<WilayatTimetable | null> {
  try {
    return await rpc<WilayatTimetable | null>('mosque_timetable_get', { p_wilayat_id: wilayatId });
  } catch (e) {
    if (!(e instanceof MissingRpcError)) throw e;
    // Before the v2 SQL update: read it through any mosque of that wilayat.
    const m = (await listMosques()).find((x) => x.wilayat_id === wilayatId);
    if (!m) {
      const exists = (await listTimetables()).some((t) => t.wilayat_id === wilayatId);
      if (exists) throw e;
      return null;
    }
    const b = await rpc<Bundle | null>('mosque_bundle', { p_code: m.code });
    return b?.timetable ? { ...b.timetable, governorate_id: m.governorate_id, updated_at: '' } as WilayatTimetable : null;
  }
}

/** Saves a wilayat's timetable + calibration; screens of that wilayat pick it up automatically. */
export async function saveWilayatTimetable(governorateId: string, wilayatId: string, schedule: PrayerSchedule, calibration: CalibrationProfile | null) {
  const r = await rpc<{ version: number }>('mosque_admin_upsert_timetable', {
    p_password: requirePw(), p_wilayat_id: wilayatId, p_governorate_id: governorateId, p_schedule: schedule, p_calibration: calibration,
  });
  if (status.binding && status.wilayatId === wilayatId) void syncNow(true);
  return r;
}

export const deleteWilayatTimetable = (wilayatId: string) => rpc<boolean>('mosque_admin_delete_timetable', { p_password: requirePw(), p_wilayat_id: wilayatId });

export const deleteMosque = (code: string) => rpc<boolean>('mosque_admin_delete_mosque', { p_password: requirePw(), p_code: code });

/** Uploads this device's settings/adhkar to its bound mosque. */
export async function pushMosque() {
  const b = status.binding; if (!b) throw new Error('هذا الجهاز غير مرتبط بمسجد');
  const { config, adhkar } = getState();
  const loc = config.mosque.location;
  if (!findWilayat(loc.governorateId, loc.wilayatId)) throw new Error('حدد المحافظة والولاية أولاً');
  const r = await rpc<{ version: number }>('mosque_admin_upsert_mosque', {
    p_password: requirePw(), p_code: b.code, p_name_ar: config.mosque.nameAr || b.name || b.code,
    p_governorate_id: loc.governorateId, p_wilayat_id: loc.wilayatId, p_config: sharedConfig(config), p_adhkar: adhkar,
  });
  const wilayatChanged = status.wilayatId !== loc.wilayatId;
  set({ mosqueVersion: r.version, wilayatId: loc.wilayatId, binding: { code: b.code, name: config.mosque.nameAr } });
  writeJson(LS_BINDING, { code: b.code, name: config.mosque.nameAr });
  if (wilayatChanged) void syncNow(true); // pick up the new wilayat's timetable
  return r;
}

/** Uploads this device's timetable (+ calibration) as THE timetable of its wilayat. */
export async function pushTimetable() {
  const { config, schedule } = getState();
  if (!schedule) throw new Error('لا يوجد جدول مواقيت لرفعه');
  const loc = config.mosque.location;
  if (schedule.meta.wilayatId && schedule.meta.wilayatId !== 'demo' && schedule.meta.wilayatId !== loc.wilayatId) {
    throw new Error(`الجدول الحالي خاص بولاية أخرى (${schedule.meta.locationLabel}) — لن يُرفع لولاية ${locationLabel(loc.governorateId, loc.wilayatId)}`);
  }
  if (schedule.meta.source === 'demo') throw new Error('لا يُرفع جدول DEMO إلى السحابة');
  const r = await rpc<{ version: number }>('mosque_admin_upsert_timetable', {
    p_password: requirePw(), p_wilayat_id: loc.wilayatId, p_governorate_id: loc.governorateId, p_schedule: schedule, p_calibration: config.calc.profile,
  });
  if (status.binding && status.wilayatId === loc.wilayatId) set({ timetableVersion: r.version });
  return r;
}

// ---------------------------------------------------------------- automatic upload of local edits (admin only)

let lastSharedHash = '';
let timer: ReturnType<typeof setTimeout> | null = null;
const pending = new Set<'mosque' | 'timetable'>();

function scheduleUpload(kind: 'mosque' | 'timetable') {
  pending.add(kind);
  set({ pendingUpload: true });
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    const kinds = [...pending]; pending.clear();
    try {
      if (kinds.includes('mosque')) await pushMosque();
      if (kinds.includes('timetable')) await pushTimetable();
      set({ pendingUpload: false, lastError: null, lastSyncAt: new Date().toISOString() });
      log('info', `رفع إلى السحابة: ${kinds.join(' + ')}`);
    } catch (e) {
      set({ pendingUpload: false, lastError: (e as Error).message });
    }
  }, 1500);
}

export function startCloud() {
  const fromUrl = bindingFromUrl();
  if (fromUrl && fromUrl !== status.binding?.code) void bindDevice(fromUrl);
  else { if (status.binding) syncUrl(status.binding.code); void syncNow(); }
  setInterval(() => { void syncNow(); }, POLL_MS);
  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow(); });

  lastSharedHash = JSON.stringify(sharedConfig(getState().config));
  // Only mosque settings/adhkar are uploaded automatically. Wilayat timetables are edited and
  // saved explicitly from «جدول المواقيت» (so a screen can never overwrite its wilayat's table).
  onLocalChange((k) => {
    if (!status.admin || !status.binding) return;
    if (k === 'config') {
      const h = JSON.stringify(sharedConfig(getState().config));
      if (h !== lastSharedHash) { lastSharedHash = h; scheduleUpload('mosque'); }
    } else if (k === 'adhkar') scheduleUpload('mosque');
  });
}

/** After a cloud download, the hashes reflect the downloaded data (so it is not echoed back). */
export function resetUploadBaseline() {
  lastSharedHash = JSON.stringify(sharedConfig(getState().config));
}
