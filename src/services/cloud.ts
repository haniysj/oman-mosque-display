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
import { defaultAdhkar, defaultConfig, mergeConfig } from '../domain/defaults';
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
const DEVICE_KEYS: (keyof DisplayPreferences)[] = ['presentation', 'deviceMode', 'wakeLock', 'autoHideControls', 'clockOffsetMs', 'autoClockCorrection'];

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
  admin: boolean; // signed in on this device (this page session) — general administrator OR mosque supervisor
  role: 'super' | 'mosque' | null; // super = general administrator (all mosques); mosque = only `codes`
  codes: string[]; // mosques a mosque supervisor may edit
  pendingUpload: boolean;
}

const readJson = <T>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) || 'null') as T; } catch { return null; } };
const writeJson = (k: string, v: unknown) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

const meta0 = readJson<Pick<CloudStatus, 'lastSyncAt' | 'mosqueVersion' | 'timetableVersion' | 'wilayatId'>>(LS_META);
let status: CloudStatus = {
  binding: readJson(LS_BINDING),
  syncing: false, lastError: null, admin: false, role: null, codes: [], pendingUpload: false,
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
  PASSWORD_TOO_SHORT: 'كلمة المرور قصيرة جداً',
  mosque_not_found: 'المسجد غير موجود في السحابة',
  BAD_SCHEDULE: 'جدول المواقيت غير صالح',
};

/** The server is missing a database function (an SQL update was not run yet). */
export class MissingRpcError extends Error {
  constructor(public fn: string) { super('قاعدة بيانات المساجد على الخادم تحتاج تحديثاً — شغّل ملف SQL المرفق'); }
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('لا يوجد اتصال بالإنترنت');
  // Older smart-TV browsers (Tizen / webOS, Chrome < 66) have fetch but no AbortController:
  // there the timeout is a race instead of a cancel.
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => { ctrl?.abort(); const e = new Error('timeout'); e.name = 'AbortError'; rej(e); }, 20000);
  });
  try {
    const init: RequestInit = {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      cache: 'no-store',
    };
    if (ctrl) init.signal = ctrl.signal;
    const res = await Promise.race([fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, init), timeout]);
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
    if (t) clearTimeout(t);
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

// This device's own settings (before it was linked) — restored when it is un-linked.
const LS_LOCAL_PROFILE = 'omd-local-profile';
const LS_UNBOUND_CODE = 'omd-cloud-unbound-code';
const LS_OWN_DONE = 'omd-own-settings-restored';

export async function bindDevice(code: string, name = '') {
  // Edits made for the previous mosque are sent to THAT mosque before switching (never to the new one).
  await flushPendingUpload();
  if (!status.binding) {
    // keep this device's own settings so un-linking later gives them back (never the mosque's)
    const { config, adhkar } = getState();
    try { localStorage.setItem(LS_LOCAL_PROFILE, JSON.stringify({ config, adhkar })); } catch { /* ignore */ }
  }
  try { localStorage.removeItem(LS_MANUAL); localStorage.removeItem(LS_UNBOUND_CODE); localStorage.removeItem(LS_OWN_DONE); } catch { /* ignore */ }
  syncUrl(code);
  const prev = status.binding?.code;
  writeJson(LS_BINDING, { code, name });
  set({ binding: { code, name }, ...(prev !== code ? { mosqueVersion: null, timetableVersion: null, wilayatId: null, lastSyncAt: null } : {}) });
  log('info', `ربط هذا الجهاز بالمسجد ${code}`);
  return syncNow(true);
}

/**
 * Un-links this device. It stays un-linked (no automatic linking, not even from the mosque's
 * /m/<code> address it was opened with) until someone links it again on purpose.
 * Its settings stop following the mosque: the device gets back its own settings from before it was
 * linked (or the defaults). The device-only choices and the last timetable stay.
 */
export async function unbindDevice() {
  const prev = status.binding?.code ?? null;
  await flushPendingUpload(); // edits already made for that mosque still go to it
  try {
    localStorage.setItem(LS_MANUAL, '1');
    if (prev) localStorage.setItem(LS_UNBOUND_CODE, prev);
  } catch { /* ignore */ }
  syncUrl(null);
  writeJson(LS_BINDING, null);
  set({ binding: null, mosqueVersion: null, timetableVersion: null, wilayatId: null, lastSyncAt: null, lastError: null, pendingUpload: false });
  await restoreOwnSettings();
  log('info', `فك ربط هذا الجهاز${prev ? ` بالمسجد ${prev}` : ''} — عادت إعدادات الجهاز المستقلة`);
}

