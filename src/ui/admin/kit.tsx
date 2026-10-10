/** Small form kit for the administration panel (Hani's palette, Cairo, RTL). */
import { useEffect, useState, type ReactNode } from 'react';

export function Card({ title, icon, actions, children, tone }: { title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; tone?: 'warn' | 'error' | 'ok' }) {
  const toneCls = tone === 'warn' ? 'border-saffron bg-saffron-soft/40' : tone === 'error' ? 'border-rose bg-rose-soft/40' : tone === 'ok' ? 'border-teal bg-teal-soft/40' : 'border-line bg-white';
  return (
    <section className={`rounded-2xl border ${toneCls} p-4 sm:p-5`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h3 className="m-0 flex items-center gap-2 text-[17px] font-extrabold text-ink">{icon}{title}</h3>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children, wide }: { label: ReactNode; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-[13px] font-bold text-ink2">{label}</span>
      {children}
      {hint && <span className="text-[12px] leading-5 text-muted">{hint}</span>}
    </label>
  );
}

const inputCls = 'h-11 w-full rounded-xl border border-line bg-white px-3 text-[15px] text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal-soft disabled:bg-paper';

export function TextInput({ value, onCommit, placeholder, dir, maxLength }: { value: string; onCommit: (v: string) => void; placeholder?: string; dir?: 'ltr' | 'rtl'; maxLength?: number }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input className={inputCls} value={v} dir={dir} maxLength={maxLength} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

export function NumberInput({ value, onCommit, min, max, suffix }: { value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    let n = Number(v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)));
    if (!Number.isFinite(n)) { setV(String(value)); return; }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setV(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <div className="flex items-center gap-2">
      <input className={`${inputCls} text-center`} inputMode="numeric" dir="ltr" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {suffix && <span className="whitespace-nowrap text-[13px] text-muted">{suffix}</span>}
    </div>
  );
}

export function TimeInput({ value, onCommit, allowEmpty = true }: { value: string; onCommit: (v: string) => void; allowEmpty?: boolean }) {
  return <input type="time" className={`${inputCls} text-center`} dir="ltr" value={value} onChange={(e) => { if (e.target.value || allowEmpty) onCommit(e.target.value); }} />;
}

export function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-line bg-white p-3">
      <span className="flex flex-col">
        <span className="text-[14px] font-bold text-ink">{label}</span>
        {hint && <span className="text-[12px] leading-5 text-muted">{hint}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex h-7 w-12 flex-none items-center">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="absolute inset-0 rounded-full bg-line transition peer-checked:bg-teal peer-focus-visible:ring-2 peer-focus-visible:ring-saffron" />
        <span className="absolute right-1 h-5 w-5 rounded-full bg-white shadow transition peer-checked:-translate-x-5" />
      </span>
    </label>
  );
}

export function Range({ value, onCommit, min, max, step = 1, suffix = '%' }: { value: number; onCommit: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="flex items-center gap-3">
      <input type="range" className="w-full accent-[#1F7A6D]" min={min} max={max} step={step} value={v} onChange={(e) => setV(+e.target.value)} onPointerUp={() => onCommit(v)} onKeyUp={() => onCommit(v)} onBlur={() => v !== value && onCommit(v)} />
      <span className="w-14 whitespace-nowrap text-center text-[13px] font-bold text-ink2" dir="ltr">{v}{suffix}</span>
    </div>
  );
}

type BtnKind = 'primary' | 'secondary' | 'danger' | 'ghost' | 'teal';
export function Btn({ kind = 'secondary', children, onClick, disabled, small, title, type = 'button' }: { kind?: BtnKind; children: ReactNode; onClick?: () => void; disabled?: boolean; small?: boolean; title?: string; type?: 'button' | 'submit' }) {
  const k: Record<BtnKind, string> = {
    primary: 'bg-ink text-white border-ink hover:bg-ink2',
    teal: 'bg-teal text-white border-teal hover:brightness-110',
    secondary: 'bg-white text-ink border-line hover:border-ink2',
    danger: 'bg-white text-rose border-rose/60 hover:bg-rose-soft',
    ghost: 'bg-transparent text-ink2 border-transparent hover:bg-paper',
  };
  return (
    <button type={type} title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${small ? 'h-9 px-3 text-[13px]' : 'h-11 px-4 text-[14px]'} ${k[kind]}`}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'ink' }: { children: ReactNode; tone?: 'ink' | 'teal' | 'rose' | 'saffron' | 'muted' }) {
  const t = { ink: 'bg-ink text-white', teal: 'bg-teal-soft text-teal', rose: 'bg-rose-soft text-rose', saffron: 'bg-saffron-soft text-[#8A5A0B]', muted: 'bg-paper text-ink2' }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-bold ${t}`}>{children}</span>;
}

export function Note({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const t = { info: 'border-line bg-paper text-ink2', warn: 'border-saffron/50 bg-saffron-soft text-[#7A4E08]', error: 'border-rose/50 bg-rose-soft text-[#8E2B22]', ok: 'border-teal/40 bg-teal-soft text-[#145247]' }[tone];
  return <div className={`rounded-xl border px-3 py-2 text-[13px] leading-6 ${t}`}>{children}</div>;
}

export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols];
  return <div className={`grid grid-cols-1 gap-3 ${c}`}>{children}</div>;
}

export function download(name: string, content: string | Blob, type = 'application/octet-stream') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function readBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file); });
}

/** UTF-8 (with or without BOM), UTF-16 (Excel "Unicode text"), or Windows-1256 (Excel "CSV" on Arabic Windows). */
export async function readFileText(file: File): Promise<string> {
  const buf = new Uint8Array(await readBuffer(file));
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* not UTF-8 */ }
  try { return new TextDecoder('windows-1256').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

/** Excel workbooks (.xlsx / .xls): the first sheet is converted to CSV text, dates as YYYY-MM-DD. */
export async function readSpreadsheetAsCsv(file: File): Promise<string> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(await readBuffer(file)), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(ws, { dateNF: 'yyyy-mm-dd', blankrows: false, rawNumbers: false } as Parameters<typeof XLSX.utils.sheet_to_csv>[1]);
}

export const isSpreadsheet = (name: string) => /\.(xlsx|xlsm|xls)$/i.test(name);

/** Two-step confirm (avoids window.confirm, which some TV browsers block). */
export function useConfirm() {
  const [pending, setPending] = useState<{ msg: string; run: () => void } | null>(null);
  const ask = (msg: string, run: () => void) => setPending({ msg, run });
  const ui = pending && (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-ink/50 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <p className="m-0 whitespace-pre-line text-[15px] leading-7 text-ink">{pending.msg}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setPending(null)}>إلغاء</Btn>
          <Btn kind="primary" onClick={() => { const r = pending.run; setPending(null); r(); }}>تأكيد</Btn>
        </div>
      </div>
    </div>
  );
  return { ask, ui };
}
