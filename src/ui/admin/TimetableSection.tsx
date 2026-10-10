import { useMemo, useState } from 'react';
import type { DailyPrayerTimes, DataSourceKind, PrayerSchedule, TimeKey } from '../../domain/types';
import { TIME_KEYS } from '../../domain/types';
import { GOVERNORATES, findGovernorate, findWilayat, locationLabel } from '../../domain/oman';
import { applyImport, coverage, exportCsv, exportJson, parseTimetableFile, type ImportResult } from '../../core/timetable';
import { calculateYear, DEFAULT_CALC, demoSchedule } from '../../core/calc';
import { daysInMonth, GREGORIAN_MONTHS_AR, datesOfYear, muscatDateKey, WEEKDAYS_AR, weekdayOf } from '../../core/time';
import { commitSchedule, restorePreviousSchedule, saveDayEdit, updateConfig, useApp } from '../../store/appStore';
import { now } from '../../services/clock';
import { Badge, Btn, Card, download, Field, Grid, Note, NumberInput, readFileText, Select, TextInput, TimeInput, useConfirm } from './kit';
import { IconDownload, IconEdit, IconFileCsv, IconFileJson, IconPrint, IconRestore, IconUpload } from '../common/icons';

const T_AR: Record<TimeKey, string> = { fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
export const SOURCE_AR: Record<DataSourceKind, string> = { official: 'رسمي (وزارة الأوقاف)', admin: 'إدخال المشرف', calculated: 'محسوب — غير رسمي', demo: 'DEMO — تجريبي' };
export const sourceTone = (s: DataSourceKind) => (s === 'official' ? 'teal' : s === 'admin' ? 'ink' : s === 'calculated' ? 'saffron' : 'rose') as 'teal' | 'ink' | 'saffron' | 'rose';
const fmtDateTime = (iso: string) => { try { return new Date(iso).toLocaleString('ar-OM-u-nu-latn', { timeZone: 'Asia/Muscat', dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };

export function TimetableSection() {
  const cfg = useApp((s) => s.config);
  const schedule = useApp((s) => s.schedule);
  const previous = useApp((s) => s.previousSchedule);
  const today = muscatDateKey(now());
  const cov = coverage(schedule, today);
  const loc = cfg.mosque.location;
  const wil = findWilayat(loc.governorateId, loc.wilayatId);
  const label = locationLabel(loc.governorateId, loc.wilayatId);
  const { ask, ui } = useConfirm();
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const isValidCurrent = !!schedule && cov.coversToday;

  const commit = (next: PrayerSchedule, what: string) => {
    const go = () => commitSchedule(next).then(() => setMsg({ tone: 'ok', text: `${what} — تم الحفظ محلياً (${next.meta.dayCount} يوماً).` })).catch((e) => setMsg({ tone: 'error', text: `تعذّر الحفظ: ${(e as Error).message}` }));
    if (schedule) ask(`سيُستبدل الجدول الحالي (${schedule.meta.locationLabel} — ${SOURCE_AR[schedule.meta.source]}، ${schedule.meta.dayCount} يوماً).\nيمكنك استعادته لاحقاً من زر «استعادة الجدول السابق».\nهل تريد المتابعة؟`, () => void go());
    else void go();
  };

  return (
    <div className="flex flex-col gap-4">
      {ui}
      {msg && <Note tone={msg.tone === 'ok' ? 'ok' : msg.tone}>{msg.text}</Note>}

      <Card title="الموقع" actions={<Badge tone="muted">11 محافظة · 63 ولاية</Badge>}>
        <Grid>
          <Field label="المحافظة">
            <Select value={loc.governorateId} options={GOVERNORATES.map((g) => ({ value: g.id, label: g.ar }))}
              onChange={(v) => void updateConfig((c) => { c.mosque.location.governorateId = v; c.mosque.location.wilayatId = findGovernorate(v)!.wilayats[0].id; })} />
          </Field>
          <Field label="الولاية">
            <Select value={loc.wilayatId} options={(findGovernorate(loc.governorateId)?.wilayats ?? []).map((w) => ({ value: w.id, label: w.ar }))}
              onChange={(v) => void updateConfig((c) => { c.mosque.location.wilayatId = v; })} />
          </Field>
        </Grid>
        {schedule && schedule.meta.wilayatId !== loc.wilayatId && schedule.meta.wilayatId !== 'demo' && (
          <div className="mt-3"><Note tone="warn">الجدول النشط خاص بـ «{schedule.meta.locationLabel}» وليس بالولاية المختارة. جدول ولاية لا يصلح لولاية أخرى — استورد جدول «{label}».</Note></div>
        )}
      </Card>

      <ActiveCard schedule={schedule} today={today} onRestore={previous ? () => ask(`استعادة الجدول السابق (${previous.meta.locationLabel} — ${previous.meta.dayCount} يوماً)؟\nسيصبح الجدول الحالي هو «السابق».`, () => void restorePreviousSchedule().then((ok) => setMsg(ok ? { tone: 'ok', text: 'تمت استعادة الجدول السابق.' } : { tone: 'error', text: 'لا يوجد جدول سابق.' }))) : undefined} />

      <ImportCard label={label} wilayatId={loc.wilayatId} schedule={schedule} onCommit={commit} isValidCurrent={isValidCurrent} />

      <CalcCard label={label} wilayatId={loc.wilayatId} lat={loc.customLat ?? wil?.lat ?? 23.6} lng={loc.customLng ?? wil?.lng ?? 58.4} onCommit={commit} />

      {schedule && <Viewer schedule={schedule} today={today} />}
    </div>
  );
}

function ActiveCard({ schedule, today, onRestore }: { schedule: PrayerSchedule | null; today: string; onRestore?: () => void }) {
  const cov = coverage(schedule, today);
  if (!schedule) {
    return (
      <Card title="الجدول النشط" tone="warn">
        <p className="m-0 text-[14px] text-ink2">لا يوجد جدول مواقيت بعد. استورد جدول الوزارة لولايتك (CSV أو JSON) من البطاقة التالية.</p>
        {onRestore && <div className="mt-3"><Btn onClick={onRestore}><IconRestore size={16} />استعادة الجدول السابق</Btn></div>}
      </Card>
    );
  }
  const m = schedule.meta;
  const tone = !cov.coversToday ? 'error' : cov.daysRemaining < 30 ? 'warn' : undefined;
  return (
    <Card title="الجدول النشط" tone={tone} actions={<Badge tone={sourceTone(m.source)}>{SOURCE_AR[m.source]}</Badge>}>
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
        <Row k="الموقع" v={m.locationLabel} />
        <Row k="المصدر" v={m.sourceNote} />
        <Row k="السنة" v={m.years.join('، ')} />
        <Row k="الفترة" v={<bdi dir="ltr">{m.firstDate} → {m.lastDate}</bdi>} />
        <Row k="عدد الأيام" v={String(m.dayCount)} />
        <Row k="الإصدار" v={<bdi dir="ltr">v{m.version} · {m.id}</bdi>} />
        <Row k="تاريخ الاستيراد" v={fmtDateTime(m.importedAt)} />
        <Row k="آخر تحديث ناجح" v={fmtDateTime(m.lastUpdated)} />
      </dl>
      <div className="mt-3">
        {!cov.coversToday
          ? <Note tone="error">الجدول لا يغطي تاريخ اليوم ({today}). الشاشة لا تعرض مواقيت حتى يُستورد جدول يشمل هذا التاريخ.</Note>
          : cov.daysRemaining < 30
            ? <Note tone="warn">يغطي الجدول {cov.daysRemaining} يوماً فقط بعد اليوم — جهّز جدول الفترة القادمة.</Note>
            : <Note tone="ok">يغطي الجدول تاريخ اليوم، ويتبقى فيه {cov.daysRemaining} يوماً بعده.</Note>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn small onClick={() => download(`prayer-times-${m.wilayatId}-${m.years.join('-')}.csv`, exportCsv(schedule), 'text/csv;charset=utf-8')}><IconFileCsv />تصدير CSV</Btn>
        <Btn small onClick={() => download(`prayer-times-${m.wilayatId}-${m.years.join('-')}.json`, exportJson(schedule), 'application/json')}><IconFileJson />تصدير JSON</Btn>
        {onRestore && <Btn small kind="danger" onClick={onRestore}><IconRestore size={16} />استعادة الجدول السابق</Btn>}
      </div>
    </Card>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex gap-2"><dt className="min-w-[110px] font-bold text-muted">{k}</dt><dd className="m-0 min-w-0 break-words text-ink">{v}</dd></div>
);

const KIND_AR = { daily: 'يومي', monthly: 'شهري', annual: 'سنوي كامل', partial: 'فترة جزئية' };

function ImportCard({ label, wilayatId, schedule, onCommit, isValidCurrent }: { label: string; wilayatId: string; schedule: PrayerSchedule | null; onCommit: (s: PrayerSchedule, what: string) => void; isValidCurrent: boolean }) {
  const [file, setFile] = useState<{ name: string; res: ImportResult } | null>(null);
  const [source, setSource] = useState<'official' | 'admin'>('official');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const year = new Date(now()).getUTCFullYear();

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const text = await readFileText(f);
    const res = parseTimetableFile(f.name, text);
    setFile({ name: f.name, res });
    const y = res.stats.years.join('/') || year;
    setNote(`تقويم وزارة الأوقاف والشؤون الدينية ${y} — ${label}`);
    setMode(res.stats.kind === 'annual' || !schedule ? 'replace' : 'merge');
  };

  const r = file?.res;
  const apply = () => {
    if (!r || r.errors.length) return;
    try {
      const next = applyImport(schedule, r, { mode, source, sourceNote: note.trim() || file!.name, locationLabel: label, wilayatId, nowIso: new Date().toISOString() });
      onCommit(next, `استيراد ${file!.name}`);
      setFile(null);
    } catch (e) { alert((e as Error).message); }
  };

  const blankYear = () => {
    const rows = ['date,fajr,sunrise,dhuhr,asr,maghrib,isha,jumuah', ...datesOfYear(year).map((d) => `${d},,,,,,,`)];
    download(`template-${year}-blank.csv`, '﻿' + rows.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  };

  return (
    <Card title="استيراد جدول المواقيت" icon={<IconUpload size={18} />}>
      <Note>
        المصدر الرسمي: تقويم وزارة الأوقاف والشؤون الدينية (تطبيق «تقويم عُمان» أو التقويم المطبوع). موقع الوزارة لا يوفر ملفات تنزيل أو واجهة برمجية عامة، لذا تُنقل المواقيت إلى ملف CSV/JSON ثم تُستورد هنا.
        يقبل الاستيراد جدولاً يومياً أو شهرياً أو سنوياً، بأرقام عربية أو إنجليزية، وبصيغة 24 ساعة أو 12 ساعة (ص/م).
      </Note>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-ink bg-ink px-4 text-[14px] font-bold text-white hover:bg-ink2">
          <IconFileCsv /><IconFileJson />اختيار ملف CSV أو JSON
          <input type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <a className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-white px-3 text-[13px] font-bold text-ink no-underline hover:border-ink2" href="/data/template.csv" download><IconFileCsv size={16} />قالب CSV</a>
        <a className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-white px-3 text-[13px] font-bold text-ink no-underline hover:border-ink2" href="/data/template.json" download><IconFileJson size={16} />قالب JSON</a>
        <Btn small onClick={blankYear}><IconDownload size={16} />قالب سنة {year} فارغ</Btn>
      </div>

      {r && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-paper/60 p-3">
          <div className="flex flex-wrap items-center gap-2 text-[14px]">
            <b className="text-ink">{file!.name}</b>
            <Badge tone={r.errors.length ? 'rose' : 'teal'}>{r.errors.length ? `${r.errors.length} خطأ` : 'صالح'}</Badge>
            {r.warnings.length > 0 && <Badge tone="saffron">{r.warnings.length} تنبيه</Badge>}
            <Badge tone="muted">{KIND_AR[r.stats.kind]}</Badge>
            <Badge tone="muted">{r.stats.count} يوماً</Badge>
            {r.stats.firstDate && <Badge tone="muted"><bdi dir="ltr">{r.stats.firstDate} → {r.stats.lastDate}</bdi></Badge>}
          </div>
          {r.errors.length > 0 && (
            <Note tone="error">
              <b>لن يُستورد الملف حتى تُصحَّح الأخطاء. الجدول الحالي لم يتغير.</b>
              <ul className="m-0 mt-1 list-disc pr-5">{r.errors.slice(0, 15).map((e, i) => <li key={i}>{e.row ? `سطر ${e.row}: ` : ''}{e.message}</li>)}</ul>
              {r.errors.length > 15 && <div>و{r.errors.length - 15} خطأ آخر…</div>}
            </Note>
          )}
          {r.warnings.length > 0 && (
            <Note tone="warn"><ul className="m-0 list-disc pr-5">{r.warnings.slice(0, 10).map((e, i) => <li key={i}>{e.date ? `${e.date}: ` : ''}{e.message}</li>)}</ul></Note>
          )}
          {!r.errors.length && (
            <>
              <Grid>
                <Field label="نوع المصدر">
                  <Select value={source} onChange={setSource} options={[{ value: 'official', label: 'رسمي — منقول من تقويم الوزارة' }, { value: 'admin', label: 'إدخال المشرف' }]} />
                </Field>
                <Field label="طريقة الاستيراد">
                  <Select value={mode} onChange={setMode} options={[{ value: 'replace', label: 'استبدال الجدول بالكامل' }, { value: 'merge', label: 'دمج: تحديث هذه الأيام فقط' }]} />
                </Field>
                <Field label="وصف المصدر" hint="يظهر في معلومات الجدول — مثال: تقويم الوزارة 2026 — بوشر" wide>
                  <TextInput value={note} onCommit={setNote} />
                </Field>
              </Grid>
              {mode === 'replace' && isValidCurrent && r.stats.kind !== 'annual' && <Note tone="warn">الملف لا يغطي سنة كاملة، وسيحل محل جدول صالح. اختر «دمج» إن أردت تحديث أيام محددة فقط.</Note>}
              <div className="flex gap-2">
                <Btn kind="teal" onClick={apply}><IconUpload size={16} />اعتماد الاستيراد</Btn>
                <Btn onClick={() => setFile(null)}>إلغاء</Btn>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function CalcCard({ label, wilayatId, lat, lng, onCommit }: { label: string; wilayatId: string; lat: number; lng: number; onCommit: (s: PrayerSchedule, what: string) => void }) {
  const [open, setOpen] = useState(false);
  const thisYear = new Date(now()).getUTCFullYear();
  const [year, setYear] = useState(thisYear);
  const [fa, setFa] = useState(DEFAULT_CALC.fajrAngle);
  const [ia, setIa] = useState(DEFAULT_CALC.ishaAngle);
  const [adj, setAdj] = useState({ ...DEFAULT_CALC.adjust });
  const [cLat, setLat] = useState(lat);
  const [cLng, setLng] = useState(lng);
  return (
    <Card title="جدول محسوب أو تجريبي" actions={<Btn small kind="ghost" onClick={() => setOpen(!open)}>{open ? 'إخفاء' : 'عرض'}</Btn>}>
      <Note tone="warn">المواقيت المحسوبة على الجهاز تقديرية وليست جدول الوزارة، وتُوسم دائماً «محسوبة — غير رسمية». استخدمها مؤقتاً فقط إلى أن يُستورد الجدول الرسمي.</Note>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <Grid cols={4}>
            <Field label="السنة"><NumberInput value={year} min={2020} max={2100} onCommit={setYear} /></Field>
            <Field label="زاوية الفجر"><NumberInput value={fa} min={12} max={21} step={0.5} suffix="°" onCommit={setFa} /></Field>
            <Field label="زاوية العشاء"><NumberInput value={ia} min={12} max={21} step={0.5} suffix="°" onCommit={setIa} /></Field>
            <Field label="العصر"><div className="flex h-11 items-center text-[14px] text-ink2">المذهب الشافعي (ظل المثل)</div></Field>
            <Field label="خط العرض" hint={`افتراضي ${label}`}><NumberInput value={cLat} min={16} max={27} step={0.001} onCommit={setLat} /></Field>
            <Field label="خط الطول"><NumberInput value={cLng} min={51} max={60} step={0.001} onCommit={setLng} /></Field>
          </Grid>
          <div className="text-[13px] font-bold text-ink2">تعديل بالدقائق (احتياط/مطابقة)</div>
          <Grid cols={3}>
            {TIME_KEYS.map((k) => (
              <Field key={k} label={T_AR[k]}><NumberInput value={adj[k]} min={-30} max={30} suffix="د" onCommit={(v) => setAdj({ ...adj, [k]: v })} /></Field>
            ))}
          </Grid>
          <div className="flex flex-wrap gap-2">
            <Btn kind="primary" onClick={() => onCommit(calculateYear(year, { lat: cLat, lng: cLng, fajrAngle: fa, ishaAngle: ia, adjust: adj }, `${label} (محسوب)`, wilayatId, new Date().toISOString()), `توليد جدول محسوب لسنة ${year}`)}>توليد جدول محسوب لسنة {year}</Btn>
            <Btn kind="danger" onClick={() => onCommit(demoSchedule(year, new Date().toISOString()), 'تحميل بيانات DEMO')}>تحميل بيانات تجريبية (DEMO)</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

function Viewer({ schedule, today }: { schedule: PrayerSchedule; today: string }) {
  const cfg = useApp((s) => s.config);
  const [view, setView] = useState<'day' | 'month' | 'year'>('month');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState(today);
  const [editing, setEditing] = useState<DailyPrayerTimes | null>(null);
  const [err, setErr] = useState('');
  const years = schedule.meta.years.length ? schedule.meta.years : [+today.slice(0, 4)];
  const [y, m] = month.split('-').map(Number);

  const monthDays = useMemo(() => Array.from({ length: daysInMonth(y, m) }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`), [y, m]);

  const save = async () => {
    if (!editing) return;
    try { await saveDayEdit(editing); setEditing(null); setErr(''); } catch (e) { setErr((e as Error).message); }
  };

  const table = (dates: string[]) => (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-[13px]">
        <thead className="bg-paper">
          <tr>
            <th className="sticky right-0 bg-paper px-2 py-2 text-right">التاريخ</th>
            {TIME_KEYS.map((k) => <th key={k} className="px-2 py-2">{T_AR[k]}</th>)}
            <th className="px-2 py-2 no-print">تعديل</th>
          </tr>
        </thead>
        <tbody>
          {dates.map((d) => {
            const r = schedule.days[d];
            const isToday = d === today;
            return (
              <tr key={d} className={`border-t border-line ${isToday ? 'bg-saffron-soft' : ''} ${weekdayOf(d) === 5 ? 'font-bold' : ''}`}>
                <td className={`sticky right-0 whitespace-nowrap px-2 py-1.5 ${isToday ? 'bg-saffron-soft' : 'bg-white'}`}>
                  <bdi dir="ltr">{d.slice(8)}</bdi> <span className="text-muted">{WEEKDAYS_AR[weekdayOf(d)]}</span>
                </td>
                {r ? TIME_KEYS.map((k) => <td key={k} className="px-2 py-1.5 text-center" dir="ltr">{r[k]}</td>)
                  : <td colSpan={6} className="px-2 py-1.5 text-center font-bold text-rose">يوم مفقود</td>}
                <td className="px-2 py-1 text-center no-print">
                  <button className="rounded-lg p-1.5 text-ink2 hover:bg-paper" aria-label={`تعديل ${d}`} onClick={() => setEditing(r ? { ...r } : { date: d, fajr: '', sunrise: '', dhuhr: '', asr: '', maghrib: '', isha: '' })}><IconEdit size={16} /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <Card title="عرض الجدول وتعديله" actions={
      <>
        <div className="inline-flex rounded-xl border border-line bg-paper p-0.5">
          {(['day', 'month', 'year'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`h-8 rounded-lg px-3 text-[13px] font-bold ${view === v ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}>{{ day: 'يوم', month: 'شهر', year: 'سنة' }[v]}</button>
          ))}
        </div>
        {view === 'month' && <Btn small onClick={() => window.print()}><IconPrint size={16} />طباعة الشهر</Btn>}
      </>
    }>
      {view === 'day' && (
        <div className="flex flex-col gap-3">
          <Field label="التاريخ"><input type="date" dir="ltr" className="h-11 rounded-xl border border-line px-3" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></Field>
          {table([day])}
        </div>
      )}
      {view === 'month' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 no-print">
            <Select value={String(y)} onChange={(v) => setMonth(`${v}-${String(m).padStart(2, '0')}`)} options={years.map((x) => ({ value: String(x), label: String(x) }))} />
            <Select value={String(m)} onChange={(v) => setMonth(`${y}-${v.padStart(2, '0')}`)} options={GREGORIAN_MONTHS_AR.map((n, i) => ({ value: String(i + 1), label: n }))} />
          </div>
          <div className="print-only">
            <h2 style={{ margin: 0 }}>{cfg.mosque.nameAr} — مواقيت {GREGORIAN_MONTHS_AR[m - 1]} {y}</h2>
            <p style={{ margin: '4px 0 8px' }}>{schedule.meta.locationLabel} · {SOURCE_AR[schedule.meta.source]} · {schedule.meta.sourceNote}</p>
          </div>
          {table(monthDays)}
        </div>
      )}
      {view === 'year' && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {years.flatMap((yy) => GREGORIAN_MONTHS_AR.map((n, i) => {
            const total = daysInMonth(yy, i + 1);
            const have = Array.from({ length: total }, (_, d) => schedule.days[`${yy}-${String(i + 1).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`]).filter(Boolean).length;
            return (
              <button key={`${yy}-${i}`} onClick={() => { setMonth(`${yy}-${String(i + 1).padStart(2, '0')}`); setView('month'); }}
                className={`rounded-xl border p-3 text-right ${have === total ? 'border-line bg-white' : have === 0 ? 'border-rose/40 bg-rose-soft/40' : 'border-saffron/50 bg-saffron-soft/50'}`}>
                <div className="text-[14px] font-bold text-ink">{n} <span className="text-muted">{yy}</span></div>
                <div className="text-[12px] text-ink2">{have}/{total} يوماً{have < total ? ` — ${total - have} مفقود` : ''}</div>
              </button>
            );
          }))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/50 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="m-0 mb-3 text-[17px] font-extrabold text-ink">تعديل مواقيت <bdi dir="ltr">{editing.date}</bdi> — {WEEKDAYS_AR[weekdayOf(editing.date)]}</h3>
            <Grid cols={3}>
              {TIME_KEYS.map((k) => <Field key={k} label={T_AR[k]}><TimeInput value={editing[k]} onCommit={(v) => setEditing({ ...editing, [k]: v })} /></Field>)}
              {weekdayOf(editing.date) === 5 && <Field label="بداية الجمعة (اختياري)"><TimeInput value={editing.jumuah ?? ''} onCommit={(v) => setEditing({ ...editing, jumuah: v || undefined })} /></Field>}
            </Grid>
            {err && <div className="mt-3"><Note tone="error"><span className="whitespace-pre-line">{err}</span></Note></div>}
            <div className="mt-4 flex justify-end gap-2">
              <Btn onClick={() => { setEditing(null); setErr(''); }}>إلغاء</Btn>
              <Btn kind="primary" onClick={() => void save()}>حفظ التعديل</Btn>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
