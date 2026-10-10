import { useEffect, useState } from 'react';
import type { AdhkarItem, LogEntry, Theme } from '../../domain/types';
import { defaultAdhkar } from '../../domain/defaults';
import { createBackup, validateBackup, type BackupValidation } from '../../core/backup';
import { computeState } from '../../core/engine';
import { classifyDevice, isPhone, readDeviceEnv } from '../../core/device';
import { formatTimestamp, muscatDateKey } from '../../core/time';
import { coverage } from '../../core/timetable';
import { restoreBackup, setAdhkar, updateConfig, useApp } from '../../store/appStore';
import { clearLogs, readLogs, requestPersistentStorage } from '../../store/db';
import { measureServerOffset, now, realNow, simulationInfo, stopSimulation } from '../../services/clock';
import { applyUpdateNow, usePwaStatus } from '../../services/pwa';
import { useOnline } from '../../services/platform';
import { Badge, Btn, Card, download, Field, Grid, Note, NumberInput, Range, readFileText, Select, Toggle, useConfirm } from './kit';
import { IconDown, IconDownload, IconEdit, IconFileJson, IconPlus, IconRestore, IconTrash, IconUp } from '../common/icons';
import { hashPin } from './pin';
import { SOURCE_AR } from './TimetableSection';
import { THEME_LABELS } from '../display/Background';

declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;

