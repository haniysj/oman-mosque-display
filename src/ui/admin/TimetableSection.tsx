/**
 * «جدول المواقيت» — simple model: one independent timetable per wilayat, stored on the platform.
 *   Home   : list of stored wilayat timetables + "add a wilayat timetable".
 *   Editor : ١ add the Ministry's times (file or image) → ٢ calibrate & complete the year → ٣ view / edit.
 * Every mosque automatically uses its wilayat's timetable. A screen that is not linked to any
 * mosque keeps a local timetable of its own (same editor, saved on the device).
 */
import { useEffect, useMemo, useState } from 'react';
import type { AppConfig, DailyPrayerTimes, DataSourceKind, PrayerSchedule, TimeKey } from '../../domain/types';
import { TIME_KEYS } from '../../domain/types';
import { GOVERNORATES, findGovernorate, findWilayat, locationLabel } from '../../domain/oman';
import { applyImport, editDay, exportCsv, exportJson, parseTimetableFile, withYear, type ImportResult } from '../../core/timetable';
import { calibrate, type CalibrationProfile, type CalibrationStats } from '../../core/calibrate';
import { fillMissing, sourceCounts } from '../../core/generate';
import { daysInMonth, GREGORIAN_MONTHS_AR, muscatDateKey, WEEKDAYS_AR, weekdayOf } from '../../core/time';
import { autoExtendIfNeeded, saveFilledSchedule, updateConfig, useApp } from '../../store/appStore';
import {
  adminLogin, deleteWilayatTimetable, getWilayatTimetable, listMosques, listTimetables, MissingRpcError, saveWilayatTimetable, useCloud,
  type MosqueSummary, type TimetableSummary,
} from '../../services/cloud';
import { useOnline } from '../../services/platform';
import { now } from '../../services/clock';
import { Badge, Btn, Card, download, Field, Grid, isSpreadsheet, Note, readFileText, readSpreadsheetAsCsv, Select, TimeInput, useConfirm } from './kit';
import { ImageImportButton } from './ImageImport';
import { IconCheck, IconEdit, IconFileCsv, IconFileJson, IconLock, IconPlus, IconPrint, IconTrash, IconUpload, IconWifiOff } from '../common/icons';

const T_AR: Record<TimeKey, string> = { fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
export const SOURCE_AR: Record<DataSourceKind, string> = { official: 'رسمي (وزارة الأوقاف)', admin: 'إدخال المشرف', calibrated: 'محسوب ومعاير على جدول الوزارة', calculated: 'محسوب — غير رسمي', demo: 'DEMO — تجريبي' };
export const sourceTone = (s: DataSourceKind) => (s === 'official' ? 'teal' : s === 'admin' || s === 'calibrated' ? 'ink' : s === 'calculated' ? 'saffron' : 'rose') as 'teal' | 'ink' | 'saffron' | 'rose';
const fmtDate = (iso: string) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString('ar-OM-u-nu-latn', { timeZone: 'Asia/Muscat', dateStyle: 'medium' }); } catch { return iso; } };
const pct = (s: CalibrationStats) => Math.round((s.exact / Math.max(1, s.total)) * 1000) / 10;
const inputCls = 'h-11 w-full rounded-xl border border-line bg-white px-3 text-[15px] text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal-soft';

type Target = { gov: string; wil: string; local: boolean };

export function TimetableSection() {
  const [open, setOpen] = useState<Target | null>(null);
  return open
    ? <WilayatEditor key={`${open.wil}-${open.local}`} target={open} onBack={() => setOpen(null)} />
    : <TimetablesHome onOpen={setOpen} />;
}

// =============================================================== home: list of wilayat timetables

