import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AppConfig, DigitStyle } from '../../domain/types';
import { formatClock, formatCountdown, muscatParts } from '../../core/time';
import type { DisplayState, ScheduledEvent } from '../../core/engine';

/** Shrinks text until it fits within `lines` lines of the box (long mosque names wrap, never clip). */
export function FitText({ text, base, min, lines, className, lh = 1.3 }: { text: string; base: number; min: number; lines: number; className?: string; lh?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(base);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let s = base;
    el.style.fontSize = `${s}px`;
    while (s > min && el.scrollHeight > s * lh * lines + 2) {
      s -= 2;
      el.style.fontSize = `${s}px`;
    }
    setSize(s);
  }, [text, base, min, lines, lh]);
  return <div ref={ref} className={className} style={{ fontSize: size, lineHeight: lh }}>{text}</div>;
}

// 12-hour times are shown without ص / م (the day context makes them clear)
export function TimeText({ ms, cfg, className }: { ms: number; cfg: AppConfig; className?: string; periodClass?: string }) {
  const p = muscatParts(ms);
  const f = formatClock(p.hour * 60 + p.minute, 0, cfg.display.timeFormat, cfg.display.digits);
  return (
    <span className={className}>
      <bdi className="num">{f.text}</bdi>
    </span>
  );
}

/** Each digit sits in a fixed-width cell so the clock never shifts when digits change. */
export function StableDigits({ text, className }: { text: string; className?: string }) {
  return (
    <bdi className={className} dir="ltr">
      {[...text].map((ch, i) => (
        <span key={i} className={ch === ':' ? 'colon' : 'digit'}>{ch}</span>
      ))}
    </bdi>
  );
}

export function eventPhrase(e: ScheduledEvent): string {
  return e.kind === 'adhan'
    ? e.label === 'الجمعة' ? 'صلاة الجمعة' : `أذان صلاة ${e.label}`
    : `إقامة صلاة ${e.label}`;
}

export function remainingText(state: DisplayState, e: ScheduledEvent | null, digits: DigitStyle): string {
  if (!e) return '—';
  return formatCountdown(Math.ceil((e.at - state.now) / 1000), digits);
}

export function Pill({ children, tone }: { children: ReactNode; tone: 'gold' | 'ivory' }) {
  return <span className={`row-pill row-pill--${tone}`}>{children}</span>;
}