// ---------------------------------------------------------------- A. Mosque
// ---------------------------------------------------------------- F. Adhkar
export function AdhkarSection({ onPreview }: { onPreview: () => void }) {
  const list = useApp((s) => s.adhkar);
  const cfg = useApp((s) => s.config);
  const [edit, setEdit] = useState<AdhkarItem | null>(null);
  const [err, setErr] = useState('');
  const { ask, ui } = useConfirm();
  const save = (l: AdhkarItem[]) => void setAdhkar(l);
  const move = (i: number, d: number) => { const l = [...list]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; save(l); };
  const enabledCount = list.filter((a) => a.enabled && a.text.trim()).length;
  const cycleSec = list.filter((a) => a.enabled && a.text.trim()).reduce((s, a) => s + (a.seconds ?? cfg.adhkar.defaultSeconds), 0);

  const commitEdit = () => {
    if (!edit) return;
    if (!edit.text.trim()) { setErr('نص الذكر لا يمكن أن يكون فارغاً'); return; }
    const exists = list.some((a) => a.id === edit.id);
    save(exists ? list.map((a) => (a.id === edit.id ? edit : a)) : [...list, edit]);
    setEdit(null); setErr('');
  };

  const importJson = async (f?: File) => {
    if (!f) return;
    try {
      const data = JSON.parse(await readFileText(f)) as unknown;
      const arr = Array.isArray(data) ? data : (data as { adhkar?: unknown[] }).adhkar;
      if (!Array.isArray(arr)) throw new Error('الملف يجب أن يحتوي مصفوفة أذكار');
      const items: AdhkarItem[] = arr.map((x, i) => {
        const o = x as Partial<AdhkarItem>;
        if (typeof o.text !== 'string' || !o.text.trim()) throw new Error(`الذكر رقم ${i + 1} بلا نص`);
        return { id: `dhikr-i${Date.now()}-${i}`, text: o.text.trim(), category: String(o.category ?? ''), source: String(o.source ?? ''), seconds: typeof o.seconds === 'number' ? o.seconds : null, enabled: o.enabled !== false, order: i };
      });
      ask(`استيراد ${items.length} ذكراً سيستبدل القائمة الحالية (${list.length}). متابعة؟`, () => save(items));
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="flex flex-col gap-4">
      {ui}
      <Card title="قائمة الأذكار" actions={
        <>
          <Badge tone="teal">{enabledCount} مفعّل</Badge>
          <Badge tone="muted">دورة كاملة {Math.round(cycleSec / 60 * 10) / 10} دقيقة</Badge>
        </>
      }>
        <Note>يُعرض ذكر واحد في كل مرة بالترتيب أدناه، وتتكرر الدورة حتى تنتهي مدة الأذكار. تأكد من صحة النصوص ومراجعها قبل اعتمادها.</Note>
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {list.map((a, i) => (
            <li key={a.id} className={`rounded-xl border p-3 ${a.enabled ? 'border-line bg-white' : 'border-dashed border-line bg-paper opacity-70'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    {a.category && <Badge tone="muted">{a.category}</Badge>}
                    <Badge tone="muted">{a.seconds ?? cfg.adhkar.defaultSeconds} ث</Badge>
                    {!a.enabled && <Badge tone="saffron">معطّل</Badge>}
                  </div>
                  <p className="m-0 line-clamp-3 whitespace-pre-line font-amiri text-[17px] leading-8 text-ink">{a.text}</p>
                  {a.source && <p className="m-0 text-[12px] text-muted">{a.source}</p>}
                </div>
                <div className="flex flex-none flex-col gap-1">
                  <button className="rounded-lg p-1.5 hover:bg-paper disabled:opacity-30" disabled={i === 0} aria-label="أعلى" onClick={() => move(i, -1)}><IconUp size={16} /></button>
                  <button className="rounded-lg p-1.5 hover:bg-paper disabled:opacity-30" disabled={i === list.length - 1} aria-label="أسفل" onClick={() => move(i, 1)}><IconDown size={16} /></button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Btn small onClick={() => setEdit({ ...a })}><IconEdit size={14} />تعديل</Btn>
                <Btn small onClick={() => save(list.map((x) => (x.id === a.id ? { ...x, enabled: !x.enabled } : x)))}>{a.enabled ? 'تعطيل' : 'تفعيل'}</Btn>
                <Btn small kind="danger" onClick={() => ask('حذف هذا الذكر نهائياً؟', () => save(list.filter((x) => x.id !== a.id)))}><IconTrash size={14} />حذف</Btn>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn kind="primary" onClick={() => setEdit({ id: `dhikr-${Date.now()}`, text: '', category: 'أذكار بعد الصلاة', source: '', seconds: null, enabled: true, order: list.length })}><IconPlus size={16} />إضافة ذكر</Btn>
          <Btn onClick={onPreview} disabled={!enabledCount}>معاينة الدورة</Btn>
          <Btn onClick={() => download('adhkar.json', JSON.stringify(list, null, 2), 'application/json')}><IconFileJson />تصدير JSON</Btn>
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-4 text-[14px] font-bold text-ink hover:border-ink2">
            <IconFileJson />استيراد JSON
            <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { void importJson(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <Btn kind="ghost" onClick={() => ask('استعادة الأذكار الافتراضية؟ ستُستبدل القائمة الحالية.', () => save(defaultAdhkar()))}><IconRestore size={16} />الافتراضي</Btn>
        </div>
        {err && !edit && <div className="mt-2"><Note tone="error">{err}</Note></div>}
      </Card>

      {edit && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/50 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="m-0 mb-3 text-[17px] font-extrabold text-ink">{list.some((a) => a.id === edit.id) ? 'تعديل ذكر' : 'ذكر جديد'}</h3>
            <div className="flex flex-col gap-3">
              <Field label="النص"><textarea className="min-h-[140px] w-full rounded-xl border border-line p-3 font-amiri text-[18px] leading-8 outline-none focus:border-teal" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} /></Field>
              <Grid>
                <Field label="التصنيف"><input className="h-11 rounded-xl border border-line px-3" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></Field>
                <Field label="المصدر / التخريج" hint="مثال: رواه مسلم (591)"><input className="h-11 rounded-xl border border-line px-3" value={edit.source} onChange={(e) => setEdit({ ...edit, source: e.target.value })} /></Field>
                <Field label="مدة العرض" hint="اتركه فارغاً لاستخدام المدة الافتراضية">
                  <input className="h-11 rounded-xl border border-line px-3 text-center" dir="ltr" inputMode="numeric" value={edit.seconds ?? ''} placeholder={String(cfg.adhkar.defaultSeconds)}
                    onChange={(e) => { const n = parseInt(e.target.value, 10); setEdit({ ...edit, seconds: Number.isFinite(n) ? Math.max(5, Math.min(600, n)) : null }); }} />
                </Field>
              </Grid>
            </div>
            {err && <div className="mt-3"><Note tone="error">{err}</Note></div>}
            <div className="mt-4 flex justify-end gap-2"><Btn onClick={() => { setEdit(null); setErr(''); }}>إلغاء</Btn><Btn kind="primary" onClick={commitEdit}>حفظ</Btn></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- G. Display
export function DisplaySection() {
  const cfg = useApp((s) => s.config);
  const d = cfg.display;
  const set = (fn: (c: typeof cfg) => void) => void updateConfig(fn);
  const detected = classifyDevice(readDeviceEnv());
  const [pin, setPin] = useState('');
  const DEV_AR = { tv: 'تلفاز', desktop: 'حاسوب', tablet: 'جهاز لوحي', mobile: 'هاتف' };
  return (
    <div className="flex flex-col gap-4">
      <Card title="المظهر">
        <Grid>
          <Field label="السمة"><Select value={d.theme} onChange={(v) => set((c) => { c.display.theme = v; })} options={(Object.keys(THEME_LABELS) as Theme[]).map((value) => ({ value, label: THEME_LABELS[value] }))} /></Field>
          <Field label="الخلفية"><Select value={d.background} onChange={(v) => set((c) => { c.display.background = v; })} options={[{ value: 'animated', label: 'حركة هادئة' }, { value: 'static', label: 'ثابتة' }]} /></Field>
          <Field label="شدة الحركة"><Range value={d.animationIntensity} min={0} max={100} onCommit={(v) => set((c) => { c.display.animationIntensity = v; })} /></Field>
          <Field label="الأرقام"><Select value={d.digits} onChange={(v) => set((c) => { c.display.digits = v; })} options={[{ value: 'western', label: '0123456789' }, { value: 'arabic', label: '٠١٢٣٤٥٦٧٨٩' }]} /></Field>
          <Field label="صيغة الوقت"><Select value={d.timeFormat} onChange={(v) => set((c) => { c.display.timeFormat = v; })} options={[{ value: '12', label: '12 ساعة (صباحاً / مساءً)' }, { value: '24', label: '24 ساعة' }]} /></Field>
          <Field label="موضع اسم المسجد"><Select value={d.namePosition} onChange={(v) => set((c) => { c.display.namePosition = v; })} options={[{ value: 'center', label: 'في الوسط' }, { value: 'right', label: 'إلى اليمين مع الشعار' }]} /></Field>
          <Field label="حجم الساعة"><Range value={d.clockScale} min={70} max={130} onCommit={(v) => set((c) => { c.display.clockScale = v; })} /></Field>
          <Field label="حجم اسم المسجد"><Range value={d.nameScale} min={60} max={140} onCommit={(v) => set((c) => { c.display.nameScale = v; })} /></Field>
          <Field label="حجم لوحات المواقيت"><Range value={d.panelScale} min={80} max={115} onCommit={(v) => set((c) => { c.display.panelScale = v; })} /></Field>
          <Field label="صلاة الضحى بعد الشروق"><NumberInput value={d.duhaMinutesAfterSunrise} min={10} max={60} suffix="دقيقة" onCommit={(v) => set((c) => { c.display.duhaMinutesAfterSunrise = v; })} /></Field>
        </Grid>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Toggle checked={d.highContrast} onChange={(v) => set((c) => { c.display.highContrast = v; })} label="تباين عالٍ" hint="خلفية سوداء ونص أبيض وذهبي ساطع لقاعات واسعة أو شاشات ضعيفة." />
          <Toggle checked={d.showSeconds} onChange={(v) => set((c) => { c.display.showSeconds = v; })} label="عرض الثواني" />
          <Toggle checked={d.countdownFocus} onChange={(v) => set((c) => { c.display.countdownFocus = v; })} label="تمييز العد التنازلي" hint="خلال آخر 60 ثانية قبل الأذان أو الإقامة: تخفت بقية الشاشة وتُغبَّش قليلاً، ويكبر العد التنازلي بلون مميز." />
          <Toggle checked={d.panelsSwapped} onChange={(v) => set((c) => { c.display.panelsSwapped = v; })} label="تبديل موضع اللوحتين" hint="الافتراضي: الأذان يميناً، الإقامة يساراً." />
          <Toggle checked={d.showEnglishName} onChange={(v) => set((c) => { c.display.showEnglishName = v; })} label="عرض الاسم الإنجليزي" />
          <Toggle checked={d.showSourceBadge} onChange={(v) => set((c) => { c.display.showSourceBadge = v; })} label="شارة «مواقيت محسوبة»" hint="بيانات DEMO تُوسم دائماً ولا يمكن إخفاء وسمها." />
        </div>
      </Card>

      <Card title="التشغيل على الشاشة">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Toggle checked={d.presentation} onChange={(v) => set((c) => { c.display.presentation = v; })} label="وضع العرض (Kiosk)" hint="يخفي جميع الأزرار. Esc أو زر الرجوع يُظهرها، و P يبدّل الوضع. بجهاز التحكم: OK أو الأسهم تُظهر الأزرار مؤقتاً." />
          <Toggle checked={d.autoHideControls} onChange={(v) => set((c) => { c.display.autoHideControls = v; })} label="إخفاء الأزرار تلقائياً" hint="بعد 8 ثوانٍ دون حركة." />
          <Toggle checked={d.wakeLock} onChange={(v) => set((c) => { c.display.wakeLock = v; })} label="منع إطفاء الشاشة" hint="يعمل في المتصفحات التي تدعم Screen Wake Lock؛ قد يتطلب الأمر ضبط إعدادات التلفاز نفسه." />
        </div>
        <div className="mt-3"><Grid>
          <Field label="نوع الجهاز" hint={`الكشف التلقائي: ${DEV_AR[detected]}. الهاتف لا يعرض الشاشة السوداء.`}>
            <Select value={d.deviceMode} onChange={(v) => set((c) => { c.display.deviceMode = v; })} options={[{ value: 'auto', label: `تلقائي (${DEV_AR[detected]})` }, { value: 'tv', label: 'تلفاز / شاشة مسجد' }, { value: 'desktop', label: 'حاسوب' }, { value: 'mobile', label: 'هاتف' }]} />
          </Field>
        </Grid></div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="inline-flex h-9 items-center rounded-xl border border-line bg-white px-3 text-[13px] font-bold text-ink no-underline" href="#/preview?w=1920&h=1080" target="_blank" rel="noreferrer">معاينة 16:9 (1920×1080)</a>
          <a className="inline-flex h-9 items-center rounded-xl border border-line bg-white px-3 text-[13px] font-bold text-ink no-underline" href="#/preview?w=3840&h=2160" target="_blank" rel="noreferrer">معاينة 4K</a>
        </div>
      </Card>

      <Card title="رمز الدخول للإعدادات">
        <p className="m-0 mb-3 text-[13px] text-muted">اختياري: يمنع المصلين من تغيير الإعدادات من شاشة المسجد. {d.adminPinHash ? 'الرمز مفعّل حالياً.' : 'لا يوجد رمز حالياً.'}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input className="h-11 w-40 rounded-xl border border-line px-3 text-center" dir="ltr" inputMode="numeric" type="password" placeholder="4–8 أرقام" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
          <Btn kind="primary" disabled={pin.length < 4} onClick={() => void hashPin(pin).then((h) => { set((c) => { c.display.adminPinHash = h; }); setPin(''); })}>حفظ الرمز</Btn>
          {d.adminPinHash && <Btn kind="danger" onClick={() => set((c) => { c.display.adminPinHash = ''; })}>إلغاء الرمز</Btn>}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- H. Backup
export function BackupSection() {
  const cfg = useApp((s) => s.config);
  const schedule = useApp((s) => s.schedule);
  const adhkar = useApp((s) => s.adhkar);
  const [val, setVal] = useState<BackupValidation | null>(null);
  const [done, setDone] = useState('');
  const { ask, ui } = useConfirm();
  const stamp = muscatDateKey(now());
  const onFile = async (f?: File) => { if (!f) return; setDone(''); setVal(validateBackup(await readFileText(f))); };
  return (
    <div className="flex flex-col gap-4">
      {ui}
      <Card title="نسخة احتياطية">
        <p className="m-0 mb-3 text-[14px] text-ink2">ملف JSON واحد يحتوي: إعدادات المسجد، جدول المواقيت، الإقامة والجمعة، التعديل الهجري، الأذكار، وإعدادات العرض. احفظه على ذاكرة USB أو هاتفك لنقل الإعداد إلى شاشة أخرى.</p>
        <Btn kind="primary" onClick={() => download(`mosque-display-backup-${stamp}.json`, JSON.stringify(createBackup(cfg, schedule, adhkar, new Date().toISOString()), null, 2), 'application/json')}><IconDownload size={16} />تنزيل نسخة احتياطية</Btn>
      </Card>
      <Card title="استعادة">
        <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-4 text-[14px] font-bold text-ink hover:border-ink2">
          <IconFileJson />اختيار ملف النسخة
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {val && !val.ok && <div className="mt-3"><Note tone="error"><b>الملف غير صالح — لم يتغير أي شيء.</b><ul className="m-0 mt-1 list-disc pr-5">{val.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Note></div>}
        {val?.ok && val.summary && (
          <div className="mt-3 flex flex-col gap-2">
            <Note tone="ok">ملف صالح: «{val.summary.mosque}» — {val.summary.days} يوماً من المواقيت، {val.summary.adhkar} ذكراً{val.summary.createdAt ? ` — أُنشئ ${val.summary.createdAt.slice(0, 10)}` : ''}.</Note>
            <div><Btn kind="teal" onClick={() => ask('ستُستبدل جميع الإعدادات والأذكار' + (val.summary!.days ? ' وجدول المواقيت' : '') + ' بمحتوى النسخة.\nالجدول الحالي يُحفظ كـ«جدول سابق». متابعة؟', () => void restoreBackup(val.backup!).then(() => { setVal(null); setDone('تمت الاستعادة بنجاح.'); }).catch((e) => setDone(`فشلت الاستعادة ولم يتغير شيء: ${(e as Error).message}`)))}><IconRestore size={16} />استعادة النسخة</Btn></div>
          </div>
        )}
        {done && <div className="mt-3"><Note tone={done.startsWith('فشلت') ? 'error' : 'ok'}>{done}</Note></div>}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Diagnostics
export function DiagnosticsSection({ onSimulate }: { onSimulate: (at: number, speed: number) => void }) {
  const cfg = useApp((s) => s.config);
  const schedule = useApp((s) => s.schedule);
  const adhkar = useApp((s) => s.adhkar);
  const online = useOnline();
  const pwa = usePwaStatus();
  const [, force] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [server, setServer] = useState<number | null | 'checking'>(null);
  const [persist, setPersist] = useState<boolean | null>(null);
  const [simAt, setSimAt] = useState('');
  const [speed, setSpeed] = useState(10);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { void readLogs(150).then(setLogs); }, []);
  useEffect(() => { void navigator.storage?.persisted?.().then(setPersist).catch(() => undefined); }, []);

  const n = now();
  const device = classifyDevice(readDeviceEnv());
  const st = computeState({ now: n, config: cfg, schedule, adhkar, isMobile: isPhone(cfg.display.deviceMode, device) });
  const sim = simulationInfo();
  const f = (ms?: number | null) => { if (!ms) return '—'; const t = formatTimestamp(ms, '24', 'western'); return `${t.text}:${t.seconds}`; };
  const cov = coverage(schedule, st.today);
  const PH = { normal: 'العرض العادي', quiet: 'الشاشة السوداء', adhkar: 'الأذكار' };

  const check = async () => {
    setServer('checking');
    const off = await measureServerOffset();
    setServer(off);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title="الحالة الآن" actions={sim.active ? <Badge tone="rose">محاكاة ×{sim.speed}</Badge> : <Badge tone="teal">الوقت الحقيقي</Badge>}>
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
          {[
            ['الوقت (مسقط)', <bdi dir="ltr" key="t">{f(n)}</bdi>],
            ['التاريخ المعتمد', <bdi dir="ltr" key="d">{st.today}</bdi>],
            ['الأذان القادم', st.nextAdhan ? <span key="a">{st.nextAdhan.label} — <bdi dir="ltr">{f(st.nextAdhan.at)}</bdi></span> : '—'],
            ['الإقامة القادمة', st.nextIqamah ? <span key="i">{st.nextIqamah.label} — <bdi dir="ltr">{f(st.nextIqamah.at)}</bdi></span> : '—'],
            ['حالة العرض', `${PH[st.phase]}${st.suppressedByMobile ? ' (مستثنى: هاتف)' : ''}${st.countdown ? ` · عد تنازلي ${st.countdown.seconds}ث` : ''}`],
            ['الاتصال', online ? 'متصل' : 'غير متصل — يعمل محلياً'],
            ['الجدول النشط', schedule ? `${schedule.meta.locationLabel} · v${schedule.meta.version} · ${SOURCE_AR[schedule.meta.source]}` : 'لا يوجد'],
            ['تغطية اليوم', cov.coversToday ? `نعم (+${cov.daysRemaining} يوماً)` : 'لا'],
            ['نوع الجهاز', `${device}${cfg.display.deviceMode !== 'auto' ? ` (يدوي: ${cfg.display.deviceMode})` : ''}`],
            ['تصحيح الساعة', `${Math.round(cfg.display.clockOffsetMs / 1000)} ثانية`],
            ['الإصدار', <bdi dir="ltr" key="v">{__APP_VERSION__} · {__BUILD_ID__.slice(0, 16)}</bdi>],
            ['العمل دون إنترنت', pwa.offlineReady ? 'جاهز (الملفات محفوظة)' : pwa.supported ? 'جارٍ التجهيز…' : 'غير مدعوم في هذا المتصفح'],
            ['التخزين الدائم', persist === null ? 'غير معروف' : persist ? 'ممنوح' : 'غير ممنوح'],
            ['نافذة الإقامة الحالية', st.currentIqamahSlot ?? '—'],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex gap-2"><dt className="min-w-[130px] font-bold text-muted">{k}</dt><dd className="m-0 text-ink">{v}</dd></div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {pwa.updateWaiting && <Btn kind="teal" onClick={() => void applyUpdateNow()}>تطبيق التحديث الآن</Btn>}
          {persist === false && <Btn onClick={() => void requestPersistentStorage().then(setPersist)}>طلب تخزين دائم</Btn>}
        </div>
      </Card>

      <Card title="ساعة الجهاز">
        <p className="m-0 mb-3 text-[13px] text-muted">تعتمد الشاشة على ساعة الجهاز بتوقيت مسقط (UTC+4). إن كانت ساعة التلفاز خاطئة، اضبطها من إعدادات الجهاز، أو أدخل تصحيحاً هنا.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Btn onClick={() => void check()} disabled={!online || server === 'checking'}>فحص الساعة مع الخادم</Btn>
          {typeof server === 'number' && (
            <>
              <Badge tone={Math.abs(server) > 60_000 ? 'rose' : Math.abs(server) > 5_000 ? 'saffron' : 'teal'}>فرق الجهاز: {Math.round(server / 1000)} ثانية</Badge>
              {Math.abs(server) > 2000 && <Btn small kind="primary" onClick={() => void updateConfig((c) => { c.display.clockOffsetMs = c.display.clockOffsetMs + Math.round(server / 1000) * 1000; })}>تطبيق التصحيح</Btn>}
            </>
          )}
          {server === null && !online && <span className="text-[13px] text-muted">الفحص يتطلب اتصالاً بالإنترنت.</span>}
        </div>
        <div className="mt-3"><Grid>
          <Field label="تصحيح يدوي" hint="موجب = تقديم الساعة."><NumberInput value={Math.round(cfg.display.clockOffsetMs / 1000)} min={-86400} max={86400} suffix="ثانية" onCommit={(v) => void updateConfig((c) => { c.display.clockOffsetMs = v * 1000; })} /></Field>
          <Field label="الوقت دون تصحيح"><div className="flex h-11 items-center font-bold" dir="ltr">{f(realNow() - cfg.display.clockOffsetMs)}</div></Field>
        </Grid></div>
      </Card>

      <Card title="المحاكاة (للاختبار فقط)">
        <Note tone="warn">المحاكاة تغيّر الوقت المعروض مؤقتاً لاختبار الانتقالات دون انتظار. تظهر شريطاً أحمر على الشاشة، ولا تُحفظ، وتتوقف عند تحديث الصفحة أو بعد 30 دقيقة.</Note>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_auto_auto]">
          <input type="datetime-local" dir="ltr" step={1} className="h-11 rounded-xl border border-line px-3" value={simAt} onChange={(e) => setSimAt(e.target.value)} />
          <Select value={String(speed)} onChange={(v) => setSpeed(+v)} options={[1, 5, 10, 30, 60].map((x) => ({ value: String(x), label: `السرعة ×${x}` }))} />
          <Btn kind="primary" disabled={!simAt} onClick={() => {
            const [d, t] = simAt.split('T'); const [hh, mm, ss = '0'] = t.split(':');
            const [Y, M, D] = d.split('-').map(Number);
            onSimulate(Date.UTC(Y, M - 1, D, +hh, +mm, +ss) - 4 * 3600_000, speed);
          }}>بدء المحاكاة</Btn>
          <Btn kind="danger" disabled={!sim.active} onClick={stopSimulation}>إيقاف</Btn>
        </div>
        <p className="m-0 mt-2 text-[12px] text-muted">الوقت المُدخل يُفسَّر بتوقيت مسقط.</p>
      </Card>

      <Card title="سجل الأحداث المحلي" actions={<><Btn small onClick={() => void readLogs(150).then(setLogs)}>تحديث</Btn><Btn small kind="danger" onClick={() => void clearLogs().then(() => setLogs([]))}>مسح</Btn></>}>
        <div className="max-h-[320px] overflow-y-auto rounded-xl border border-line">
          {logs.length === 0 ? <p className="m-0 p-3 text-[13px] text-muted">لا توجد أحداث.</p> : (
            <ul className="m-0 list-none p-0 text-[13px]">
              {logs.map((l) => (
                <li key={l.id} className="flex gap-2 border-b border-line px-3 py-1.5 last:border-0">
                  <bdi dir="ltr" className="whitespace-nowrap text-muted">{new Date(l.at).toLocaleString('en-GB', { timeZone: 'Asia/Muscat', hour12: false })}</bdi>
                  <span className={l.level === 'error' ? 'text-rose' : l.level === 'warn' ? 'text-[#8A5A0B]' : 'text-ink'}>{l.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

