/**
 * Phone reminder 5 minutes before each iqamah.
 *
 * Limits (browser rules, not app choices): the reminder fires while the app is open or kept
 * in the background by the system. iPhone requires the app to be added to the Home Screen
 * (iOS 16.4+) before notifications are allowed at all. A reminder when the app is fully
 * closed would need a push server.
 */
import { useSyncExternalStore } from 'react';
import type { DisplayState } from '../core/engine';
import { formatTimestamp } from '../core/time';

export const REMIND_MS = 5 * 60 * 1000;
const LS_PREF = 'omd-notify-iqamah';
const LS_FIRED = 'omd-notify-fired';

export type NotifyState = 'unsupported' | 'off' | 'on' | 'denied';

const supported = () => typeof window !== 'undefined' && 'Notification' in window;
function compute(): NotifyState {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  let pref = false; try { pref = localStorage.getItem(LS_PREF) === '1'; } catch { /* ignore */ }
  return pref && Notification.permission === 'granted' ? 'on' : 'off';
}
let current = compute();
const subs = new Set<() => void>();
const refresh = () => { current = compute(); subs.forEach((s) => s()); };
export const useNotifyState = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => current);

export async function enableReminders(): Promise<NotifyState> {
  if (!supported()) return 'unsupported';
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  try { localStorage.setItem(LS_PREF, p === 'granted' ? '1' : '0'); } catch { /* ignore */ }
  refresh();
  return current;
}
export function disableReminders() { try { localStorage.setItem(LS_PREF, '0'); } catch { /* ignore */ } refresh(); }

function firedSet(): string[] { try { return JSON.parse(localStorage.getItem(LS_FIRED) || '[]') as string[]; } catch { return []; } }

/** Called every second with the display state; fires each reminder once per iqamah. */
export function maybeRemind(state: DisplayState, mosqueName: string, fmt: '12' | '24') {
  if (current !== 'on') return;
  const e = state.nextIqamah;
  if (!e) return;
  const left = e.at - state.now;
  if (left <= 0 || left > REMIND_MS) return;
  const fired = firedSet();
  if (fired.includes(e.id)) return;
  try { localStorage.setItem(LS_FIRED, JSON.stringify([...fired, e.id].slice(-30))); } catch { /* ignore */ }
  const mins = Math.max(1, Math.round(left / 60000));
  const t = formatTimestamp(e.at, fmt, 'western');
  const title = `إقامة صلاة ${e.label} بعد ${mins === 1 ? 'دقيقة' : mins === 2 ? 'دقيقتين' : `${mins} دقائق`}`;
  const body = `${mosqueName} — الإقامة ${t.text} ${t.period}`.trim();
  const opts: NotificationOptions = { body, tag: e.id, icon: '/icon-192.png', badge: '/favicon-32.png', lang: 'ar', dir: 'rtl', silent: false };
  const fallback = () => { try { new Notification(title, opts); } catch { /* ignore */ } };
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then((r) => r.showNotification(title, opts)).catch(fallback);
  } else fallback();
}
