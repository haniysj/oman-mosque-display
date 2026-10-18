/**
 * Display state engine.
 *
 * The whole screen state is a PURE FUNCTION of (current time, timetable, settings).
 * Nothing is counted down with timers: every tick (and every resume, focus or restart)
 * recomputes the state from absolute timestamps. A browser that was suspended for
 * three minutes during the quiet period therefore resumes exactly where it should be,
 * and an event can never fire early because of timer drift or rounding.
 */
import { activeSleep, SLEEP_WAKE_BEFORE_ADHAN_MS, type SleepWindow } from './sleep';
import type { AdhkarGroup, AdhkarItem, AppConfig, PrayerKey, PrayerSchedule } from '../domain/types';
import { PRAYER_KEYS } from '../domain/types';
import { buildDayPlan, type DayPlan, type SlotKey } from './iqamah';
import { addDays, MINUTE, muscatParts, type MuscatParts } from './time';

export type Phase = 'normal' | 'quiet' | 'adhkar';

export interface ScheduledEvent {
  id: string; // stable: `${date}:${slot}:${kind}`
  kind: 'adhan' | 'iqamah';
  slot: SlotKey;
  date: string;
  at: number;
  label: string; // Arabic prayer name (Friday → الجمعة)
}

export interface Sequence {
  id: string; // `${date}:${slot}:seq`
  slot: SlotKey;
  adhkarKey: PrayerKey | 'jumuah'; // which adhkar groups apply (Friday dhuhr → jumuah)
  label: string;
  iqamahAt: number;
  quietEnd: number;
  adhkarEnd: number;
  quietActive: boolean; // false when quiet mode is disabled (normal screen until adhkar)
}

export interface Countdown {
  event: ScheduledEvent;
  seconds: number; // whole seconds remaining (ceil) — 60 … 1
}

export interface DisplayState {
  now: number;
  parts: MuscatParts;
  today: string;
  plan: DayPlan | null; // null → no timetable record for today
  hijriDate: string; // Gregorian date used for the Hijri conversion (before admin adjustment)
  nextAdhan: ScheduledEvent | null;
  nextIqamah: ScheduledEvent | null;
  nextPrayerSlot: SlotKey | null; // highlighted in the prayer-times panel (today only)
  currentIqamahSlot: SlotKey | null; // between adhan and iqamah (highlighted in iqamah panel)
  adhanNowSlot: SlotKey | null; // «الآن» on the adhan row: adhan → 1 min before the iqamah
  iqamahNextSlot: SlotKey | null; // «القادمة» on the iqamah row (same window)
  iqamahNowSlot: SlotKey | null; // «الآن» on the iqamah row: 1 min before → 1 min after the iqamah
  countdown: Countdown | null;
  phase: Phase;
  sequence: Sequence | null;
  adhkarItem: AdhkarItem | null;
  adhkarIndex: number;
  adhkarCount: number;
  adhkarItemEndsAt: number | null;
  suppressedByMobile: boolean;
  /** Set while the black screen is a power-saving period (not a prayer). */
  sleep: SleepWindow | null;
}

export interface EngineInput {
  now: number;
  config: AppConfig;
  schedule: PrayerSchedule | null;
  adhkar: AdhkarItem[];
  isMobile: boolean;
  dismissed?: ReadonlySet<string>;
}

export const COUNTDOWN_WINDOW_MS = 60_000;
/** The black screen starts this long after the iqamah (its end time is unchanged). */
export const QUIET_DELAY_MS = 5_000;
/** Badge switch: «الآن» moves from the adhan row to the iqamah row this long before the iqamah,
 *  and «القادمة» moves to the next prayer this long after it. */
export const BADGE_SWITCH_MS = 60_000;

const NAMES: Record<PrayerKey, string> = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };

export function slotLabel(plan: DayPlan, slot: SlotKey, cfg: AppConfig): string {
  return slot === 'dhuhr' && plan.isFriday ? cfg.friday.label || 'الجمعة' : NAMES[slot];
}

