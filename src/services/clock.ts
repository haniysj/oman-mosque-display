/**
 * The single timekeeping service. Exactly one ticker exists per page, no matter how
 * many components subscribe or how often they re-render.
 *
 * now() = device clock + administrator/server correction (+ simulation, if active).
 * Ticks are aligned to whole seconds, and an immediate tick is forced whenever the page
 * becomes visible, regains focus, is restored from the back/forward cache or comes back
 * online — so the state is always recomputed after a suspension.
 *
 * Simulation lives ONLY in memory: a page reload always returns to the real clock, so a
 * demo can never stay enabled on the mosque display.
 */

type Listener = (now: number) => void;

interface Simulation { realStart: number; simStart: number; speed: number; expiresAtReal: number }

const listeners = new Set<Listener>();
let offsetMs = 0;
let sim: Simulation | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
const SIM_MAX_REAL_MS = 30 * 60 * 1000; // a simulation ends by itself after 30 real minutes

export function setClockOffset(ms: number) { offsetMs = Number.isFinite(ms) ? ms : 0; tickNow(); }
export function getClockOffset() { return offsetMs; }

export function realNow(): number { return Date.now() + offsetMs; }

export function now(): number {
  const r = Date.now();
  if (sim) {
    if (r >= sim.expiresAtReal) sim = null;
    else return sim.simStart + (r - sim.realStart) * sim.speed;
  }
  return r + offsetMs;
}

export function startSimulation(simStart: number, speed = 1) {
  const r = Date.now();
  sim = { realStart: r, simStart, speed: Math.max(1, Math.min(60, speed)), expiresAtReal: r + SIM_MAX_REAL_MS };
  tickNow();
}
export function stopSimulation() { sim = null; tickNow(); }
export function simulationInfo(): { active: boolean; speed: number; endsInMs: number } {
  if (!sim) return { active: false, speed: 1, endsInMs: 0 };
  return { active: true, speed: sim.speed, endsInMs: Math.max(0, sim.expiresAtReal - Date.now()) };
}

function emit() {
  const n = now();
  listeners.forEach((l) => { try { l(n); } catch (e) { console.error(e); } });
}

function schedule() {
  if (timer) clearTimeout(timer);
  // when simulating at speed > 1, tick faster so the screen keeps up
  const step = sim && sim.speed > 1 ? Math.max(50, 1000 / sim.speed) : 1000;
  const n = now();
  const delay = sim && sim.speed > 1 ? step : 1000 - (n % 1000) + 5;
  timer = setTimeout(() => { emit(); schedule(); }, delay);
}

export function tickNow() { if (started) { emit(); schedule(); } }

function onWake() { tickNow(); }

export function startClock() {
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('focus', onWake);
  window.addEventListener('pageshow', onWake);
  window.addEventListener('online', onWake);
  emit();
  schedule();
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/**
 * Compares the device clock with the HTTP Date header of the hosting server (when online).
 * Returns the server-minus-device difference in ms, or null when offline / unavailable.
 * Resolution is ±1 s (the Date header has whole-second precision).
 */
export async function measureServerOffset(): Promise<number | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  try {
    const t0 = Date.now();
    const res = await fetch(`/__time?ts=${t0}`, { method: 'HEAD', cache: 'no-store' });
    const t1 = Date.now();
    const h = res.headers.get('date');
    if (!h) return null;
    const server = Date.parse(h);
    if (!Number.isFinite(server)) return null;
    if (t1 - t0 > 5000) return null; // too slow to be meaningful
    return server + 500 - (t0 + t1) / 2;
  } catch {
    return null;
  }
}
