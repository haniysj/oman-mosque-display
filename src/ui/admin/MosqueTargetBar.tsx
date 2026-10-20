/**
 * «ملف المسجد» — per-mosque settings work like a profile:
 *  - outside a profile: a list of mosques, each with «دخول إلى ملف المسجد»;
 *  - inside: a clear banner on every per-mosque page («كل التعديلات تُحفظ لهذا المسجد فقط»)
 *    with «الخروج من ملف المسجد» — to edit another mosque you leave this one first.
 */
import { useEffect, useState } from 'react';
import { linkedCode, listMosques, useCloud, type MosqueSummary } from '../../services/cloud';
import { locationLabel } from '../../domain/oman';
import { useApp } from '../../store/appStore';
import { enterProfile, exitProfile, LOCAL, saveTarget, useEditState } from './editTarget';
import { Badge, Btn, Note } from './kit';
import { IconCheck, IconEnter, IconLogout, IconMosque } from '../common/icons';

interface Entry { code: string; name: string; place: string; here: boolean }

export function useProfileOpen(): boolean {
  return !!useEditState().target;
}
/** Name of the open mosque profile ('' when none). */
export function useProfileName(): string {
  const e = useEditState();
  const localName = useApp((s) => s.config.mosque.nameAr);
  const cloud = useCloud();
  if (!e.target) return '';
  if (e.target === LOCAL || e.target === linkedCode()) return localName || cloud.binding?.name || 'هذه الشاشة';
  return e.remote?.code === e.target ? e.remote.cfg.mosque.nameAr || e.target : '…';
}

