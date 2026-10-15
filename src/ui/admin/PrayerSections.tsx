import { useEffect, useState } from 'react';
import type { AppConfig, IqamahRule, PrayerKey, PrayerSchedule } from '../../domain/types';
import { PRAYER_KEYS } from '../../domain/types';
import { DEFAULT_IQAMAH_DELAYS, defaultConfig } from '../../domain/defaults';
import { buildDayPlan } from '../../core/iqamah';
import { addDays, formatTimestamp, muscatDateKey, toDigits, WEEKDAYS_AR, weekdayOf } from '../../core/time';
import { formatHijriAr, toHijri } from '../../core/hijri';
import { updateConfig, useApp } from '../../store/appStore';
import { now } from '../../services/clock';
import { getMosqueConfig, getWilayatTimetable, listMosques, updateMosque, useCloud, type MosqueSummary } from '../../services/cloud';
import { locationLabel } from '../../domain/oman';
import { Badge, Btn, Card, Field, Grid, Note, NumberInput, Select, TextInput, TimeInput, Toggle } from './kit';
import { IconPlus, IconRestore, IconCheck, IconTrash } from '../common/icons';

const P_AR: Record<PrayerKey, string> = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
const HOW_AR: Record<string, string> = { exception: 'استثناء بتاريخ', lock: 'مثبّت', record: 'من الجدول', weekday: 'قاعدة يوم', fixed: 'وقت ثابت', delay: 'بعد الأذان', friday: 'إعداد الجمعة', 'friday-fallback': 'مؤقت (الجمعة غير مضبوطة)' };

function RuleEditor({ rule, onChange }: { rule: IqamahRule; onChange: (r: IqamahRule) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Select value={rule.mode} onChange={(mode) => onChange({ ...rule, mode })} options={[{ value: 'delay', label: 'دقائق بعد الأذان' }, { value: 'fixed', label: 'وقت ثابت' }]} />
      {rule.mode === 'delay'
        ? <NumberInput value={rule.delay} min={0} max={180} suffix="دقيقة" onCommit={(delay) => onChange({ ...rule, delay })} />
        : <TimeInput value={rule.fixedTime} onCommit={(fixedTime) => onChange({ ...rule, fixedTime })} />}
    </div>
  );
}

function TodayPreview({ cfg, schedule }: { cfg: AppConfig; schedule: PrayerSchedule | null }) {
  const [offset, setOffset] = useState(0);
  const date = addDays(muscatDateKey(now()), offset);
  const rec = schedule?.days[date];
  if (!rec) return <Note tone="warn">لا توجد مواقيت لتاريخ {date} في جدول ولاية هذا المسجد — لا يمكن عرض المعاينة.</Note>;
  const plan = buildDayPlan(rec, cfg);
  const f = (ms: number) => { const t = formatTimestamp(ms, cfg.display.timeFormat, 'western'); return `${t.text} ${t.period}`; };
  return (
    <Card title={<>معاينة <bdi dir="ltr">{date}</bdi> — {WEEKDAYS_AR[weekdayOf(date)]}</>} actions={
      <>
        <Btn small onClick={() => setOffset(offset - 1)}>اليوم السابق</Btn>
        <Btn small onClick={() => setOffset(0)}>اليوم</Btn>
        <Btn small onClick={() => setOffset(offset + 1)}>اليوم التالي</Btn>
      </>
    }>
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]" data-testid="iq-preview">
          <thead><tr className="text-muted"><th className="py-1 text-right">الصلاة</th><th>الأذان</th><th>الإقامة</th><th>المصدر</th></tr></thead>
          <tbody>
            {PRAYER_KEYS.map((k) => (
              <tr key={k} className="border-t border-line">
                <td className="py-1.5 font-bold">{k === 'dhuhr' && plan.isFriday ? cfg.friday.label : P_AR[k]}</td>
                <td className="whitespace-nowrap text-center">{f(plan.adhan[k])}</td>
                <td className="whitespace-nowrap text-center font-bold">{f(plan.iqamah[k].at)}</td>
                <td className="text-center"><Badge tone={plan.iqamah[k].how === 'friday-fallback' ? 'saffron' : 'muted'}>{HOW_AR[plan.iqamah[k].how]}</Badge></td>
              </tr>
            ))}
            <tr className="border-t border-line text-ink2"><td className="py-1.5">الضحى</td><td className="text-center">—</td><td className="text-center">{f(plan.duha)}</td><td className="text-center"><Badge tone="muted">بعد الشروق</Badge></td></tr>
          </tbody>
        </table>
      </div>
      {plan.warnings.length > 0 && <div className="mt-3"><Note tone="warn"><ul className="m-0 list-disc pr-5">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Note></div>}
    </Card>
  );
}

