/**
 * «جدول المواقيت» for one mosque: its wilayat's timetable, viewable and editable day by day.
 * Every change is stored as this mosque's own change (config.timeOverrides) — the wilayat table and
 * the other mosques of the wilayat are never touched.
 */
import { useMemo } from 'react';
import type { DailyPrayerTimes, PrayerSchedule, TimeKey } from '../../domain/types';
import { TIME_KEYS } from '../../domain/types';
import { withMosqueTimes } from '../../core/iqamah';
import { muscatDateKey } from '../../core/time';
import { now } from '../../services/clock';
import { locationLabel } from '../../domain/oman';
import { editConfig, useEditCfg, useEditReady, useEditSchedule } from './editTarget';
import { Viewer } from './TimetableSection';
import { Badge, Btn, Card, Note, useConfirm } from './kit';

type Fields = TimeKey | 'jumuah';

export function MosqueTimesSection() {
  const cfg = useEditCfg();
  const base = useEditSchedule();
  const ready = useEditReady();
  const { ask, ui } = useConfirm();
  const overrides = cfg.timeOverrides ?? {};
  const today = muscatDateKey(now());

  // the mosque's effective timetable = wilayat table + this mosque's own changes
  const effective = useMemo<PrayerSchedule | null>(() => {
    if (!base) return null;
    const days: PrayerSchedule['days'] = { ...base.days };
    for (const d of Object.keys(overrides)) if (days[d]) days[d] = { ...withMosqueTimes(days[d], cfg), source: 'admin' };
    return { ...base, days };
  }, [base, overrides, cfg]);

  if (!ready) return null;
  const loc = cfg.mosque.location;
  const count = Object.keys(overrides).length;

  const saveDay = async (rec: DailyPrayerTimes) => {
    const b = base?.days[rec.date];
    if (!b) throw new Error('لا يوجد جدول للولاية لهذا اليوم — لا يمكن تعديله للمسجد');
    const diff: Partial<Record<Fields, string>> = {};
    for (const k of [...TIME_KEYS, 'jumuah'] as Fields[]) {
      const v = rec[k];
      if (v && v !== b[k]) diff[k] = v;
    }
    editConfig((c) => {
      const next = { ...(c.timeOverrides ?? {}) };
      if (Object.keys(diff).length) next[rec.date] = diff; else delete next[rec.date];
      c.timeOverrides = next;
    });
  };
  const resetDay = (date: string) => editConfig((c) => { const next = { ...(c.timeOverrides ?? {}) }; delete next[date]; c.timeOverrides = next; });

  return (
    <div className="flex flex-col gap-4">
      {ui}
      <Card title="مواقيت هذا المسجد" actions={count ? <Badge tone="saffron">{count} يوماً معدّلاً لهذا المسجد</Badge> : <Badge tone="teal">مطابق لجدول الولاية</Badge>}>
        <Note>المواقيت هنا هي جدول ولاية {locationLabel(loc.governorateId, loc.wilayatId)}. أي تعديل تجريه يصبح خاصاً بهذا المسجد فقط — لا يتغيّر جدول الولاية ولا مواقيت المساجد الأخرى. وعند رفع جدول جديد للولاية يأخذه هذا المسجد تلقائياً، وتبقى الأيام التي عدّلتها هنا كما هي.</Note>
        {count > 0 && (
          <div className="mt-3">
            <Btn small kind="danger" onClick={() => ask(`إلغاء كل تعديلات المسجد (${count} يوماً) والعودة لجدول الولاية؟`, () => editConfig((c) => { c.timeOverrides = {}; }))}>إلغاء كل تعديلات المسجد</Btn>
          </div>
        )}
      </Card>
      {!effective
        ? <Note tone="warn">لا يوجد جدول مواقيت لولاية هذا المسجد بعد — يضيفه المشرف العام من «جدول المواقيت».</Note>
        : <Viewer schedule={effective} today={today} title={cfg.mosque.nameAr} disabled={false} onSaveDay={saveDay}
            heading="عرض المواقيت وتعديلها" marked={(d) => !!overrides[d]} onResetDay={resetDay}
            legend={<span className="inline-flex items-center gap-1"><span className="rounded-full bg-[#7C3AED] px-1.5 text-[10px] font-bold text-white">المسجد</span>معدّل لهذا المسجد</span>} />}
    </div>
  );
}