function plansAround(input: EngineInput, today: string): (DayPlan | null)[] {
  return [addDays(today, -1), today, addDays(today, 1)].map((d) => {
    const rec = input.schedule?.days[d];
    return rec ? buildDayPlan(rec, input.config) : null;
  });
}

export function eventsOf(plan: DayPlan, cfg: AppConfig): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  for (const slot of PRAYER_KEYS) {
    const label = slotLabel(plan, slot, cfg);
    out.push({ id: `${plan.date}:${slot}:adhan`, kind: 'adhan', slot, date: plan.date, at: plan.adhan[slot], label });
    out.push({ id: `${plan.date}:${slot}:iqamah`, kind: 'iqamah', slot, date: plan.date, at: plan.iqamah[slot].at, label });
  }
  return out;
}

export function enabledAdhkar(list: AdhkarItem[]): AdhkarItem[] {
  return list.filter((a) => a.enabled && a.text.trim().length > 0).sort((a, b) => a.order - b.order);
}

/** Which group a dhikr belongs to (older items without groupId: guessed from their category). */
export function groupIdOf(item: AdhkarItem, groups: AdhkarGroup[]): string | null {
  if (item.groupId && groups.some((g) => g.id === item.groupId)) return item.groupId;
  const c = item.category || '';
  if (/صباح/.test(c) && groups.some((g) => g.id === 'morning')) return 'morning';
  if (/مساء/.test(c) && groups.some((g) => g.id === 'evening')) return 'evening';
  return groups.find((g) => g.id === 'after')?.id ?? groups[0]?.id ?? null;
}

/**
 * The adhkar shown after one prayer: the enabled groups that include this prayer, in group order,
 * each with its own items in order. The title of every item becomes its group's name.
 * slot null → every enabled group (used when no prayer applies).
 */
export function adhkarForSlot(list: AdhkarItem[], groups: AdhkarGroup[] | undefined, slot: PrayerKey | 'jumuah' | null): AdhkarItem[] {
  const gs = groups && groups.length ? groups : null;
  if (!gs) return enabledAdhkar(list);
  const items = enabledAdhkar(list);
  const out: AdhkarItem[] = [];
  for (const g of gs) {
    if (!g.enabled || (slot && !g.prayers?.[slot])) continue;
    for (const a of items) if (groupIdOf(a, gs) === g.id) out.push({ ...a, category: g.name });
  }
  return out.map((a, i) => ({ ...a, order: i }));
}

function sequenceFor(plan: DayPlan, slot: SlotKey, input: EngineInput): Sequence | null {
  const cfg = input.config;
  const isJumuah = slot === 'dhuhr' && plan.isFriday;
  const selected = cfg.quiet.prayers[isJumuah ? 'jumuah' : slot];
  if (!selected) return null;
  const quietMin = Math.max(0, isJumuah ? cfg.friday.quietMinutes : (cfg.quiet.minutesByPrayer?.[slot] ?? cfg.quiet.minutes));
  const adhkarKey = isJumuah ? 'jumuah' as const : slot;
  const hasAdhkar = cfg.adhkar.enabled && adhkarForSlot(input.adhkar, cfg.adhkar.groups, adhkarKey).length > 0;
  const adhkarMin = hasAdhkar ? Math.max(0, isJumuah ? cfg.friday.adhkarMinutes : cfg.adhkar.minutes) : 0;
  if (!cfg.quiet.enabled && adhkarMin === 0) return null;
  const iqamahAt = plan.iqamah[slot].at;
  const quietEnd = iqamahAt + quietMin * MINUTE;
  return {
    id: `${plan.date}:${slot}:seq`,
    slot,
    adhkarKey,
    label: slotLabel(plan, slot, cfg),
    iqamahAt,
    quietEnd,
    adhkarEnd: quietEnd + adhkarMin * MINUTE,
    quietActive: cfg.quiet.enabled,
  };
}