export function MosqueTargetBar() {
  const cloud = useCloud();
  const e = useEditState();
  const localName = useApp((s) => s.config.mosque.nameAr);
  const localLoc = useApp((s) => s.config.mosque.location);
  const [mosques, setMosques] = useState<MosqueSummary[] | null>(null);
  const bound = linkedCode();
  const shown = cloud.binding?.code ?? null; // linked or only showing its times

  useEffect(() => {
    let off = false;
    listMosques().then((m) => { if (!off) setMosques(m); }).catch(() => { if (!off) setMosques([]); });
    return () => { off = true; };
  }, []);

  const allowed = (code: string) => cloud.role === 'super' || cloud.codes.includes(code);
  const entries: Entry[] = [];
  for (const m of mosques ?? []) if (allowed(m.code)) entries.push({ code: m.code, name: m.name_ar, place: locationLabel(m.governorate_id, m.wilayat_id), here: m.code === shown });
  if (bound && allowed(bound) && !entries.some((x) => x.code === bound)) entries.push({ code: bound, name: cloud.binding?.name || bound, place: locationLabel(localLoc.governorateId, localLoc.wilayatId), here: true });
  if (cloud.role === 'mosque') for (const c of cloud.codes) if (!entries.some((x) => x.code === c)) entries.push({ code: c, name: c, place: '', here: false });
  entries.sort((a, b) => Number(b.here) - Number(a.here));

  // a supervisor of a single mosque goes straight into its profile
  const only = cloud.role === 'mosque' && cloud.codes.length === 1 ? cloud.codes[0] : '';
  useEffect(() => { if (!e.target && only) void enterProfile(only); }, [e.target, only]);

  const nameOf = (code: string) => code === LOCAL ? (localName || 'هذه الشاشة') : entries.find((x) => x.code === code)?.name ?? (code === bound ? cloud.binding?.name : '') ?? code;
  const remote = !!e.target && e.target !== LOCAL && e.target !== bound;

  // ---------- outside any profile: choose a mosque ----------
  if (!e.target) {
    return (
      <section className="no-print mb-4 rounded-2xl border border-line bg-white p-4" aria-label="اختيار ملف المسجد">
        <h3 className="m-0 inline-flex items-center gap-2 text-[16px] font-extrabold"><IconMosque size={20} />اختر المسجد الذي تريد تعديل إعداداته</h3>
        <p className="m-0 mt-1 text-[13px] leading-6 text-ink2">إعدادات هذه الصفحة خاصة بكل مسجد (مثل الملف الشخصي): اضغط «دخول» على المسجد، وكل ما تعدّله يُحفظ له وحده. لتعديل مسجد آخر اخرج من الملف ثم ادخل إلى ملف المسجد الآخر.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {cloud.role === 'super' && !shown && (
            <ProfileCard testId="enter-local" name={`هذه الشاشة — ${localName || 'بدون اسم'}`} place="غير مرتبطة بمسجد · يُحفظ على هذا الجهاز فقط" onEnter={() => void enterProfile(LOCAL)} />
          )}
          {entries.map((x) => (
            <ProfileCard key={x.code} testId={`enter-${x.code}`} name={x.name} place={x.place} here={x.here} onEnter={() => void enterProfile(x.code)} />
          ))}
        </div>
        {mosques === null && <div className="mt-2"><Note>جارٍ تحميل قائمة المساجد…</Note></div>}
        {mosques !== null && entries.length === 0 && cloud.role !== 'super' && <div className="mt-2"><Note tone="warn">لا توجد مساجد متاحة لحسابك.</Note></div>}
      </section>
    );
  }

  // ---------- inside a profile ----------
  const status = e.saving ? <Badge tone="saffron">جارٍ الحفظ…</Badge>
    : e.error ? <Badge tone="rose">لم يُحفظ</Badge>
    : remote && e.remote?.dirty ? <Badge tone="saffron">تغييرات بانتظار الحفظ</Badge>
    : <Badge tone="teal"><IconCheck size={13} />محفوظ</Badge>;
  return (
    <section className="profile-bar no-print mb-4 rounded-2xl border-2 border-teal bg-teal-soft/60 p-3" aria-label="ملف المسجد" data-testid="profile-bar">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-teal text-white"><IconMosque size={22} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold text-teal">ملف المسجد</div>
          <div className="truncate text-[17px] font-extrabold text-ink" data-testid="profile-name">{nameOf(e.target)}</div>
        </div>
        {status}
        {remote && e.remote?.dirty && !e.saving && <Btn small kind="teal" onClick={() => void saveTarget()}><IconCheck size={14} />حفظ الآن</Btn>}
        {!only && <Btn small onClick={() => void exitProfile()} disabled={e.saving}><IconLogout size={15} />الخروج من ملف المسجد</Btn>}
      </div>
      <p className="m-0 mt-2 text-[12.5px] leading-6 text-ink2">
        <b className="text-ink">كل التعديلات في هذه الصفحات تُحفظ لهذا المسجد فقط</b>
        {e.target === LOCAL ? ' — على هذا الجهاز (الشاشة غير مرتبطة بمسجد).'
          : remote ? ' — تُحفظ تلقائياً وتصل إلى شاشاته خلال 5 دقائق أو عند فتحها.'
          : ' — مسجد هذه الشاشة: يُطبَّق التعديل فوراً ويُرفع لهذا المسجد وحده.'}
        {!only && ' لتعديل مسجد آخر اخرج من هذا الملف أولاً.'}
      </p>
      {e.loading && <div className="mt-2"><Note>جارٍ تحميل إعدادات المسجد…</Note></div>}
      {e.error && <div className="mt-2"><Note tone="error">{e.error} — لم تُفقد تعديلاتك، أعد المحاولة بـ«حفظ الآن».</Note></div>}
    </section>
  );
}

function ProfileCard({ name, place, here, onEnter, testId }: { name: string; place: string; here?: boolean; onEnter: () => void; testId: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-paper p-3">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-white text-teal"><IconMosque size={20} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-extrabold leading-6">{name}</div>
        <div className="flex flex-wrap items-center gap-1 text-[12px] text-muted">{place}{here && <Badge tone="teal">هذه الشاشة</Badge>}</div>
      </div>
      <button data-testid={testId} onClick={onEnter} title="دخول إلى ملف المسجد" aria-label={`دخول إلى ملف ${name}`} className="inline-flex h-9 flex-none items-center gap-1.5 rounded-xl border border-teal bg-teal px-3 text-[13px] font-bold text-white hover:brightness-110">
        <IconEnter size={15} />دخول
      </button>
    </div>
  );
}
