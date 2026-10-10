/** Browser platform helpers: full screen, screen wake lock, online status. */
import { useEffect, useState } from 'react';

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

export const fullscreenSupported = () => {
  const el = document.documentElement as FsEl;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
};
export const isFullscreen = () => !!(document.fullscreenElement || (document as FsDoc).webkitFullscreenElement);

/** Must be called from a user gesture (click / key press) — browsers refuse otherwise. */
export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (isFullscreen()) {
      const d = document as FsDoc;
      await (document.exitFullscreen ? document.exitFullscreen() : d.webkitExitFullscreen?.());
      return false;
    }
    const el = document.documentElement as FsEl;
    await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions) : el.webkitRequestFullscreen?.());
    return true;
  } catch {
    return isFullscreen();
  }
}

export function useFullscreen(): boolean {
  const [fs, setFs] = useState(isFullscreen());
  useEffect(() => {
    const h = () => setFs(isFullscreen());
    document.addEventListener('fullscreenchange', h);
    document.addEventListener('webkitfullscreenchange', h);
    return () => { document.removeEventListener('fullscreenchange', h); document.removeEventListener('webkitfullscreenchange', h); };
  }, []);
  return fs;
}

export function useOnline(): boolean {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener('online', a); window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (t: string, f: () => void) => void };

/** Keeps the screen awake where the Screen Wake Lock API exists; re-acquired after visibility changes. */
export function useWakeLock(enabled: boolean): 'active' | 'unsupported' | 'off' | 'released' {
  const [status, setStatus] = useState<'active' | 'unsupported' | 'off' | 'released'>('off');
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } };
    if (!enabled) { setStatus('off'); return; }
    if (!nav.wakeLock) { setStatus('unsupported'); return; }
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || cancelled) return;
      try {
        sentinel = await nav.wakeLock!.request('screen');
        setStatus('active');
        sentinel.addEventListener?.('release', () => setStatus('released'));
      } catch { setStatus('released'); }
    };
    void acquire();
    const onVis = () => { if (document.visibilityState === 'visible') void acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); void sentinel?.release().catch(() => undefined); };
  }, [enabled]);
  return status;
}