const LOCAL = '__local__';

/**
 * Iqamah settings belong to ONE mosque. The admin picks the mosque at the top:
 *  - this screen's own mosque → edited live on this screen (and uploaded to that mosque only);
 *  - any other mosque → loaded from the cloud, edited here, saved to that mosque only.
 * Other mosques are never touched.
 */
export function IqamahSection() {
  const localCfg = useApp((s) => s.config);
  const localSchedule = useApp((s) => s.schedule);
  const cloud = useCloud();
  const boundCode = cloud.binding?.code ?? null;
  const [mosques, setMosques] = useState<MosqueSummary[] | null>(null);
  const [listErr, setListErr] = useState('');
  const [target, setTarget] = useState<string>(boundCode ?? LOCAL);
  const [remote, setRemote] = useState<{ code: string; cfg: AppConfig; schedule: PrayerSchedule | null; dirty: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let off = false;
    listMosques().then((m) => { if (!off) setMosques(m); }).catch((e) => { if (!off) setListErr((e as Error).message); });
    return () => { off = true; };
  }, []);

  const isLocal = target === LOCAL || target === boundCode;
  const mosqueName = (code: string) => mosques?.find((m) => m.code === code)?.name_ar ?? code;

  const pick = (code: string) => {
    if (remote?.dirty && !window.confirm('توجد تغييرات غير محفوظة على هذا المسجد. هل تريد تجاهلها؟')) return;
    void load(code);
  };
  const load = async (code: string) => {
    setMsg(null); setTarget(code);
    if (code === LOCAL || code === boundCode) { setRemote(null); return; }
    setRemote(null); setBusy('load');
    try {
      const cfg = await getMosqueConfig(code);
      const wid = cfg.mosque.location.wilayatId;
      let schedule: PrayerSchedule | null = null;
      if (localSchedule && localCfg.mosque.location.wilayatId === wid) schedule = localSchedule;
      else { try { schedule = (await getWilayatTimetable(wid))?.schedule ?? null; } catch { schedule = null; } }
      setRemote({ code, cfg, schedule, dirty: false });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally { setBusy(''); }
  };

  const saveRemote = async () => {
    if (!remote) return;
    setBusy('save'); setMsg(null);
    try {
      // re-read the mosque right before saving and replace ONLY its iqamah settings
      const fresh = await getMosqueConfig(remote.code);
      fresh.iqamah = remote.cfg.iqamah;
      await updateMosque(remote.code, fresh);
      setRemote({ ...remote, cfg: fresh, dirty: false });
      setMsg({ tone: 'ok', text: `تم حفظ الإقامة لمسجد «${mosqueName(remote.code)}» فقط — تصل إلى شاشاته خلال 5 دقائق أو عند فتحها.` });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally { setBusy(''); }
  };

  const cfg = isLocal ? localCfg : remote?.cfg ?? null;
  const schedule = isLocal ? localSchedule : remote?.schedule ?? null;
  const set = (fn: (c: AppConfig) => void) => {
    if (isLocal) { void updateConfig(fn); return; }
    setRemote((r) => { if (!r) return r; const c = JSON.parse(JSON.stringify(r.cfg)) as AppConfig; fn(c); return { ...r, cfg: c, dirty: true }; });
  };

  const options = [
    ...(boundCode ? [] : [{ value: LOCAL, label: `هذه الشاشة — ${localCfg.mosque.nameAr || 'بدون اسم'}` }]),
    ...(boundCode && !(mosques ?? []).some((m) => m.code === boundCode) ? [{ value: boundCode, label: `${cloud.binding?.name || boundCode} (هذه الشاشة)` }] : []),
    ...(mosques ?? []).map((m) => ({ value: m.code, label: `${m.name_ar} — ${locationLabel(m.governorate_id, m.wilayat_id)}${m.code === boundCode ? ' (هذه الشاشة)' : ''}` })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card title="المسجد">
        <div className="flex flex-col gap-2">
          <Field label="إعدادات الإقامة لأي مسجد؟" hint="كل مسجد له إقامته الخاصة: التأخير بعد الأذان، الوقت الثابت، التثبيت، قواعد الأيام والاستثناءات. التعديل هنا لا يغيّر أي مسجد آخر.">
            <Select value={target} onChange={pick} options={options} />
          </Field>
          {listErr && !mosques && <Note tone="warn">تعذّر جلب قائمة المساجد ({listErr}) — يمكنك تعديل إقامة هذه الشاشة فقط الآن.</Note>}
          {isLocal
            ? <Note tone="info">{boundCode ? <>تعدّل الآن مسجد هذه الشاشة «{localCfg.mosque.nameAr || boundCode}». يُحفظ كل تغيير فوراً ويُرفع لهذا المسجد وحده.</> : <>هذه الشاشة غير مرتبطة بمسجد في السحابة — التعديل يُحفظ على هذا الجهاز فقط.</>}</Note>
            : remote && <Note tone="info">تعدّل مسجد «{mosqueName(remote.code)}» (ليس مسجد هذه الشاشة). اضغط «حفظ» لإرسال التعديل إليه وحده.</Note>}
          {busy === 'load' && <Note tone="info">جارٍ تحميل إعدادات المسجد…</Note>}
          {msg && <Note tone={msg.tone === 'ok' ? 'ok' : 'error'}>{msg.text}</Note>}
        </div>
      </Card>

      {cfg && <IqamahEditor cfg={cfg} schedule={schedule} set={set} />}

      {!isLocal && remote && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white/95 p-3 shadow-lg backdrop-blur">
          <Btn kind="primary" disabled={!remote.dirty || !!busy} onClick={() => void saveRemote()}><IconCheck size={16} />{busy === 'save' ? 'جارٍ الحفظ…' : `حفظ إقامة «${mosqueName(remote.code)}»`}</Btn>
          <Btn disabled={!remote.dirty || !!busy} onClick={() => void load(remote.code)}>تجاهل التغييرات</Btn>
          {remote.dirty ? <Badge tone="saffron">تغييرات غير محفوظة</Badge> : <Badge tone="teal">محفوظ</Badge>}
        </div>
      )}
    </div>
  );
}

function IqamahEditor({ cfg, schedule, set }: { cfg: AppConfig; schedule: PrayerSchedule | null; set: (fn: (c: AppConfig) => void) => void }) {
  const iq = cfg.iqamah;
  const [wd, setWd] = useState(4);
  const [exDate, setExDate] = useState(muscatDateKey(now()));
  const [exPrayer, setExPrayer] = useState<PrayerKey | 'jumuah'>('fajr');
  const [exTime, setExTime] = useState('');

  return (
    <>
      <TodayPreview cfg={cfg} schedule={schedule} />
      <Card title="الإقامة اليومية" actions={<Btn small kind="ghost" onClick={() => set((c) => { c.iqamah.rules = defaultConfig().iqamah.rules; })}><IconRestore size={16} />استعادة الافتراضي</Btn>}>
        <p className="m-0 mb-3 text-[13px] text-muted">الإقامة = وقت الأذان + التأخير، أو وقت ثابت. القيم الافتراضية للعرض فقط: {PRAYER_KEYS.map((k) => `${P_AR[k]} ${DEFAULT_IQAMAH_DELAYS[k]}`).join('، ')} دقيقة.</p>
        <div className="flex flex-col gap-2">
          {PRAYER_KEYS.map((k) => {
            const lock = iq.locks?.[k];
            const locked = !!lock?.enabled;
            return (
              <div key={k} className={`grid grid-cols-1 items-start gap-2 rounded-xl border p-2 sm:grid-cols-[170px_1fr] ${locked ? 'border-teal/50 bg-teal-soft/30' : 'border-line'}`}>
                <div className="flex flex-col gap-1.5">
                  <b className="text-[15px] text-ink">{P_AR[k]}</b>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[13px] font-bold text-ink2">
                    <input type="checkbox" className="accent-[#1F7A6D]" checked={locked}
                      onChange={(e) => set((c) => { c.iqamah.locks = { ...(c.iqamah.locks ?? {}), [k]: { enabled: e.target.checked, time: c.iqamah.locks?.[k]?.time || '' } }; })} />
                    تثبيت موعد الإقامة
                  </label>
                  {locked && <TimeInput value={lock?.time ?? ''} onCommit={(time) => set((c) => { c.iqamah.locks = { ...(c.iqamah.locks ?? {}), [k]: { enabled: true, time } }; })} />}
                </div>
                <div className={locked ? 'pointer-events-none opacity-40' : ''} aria-disabled={locked}>
                  <RuleEditor rule={iq.rules[k]} onChange={(r) => set((c) => { c.iqamah.rules[k] = r; })} />
                  {locked && <p className="m-0 mt-1 text-[12px] text-ink2">موقوف أثناء التثبيت — الإقامة {lock?.time ? `ثابتة على ${lock.time}` : 'بانتظار اختيار الوقت'} كل يوم{k === 'dhuhr' ? ' (الجمعة لها إعداد مستقل)' : ''}.</p>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="قواعد خاصة بأيام الأسبوع">
        <p className="m-0 mb-3 text-[13px] text-muted">تُطبّق بدلاً من الإقامة اليومية في اليوم المحدد فقط (الجمعة لها قسم مستقل).</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {WEEKDAYS_AR.map((n, i) => (
            <button key={i} onClick={() => setWd(i)} className={`h-9 rounded-full border px-3 text-[13px] font-bold ${wd === i ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink2'}`}>
              {n}{iq.weekdayRules[i] && Object.keys(iq.weekdayRules[i]!).length ? ' •' : ''}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {PRAYER_KEYS.map((k) => {
            const r = iq.weekdayRules[wd]?.[k];
            return (
              <div key={k} className="grid grid-cols-1 items-center gap-2 rounded-xl border border-line p-2 sm:grid-cols-[120px_1fr_auto]">
                <b className="text-[14px] text-ink">{P_AR[k]}</b>
                {r ? <RuleEditor rule={r} onChange={(nr) => set((c) => { c.iqamah.weekdayRules[wd] = { ...c.iqamah.weekdayRules[wd], [k]: nr }; })} />
                  : <span className="text-[13px] text-muted">يستخدم الإقامة اليومية</span>}
                {r ? <Btn small kind="danger" onClick={() => set((c) => { const m = { ...c.iqamah.weekdayRules[wd] }; delete m[k]; c.iqamah.weekdayRules[wd] = m; })}><IconTrash size={14} />حذف</Btn>
                  : <Btn small onClick={() => set((c) => { c.iqamah.weekdayRules[wd] = { ...c.iqamah.weekdayRules[wd], [k]: { ...c.iqamah.rules[k] } }; })}><IconPlus size={14} />قاعدة خاصة</Btn>}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="استثناءات بتاريخ محدد">
        <p className="m-0 mb-3 text-[13px] text-muted">أعلى أولوية: تحدد وقت الإقامة لصلاة واحدة في تاريخ واحد (مثل العيد أو مناسبة).</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input type="date" dir="ltr" className="h-11 rounded-xl border border-line px-3" value={exDate} onChange={(e) => setExDate(e.target.value)} />
          <Select value={exPrayer} onChange={setExPrayer} options={[...PRAYER_KEYS.map((k) => ({ value: k as PrayerKey | 'jumuah', label: P_AR[k] })), { value: 'jumuah', label: 'الجمعة' }]} />
          <TimeInput value={exTime} onCommit={setExTime} />
          <Btn kind="primary" disabled={!exDate || !exTime} onClick={() => { set((c) => { c.iqamah.dateExceptions = [...c.iqamah.dateExceptions.filter((e) => !(e.date === exDate && e.prayer === exPrayer)), { id: `ex-${Date.now()}`, date: exDate, prayer: exPrayer, time: exTime }].sort((a, b) => a.date.localeCompare(b.date)); }); setExTime(''); }}><IconPlus size={16} />إضافة</Btn>
        </div>
        {iq.dateExceptions.length > 0 && (
          <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
            {iq.dateExceptions.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-[14px]">
                <span><bdi dir="ltr">{e.date}</bdi> — إقامة {e.prayer === 'jumuah' ? 'الجمعة' : P_AR[e.prayer]} <b dir="ltr">{e.time}</b></span>
                <button className="rounded-lg p-1.5 text-rose hover:bg-rose-soft" aria-label="حذف الاستثناء" onClick={() => set((c) => { c.iqamah.dateExceptions = c.iqamah.dateExceptions.filter((x) => x.id !== e.id); })}><IconTrash size={16} /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export function FridaySection() {
  const cfg = useApp((s) => s.config);
  const f = cfg.friday;
  const set = (fn: (c: typeof cfg) => void) => void updateConfig((c) => { fn(c); c.friday.configured = true; });
  return (
    <div className="flex flex-col gap-4">
      {!f.configured && f.enabled && (
        <Note tone="warn">لم تُحفظ إعدادات صلاة الجمعة بعد. إلى أن تُضبط، تُعرض إقامة الجمعة مؤقتاً بحسب إعداد الظهر مع هذا التنبيه. اضبط وقت الجمعة ثم اضغط «اعتماد إعدادات الجمعة».</Note>
      )}
      <Card title="صلاة الجمعة" actions={f.configured ? <Badge tone="teal">مضبوطة</Badge> : <Badge tone="saffron">غير مضبوطة</Badge>}>
        <div className="flex flex-col gap-3">
          <Toggle checked={f.enabled} onChange={(v) => set((c) => { c.friday.enabled = v; })} label="تفعيل وضع الجمعة" hint="يُفعَّل تلقائياً يوم الجمعة بتوقيت مسقط، ويعود العرض العادي يوم السبت." />
          <Grid>
            <Field label="اسم الصلاة على الشاشة"><TextInput value={f.label} onCommit={(v) => set((c) => { c.friday.label = v.trim() || 'الجمعة'; })} /></Field>
            <Field label="بداية صلاة الجمعة">
              <Select value={f.startMode} onChange={(v) => set((c) => { c.friday.startMode = v; })} options={[{ value: 'dhuhr', label: 'وقت الظهر من الجدول المعتمد' }, { value: 'fixed', label: 'وقت ثابت يحدده المسجد' }]} />
            </Field>
            {f.startMode === 'fixed' && <Field label="وقت بداية الجمعة (الأذان)"><TimeInput value={f.startTime} onCommit={(v) => set((c) => { c.friday.startTime = v; })} /></Field>}
            <Field label="إقامة الجمعة" hint="مستقلة تماماً عن إعداد إقامة الظهر.">
              <RuleEditor rule={f.iqamah} onChange={(r) => set((c) => { c.friday.iqamah = r; })} />
            </Field>
            <Field label="صف الإقامة يوم الجمعة">
              <Select value={f.rowMode} onChange={(v) => set((c) => { c.friday.rowMode = v; })} options={[{ value: 'replace', label: '«إقامة الجمعة» بدل «إقامة الظهر»' }, { value: 'relabel', label: '«إقامة الظهر / الجمعة»' }]} />
            </Field>
            <Field label="مدة الشاشة السوداء بعد إقامة الجمعة"><NumberInput value={f.quietMinutes} min={0} max={90} suffix="دقيقة" onCommit={(v) => set((c) => { c.friday.quietMinutes = v; })} /></Field>
            <Field label="مدة الأذكار بعد الجمعة"><NumberInput value={f.adhkarMinutes} min={0} max={60} suffix="دقيقة" onCommit={(v) => set((c) => { c.friday.adhkarMinutes = v; })} /></Field>
            <Field label="إعلان يظهر يوم الجمعة (اختياري)" wide><TextInput value={f.announcement} maxLength={120} placeholder="مثال: خطبة الجمعة بعنوان …" onCommit={(v) => set((c) => { c.friday.announcement = v; })} /></Field>
          </Grid>
          <Toggle checked={f.countdownEnabled} onChange={(v) => set((c) => { c.friday.countdownEnabled = v; })} label="العد التنازلي للجمعة" hint="عرض العد التنازلي (60 ثانية) قبل أذان الجمعة وإقامتها." />
          <Toggle checked={f.themeVariation} onChange={(v) => set((c) => { c.friday.themeVariation = v; })} label="مظهر مميز يوم الجمعة" hint="ألوان ذهبية أدفأ قليلاً يوم الجمعة." />
          {!f.configured && <div><Btn kind="teal" onClick={() => set(() => undefined)}>اعتماد إعدادات الجمعة</Btn></div>}
        </div>
      </Card>
    </div>
  );
}

export function HijriSection() {
  const cfg = useApp((s) => s.config);
  const h = cfg.hijri;
  const today = muscatDateKey(now());
  const set = (fn: (c: typeof cfg) => void) => void updateConfig(fn);
  const base = toHijri(today, 0);
  const adj = toHijri(today, h.adjustment);
  return (
    <Card title="التاريخ الهجري">
      <div className="flex flex-col gap-3">
        <Note>التعديل يغيّر التاريخ الهجري المعروض فقط، ولا يؤثر على التاريخ الميلادي ولا على جدول المواقيت. يعتمد التطبيق تقويم أم القرى المدمج في المتصفح دون إنترنت، ثم يُطبّق تعديلك ليوافق إعلان رؤية الهلال في سلطنة عُمان.</Note>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-3"><div className="text-[12px] text-muted">بدون تعديل ({base.method === 'umalqura' ? 'أم القرى' : 'جدولي'})</div><div className="text-[18px] font-bold text-ink2">{formatHijriAr(base, cfg.display.digits)}</div></div>
          <div className="rounded-xl border border-teal bg-teal-soft/40 p-3"><div className="text-[12px] text-muted">المعروض على الشاشة</div><div className="text-[18px] font-extrabold text-ink">{formatHijriAr(adj, cfg.display.digits)}</div></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn onClick={() => set((c) => { c.hijri.adjustment = Math.max(-c.hijri.maxAdjustment, c.hijri.adjustment - 1); })} disabled={h.adjustment <= -h.maxAdjustment}>− يوم</Btn>
          <span className="min-w-[90px] text-center text-[20px] font-extrabold text-ink" dir="ltr">{h.adjustment > 0 ? '+' : ''}{toDigits(h.adjustment, 'western')}</span>
          <Btn onClick={() => set((c) => { c.hijri.adjustment = Math.min(c.hijri.maxAdjustment, c.hijri.adjustment + 1); })} disabled={h.adjustment >= h.maxAdjustment}>+ يوم</Btn>
          <Btn kind="ghost" onClick={() => set((c) => { c.hijri.adjustment = 0; })}><IconRestore size={16} />إعادة إلى صفر</Btn>
        </div>
        <Grid>
          <Field label="أقصى مدى للتعديل" hint="الافتراضي ±3 أيام، ويمكن توسيعه."><NumberInput value={h.maxAdjustment} min={3} max={10} suffix="أيام" onCommit={(v) => set((c) => { c.hijri.maxAdjustment = v; c.hijri.adjustment = Math.max(-v, Math.min(v, c.hijri.adjustment)); })} /></Field>
        </Grid>
        <Toggle checked={h.changeAtMaghrib} onChange={(v) => set((c) => { c.hijri.changeAtMaghrib = v; })} label="تغيير التاريخ الهجري عند المغرب" hint="يبدأ اليوم الهجري شرعاً بغروب الشمس. عند التفعيل يتقدم التاريخ الهجري المعروض بعد أذان المغرب." />
      </div>
    </Card>
  );
}

export function QuietSection({ onPreview }: { onPreview: (slot: PrayerKey) => void }) {
  const cfg = useApp((s) => s.config);
  const q = cfg.quiet;
  const a = cfg.adhkar;
  const set = (fn: (c: typeof cfg) => void) => void updateConfig(fn);
  const [pv, setPv] = useState<PrayerKey>('asr');
  return (
    <div className="flex flex-col gap-4">
      <Card title="الشاشة السوداء بعد الإقامة">
        <div className="flex flex-col gap-3">
          <Toggle checked={q.enabled} onChange={(v) => set((c) => { c.quiet.enabled = v; })} label="تفعيل الشاشة السوداء" hint="عند حلول وقت الإقامة تختفي جميع العناصر وتصبح الشاشة سوداء تماماً، مع استمرار الحساب الداخلي للوقت." />
          <Grid>
            <Field label="المدة"><NumberInput value={q.minutes} min={1} max={60} suffix="دقيقة" onCommit={(v) => set((c) => { c.quiet.minutes = v; })} /></Field>
            <Field label="مدة الجمعة" hint="تُضبط من قسم «الجمعة»."><div className="flex h-11 items-center text-[15px] font-bold text-ink">{cfg.friday.quietMinutes} دقيقة</div></Field>
          </Grid>
          <div className="text-[13px] font-bold text-ink2">الصلوات التي تُفعّل الشاشة السوداء والأذكار</div>
          <div className="flex flex-wrap gap-2">
            {([...Object.keys(P_AR), 'jumuah'] as (PrayerKey | 'jumuah')[]).map((k) => (
              <label key={k} className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-[14px] font-bold ${q.prayers[k] ? 'border-teal bg-teal-soft text-teal' : 'border-line bg-white text-muted'}`}>
                <input type="checkbox" className="accent-[#1F7A6D]" checked={q.prayers[k]} onChange={(e) => set((c) => { c.quiet.prayers[k] = e.target.checked; })} />
                {k === 'jumuah' ? 'الجمعة' : P_AR[k]}
              </label>
            ))}
          </div>
          <Note>الهواتف لا تعرض الشاشة السوداء ولا الأذكار أبداً؛ تبقى المواقيت والعد التنازلي ظاهرة. نوع الجهاز يُحدَّد تلقائياً ويمكن تغييره من «العرض».</Note>
          <Toggle checked={q.emergencyExit} onChange={(v) => set((c) => { c.quiet.emergencyExit = v; })} label="خروج طارئ" hint="الضغط على زر OK / Enter بجهاز التحكم 3 مرات خلال ثانيتين (أو 3 لمسات) ينهي الشاشة السوداء والأذكار الحالية فقط." />
        </div>
      </Card>

      <Card title="الأذكار بعد الشاشة السوداء">
        <div className="flex flex-col gap-3">
          <Toggle checked={a.enabled} onChange={(v) => set((c) => { c.adhkar.enabled = v; })} label="عرض الأذكار" />
          <Grid>
            <Field label="مدة الأذكار"><NumberInput value={a.minutes} min={1} max={60} suffix="دقيقة" onCommit={(v) => set((c) => { c.adhkar.minutes = v; })} /></Field>
            <Field label="مدة كل ذكر (افتراضي)"><NumberInput value={a.defaultSeconds} min={10} max={600} suffix="ثانية" onCommit={(v) => set((c) => { c.adhkar.defaultSeconds = v; })} /></Field>
          </Grid>
          <Toggle checked={a.audio} onChange={(v) => set((c) => { c.adhkar.audio = v; })} label="الصوت" hint="لا يتضمن التطبيق أي ملفات صوتية؛ الإعداد محفوظ لاستخدام مستقبلي ولا يُشغَّل أي صوت." />
        </div>
      </Card>

      <Card title="معاينة التسلسل">
        <p className="m-0 mb-3 text-[13px] text-muted">تشغّل محاكاة تبدأ قبل الإقامة بـ 20 ثانية وتعرض: العد التنازلي ← الشاشة السوداء ← الأذكار ← العودة، بسرعة 10×. تتوقف المحاكاة تلقائياً بعد 30 دقيقة أو عند تحديث الصفحة.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={pv} onChange={setPv} options={PRAYER_KEYS.map((k) => ({ value: k, label: P_AR[k] }))} />
          <Btn kind="primary" onClick={() => onPreview(pv)}>تشغيل المعاينة</Btn>
        </div>
      </Card>
    </div>
  );
}
