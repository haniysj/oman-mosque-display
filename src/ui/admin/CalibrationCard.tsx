import { useEffect, useMemo, useState } from 'react';
import type { PrayerSchedule, TimeKey } from '../../domain/types';
import { TIME_KEYS } from '../../domain/types';
import { GOVERNORATES, findGovernorate, findWilayat, locationLabel } from '../../domain/oman';
import { calibrate, verifyProfile, type CalibrationStats } from '../../core/calibrate';
import { fillMissing, sourceCounts, targetCoords } from '../../core/generate';
import { GREGORIAN_MONTHS_AR, muscatDateKey } from '../../core/time';
import { autoExtendIfNeeded, saveFilledSchedule, updateConfig, useApp } from '../../store/appStore';
import { now } from '../../services/clock';
import { Badge, Btn, Card, Field, Grid, Note, Select, Toggle, useConfirm } from './kit';
import { IconCheck, IconRestore } from '../common/icons';

const T_AR: Record<TimeKey, string> = { fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
const monthLabel = (ym: string) => `${GREGORIAN_MONTHS_AR[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const pct = (s: CalibrationStats) => Math.round((s.exact / Math.max(1, s.total)) * 1000) / 10;

export function StatsLine({ s }: { s: CalibrationStats }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
      <Badge tone={s.maxError === 0 ? 'teal' : s.maxError <= 1 ? 'teal' : 'saffron'}>مطابقة {s.exact}/{s.total} ({pct(s)}%)</Badge>
      <Badge tone={s.maxError <= 1 ? 'muted' : 'rose'}>أقصى فرق {s.maxError} دقيقة</Badge>
      {TIME_KEYS.map((k) => (
        <span key={k} className="whitespace-nowrap rounded-full border border-line bg-white px-2 py-0.5 text-[12px] text-ink2">
          {T_AR[k]} {s.perPrayer[k].exact}/{s.days}
        </span>
      ))}
    </div>
  );
}

export function CalibrationCard() {
  const cfg = useApp((s) => s.config);
  const schedule = useApp((s) => s.schedule);
  const profile = cfg.calc.profile;
  const { ask, ui } = useConfirm();
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [refGov, setRefGov] = useState(profile ? GOVERNORATES.find((g) => g.wilayats.some((w) => w.id === profile.reference.wilayatId))?.id ?? cfg.mosque.location.governorateId : cfg.mosque.location.governorateId);
  const [refWil, setRefWil] = useState(profile?.reference.wilayatId ?? cfg.mosque.location.wilayatId);
  // until a calibration exists, the reference city follows the mosque's selected location
  const loc = cfg.mosque.location;
  useEffect(() => { if (!profile) { setRefGov(loc.governorateId); setRefWil(loc.wilayatId); } }, [profile, loc.governorateId, loc.wilayatId]);
  const thisYear = +muscatDateKey(now()).slice(0, 4);
  const [year, setYear] = useState(thisYear);

  const officialDays = useMemo(() => Object.values(schedule?.days ?? {}).filter((d) => (d.source ?? schedule?.meta.source) === 'official'), [schedule]);
  const officialMonths = useMemo(() => [...new Set(officialDays.map((d) => d.date.slice(0, 7)))].sort(), [officialDays]);
  const target = targetCoords(cfg);
  const counts = sourceCounts(schedule);
  const recheck = useMemo(() => (profile && officialDays.length ? verifyProfile(profile, officialDays) : null), [profile, officialDays]);
  const newOfficialSinceCalib = profile ? officialDays.length - profile.reference.days : 0;

  const runCalibration = () => {
    const w = findWilayat(refGov, refWil);
    if (!w) return;
    try {
      const p = calibrate(officialDays, w.lat, w.lng, { wilayatId: w.id, label: locationLabel(refGov, refWil) }, new Date().toISOString());
      void updateConfig((c) => { c.calc.profile = p; })
        .then(() => autoExtendIfNeeded(muscatDateKey(now())))
        .then((added) => setMsg({ tone: 'ok', text: `تمت المعايرة على ${p.stats.days} يوماً رسمياً: مطابقة ${p.stats.exact} من ${p.stats.total} (${pct(p.stats)}%)، أقصى فرق ${p.stats.maxError} دقيقة.${added ? ` وأُضيف تلقائياً ${added} يوماً قادماً محسوباً بالمعايرة.` : ''}` }));
    } catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); }
  };

  const generate = (from: string, to: string, what: string) => {
    const { schedule: next, added } = fillMissing(schedule, from, to, cfg, new Date().toISOString());
    if (!added) { setMsg({ tone: 'ok', text: 'لا توجد أيام ناقصة في هذه الفترة — لم يتغير شيء.' }); return; }
    void saveFilledSchedule(next as PrayerSchedule, `${what}: ${added} يوماً`).then(() => setMsg({ tone: 'ok', text: `${what}: أُضيف ${added} يوماً. الأيام الرسمية بقيت كما هي.` }));
  };

  return (
    <Card title="التوليد التلقائي المعاير على جدول الوزارة" actions={profile ? <Badge tone="teal"><IconCheck size={12} />معاير</Badge> : <Badge tone="saffron">غير معاير</Badge>}>
      {ui}
      <div className="flex flex-col gap-3">
        <Note>
          تستورد شهراً أو أكثر من جدول الوزارة، فيستنتج النظام منها إعدادات الحساب لكل صلاة (الزاوية، ودقائق الاحتياط، وطريقة التقريب)، ثم يحسب بها أي يوم قادم دون إنترنت ولكل ولاية بحسب موقعها. الأيام الرسمية المستوردة تبقى دائماً كما هي ولا يُكتب فوقها.
        </Note>

        <div className="rounded-xl border border-line p-3">
          <div className="mb-2 text-[13px] font-bold text-ink2">١. المعايرة</div>
          <div className="mb-2 text-[13px] text-ink">
            الأيام الرسمية المتاحة في الجدول: <b>{officialDays.length}</b>
            {officialMonths.length > 0 && <> — {officialMonths.map(monthLabel).join('، ')}</>}
          </div>
          <Grid>
            <Field label="مدينة الجدول الرسمي (كما اخترتها في موقع الوزارة)">
              <Select value={refGov} options={GOVERNORATES.map((g) => ({ value: g.id, label: g.ar }))} onChange={(v) => { setRefGov(v); setRefWil(findGovernorate(v)!.wilayats[0].id); }} />
            </Field>
            <Field label="الولاية">
              <Select value={refWil} options={(findGovernorate(refGov)?.wilayats ?? []).map((w) => ({ value: w.id, label: w.ar }))} onChange={setRefWil} />
            </Field>
          </Grid>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn kind="teal" disabled={officialDays.length < 7} onClick={runCalibration}>{profile ? 'إعادة المعايرة' : 'معايرة الآن'}</Btn>
            {profile && <Btn kind="danger" onClick={() => ask('حذف المعايرة؟ الأيام المولدة سابقاً تبقى في الجدول.', () => void updateConfig((c) => { c.calc.profile = null; }))}><IconRestore size={16} />حذف المعايرة</Btn>}
          </div>
          {officialDays.length < 7 && <div className="mt-2"><Note tone="warn">استورد أولاً شهراً واحداً على الأقل من جدول الوزارة بنوع المصدر «رسمي».</Note></div>}
        </div>

        {profile && (
          <div className="rounded-xl border border-teal/40 bg-teal-soft/30 p-3">
            <div className="mb-2 text-[13px] font-bold text-ink2">نتيجة المعايرة — {profile.reference.label}، {profile.reference.months.map(monthLabel).join('، ')}</div>
            <StatsLine s={profile.stats} />
            <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {TIME_KEYS.map((k) => (
                <div key={k} className="rounded-lg border border-line bg-white px-2 py-1.5 text-center">
                  <div className="text-[12px] font-bold text-ink">{T_AR[k]}</div>
                  <div className="text-[13px] font-extrabold text-teal" dir="ltr">{profile.adjust[k] > 0 ? '+' : ''}{profile.adjust[k]}</div>
                  <div className="text-[11px] text-muted">دقيقة · تقريب {{ nearest: 'لأقرب', ceil: 'للأعلى', floor: 'للأدنى' }[profile.rounding[k]]}</div>
                </div>
              ))}
            </div>
            <p className="m-0 mt-2 text-[12px] text-muted">زاوية الفجر {profile.fajrAngle}° · زاوية العشاء {profile.ishaAngle}° · العصر: المذهب الشافعي (ظل المثل)</p>
            {!profile.multiSeason && (
              <div className="mt-2"><Note tone="warn">المعايرة مبنية على فصل واحد. لضمان الدقة على مدار السنة استورد من موقع الوزارة شهرين من فصلين آخرين (مثل يناير ويونيو) ثم اضغط «إعادة المعايرة».</Note></div>
            )}
            {recheck && newOfficialSinceCalib > 0 && (
              <div className="mt-2">
                <Note tone={recheck.maxError <= 1 ? 'ok' : 'warn'}>
                  فحص المعايرة على كل الأيام الرسمية الحالية ({recheck.days} يوماً، منها {newOfficialSinceCalib} جديدة): مطابقة {recheck.exact}/{recheck.total}، أقصى فرق {recheck.maxError} دقيقة. {recheck.maxError > 1 ? 'يُنصح بإعادة المعايرة.' : ''}
                </Note>
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl border border-line p-3">
          <div className="mb-2 text-[13px] font-bold text-ink2">٢. التوليد</div>
          <div className="mb-2 text-[13px] text-ink">يُحسب لـ: <b>{target.label}</b> <span className="text-muted" dir="ltr">({target.lat.toFixed(4)}, {target.lng.toFixed(4)})</span></div>
          <div className="flex flex-col gap-2">
            <Toggle checked={cfg.calc.useMosqueCoords} onChange={(v) => void updateConfig((c) => { c.calc.useMosqueCoords = v; })}
              label="استخدام إحداثيات المسجد" hint="تُضبط من قسم «المسجد». جدول الوزارة يُحسب لمركز المدينة، لذا قد يختلف وقت المسجد عنه بدقيقة في الأطراف البعيدة." />
            <Toggle checked={cfg.calc.autoExtend} onChange={(v) => void updateConfig((c) => { c.calc.autoExtend = v; }).then(() => (v ? autoExtendIfNeeded(muscatDateKey(now())) : 0))}
              label="تمديد الجدول تلقائياً" hint="عند وجود معايرة: يبقى الجدول مملوءاً لأكثر من سنة قادمة دون رفع أي ملف. الأيام الرسمية لا تُستبدل." />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select value={String(year)} onChange={(v) => setYear(+v)} options={[thisYear, thisYear + 1, thisYear + 2].map((y) => ({ value: String(y), label: String(y) }))} />
            <Btn kind="primary" disabled={!profile} onClick={() => generate(`${year}-01-01`, `${year}-12-31`, `توليد الأيام الناقصة لسنة ${year}`)}>توليد الأيام الناقصة لسنة {year}</Btn>
          </div>
          {!profile && <p className="m-0 mt-2 text-[12px] text-muted">التوليد المعاير يتطلب معايرة أولاً.</p>}
          {schedule && (
            <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
              {counts.official ? <Badge tone="teal">رسمي {counts.official}</Badge> : null}
              {counts.calibrated ? <Badge tone="ink">محسوب معاير {counts.calibrated}</Badge> : null}
              {counts.calculated ? <Badge tone="saffron">محسوب غير معاير {counts.calculated}</Badge> : null}
              {counts.admin ? <Badge tone="muted">إدخال المشرف {counts.admin}</Badge> : null}
              {counts.demo ? <Badge tone="rose">DEMO {counts.demo}</Badge> : null}
            </div>
          )}
        </div>
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
      </div>
    </Card>
  );
}
