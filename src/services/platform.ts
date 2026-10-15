/** Browser platform helpers: full screen, screen wake lock, online status. */
import { useEffect, useState } from 'react';

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

export const fullscreenSupported = () => {
  const el = document.documentElement as FsEl;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
};

/**
 * iPhone Safari (and the installed iPhone app) has no Fullscreen API for pages. There we use an
 * in-app "full screen" mode instead: the page already fills the screen, so it only hides the buttons
 * (exactly like real full screen does elsewhere) and is left with the same exit button.
 */
let pseudoFs = false;
const PSEUDO_EVT = 'omd-pseudo-fullscreen';
export const isFullscreen = () => pseudoFs || !!(document.fullscreenElement || (document as FsDoc).webkitFullscreenElement);

/** Must be called from a user gesture (click / key press) — browsers refuse otherwise. */
export async function toggleFullscreen(): Promise<boolean> {
  if (pseudoFs || !fullscreenSupported()) {
    pseudoFs = !pseudoFs;
    document.documentElement.classList.toggle('is-pseudo-fs', pseudoFs);
    document.dispatchEvent(new Event(PSEUDO_EVT));
    return pseudoFs;
  }
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
    document.addEventListener(PSEUDO_EVT, h);
    return () => { document.removeEventListener('fullscreenchange', h); document.removeEventListener('webkitfullscreenchange', h); document.removeEventListener(PSEUDO_EVT, h); };
  }, []);
  return fs;
}

export interface SafeInsets { top: number; right: number; bottom: number; left: number }

/**
 * The screen areas covered by the notch / Dynamic Island / home indicator / rounded corners
 * (iPhone, some Android phones). Zero everywhere else. Measured from CSS env(safe-area-inset-*).
 */
export function useSafeInsets(): SafeInsets {
  const read = (): SafeInsets => {
    if (typeof document === 'undefined' || !document.body) return { top: 0, right: 0, bottom: 0, left: 0 };
    const p = document.createElement('div');
    p.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(p);
    const s = getComputedStyle(p);
    const r = { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
    p.remove();
    return r;
  };
  const [ins, setIns] = useState<SafeInsets>(read);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const h = () => {
      setIns(read());
      clearTimeout(t); t = setTimeout(() => setIns(read()), 350); // iOS updates insets after the rotation animation
    };
    window.addEventListener('resize', h); window.addEventListener('orientationchange', h);
    return () => { clearTimeout(t); window.removeEventListener('resize', h); window.removeEventListener('orientationchange', h); };
  }, []);
  return ins;
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