function TimetablesHome({ onOpen }: { onOpen: (t: Target) => void }) {
  const online = useOnline();
  const cloud = useCloud();
  const cfg = useApp((s) => s.config);
  const local = useApp((s) => s.schedule);
  const [tables, setTables] = useState<TimetableSummary[] | null>(null);
  const [mosques, setMosques] = useState<MosqueSummary[] | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [gov, setGov] = useState(cfg.mosque.location.governorateId);
  const [wil, setWil] = useState(cfg.mosque.location.wilayatId);

  useEffect(() => {
    if (!online) return;
    setErr('');
    Promise.all([listTimetables(), listMosques()]).then(([t, m]) => { setTables(t); setMosques(m); }).catch((e) => setErr((e as Error).message));
  }, [online]);

  const deviceWil = cloud.binding ? cloud.wilayatId : null;
  const exists = tables?.some((t) => t.wilayat_id === wil);

  return (
    <div className="flex flex-col gap-4">
      <Note>لكل ولاية جدول مواقيت مستقل محفوظ في المنصة. الجدول الذي ترفعه يُحفظ لتلك الولاية، وكل مساجد الولاية تأخذه تلقائياً — ما عدا الأيام التي عُدّلت يدوياً لمسجد معيّن (من «مواقيت المسجد») فتبقى كما عُدّلت لذلك المسجد.</Note>
      {!online && <Note tone="warn"><span className="inline-flex items-center gap-1.5"><IconWifiOff size={15} />جداول المنصة تحتاج اتصالاً بالإنترنت. الشاشة تعمل بآخر جدول محفوظ عليها.</span></Note>}
      {err && <Note tone="error">{err}</Note>}

      <Card title="جداول الولايات" actions={online && <Btn small kind="teal" onClick={() => setAdding((v) => !v)}><IconPlus size={14} />جدول ولاية جديد</Btn>}>
        {adding && (
          <div className="mb-3 rounded-xl border border-teal/40 bg-teal-soft/30 p-3">
            <Grid>
              <Field label="المحافظة"><Select value={gov} options={GOVERNORATES.map((g) => ({ value: g.id, label: g.ar }))} onChange={(v) => { setGov(v); setWil(findGovernorate(v)!.wilayats[0].id); }} /></Field>
              <Field label="الولاية"><Select value={wil} options={(findGovernorate(gov)?.wilayats ?? []).map((w) => ({ value: w.id, label: w.ar }))} onChange={setWil} /></Field>
            </Grid>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Btn kind="primary" onClick={() => onOpen({ gov, wil, local: false })}>{exists ? 'فتح الجدول الموجود' : 'إنشاء الجدول'}</Btn>
              {exists && <span className="text-[13px] text-ink2">لهذه الولاية جدول محفوظ — سيُفتح للتعديل.</span>}
            </div>
          </div>
        )}
        {online && !tables && !err && <p className="m-0 text-[13px] text-muted">جارٍ التحميل…</p>}
        {tables && !tables.length && <p className="m-0 text-[14px] text-ink2">لا توجد جداول بعد. اضغط «جدول ولاية جديد» واختر الولاية.</p>}
        {tables && tables.length > 0 && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {tables.map((t) => {
              const names = (mosques ?? []).filter((m) => m.wilayat_id === t.wilayat_id).map((m) => m.name_ar);
              return (
                <button key={t.wilayat_id} onClick={() => onOpen({ gov: t.governorate_id, wil: t.wilayat_id, local: false })}
                  className={`flex flex-col gap-1.5 rounded-xl border p-3 text-right transition hover:border-ink2 ${t.wilayat_id === deviceWil ? 'border-teal bg-teal-soft/30' : 'border-line bg-white'}`}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <b className="text-[16px] text-ink">{findWilayat(t.governorate_id, t.wilayat_id)?.ar ?? t.wilayat_id}</b>
                    <span className="text-[12px] text-muted">{findGovernorate(t.governorate_id)?.ar}</span>
                    {t.wilayat_id === deviceWil && <Badge tone="teal">هذا الجهاز</Badge>}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Badge tone={t.days >= 365 ? 'teal' : 'saffron'}>{t.days} يوماً</Badge>
                    {t.calibrated ? <Badge tone="teal"><IconCheck size={12} />معاير</Badge> : <Badge tone="muted">غير معاير</Badge>}
                  </span>
                  <span className="text-[12px] text-ink2">{names.length ? `المساجد: ${names.join('، ')}` : 'لا يستخدمه أي مسجد بعد'}</span>
                  <span className="inline-flex items-center gap-1 text-[12px] font-bold text-teal"><IconEdit size={13} />فتح وتعديل · آخر تحديث {fmtDate(t.updated_at)}</span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {!cloud.binding && (
        <Card title="جدول هذا الجهاز فقط">
          <p className="m-0 mb-2 text-[13px] text-ink2">هذه الشاشة غير مرتبطة بمسجد، فتعمل بجدول محفوظ عليها وحدها. للربط بجدول المنصة اختر المسجد من «المساجد والمزامنة».</p>
          <Grid>
            <Field label="المحافظة"><Select value={cfg.mosque.location.governorateId} options={GOVERNORATES.map((g) => ({ value: g.id, label: g.ar }))}
              onChange={(v) => void updateConfig((c) => { c.mosque.location.governorateId = v; c.mosque.location.wilayatId = findGovernorate(v)!.wilayats[0].id; })} /></Field>
            <Field label="الولاية"><Select value={cfg.mosque.location.wilayatId} options={(findGovernorate(cfg.mosque.location.governorateId)?.wilayats ?? []).map((w) => ({ value: w.id, label: w.ar }))}
              onChange={(v) => void updateConfig((c) => { c.mosque.location.wilayatId = v; })} /></Field>
          </Grid>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Btn onClick={() => onOpen({ gov: cfg.mosque.location.governorateId, wil: cfg.mosque.location.wilayatId, local: true })}><IconEdit size={15} />فتح جدول الجهاز</Btn>
            <span className="text-[13px] text-muted">{local ? `${local.meta.locationLabel} — ${local.meta.dayCount} يوماً` : 'لا يوجد جدول على الجهاز'}</span>
          </div>
        </Card>
      )}
    </div>
  );
}

// =============================================================== editor for one wilayat

function WilayatEditor({ target, onBack }: { target: Target; onBack: () => void }) {
  const { gov, wil, local } = target;
  const cloud = useCloud();
  const online = useOnline();
  const cfg = useApp((s) => s.config);
  const localSchedule = useApp((s) => s.schedule);
  const { ask, ui } = useConfirm();
  const w = findWilayat(gov, wil);
  const label = locationLabel(gov, wil);
  const name = w?.ar ?? wil;
  const today = muscatDateKey(now());

  const [loaded, setLoaded] = useState(local);
  const [cloudSchedule, setCloudSchedule] = useState<PrayerSchedule | null>(null);
  const [cloudProfile, setCloudProfile] = useState<CalibrationProfile | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);

  const schedule = local ? localSchedule : cloudSchedule;
  const profile = local ? cfg.calc.profile : cloudProfile;
  const canSave = local || cloud.admin;

  useEffect(() => {
    if (local) return;
    getWilayatTimetable(wil)
      .then((t) => { setCloudSchedule(t?.schedule ?? null); setCloudProfile(t?.calibration ?? null); setVersion(t?.version ?? null); setLoaded(true); })
      .catch((e) => setMsg({ tone: 'error', text: e instanceof MissingRpcError ? 'لفتح جدول ولاية لا يستخدمه أي مسجد بعد، شغّل ملف التحديث supabase/mosque-cloud-v2-timetables.sql في Supabase مرة واحدة.' : (e as Error).message }));
  }, [local, wil]);

  /** Saves the whole timetable of this wilayat (platform) or of this device (local). */
  const persist = async (next: PrayerSchedule, nextProfile: CalibrationProfile | null, okText: string) => {
    if (!canSave) { setMsg({ tone: 'error', text: 'سجّل دخول المشرف أولاً (أعلى الصفحة).' }); return; }
    setBusy(true); setMsg(null);
    try {
      if (local) {
        await saveFilledSchedule(next, okText);
        if (JSON.stringify(nextProfile) !== JSON.stringify(cfg.calc.profile)) await updateConfig((c) => { c.calc.profile = nextProfile; });
        await autoExtendIfNeeded(today);
      } else {
        const r = await saveWilayatTimetable(gov, wil, next, nextProfile);
        setCloudSchedule(next); setCloudProfile(nextProfile); setVersion(r.version);
      }
      setMsg({ tone: 'ok', text: `${okText} — تم الحفظ${local ? ' على هذا الجهاز' : ` في المنصة لولاية ${name}`}.` });
    } catch (e) { setMsg({ tone: 'error', text: `لم يُحفظ: ${(e as Error).message}` }); } finally { setBusy(false); }
  };

  const counts = sourceCounts(schedule);
  const officialDays = useMemo(() => Object.values(schedule?.days ?? {}).filter((d) => (d.source ?? schedule?.meta.source) === 'official'), [schedule]);

  return (
    <div className="flex flex-col gap-4">
      {ui}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Btn small kind="ghost" onClick={onBack}>→ كل الجداول</Btn>
        {schedule && (
          <div className="flex flex-wrap gap-1.5">
            <Btn small onClick={() => download(`prayer-times-${wil}.csv`, exportCsv(schedule), 'text/csv;charset=utf-8')}><IconFileCsv />CSV</Btn>
            <Btn small onClick={() => download(`prayer-times-${wil}.json`, exportJson(schedule), 'application/json')}><IconFileJson />JSON</Btn>
            {!local && cloud.admin && (
              <Btn small kind="danger" title={`حذف جدول ${name}`} disabled={busy} onClick={() => ask(`حذف جدول ولاية ${name} من المنصة؟`, () => ask(`تأكيد نهائي: حذف جدول ${name}. مساجد هذه الولاية ستبقى بآخر جدول محفوظ على شاشاتها حتى يُضاف جدول جديد.`, () => {
                setBusy(true);
                deleteWilayatTimetable(wil).then(onBack).catch((e) => setMsg({ tone: 'error', text: e instanceof MissingRpcError ? 'الحذف يحتاج تشغيل ملف التحديث supabase/mosque-cloud-v2-timetables.sql في Supabase.' : (e as Error).message })).finally(() => setBusy(false));
              }))}><IconTrash size={14} /></Btn>
            )}
          </div>
        )}
      </div>

      <Card title={local ? `جدول هذا الجهاز — ${label}` : `جدول ولاية ${name}`} actions={
        <span className="flex flex-wrap gap-1.5">
          {!local && version != null && <Badge tone="muted">v{version}</Badge>}
          {profile ? <Badge tone="teal"><IconCheck size={12} />معاير</Badge> : <Badge tone="saffron">غير معاير</Badge>}
        </span>
      }>
        <div className="flex flex-wrap gap-1.5 text-[13px]">
          <Badge tone="muted">{findGovernorate(gov)?.ar}</Badge>
          <Badge tone={schedule ? 'ink' : 'saffron'}>{schedule ? `${schedule.meta.dayCount} يوماً` : 'فارغ'}</Badge>
          {counts.official ? <Badge tone="teal">رسمي {counts.official}</Badge> : null}
          {counts.calibrated ? <Badge tone="ink">مكمَّل بالمعايرة {counts.calibrated}</Badge> : null}
          {counts.calculated ? <Badge tone="saffron">تقديري {counts.calculated}</Badge> : null}
          {counts.admin ? <Badge tone="muted">معدَّل يدوياً {counts.admin}</Badge> : null}
          {counts.demo ? <Badge tone="rose">DEMO {counts.demo}</Badge> : null}
        </div>
        {!local && !cloud.admin && <div className="mt-3"><AdminGate /></div>}
        {!local && !online && <div className="mt-3"><Note tone="warn">لا يوجد إنترنت — لا يمكن الحفظ في المنصة الآن.</Note></div>}
      </Card>

      {msg && <Note tone={msg.tone}>{msg.text}</Note>}

      {!loaded ? <p className="m-0 text-[13px] text-muted">جارٍ تحميل الجدول…</p> : (
        <>
          <StepImport name={name} label={label} wil={wil} schedule={schedule} disabled={!canSave || busy}
            onApply={(next, what) => persist(next, profile, what)} />
          <StepCalibrate name={name} gov={gov} wil={wil} cfg={cfg} schedule={schedule} profile={profile} officialDays={officialDays} disabled={!canSave || busy} local={local}
            onApply={(next, p, what) => persist(next, p, what)} />
          {schedule && <Viewer schedule={schedule} today={today} title={local ? label : `ولاية ${name}`} disabled={!canSave || busy}
            onSaveDay={(rec) => persist(editDay(schedule, rec, new Date().toISOString()), profile, `تعديل مواقيت ${rec.date}`)} />}
        </>
      )}
    </div>
  );
}

function AdminGate() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <form className="flex flex-col gap-2 rounded-xl border border-saffron/50 bg-saffron-soft/40 p-3" onSubmit={(e) => { e.preventDefault(); setErr(''); adminLogin(pw).then(() => setPw('')).catch((x) => setErr((x as Error).message)); }}>
      <span className="inline-flex items-center gap-1.5 text-[14px] font-bold text-ink"><IconLock size={15} />للتعديل والحفظ في المنصة: سجّل دخول المشرف</span>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-xs`} type="password" placeholder="كلمة مرور الإدارة" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Btn kind="primary" type="submit" disabled={!pw}>دخول</Btn>
      </div>
      {err && <span className="text-[13px] text-rose">{err}</span>}
    </form>
  );
}

// --------------------------------------------------------------- step 1: Ministry times

const KIND_AR = { daily: 'يومي', monthly: 'شهري', annual: 'سنوي كامل', partial: 'فترة جزئية' };

function StepImport({ name, label, wil, schedule, disabled, onApply }: {
  name: string; label: string; wil: string; schedule: PrayerSchedule | null; disabled: boolean;
  onApply: (next: PrayerSchedule, what: string) => Promise<void>;
}) {
  const [file, setFile] = useState<{ name: string; res: ImportResult } | null>(null);
  const [year, setYear] = useState<number | null>(null); // null = as dated in the file
  const thisYear = +muscatDateKey(now()).slice(0, 4);
  const onFile = async (f?: File) => {
    setYear(null);
    if (!f) return;
    let res: ImportResult;
    try {
      res = isSpreadsheet(f.name) ? parseTimetableFile('sheet.csv', await readSpreadsheetAsCsv(f)) : parseTimetableFile(f.name, await readFileText(f));
    } catch (e) {
      res = parseTimetableFile('x.csv', '');
      res.errors = [{ row: null, message: `تعذّرت قراءة الملف: ${(e as Error).message}` }];
    }
    setFile({ name: f.name, res });
  };
  const orig = file?.res;
  const r = useMemo(() => (orig && year ? withYear(orig, year) : orig), [orig, year]);
  const fileYear = orig && orig.stats.years.length === 1 ? orig.stats.years[0] : null;
  const apply = () => {
    if (!r || r.errors.length) return;
    const y = r.stats.years.join('/');
    const next = applyImport(schedule, r, { mode: 'merge', source: 'official', sourceNote: `تقويم وزارة الأوقاف ${y} — ${label}`, locationLabel: label, wilayatId: wil, nowIso: new Date().toISOString() });
    void onApply(next, `إضافة ${r.stats.count} يوماً رسمياً`).then(() => setFile(null));
  };

  return (
    <Card title="١. أضف مواقيت الوزارة" icon={<IconUpload size={18} />}>
      <p className="m-0 mb-3 text-[14px] text-ink2">أضف شهراً أو أكثر من تقويم وزارة الأوقاف لولاية {name} — من ملف أو من صورة، للسنة الحالية أو لسنة قادمة. الأيام الجديدة تُضاف للجدول، والموجودة تُستبدل بها.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-ink bg-ink px-4 text-[14px] font-bold text-white hover:bg-ink2 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
          <IconFileCsv /><IconFileJson />ملف Excel أو CSV أو JSON
          <input type="file" disabled={disabled} accept=".csv,.json,.xlsx,.xls,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <ImageImportButton onParsed={(n, res) => { setYear(null); setFile({ name: n, res }); }} />
        <a className="text-[13px] font-bold text-teal" href="/data/template.csv" download>تنزيل قالب CSV</a>
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
              <b>لن يُضاف الملف حتى تُصحَّح الأخطاء. الجدول لم يتغير.</b>
              <ul className="m-0 mt-1 list-disc pr-5">{r.errors.slice(0, 15).map((e, i) => <li key={i}>{e.row ? `سطر ${e.row}: ` : ''}{e.message}</li>)}</ul>
              {r.errors.length > 15 && <div>و{r.errors.length - 15} خطأ آخر…</div>}
            </Note>
          )}
          {fileYear && !orig!.errors.length && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-bold text-ink2">سنة المواقيت:</span>
              <div className="w-64"><Select value={String(year ?? '')} onChange={(v) => setYear(v ? +v : null)} options={[
                { value: '', label: `كما في الملف (${fileYear})` },
                ...[thisYear - 1, thisYear, thisYear + 1, thisYear + 2, thisYear + 3].filter((y) => y !== fileYear).map((y) => ({ value: String(y), label: `اعتبرها مواقيت سنة ${y}` })),
              ]} /></div>
              {year && <span className="text-ink2">تُنقل كل التواريخ إلى سنة {year} بنفس اليوم والشهر.</span>}
            </div>
          )}
          {r.stats.months.length > 0 && <MonthStrip months={r.stats.months} />}
          {r.warnings.length > 0 && <Note tone="warn"><ul className="m-0 list-disc pr-5">{r.warnings.slice(0, 8).map((e, i) => <li key={i}>{e.date ? `${e.date}: ` : ''}{e.message}</li>)}</ul></Note>}
          {!r.errors.length && (
            <div className="flex flex-wrap gap-2">
              <Btn kind="teal" disabled={disabled} onClick={apply}><IconUpload size={16} />إضافة إلى جدول {name}</Btn>
              <Btn onClick={() => setFile(null)}>إلغاء</Btn>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// --------------------------------------------------------------- step 2: calibrate & complete the year

function genCfg(cfg: AppConfig, gov: string, wil: string, profile: CalibrationProfile | null): AppConfig {
  return { ...cfg, mosque: { ...cfg.mosque, location: { governorateId: gov, wilayatId: wil, customLat: null, customLng: null } }, calc: { ...cfg.calc, profile, useMosqueCoords: false } };
}

/** Removes previously generated days (they are regenerated with the new calibration). */
function withoutGenerated(s: PrayerSchedule | null): PrayerSchedule | null {
  if (!s) return null;
  const days = Object.fromEntries(Object.entries(s.days).filter(([, d]) => { const src = d.source ?? s.meta.source; return src !== 'calibrated' && src !== 'calculated'; }));
  return { ...s, days };
}

function StepCalibrate({ name, gov, wil, cfg, schedule, profile, officialDays, disabled, local, onApply }: {
  name: string; gov: string; wil: string; cfg: AppConfig; schedule: PrayerSchedule | null; profile: CalibrationProfile | null;
  officialDays: DailyPrayerTimes[]; disabled: boolean; local: boolean;
  onApply: (next: PrayerSchedule, p: CalibrationProfile | null, what: string) => Promise<void>;
}) {
  const thisYear = +muscatDateKey(now()).slice(0, 4);
  const [year, setYear] = useState(thisYear);
  const [err, setErr] = useState('');
  const [others, setOthers] = useState<TimetableSummary[]>([]);
  const [from, setFrom] = useState('');
  const w = findWilayat(gov, wil);
  const enough = officialDays.length >= 7;
  const months = [...new Set(officialDays.map((d) => d.date.slice(0, 7)))].sort();

  useEffect(() => { if (!enough && !local) listTimetables().then((t) => setOthers(t.filter((x) => x.calibrated && x.wilayat_id !== wil))).catch(() => undefined); }, [enough, local, wil]);

  const complete = (p: CalibrationProfile | null, what: string) => {
    const base = withoutGenerated(schedule);
    const { schedule: next, added } = fillMissing(base, `${year}-01-01`, `${year}-12-31`, genCfg(cfg, gov, wil, p), new Date().toISOString());
    return onApply(next, p, `${what} — أُكمل ${added} يوماً من سنة ${year}`);
  };

  const run = () => {
    setErr('');
    if (!w) return;
    try {
      const p = calibrate(officialDays, w.lat, w.lng, { wilayatId: wil, label: locationLabel(gov, wil) }, new Date().toISOString());
      void complete(p, `معايرة على ${p.stats.days} يوماً رسمياً (مطابقة ${pct(p.stats)}%)`);
    } catch (e) { setErr((e as Error).message); }
  };

  const useOther = async () => {
    setErr('');
    try {
      const t = await getWilayatTimetable(from);
      if (!t?.calibration) throw new Error('لا توجد معايرة في الجدول المختار');
      await complete(t.calibration, `استخدام معايرة ${locationLabel(t.governorate_id, t.wilayat_id)} لحساب ${name}`);
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <Card title="٢. المعايرة وإكمال السنة" actions={profile ? <Badge tone="teal"><IconCheck size={12} />معاير</Badge> : null}>
      <p className="m-0 mb-3 text-[14px] text-ink2">
        يقارن النظام الحساب الفلكي بمواقيت الوزارة لولاية {name} حتى يطابقها، ثم يحسب بقية أيام السنة بنفس الطريقة ويحفظها في الجدول. الأيام الرسمية لا تتغير أبداً.
      </p>
      <div className="mb-3 text-[13px] text-ink">
        الأيام الرسمية في الجدول: <b>{officialDays.length}</b>{months.length > 0 && <span className="text-muted"> — {months.map((m) => `${GREGORIAN_MONTHS_AR[+m.slice(5) - 1]} ${m.slice(0, 4)}`).join('، ')}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-28"><Select value={String(year)} onChange={(v) => setYear(+v)} options={[thisYear, thisYear + 1, thisYear + 2].map((y) => ({ value: String(y), label: String(y) }))} /></div>
        <Btn kind="teal" disabled={disabled || !enough} onClick={run}>{profile ? 'إعادة المعايرة وإكمال سنة' : 'معايرة وإكمال سنة'} {year}</Btn>
      </div>

      {!enough && (
        <div className="mt-3 flex flex-col gap-2">
          <Note tone="warn">المعايرة تحتاج 7 أيام رسمية على الأقل لهذه الولاية — أضفها من الخطوة ١.</Note>
          {others.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-ink2">أو احسب {name} بمعايرة جدول ولاية أخرى:</span>
              <div className="w-56"><Select value={from} onChange={setFrom} options={[{ value: '', label: 'اختر الولاية' }, ...others.map((t) => ({ value: t.wilayat_id, label: locationLabel(t.governorate_id, t.wilayat_id) }))]} /></div>
              <Btn disabled={disabled || !from} onClick={() => void useOther()}>استخدام</Btn>
            </div>
          )}
        </div>
      )}

      {profile && (
        <div className="mt-3 rounded-xl border border-teal/40 bg-teal-soft/30 p-3">
          <div className="mb-1.5 text-[13px] font-bold text-ink2">نتيجة المعايرة — {profile.reference.label}</div>
          <StatsLine s={profile.stats} />
          {!profile.multiSeason && profile.reference.wilayatId === wil && (
            <div className="mt-2"><Note tone="warn">المعايرة مبنية على فصل واحد. للدقة طوال السنة أضف شهرين من فصلين آخرين (مثل يناير ويونيو) ثم أعد المعايرة.</Note></div>
          )}
        </div>
      )}
      {err && <div className="mt-2"><Note tone="error">{err}</Note></div>}
    </Card>
  );
}

export function StatsLine({ s }: { s: CalibrationStats }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
      <Badge tone={s.maxError <= 1 ? 'teal' : 'saffron'}>مطابقة {s.exact}/{s.total} ({pct(s)}%)</Badge>
      <Badge tone={s.maxError <= 1 ? 'muted' : 'rose'}>أقصى فرق {s.maxError} دقيقة</Badge>
      {TIME_KEYS.map((k) => (
        <span key={k} className="whitespace-nowrap rounded-full border border-line bg-white px-2 py-0.5 text-[12px] text-ink2">{T_AR[k]} {s.perPrayer[k].exact}/{s.days}</span>
      ))}
    </div>
  );
}

// --------------------------------------------------------------- step 3: view & edit

export function Viewer({ schedule, today, title, disabled, onSaveDay, heading = '٣. عرض المواقيت وتعديلها', marked, onResetDay, legend }: {
  schedule: PrayerSchedule; today: string; title: string; disabled: boolean; onSaveDay: (rec: DailyPrayerTimes) => Promise<void>;
  heading?: string; marked?: (date: string) => boolean; onResetDay?: (date: string) => void; legend?: React.ReactNode;
}) {
  const [view, setView] = useState<'month' | 'year'>('month');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [editing, setEditing] = useState<DailyPrayerTimes | null>(null);
  const [err, setErr] = useState('');
  const years = [...new Set([...schedule.meta.years, +today.slice(0, 4)])].sort();
  const [y, m] = month.split('-').map(Number);
  const monthDays = useMemo(() => Array.from({ length: daysInMonth(y, m) }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`), [y, m]);

  const save = async () => {
    if (!editing) return;
    try { editDay(schedule, editing, new Date().toISOString()); } catch (e) { setErr((e as Error).message); return; }
    await onSaveDay(editing); setEditing(null); setErr('');
  };

  return (
    <Card title={heading} actions={
      <>
        <div className="inline-flex rounded-xl border border-line bg-paper p-0.5">
          {(['month', 'year'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`h-8 rounded-lg px-3 text-[13px] font-bold ${view === v ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}>{{ month: 'شهر', year: 'السنة' }[v]}</button>
          ))}
        </div>
        {view === 'month' && <Btn small onClick={() => window.print()}><IconPrint size={16} />طباعة</Btn>}
      </>
    }>
      {view === 'month' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 no-print">
            <div className="w-28"><Select value={String(y)} onChange={(v) => setMonth(`${v}-${String(m).padStart(2, '0')}`)} options={years.map((x) => ({ value: String(x), label: String(x) }))} /></div>
            <div className="w-36"><Select value={String(m)} onChange={(v) => setMonth(`${y}-${v.padStart(2, '0')}`)} options={GREGORIAN_MONTHS_AR.map((n, i) => ({ value: String(i + 1), label: n }))} /></div>
            <span className="text-[12px] text-muted">اضغط ✎ لتعديل أي يوم.</span>
          </div>
          <div className="print-only"><h2 style={{ margin: 0 }}>مواقيت الصلاة — {title} — {GREGORIAN_MONTHS_AR[m - 1]} {y}</h2></div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-paper"><tr><th className="sticky right-0 bg-paper px-2 py-2 text-right">اليوم</th>{TIME_KEYS.map((k) => <th key={k} className="px-2 py-2">{T_AR[k]}</th>)}<th className="px-2 py-2 no-print" /></tr></thead>
              <tbody>
                {monthDays.map((d) => {
                  const r = schedule.days[d];
                  const src = r ? r.source ?? schedule.meta.source : null;
                  const isToday = d === today;
                  return (
                    <tr key={d} className={`border-t border-line ${isToday ? 'bg-saffron-soft' : ''} ${weekdayOf(d) === 5 ? 'font-bold' : ''}`}>
                      <td className={`sticky right-0 whitespace-nowrap px-2 py-1.5 ${isToday ? 'bg-saffron-soft' : 'bg-white'}`}>
                        <bdi dir="ltr">{d.slice(8)}</bdi> <span className="text-muted">{WEEKDAYS_AR[weekdayOf(d)]}</span>
                        {marked?.(d) && <span className="mr-1 inline-block rounded-full bg-[#7C3AED] px-1.5 text-[10px] font-bold text-white align-middle" title="معدّل لهذا المسجد">المسجد</span>}
                        {!marked?.(d) && src && src !== 'official' && <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${src === 'admin' ? 'bg-ink2' : src === 'calibrated' ? 'bg-teal' : 'bg-saffron'}`} title={SOURCE_AR[src]} />}
                      </td>
                      {r ? TIME_KEYS.map((k) => <td key={k} className="px-2 py-1.5 text-center" dir="ltr">{r[k]}</td>)
                        : <td colSpan={6} className="px-2 py-1.5 text-center text-muted">—</td>}
                      <td className="px-2 py-1 text-center no-print">
                        <button disabled={disabled} className="rounded-lg p-1.5 text-ink2 hover:bg-paper disabled:opacity-40" aria-label={`تعديل ${d}`} onClick={() => setEditing(r ? { ...r } : { date: d, fajr: '', sunrise: '', dhuhr: '', asr: '', maghrib: '', isha: '' })}><IconEdit size={16} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3 text-[12px] text-muted no-print">
            {legend}
            <span>بدون علامة: رسمي</span>
            <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-teal" />مكمَّل بالمعايرة</span>
            <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-ink2" />معدَّل يدوياً</span>
            <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-saffron" />تقديري</span>
          </div>
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
                <div className="text-[12px] text-ink2">{have}/{total} يوماً</div>
              </button>
            );
          }))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/50 p-4" role="dialog" aria-modal aria-label="تعديل مواقيت يوم">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="m-0 mb-3 text-[17px] font-extrabold text-ink">تعديل مواقيت <bdi dir="ltr">{editing.date}</bdi> — {WEEKDAYS_AR[weekdayOf(editing.date)]}</h3>
            <Grid cols={3}>
              {TIME_KEYS.map((k) => <Field key={k} label={T_AR[k]}><TimeInput value={editing[k]} onCommit={(v) => setEditing({ ...editing, [k]: v })} /></Field>)}
              {weekdayOf(editing.date) === 5 && <Field label="بداية الجمعة (اختياري)"><TimeInput value={editing.jumuah ?? ''} onCommit={(v) => setEditing({ ...editing, jumuah: v || undefined })} /></Field>}
            </Grid>
            {err && <div className="mt-3"><Note tone="error"><span className="whitespace-pre-line">{err}</span></Note></div>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {onResetDay && marked?.(editing.date) && <Btn kind="ghost" onClick={() => { onResetDay(editing.date); setEditing(null); setErr(''); }}>إرجاع لجدول الولاية</Btn>}
              <Btn onClick={() => { setEditing(null); setErr(''); }}>إلغاء</Btn>
              <Btn kind="primary" onClick={() => void save()}>حفظ التعديل</Btn>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Month-by-month coverage of an import file. */
function MonthStrip({ months }: { months: { month: string; days: number; total: number }[] }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      {months.map((m) => {
        const full = m.days === m.total, none = m.days === 0;
        return (
          <div key={m.month} className={`rounded-lg border px-2 py-1.5 text-center ${full ? 'border-teal/40 bg-teal-soft' : none ? 'border-line bg-white text-muted' : 'border-saffron/50 bg-saffron-soft'}`}>
            <div className="text-[12px] font-bold text-ink">{GREGORIAN_MONTHS_AR[+m.month.slice(5) - 1]}</div>
            <div className="whitespace-nowrap text-[11px] text-ink2">{none ? 'فارغ' : full ? `مكتمل ${m.days}` : `${m.days}/${m.total}`}</div>
          </div>
        );
      })}
    </div>
  );
}