/** Gives an un-linked device its own settings back (from before it was linked, or the defaults). */
async function restoreOwnSettings() {
  try { localStorage.setItem(LS_OWN_DONE, '1'); } catch { /* ignore */ }
  const cur = getState().config;
  let saved: { config?: unknown; adhkar?: AdhkarItem[] } | null = null;
  try { saved = JSON.parse(localStorage.getItem(LS_LOCAL_PROFILE) || 'null'); } catch { saved = null; }
  const own = saved?.config ? mergeConfig(saved.config) : defaultConfig();
  for (const k of DEVICE_KEYS) (own.display as unknown as Record<string, unknown>)[k] = cur.display[k];
  // the timetable on the device is still the last wilayat's — keep its location and calibration with it
  own.mosque = { ...own.mosque, location: { ...cur.mosque.location } };
  own.calc = { ...cur.calc };
  own.timeOverrides = saved?.config ? own.timeOverrides : {};
  await applyCloudData({ config: own, adhkar: Array.isArray(saved?.adhkar) && saved!.adhkar!.length ? saved!.adhkar : defaultAdhkar() });
  resetUploadBaseline();
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

// ---------------------------------------------------------------- default mosque (first open of any device)

const LS_MANUAL = 'omd-cloud-unbound-by-admin';
export interface DefaultMosque { code: string; name_ar: string; governorate_id: string; wilayat_id: string }

/** The platform's default mosque (null when none is set, or before the v3 SQL update). */
export async function getDefaultMosque(): Promise<DefaultMosque | null> {
  try { return await rpc<DefaultMosque | null>('mosque_default_get'); } catch (e) { if (e instanceof MissingRpcError) return null; throw e; }
}
export const setDefaultMosque = (code: string | null) => rpc<boolean>('mosque_admin_set_default', { p_password: requirePw(), p_code: code });

let autoBinding = false;
/**
 * A device opened for the first time (no mosque yet) links itself to the platform's default mosque —
 * no sign-in and no settings needed. If no default is set, the first mosque of the list is used.
 * Skipped when the admin un-linked this device on purpose, or the device has its own real timetable.
 */
export async function autoBindDefault(): Promise<boolean> {
  if (autoBinding || status.binding || bindingFromUrl()) return false;
  try { if (localStorage.getItem(LS_MANUAL)) return false; } catch { /* ignore */ }
  const sch = getState().schedule;
  if (sch && sch.meta.source !== 'demo') return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  autoBinding = true;
  try {
    let d: { code: string; name_ar: string } | null = await getDefaultMosque();
    if (!d) d = (await listMosques())[0] ?? null;
    if (!d || status.binding) return false;
    log('info', `ربط تلقائي بالمسجد الافتراضي ${d.code}`);
    await bindDevice(d.code, d.name_ar);
    return true;
  } catch (e) {
    set({ lastError: (e as Error).message });
    return false;
  } finally { autoBinding = false; }
}

// ---------------------------------------------------------------- admin

export const adminStatus = () => rpc<{ initialized: boolean }>('mosque_admin_status');
export const listMosques = () => rpc<MosqueSummary[]>('mosque_list');
export const listTimetables = () => rpc<TimetableSummary[]>('mosque_timetables_summary');

// Offline sign-in: after a successful online sign-in the device keeps only salted SHA-256 verifiers
// (never the passwords), with the role they open, so the settings still open when the screen is offline.
const LS_VERIFIER = 'omd-admin-verifier';
type Verifier = { salt: string; h: string; role?: 'super' | 'mosque'; codes?: string[] };
async function sha256Hex(text: string): Promise<string | null> {
  try {
    if (!crypto?.subtle) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}
const readVerifiers = (): Verifier[] => { const v = readJson<Verifier | Verifier[]>(LS_VERIFIER); return !v ? [] : Array.isArray(v) ? v : [v]; };
async function rememberVerifier(password: string, role: 'super' | 'mosque', codes: string[]) {
  const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const h = await sha256Hex(`omd-admin:${salt}:${password}`);
  if (!h) return;
  // one verifier per role/mosque set; a changed password replaces the old one of the same role
  const key = (v: Verifier) => `${v.role ?? 'super'}:${(v.codes ?? []).join(',')}`;
  const mine: Verifier = { salt, h, role, codes };
  writeJson(LS_VERIFIER, [mine, ...readVerifiers().filter((v) => key(v) !== key(mine))].slice(0, 6));
}
export const hasOfflineVerifier = () => readVerifiers().length > 0;
/** Opens the settings offline when the password matches a verifier saved at an earlier online sign-in. */
export async function adminLoginOffline(password: string) {
  const vs = readVerifiers();
  if (!vs.length) throw new Error('أول دخول على هذا الجهاز يحتاج اتصالاً بالإنترنت');
  for (const v of vs) {
    if ((await sha256Hex(`omd-admin:${v.salt}:${password}`)) === v.h) {
      adminPassword = password; set({ admin: true, role: v.role ?? 'super', codes: v.codes ?? [] });
      return;
    }
  }
  throw new Error('كلمة المرور غير صحيحة');
}

const signedIn = (password: string, role: 'super' | 'mosque', codes: string[]) => {
  adminPassword = password; set({ admin: true, role, codes }); void rememberVerifier(password, role, codes);
};
export async function adminInit(password: string) { await rpc('mosque_admin_init', { p_password: password }); signedIn(password, 'super', []); }
/** General administrator password → everything; a mosque password → that mosque's settings only. */
export async function adminLogin(password: string) {
  try {
    const r = await rpc<{ role: 'super' | 'mosque'; codes?: string[] } | null>('mosque_auth', { p_password: password });
    if (!r || (r.role !== 'super' && r.role !== 'mosque')) throw new Error('كلمة المرور غير صحيحة');
    signedIn(password, r.role === 'mosque' ? 'mosque' : 'super', r.codes ?? []);
  } catch (e) {
    if (!(e instanceof MissingRpcError)) throw e;
    await rpc('mosque_admin_login', { p_password: password }); // before the v4 SQL update
    signedIn(password, 'super', []);
  }
}
export function adminLogout() { adminPassword = null; set({ admin: false, role: null, codes: [], pendingUpload: false }); }
export async function adminChangePassword(oldP: string, newP: string) { await rpc('mosque_admin_change_password', { p_old: oldP, p_new: newP }); adminPassword = newP; void rememberVerifier(newP, 'super', []); }

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

/** Reads one mosque's shared settings + adhkar (for editing another mosque from the settings). */
export async function getMosqueBundle(code: string): Promise<{ cfg: AppConfig; adhkar: AdhkarItem[] | null; wilayatSchedule: PrayerSchedule | null }> {
  const b = await rpc<Bundle | null>('mosque_bundle', { p_code: code });
  if (!b) throw new Error(`المسجد «${code}» غير موجود في السحابة`);
  const c = mergeConfig(b.mosque.config ?? {});
  c.mosque.nameAr = b.mosque.name_ar;
  c.mosque.location = { ...c.mosque.location, governorateId: b.mosque.governorate_id, wilayatId: b.mosque.wilayat_id };
  const sch = b.timetable && isValidScheduleShape(b.timetable.schedule) ? b.timetable.schedule : null;
  return { cfg: c, adhkar: Array.isArray(b.mosque.adhkar) && b.mosque.adhkar.length ? b.mosque.adhkar : null, wilayatSchedule: sch };
}

/**
 * Saves one mosque's settings (iqamah, Friday, display, adhkar…) — allowed for the general
 * administrator and for that mosque's supervisor. Name / wilayat are not touched.
 */
export async function saveMosqueSettings(code: string, cfg: AppConfig, adhkar: AdhkarItem[] | null) {
  if (!canEdit(code)) throw new Error('لا تملك صلاحية تعديل هذا المسجد');
  let r: { version: number };
  try {
    r = await rpc<{ version: number }>('mosque_manager_update', { p_password: requirePw(), p_code: code, p_config: sharedConfig(cfg), p_adhkar: adhkar });
  } catch (e) {
    if (!(e instanceof MissingRpcError) || status.role !== 'super') throw e;
    const loc = cfg.mosque.location; // before the v4 SQL update: general administrator path
    r = await rpc<{ version: number }>('mosque_admin_upsert_mosque', { p_password: requirePw(), p_code: code, p_name_ar: cfg.mosque.nameAr, p_governorate_id: loc.governorateId, p_wilayat_id: loc.wilayatId, p_config: sharedConfig(cfg), p_adhkar: adhkar });
  }
  if (status.binding?.code === code) await syncNow(true);
  return r;
}

/** The signed-in person may edit this mosque's settings. */
export const canEdit = (code: string | null | undefined) => !!code && status.admin && (status.role === 'super' || status.codes.includes(code));
export const isSuper = () => status.admin && status.role === 'super';

/** General administrator: set / change / remove (empty) a mosque's own password. */
export const setMosquePassword = (code: string, pw: string | null) => rpc<boolean>('mosque_admin_set_mosque_password', { p_password: requirePw(), p_code: code, p_new: pw || null });
export const listMosquePasswords = () => rpc<{ code: string; updated_at: string }[]>('mosque_admin_mosque_passwords', { p_password: requirePw() });

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
export async function pushMosque(snap?: { code: string; config: AppConfig; adhkar: AdhkarItem[] }) {
  const b = snap ? { code: snap.code, name: snap.config.mosque.nameAr } : status.binding; if (!b) throw new Error('هذا الجهاز غير مرتبط بمسجد');
  const { config, adhkar } = snap ?? getState();
  if (status.role === 'mosque') {
    // mosque supervisor: only this mosque's settings + adhkar (name / wilayat stay as they are)
    if (!canEdit(b.code)) throw new Error('لا تملك صلاحية تعديل هذا المسجد');
    const r = await rpc<{ version: number }>('mosque_manager_update', { p_password: requirePw(), p_code: b.code, p_config: sharedConfig(config), p_adhkar: adhkar });
    if (status.binding?.code === b.code) set({ mosqueVersion: r.version });
    return r;
  }
  const loc = config.mosque.location;
  if (!findWilayat(loc.governorateId, loc.wilayatId)) throw new Error('حدد المحافظة والولاية أولاً');
  const r = await rpc<{ version: number }>('mosque_admin_upsert_mosque', {
    p_password: requirePw(), p_code: b.code, p_name_ar: config.mosque.nameAr || b.name || b.code,
    p_governorate_id: loc.governorateId, p_wilayat_id: loc.wilayatId, p_config: sharedConfig(config), p_adhkar: adhkar,
  });
  if (status.binding?.code !== b.code) return r; // the device has moved on to another mosque
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
/** What is waiting to be uploaded, captured with the mosque it belongs to (so a mosque switch
 *  in the meantime can never send one mosque's settings to another). */
let pendingSnap: { code: string; config: AppConfig; adhkar: AdhkarItem[] } | null = null;

async function runUpload() {
  if (timer) { clearTimeout(timer); timer = null; }
  const kinds = [...pending]; pending.clear();
  const snap = pendingSnap; pendingSnap = null;
  if (!kinds.length) return;
  try {
    if (kinds.includes('mosque') && snap) await pushMosque(snap);
    if (kinds.includes('timetable')) await pushTimetable();
    set({ pendingUpload: false, lastError: null, lastSyncAt: new Date().toISOString() });
    log('info', `رفع إلى السحابة (${snap?.code ?? ''}): ${kinds.join(' + ')}`);
  } catch (e) {
    set({ pendingUpload: false, lastError: (e as Error).message });
  }
}

function scheduleUpload(kind: 'mosque' | 'timetable') {
  pending.add(kind);
  if (kind === 'mosque' && status.binding) {
    const { config, adhkar } = getState();
    pendingSnap = { code: status.binding.code, config: JSON.parse(JSON.stringify(config)) as AppConfig, adhkar };
  }
  set({ pendingUpload: true });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void runUpload(), 1500);
}

/** Sends any waiting edits now (used before the device switches to another mosque). */
export async function flushPendingUpload() {
  if (pending.size) await runUpload();
}

export function startCloud() {
  let fromUrl = bindingFromUrl();
  // opened from the address of the mosque it was un-linked from (e.g. an old home-screen icon): stay un-linked
  try { if (fromUrl && !status.binding && fromUrl === localStorage.getItem(LS_UNBOUND_CODE)) { fromUrl = null; syncUrl(null); } } catch { /* ignore */ }
  // devices un-linked before this update still carry the mosque's settings → give them their own once
  try { if (!status.binding && !fromUrl && localStorage.getItem(LS_MANUAL) && !localStorage.getItem(LS_OWN_DONE)) void restoreOwnSettings(); } catch { /* ignore */ }
  if (fromUrl && fromUrl !== status.binding?.code) void bindDevice(fromUrl);
  else if (status.binding) { syncUrl(status.binding.code); void syncNow(); }
  else void autoBindDefault();
  const tick = () => { if (status.binding) void syncNow(); else void autoBindDefault(); };
  setInterval(tick, POLL_MS);
  window.addEventListener('online', tick);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });

  lastSharedHash = JSON.stringify(sharedConfig(getState().config));
  // Only mosque settings/adhkar are uploaded automatically. Wilayat timetables are edited and
  // saved explicitly from «جدول المواقيت» (so a screen can never overwrite its wilayat's table).
  onLocalChange((k) => {
    if (!status.admin || !status.binding || !canEdit(status.binding.code)) return;
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