export function adhkarAt(list: AdhkarItem[], defaultSeconds: number, startedAt: number, now: number) {
  const items = enabledAdhkar(list);
  if (!items.length) return { item: null, index: -1, endsAt: null as number | null };
  // each dhikr may have its own length (any value ≥ 1 s); otherwise the default (≥ 5 s)
  const durs = items.map((a) => (typeof a.seconds === 'number' && a.seconds > 0 ? Math.max(1, a.seconds) : Math.max(5, defaultSeconds)) * 1000);
  const total = durs.reduce((a, b) => a + b, 0);
  const elapsed = Math.max(0, now - startedAt);
  const cycleStart = startedAt + Math.floor(elapsed / total) * total;
  let pos = elapsed % total;
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    if (pos < durs[i]) return { item: items[i], index: i, endsAt: cycleStart + acc + durs[i] };
    pos -= durs[i];
    acc += durs[i];
  }
  return { item: items[0], index: 0, endsAt: cycleStart + durs[0] };
}

export function computeState(input: EngineInput): DisplayState {
  const { now, config: cfg } = input;
  const parts = muscatParts(now);
  const today = parts.dateKey;
  const [yPlan, tPlan, nPlan] = plansAround(input, today);

  const events = [yPlan, tPlan, nPlan].flatMap((p) => (p ? eventsOf(p, cfg) : [])).sort((a, b) => a.at - b.at);
  // "upcoming" means strictly in the future: an event at `at` has happened once now >= at.
  const nextAdhan = events.find((e) => e.kind === 'adhan' && e.at > now) ?? null;
  const nextIqamah = events.find((e) => e.kind === 'iqamah' && e.at > now) ?? null;

  let nextPrayerSlot: SlotKey | null = null;
  let currentIqamahSlot: SlotKey | null = null;
  let adhanNowSlot: SlotKey | null = null;
  let iqamahNextSlot: SlotKey | null = null;
  let iqamahNowSlot: SlotKey | null = null;
  if (tPlan) {
    currentIqamahSlot = PRAYER_KEYS.find((s) => tPlan.adhan[s] <= now && now < tPlan.iqamah[s].at) ?? null;
    // Badges: from the adhan until 1 min before the iqamah → «الآن» on the adhan row and «القادمة»
    // on the iqamah row; from 1 min before until 1 min after the iqamah → «الآن» on the iqamah row.
    adhanNowSlot = PRAYER_KEYS.find((s) => tPlan.adhan[s] <= now && now < tPlan.iqamah[s].at - BADGE_SWITCH_MS) ?? null;
    iqamahNextSlot = adhanNowSlot;
    iqamahNowSlot = PRAYER_KEYS.find((s) => tPlan.iqamah[s].at - BADGE_SWITCH_MS <= now && now < tPlan.iqamah[s].at + BADGE_SWITCH_MS && tPlan.adhan[s] <= now) ?? null;
    // «القادمة» on the next adhan: one minute after the current prayer's iqamah
    const busy = PRAYER_KEYS.some((s) => tPlan.adhan[s] <= now && now < tPlan.iqamah[s].at + BADGE_SWITCH_MS)
      || (!!yPlan && now < yPlan.iqamah.isha.at + BADGE_SWITCH_MS);
    nextPrayerSlot = busy ? null : PRAYER_KEYS.find((s) => tPlan.adhan[s] > now) ?? null;
  }

  // Countdown (≤ 60 s) — choose the earliest qualifying event
  let countdown: Countdown | null = null;
  for (const e of [nextAdhan, nextIqamah].filter(Boolean).sort((a, b) => a!.at - b!.at) as ScheduledEvent[]) {
    const remaining = e.at - now;
    if (remaining > 0 && remaining <= COUNTDOWN_WINDOW_MS) {
      const plan = e.date === today ? tPlan : e.date < today ? yPlan : nPlan;
      if (plan && e.slot === 'dhuhr' && plan.isFriday && !cfg.friday.countdownEnabled) continue;
      countdown = { event: e, seconds: Math.ceil(remaining / 1000) };
      break;
    }
  }

  // Post-iqamah sequence (quiet → adhkar), from yesterday or today (Isha may cross midnight)
  let sequence: Sequence | null = null;
  for (const p of [yPlan, tPlan]) {
    if (!p) continue;
    for (const slot of PRAYER_KEYS) {
      const seq = sequenceFor(p, slot, input);
      if (seq && now >= seq.iqamahAt && now < seq.adhkarEnd) sequence = seq;
    }
  }
  if (sequence && input.dismissed?.has(sequence.id)) sequence = null;

  let phase: Phase = 'normal';
  let suppressedByMobile = false;
  if (sequence) {
    if (now < sequence.quietEnd) phase = sequence.quietActive && now >= sequence.iqamahAt + QUIET_DELAY_MS ? 'quiet' : 'normal';
    else phase = 'adhkar';
    // Phones never show the black screen or the adhkar screen (not configurable).
    if (phase !== 'normal' && input.isMobile) {
      suppressedByMobile = true;
      phase = 'normal';
    }
  }

  // Power-saving periods: black screen with the clock, except around the prayers
  let sleep: SleepWindow | null = null;
  if (!sequence && phase === 'normal') {
    const w = activeSleep(cfg, now);
    const wake = cfg.quiet.sleep?.wakeForPrayers !== false;
    const nearPrayer = wake && [yPlan, tPlan, nPlan].some((p) => !!p && PRAYER_KEYS.some((s) => now >= p.adhan[s] - SLEEP_WAKE_BEFORE_ADHAN_MS && now < p.iqamah[s].at + BADGE_SWITCH_MS));
    if (w && !nearPrayer && !input.dismissed?.has(w.id)) {
      if (input.isMobile) suppressedByMobile = true;
      else { sleep = w; phase = 'quiet'; }
    }
  }

  let adhkarItem: AdhkarItem | null = null, adhkarIndex = -1, adhkarItemEndsAt: number | null = null;
  const enabled = enabledAdhkar(input.adhkar);
  if (phase === 'adhkar' && sequence) {
    const a = adhkarAt(adhkarForSlot(input.adhkar, cfg.adhkar.groups, sequence.adhkarKey ?? sequence.slot), cfg.adhkar.defaultSeconds, sequence.quietEnd, now);
    adhkarItem = a.item; adhkarIndex = a.index; adhkarItemEndsAt = a.endsAt;
  }

  let hijriDate = today;
  if (cfg.hijri.changeAtMaghrib && tPlan && now >= tPlan.adhan.maghrib) hijriDate = addDays(today, 1);

  return {
    now, parts, today, plan: tPlan, hijriDate,
    nextAdhan, nextIqamah, nextPrayerSlot, currentIqamahSlot, adhanNowSlot, iqamahNextSlot, iqamahNowSlot,
    countdown, phase, sequence,
    adhkarItem, adhkarIndex, adhkarCount: enabled.length, adhkarItemEndsAt, suppressedByMobile, sleep,
  };
}

