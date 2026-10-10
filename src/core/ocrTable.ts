/**
 * Turns OCR output of a printed / screenshotted prayer-times table (e.g. the Ministry's monthly
 * page) into rows of six times in prayer order. Pure functions — the OCR engine itself lives in
 * services/ocr.ts. Nothing here is trusted blindly: every row is checked for plausibility and
 * the admin reviews and corrects the grid before it reaches the normal CSV import validation.
 */
import { TIME_KEYS, type TimeKey } from '../domain/types';

export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number }

export interface OcrRow {
  times: string[]; // 6 × "H:MM" in prayer order (fajr, sunrise, dhuhr, asr, maghrib, isha)
  date: string | null; // ISO date when a full date was printed on the row
  plausible: boolean;
  y: number;
}

export interface OcrTable {
  rows: OcrRow[];
  direction: 'rtl' | 'ltr'; // visual order of the time columns
  detectedYear: number | null;
  detectedMonth: number | null; // 1–12
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function latinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) >= 0 ? AR_DIGITS.indexOf(d) : FA_DIGITS.indexOf(d)));
}

const DATE_RE = /(\d{1,4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})/;
const TIME_RE = /(\d{1,2})\s*[:.٫;,]\s*(\d{2})(?!\d)/g;

interface Tok { kind: 'time' | 'date'; value: string; x: number }

