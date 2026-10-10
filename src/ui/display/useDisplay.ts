import { useEffect, useMemo, useRef, useState } from 'react';
import { computeState, EventTracker, type DisplayState } from '../../core/engine';
import { classifyDevice, isPhone, readDeviceEnv, type DeviceClass } from '../../core/device';
import { autoExtendIfNeeded, getState, log, useApp } from '../../store/appStore';
import { now as clockNow, subscribe } from '../../services/clock';
import { maybeApplyUpdate } from '../../services/pwa';
import { maybeRemind } from '../../services/notify';
import { MINUTE } from '../../core/time';

export function useNow(): number {
  const [n, setN] = useState(clockNow());
  useEffect(() => subscribe(setN), []);
  return n;
}

export function useDeviceClass(): DeviceClass {
  const [c, setC] = useState<DeviceClass>(() => classifyDevice(readDeviceEnv()));
  useEffect(() => {
    const h = () => setC(classifyDevice(readDeviceEnv()));
    window.addEventListener('resize', h);
    window.addEventListener('orientationchange', h);
    return () => { window.removeEventListener('resize', h); window.removeEventListener('orientationchange', h); };
  }, []);
  return c;
}

const DISMISS_KEY = 'omd-dismissed-sequences';
function readDismissed(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '[]') as string[]); } catch { return new Set(); }
}

export function useDisplayState(): { state: DisplayState; device: DeviceClass; phone: boolean; dismissCurrent: () => void } {
  const now = useNow();
  const config = useApp((s) => s.config);
  const schedule = useApp((s) => s.schedule);
  const adhkar = useApp((s) => s.adhkar);
  const device = useDeviceClass();
  const phone = isPhone(config.display.deviceMode, device);
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const tracker = useRef(new EventTracker());

  const state = useMemo(
    () => computeState({ now, config, schedule, adhkar, isMobile: phone, dismissed }),
    [now, config, schedule, adhkar, phone, dismissed],
  );

  // Event logging (each event exactly once) + clock-jump detection + safe PWA update
  useEffect(() => {
    const r = tracker.current.observe(state, getState().schedule, getState().config);
    r.fired.forEach((e) => log('info', `${e.kind === 'adhan' ? 'أذان' : 'إقامة'} ${e.label} (${e.date})`));
    if (Math.abs(r.clockJump) > 2 * MINUTE) log('warn', `قفزة في ساعة الجهاز أو استئناف بعد توقف: ${Math.round(r.clockJump / 1000)} ثانية — أعيد حساب الحالة`);
    const nextAt = Math.min(state.nextAdhan?.at ?? Infinity, state.nextIqamah?.at ?? Infinity);
    maybeApplyUpdate(state.phase === 'normal' && !state.countdown && nextAt - state.now > 3 * MINUTE);
    const c = getState().config;
    maybeRemind(state, c.mosque.nameAr, c.display.timeFormat);
  }, [state]);

  // date rollover: keep the calibrated timetable filled ahead
  useEffect(() => { void autoExtendIfNeeded(state.today); }, [state.today]);

  const prevPhase = useRef(state.phase);
  useEffect(() => {
    if (prevPhase.current !== state.phase) {
      log('info', `تغيّر العرض: ${prevPhase.current} ← ${state.phase}${state.sequence ? ` (${state.sequence.label})` : ''}`);
      prevPhase.current = state.phase;
    }
  }, [state.phase, state.sequence]);

  const dismissCurrent = () => {
    if (!state.sequence) return;
    const next = new Set(dismissed);
    next.add(state.sequence.id);
    try { sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next].slice(-20))); } catch { /* ignore */ }
    setDismissed(next);
    log('warn', `إنهاء يدوي لوضع السكون/الأذكار (${state.sequence.label})`);
  };

  return { state, device, phone, dismissCurrent };
}