/**
 * Fires each event exactly once per page session, even if the state is recomputed many
 * times per second, the device clock jumps backwards, or the component re-renders.
 * Events that already lay in the past when the app started are reported as "reconciled"
 * (not fired), so a restart never replays an adhan or re-starts a finished sequence.
 */
export class EventTracker {
  private fired = new Set<string>();
  private lastNow: number | null = null;

  observe(state: DisplayState, schedule: PrayerSchedule | null, cfg: AppConfig): { fired: ScheduledEvent[]; reconciled: number; clockJump: number } {
    const events: ScheduledEvent[] = [];
    for (const d of [addDays(state.today, -1), state.today]) {
      const rec = schedule?.days[d];
      if (rec) events.push(...eventsOf(buildDayPlan(rec, cfg), cfg));
    }
    const out: ScheduledEvent[] = [];
    let reconciled = 0;
    const first = this.lastNow === null;
    const jump = this.lastNow === null ? 0 : state.now - this.lastNow;
    for (const e of events) {
      if (e.at > state.now || this.fired.has(e.id)) continue;
      this.fired.add(e.id);
      // On first observation (startup) or after a big forward jump (sleep / clock change),
      // past events are reconciled silently rather than fired late.
      if (first || state.now - e.at > 5 * MINUTE) reconciled++;
      else out.push(e);
    }
    this.lastNow = state.now;
    if (this.fired.size > 200) this.fired = new Set([...this.fired].slice(-100));
    return { fired: out, reconciled, clockJump: jump };
  }
}
