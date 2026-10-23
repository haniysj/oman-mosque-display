/**
 * Device classification. Phones must never get the black screen after iqamah.
 * Smart TVs are often touch-capable or report odd viewport sizes, so TV user-agent
 * markers are checked FIRST and always win over the phone heuristics.
 */
import type { DeviceMode } from '../domain/types';

export interface DeviceEnv {
  userAgent: string;
  uaMobileHint?: boolean; // navigator.userAgentData?.mobile
  screenWidth: number;
  screenHeight: number;
  coarsePointer: boolean;
  maxTouchPoints: number;
}

export type DeviceClass = 'tv' | 'desktop' | 'tablet' | 'mobile';

const TV_RE = /smart-?tv|smarttv|tizen|web0s|webos|netcast|hbbtv|bravia|aft[a-z]|android tv|googletv|crkey|roku|viera|philipstv|vidaa|hisense|tv safari|large screen|\btv\b/i;
const PHONE_RE = /iphone|ipod|android.+mobile|windows phone|blackberry|opera mini|mobile safari(?!.*ipad)/i;
const TABLET_RE = /ipad|android(?!.*mobile)|tablet/i;

export function classifyDevice(env: DeviceEnv): DeviceClass {
  const ua = env.userAgent || '';
  if (TV_RE.test(ua)) return 'tv';
  const shortSide = Math.min(env.screenWidth, env.screenHeight);
  const touch = env.coarsePointer || env.maxTouchPoints > 1;
  // Android with no touch screen at all = a TV / TV box. Kiosk apps (Fully Kiosk…) use the Android
  // WebView, whose user agent says «Mobile» and whose screen is often 960×540 — never a phone.
  if (/android/i.test(ua) && !env.coarsePointer && env.maxTouchPoints === 0) return 'tv';
  if (env.uaMobileHint === true || PHONE_RE.test(ua)) return shortSide >= 600 ? 'tablet' : 'mobile';
  // iPadOS reports a desktop Safari UA — detect by touch on a "Macintosh"
  if (/macintosh/i.test(ua) && env.maxTouchPoints > 1) return 'tablet';
  if (TABLET_RE.test(ua) && touch) return 'tablet';
  if (touch && shortSide < 600) return 'mobile';
  return 'desktop';
}

/** True when quiet mode must be suppressed (phones). Manual override wins. */
export function isPhone(mode: DeviceMode, detected: DeviceClass): boolean {
  if (mode === 'mobile') return true;
  if (mode === 'tv' || mode === 'desktop') return false;
  return detected === 'mobile';
}

export function readDeviceEnv(): DeviceEnv {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return {
    userAgent: nav.userAgent,
    uaMobileHint: nav.userAgentData?.mobile,
    screenWidth: window.screen?.width ?? window.innerWidth,
    screenHeight: window.screen?.height ?? window.innerHeight,
    coarsePointer: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
  };
}
