/**
 * Which mosque the settings pages are editing.
 *  - this screen's own mosque (or an unlinked device): edits go live to this device, and are
 *    uploaded to that mosque only when the signed-in person may edit it;
 *  - any other mosque: its settings are loaded from the cloud into a draft and saved to it alone.
 * The general administrator may pick any mosque; a mosque supervisor only their own mosque(s).
 */
import { useSyncExternalStore } from 'react';
import type { AdhkarItem, AppConfig, PrayerSchedule } from '../../domain/types';
import { getState, setAdhkar, updateConfig, useApp } from '../../store/appStore';
import { getCloud, getMosqueBundle, getMosqueConfig, saveMosqueSettings } from '../../services/cloud';
import { defaultAdhkar } from '../../domain/defaults';

export const LOCAL = '__local__';

interface Remote { code: string; cfg: AppConfig; adhkar: AdhkarItem[]; schedule: PrayerSchedule | null; dirty: boolean }
interface EditState { target: string; remote: Remote | null; loading: boolean; saving: boolean; error: string; msg: string }

let st: EditState = { target: '', remote: null, loading: false, saving: false, error: '', msg: '' };
const subs = new Set<() => void>();
const put = (p: Partial<EditState>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const useEditState = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => st);

/** The default target for the signed-in person. */
export function defaultTarget(): string {
  const c = getCloud();
  const bound = c.binding?.code ?? null;
  if (c.role === 'mosque') return bound && c.codes.includes(bound) ? bound : c.codes[0] ?? '';
  return bound ?? LOCAL;
}

const isLocalTarget = (t: string) => !!t && (t === LOCAL || t === getCloud().binding?.code);

export async function selectTarget(code: string) {
  put({ target: code, error: '', msg: '' });
  if (isLocalTarget(code)) { put({ remote: null, loading: false }); return; }
  put({ remote: null, loading: true });
  try {
    const b = await getMosqueBundle(code);
    const local = getState();
    const schedule = b.wilayatSchedule ?? (local.config.mosque.location.wilayatId === b.cfg.mosque.location.wilayatId ? local.schedule : null);
    if (st.target === code) put({ remote: { code, cfg: b.cfg, adhkar: b.adhkar ?? defaultAdhkar(), schedule, dirty: false }, loading: false });
  } catch (e) {
    if (st.target === code) put({ loading: false, error: (e as Error).message });
  }
}

export function ensureTarget() {
  if (!st.target) void selectTarget(defaultTarget());
}

export function resetEditTarget() { st = { target: '', remote: null, loading: false, saving: false, error: '', msg: '' }; subs.forEach((f) => f()); }

/** Live config of the mosque being edited (this device's config for the local target). */
export function useEditCfg(): AppConfig {
  const local = useApp((s) => s.config);
  const e = useEditState();
  return !isLocalTarget(e.target) && e.remote ? e.remote.cfg : local;
}
export function useEditAdhkar(): AdhkarItem[] {
  const local = useApp((s) => s.adhkar);
  const e = useEditState();
  return !isLocalTarget(e.target) && e.remote ? e.remote.adhkar : local;
}
export function useEditSchedule(): PrayerSchedule | null {
  const local = useApp((s) => s.schedule);
  const e = useEditState();
  return !isLocalTarget(e.target) && e.remote ? e.remote.schedule : local;
}
/** True while another mosque is loading / not available (pages show a note instead of editing). */
export function useEditReady(): boolean {
  const e = useEditState();
  return isLocalTarget(e.target) || (!!e.remote && e.remote.code === e.target);
}

export function editConfig(fn: (c: AppConfig) => void) {
  if (isLocalTarget(st.target)) { void updateConfig(fn); return; }
  if (!st.remote) return; // another mosque is still loading — never touch this device by mistake
  const c = JSON.parse(JSON.stringify(st.remote.cfg)) as AppConfig;
  fn(c);
  put({ remote: { ...st.remote, cfg: c, dirty: true }, msg: '' });
}
export function editAdhkar(list: AdhkarItem[]) {
  if (isLocalTarget(st.target)) { void setAdhkar(list); return; }
  if (!st.remote) return;
  put({ remote: { ...st.remote, adhkar: list.map((a, i) => ({ ...a, order: i })), dirty: true }, msg: '' });
}

/** Saves the draft of another mosque: re-reads it and replaces only its settings sections. */
export async function saveTarget() {
  const r = st.remote;
  if (!r) return;
  put({ saving: true, error: '', msg: '' });
  try {
    const fresh = await getMosqueConfig(r.code);
    const merged: AppConfig = { ...fresh, iqamah: r.cfg.iqamah, friday: r.cfg.friday, hijri: r.cfg.hijri, quiet: r.cfg.quiet, adhkar: r.cfg.adhkar, display: { ...fresh.display, ...r.cfg.display } };
    await saveMosqueSettings(r.code, merged, r.adhkar);
    put({ saving: false, remote: { ...r, cfg: merged, dirty: false }, msg: 'تم الحفظ لهذا المسجد فقط — يصل إلى شاشاته خلال 5 دقائق أو عند فتحها.' });
  } catch (e) {
    put({ saving: false, error: (e as Error).message });
  }
}
export const discardTarget = () => { if (st.remote) void selectTarget(st.remote.code); };
