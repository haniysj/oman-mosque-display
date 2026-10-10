/**
 * Service worker registration with a SAFE update strategy.
 * A new version is downloaded in the background but only activated (page reload) when
 * the display is idle: normal phase, no countdown, and no adhan / iqamah within 3 minutes.
 * The administrator can also apply it immediately from the diagnostics page.
 */
import { useSyncExternalStore } from 'react';

export interface PwaStatus {
  supported: boolean;
  registered: boolean;
  offlineReady: boolean;
  updateWaiting: boolean;
  error: string | null;
}

let status: PwaStatus = { supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator, registered: false, offlineReady: false, updateWaiting: false, error: null };
const subs = new Set<() => void>();
const set = (p: Partial<PwaStatus>) => { status = { ...status, ...p }; subs.forEach((s) => s()); };
let updateFn: ((reload?: boolean) => Promise<void>) | null = null;

export const usePwaStatus = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => status);
export const getPwaStatus = () => status;

export async function registerPwa(onLog: (m: string) => void) {
  if (!status.supported) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    updateFn = registerSW({
      immediate: true,
      onRegisteredSW() { set({ registered: true }); },
      onOfflineReady() { set({ offlineReady: true }); onLog('التطبيق جاهز للعمل دون إنترنت (تم حفظ الملفات محلياً)'); },
      onNeedRefresh() { set({ updateWaiting: true }); onLog('يتوفر إصدار جديد — سيُطبَّق تلقائياً في وقت آمن'); },
      onRegisterError(e: unknown) { set({ error: String(e) }); },
    });
    // an already-controlled page is offline-ready
    if (navigator.serviceWorker.controller) set({ offlineReady: true });
  } catch (e) {
    set({ error: (e as Error).message });
  }
}

export async function applyUpdateNow() {
  if (updateFn) await updateFn(true);
}

/** Called every tick by the display: applies a waiting update only when it is safe. */
export function maybeApplyUpdate(isSafe: boolean) {
  if (status.updateWaiting && isSafe && updateFn) {
    set({ updateWaiting: false });
    void updateFn(true);
  }
}