function tokensOf(words: OcrWord[]): Tok[] {
  const out: Tok[] = [];
  for (const w of words) {
    let t = latinDigits(w.text).replace(/[Oo]/g, '0').replace(/[lI|]/g, '1');
    const x = (w.x0 + w.x1) / 2;
    const d = DATE_RE.exec(t);
    if (d) {
      const [a, b, c] = [d[1], d[2], d[3]];
      const iso = a.length === 4 ? `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}` : `${c.length === 2 ? `20${c}` : c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
      if (/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso)) out.push({ kind: 'date', value: iso, x }); // Hijri dates (14xx) are ignored
      t = t.replace(d[0], ' ');
    }
    TIME_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TIME_RE.exec(t))) {
      const h = +m[1], mi = +m[2];
      if (h <= 23 && mi <= 59) out.push({ kind: 'time', value: `${h}:${m[2]}`, x });
    }
  }
  return out;
}

/** Groups words into visual rows by their vertical centre. */
export function groupRows(words: OcrWord[]): OcrWord[][] {
  const ws = words.filter((w) => w.text.trim()).map((w) => ({ w, yc: (w.y0 + w.y1) / 2, h: Math.max(1, w.y1 - w.y0) }));
  if (!ws.length) return [];
  const hs = ws.map((x) => x.h).sort((a, b) => a - b);
  const tol = Math.max(4, hs[Math.floor(hs.length / 2)] * 0.55);
  ws.sort((a, b) => a.yc - b.yc);
  const rows: { yc: number; items: typeof ws }[] = [];
  for (const it of ws) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(it.yc - r.yc) <= tol) { r.items.push(it); r.yc = r.items.reduce((s, x) => s + x.yc, 0) / r.items.length; }
    else rows.push({ yc: it.yc, items: [it] });
  }
  return rows.map((r) => r.items.map((x) => x.w));
}

// Plausible hour ranges in Oman (both 12-hour as printed by the Ministry, and 24-hour).
const RANGES: Record<TimeKey, [number, number][]> = {
  fajr: [[3 * 60 + 30, 6 * 60]],
  sunrise: [[5 * 60, 7 * 60 + 15]],
  dhuhr: [[11 * 60 + 30, 12 * 60 + 59], [0, 59]],
  asr: [[2 * 60 + 30, 4 * 60 + 45], [14 * 60 + 30, 16 * 60 + 45]],
  maghrib: [[5 * 60, 7 * 60 + 30], [17 * 60, 19 * 60 + 30]],
  isha: [[6 * 60 + 15, 9 * 60], [18 * 60 + 15, 21 * 60]],
};

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export function plausibleRow(times: string[]): boolean {
  if (times.length !== 6) return false;
  return TIME_KEYS.every((k, i) => RANGES[k].some(([a, b]) => { const v = toMin(times[i]); return v >= a && v <= b; }));
}

/** Builds the table from OCR words. */
export function parseOcrWords(words: OcrWord[]): OcrTable {
  const raw: { times: Tok[]; date: string | null; y: number }[] = [];
  for (const row of groupRows(words)) {
    const toks = tokensOf(row);
    const times = toks.filter((t) => t.kind === 'time').sort((a, b) => a.x - b.x);
    if (times.length < 4) continue; // header / title / footer lines
    const date = toks.find((t) => t.kind === 'date')?.value ?? null;
    raw.push({ times, date, y: Math.min(...row.map((w) => w.y0)) });
  }
  // Column centres (visual, left→right) from rows that were read completely — used to put the
  // values of incomplete rows in the right column and leave the unread cell empty for the admin.
  const full = raw.filter((r) => r.times.length === 6);
  const centres = full.length >= 3
    ? Array.from({ length: 6 }, (_, c) => { const xs = full.map((r) => r.times[c].x).sort((a, b) => a - b); return xs[Math.floor(xs.length / 2)]; })
    : null;
  const visual = (r: { times: Tok[] }): string[] => {
    if (r.times.length === 6 || !centres) return r.times.map((t) => t.value);
    const out = ['', '', '', '', '', ''];
    const gap = Math.min(...centres.slice(1).map((c, i) => c - centres[i]));
    for (const t of r.times) {
      let best = 0;
      centres.forEach((c, i) => { if (Math.abs(t.x - c) < Math.abs(t.x - centres[best])) best = i; });
      if (Math.abs(t.x - centres[best]) < gap * 0.6 && !out[best]) out[best] = t.value;
    }
    return out;
  };
  // Choose the reading direction that makes the most rows plausible.
  const pick = (r: { times: Tok[] }, dir: 'ltr' | 'rtl'): string[] => {
    const vals = centres ? visual(r) : r.times.map((t) => t.value);
    const seq = dir === 'ltr' ? vals : [...vals].reverse();
    if (seq.length <= 6) return seq;
    for (let i = 0; i + 6 <= seq.length; i++) { const w = seq.slice(i, i + 6); if (plausibleRow(w)) return w; }
    return seq.slice(seq.length - 6);
  };
  const score = (dir: 'ltr' | 'rtl') => raw.filter((r) => plausibleRow(pick(r, dir))).length;
  const direction: 'ltr' | 'rtl' = score('rtl') >= score('ltr') ? 'rtl' : 'ltr';
  const rows: OcrRow[] = raw.map((r) => {
    const times = pick(r, direction);
    while (times.length < 6) times.push('');
    return { times, date: r.date, y: r.y, plausible: plausibleRow(times) };
  });
  // Most common year/month among printed dates
  const counts = new Map<string, number>();
  for (const r of rows) if (r.date) { const k = r.date.slice(0, 7); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { rows, direction, detectedYear: best ? +best.slice(0, 4) : null, detectedMonth: best ? +best.slice(5, 7) : null };
}

/** Flags cells that jump compared with the neighbouring days (likely OCR misreads). */
export function suspiciousCells(rows: string[][], maxJump = 4): boolean[][] {
  return rows.map((r, i) => r.map((t, c) => {
    if (!/^\d{1,2}:\d{2}$/.test(t)) return true;
    const ns = [rows[i - 1]?.[c], rows[i + 1]?.[c]].filter((x): x is string => !!x && /^\d{1,2}:\d{2}$/.test(x));
    if (!ns.length) return false;
    return ns.every((n) => { let d = Math.abs(toMin(n) - toMin(t)); d = Math.min(d, 720 - (d % 720)); return d > maxJump; });
  }));
}

/** CSV text for the regular import pipeline (which validates everything again). */
export function ocrRowsToCsv(rows: { date: string; times: string[] }[]): string {
  return ['date,fajr,sunrise,dhuhr,asr,maghrib,isha', ...rows.map((r) => [r.date, ...r.times].join(','))].join('\n') + '\n';
}
