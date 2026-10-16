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

/**
 * Gold cartouche behind the mosque name (pointed ogee ends, gold band, inner colour from the theme).
 * Built from 3 parts so the ends keep their shape whatever the length of the name:
 * [right end][middle — grows with the name][left end].
 */
export function NameFrame({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const cap = (flip: boolean) => (
    <svg className="nf-cap" viewBox="0 0 46 100" preserveAspectRatio="none" aria-hidden style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <defs>
        <linearGradient id={`nfg${flip ? 'l' : 'r'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F7C76A" /><stop offset=".5" stopColor="#D8932A" /><stop offset="1" stopColor="#F2BC5C" />
        </linearGradient>
      </defs>
      <path d="M-1 0H14V9H19C29 9 33 33 46 50 33 67 29 91 19 91H14V100H-1Z" fill={`url(#nfg${flip ? 'l' : 'r'})`} />
      <path d="M-1 8H8V15H16C24 15 27 36 37 50 27 64 24 85 16 85H8V92H-1Z" fill="#9A5E12" opacity=".55" />
      <path d="M-1 10H6V17H15C22 17 25 37 34 50 25 63 22 83 15 83H6V90H-1Z" className="nf-cap-fill" />
    </svg>
  );
  return (
    <span className={`name-frame ${className}`}>
      {/* in RTL the first item sits on the right: its point faces right; the last one is mirrored */}
      {cap(false)}
      <span className="nf-mid">{children}</span>
      {cap(true)}
    </span>
  );
}
