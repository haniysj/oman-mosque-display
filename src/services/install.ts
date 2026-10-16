/**
 * «تثبيت التطبيق»: installs the platform as an app on this device.
 * Chrome / Edge / Android / Samsung: the browser's own install prompt (captured early, shown on click).
 * iPhone / iPad (Safari has no prompt): step-by-step «Add to Home Screen» instructions.
 */
import { useSyncExternalStore } from 'react';

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: BIPEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const isStandalone = () =>
  (typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches))
  || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; emit(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; emit(); });
}

export type InstallState = 'installed' | 'prompt' | 'ios' | 'manual';
const snapshot = (): InstallState => (installed || isStandalone() ? 'installed' : deferred ? 'prompt' : isIos() ? 'ios' : 'manual');
let last = snapshot();
export function useInstallState(): InstallState {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => { const s = snapshot(); if (s !== last) last = s; return last; });
}

/** Shows the browser's install prompt. Returns true when the app was installed. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  await e.prompt();
  const { outcome } = await e.userChoice;
  deferred = null; emit();
  return outcome === 'accepted';
}
