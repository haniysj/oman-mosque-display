/** «المسجد الذي تعدّله»: shown above every per-mosque settings page, with Save for another mosque. */
import { useEffect, useState } from 'react';
import { listMosques, useCloud, type MosqueSummary } from '../../services/cloud';
import { locationLabel } from '../../domain/oman';
import { useApp } from '../../store/appStore';
import { discardTarget, ensureTarget, LOCAL, saveTarget, selectTarget, useEditState } from './editTarget';
import { Badge, Btn, Note, Select } from './kit';
import { IconCheck, IconMosque } from '../common/icons';

export function MosqueTargetBar() {
  const cloud = useCloud();
  const e = useEditState();
  const localName = useApp((s) => s.config.mosque.nameAr);
  const [mosques, setMosques] = useState<MosqueSummary[] | null>(null);
  const bound = cloud.binding?.code ?? null;

  useEffect(() => { if (!e.target) ensureTarget(); }, [e.target]);
  useEffect(() => {
    let off = false;
    listMosques().then((m) => { if (!off) setMosques(m); }).catch(() => { if (!off) setMosques([]); });
    return () => { off = true; };
  }, []);

  const nameOf = (code: string) => mosques?.find((m) => m.code === code)?.name_ar ?? (code === bound ? cloud.binding?.name : '') ?? code;
  const allowed = (code: string) => cloud.role === 'super' || cloud.codes.includes(code);
  const options = [
    ...(cloud.role === 'super' && !bound ? [{ value: LOCAL, label: `هذه الشاشة — ${localName || 'بدون اسم'} (غير مرتبطة)` }] : []),
    ...(bound && allowed(bound) && !(mosques ?? []).some((m) => m.code === bound) ? [{ value: bound, label: `${cloud.binding?.name || bound} (هذه الشاشة)` }] : []),
    ...(mosques ?? []).filter((m) => allowed(m.code)).map((m) => ({ value: m.code, label: `${m.name_ar} — ${locationLabel(m.governorate_id, m.wilayat_id)}${m.code === bound ? ' (هذه الشاشة)' : ''}` })),
    ...(cloud.role === 'mosque' ? cloud.codes.filter((c) => !(mosques ?? []).some((m) => m.code === c) && c !== bound).map((c) => ({ value: c, label: c })) : []),
  ];
  const remote = e.target && e.target !== LOCAL && e.target !== bound;
  const pick = (v: string) => {
    if (e.remote?.dirty && !window.confirm('توجد تغييرات غير محفوظة على هذا المسجد. هل تريد تجاهلها؟')) return;
    void selectTarget(v);
  };

  return (
    <>
      <section className="no-print mb-4 rounded-2xl border border-teal/40 bg-white p-3" aria-label="المسجد الذي تعدّله">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[14px] font-extrabold text-ink"><IconMosque size={18} />المسجد الذي تعدّله:</span>
          <div className="min-w-[220px] flex-1">
            <Select value={e.target || ''} onChange={pick} options={options.length ? options : [{ value: e.target || '', label: '…' }]} />
          </div>
          {cloud.role === 'mosque' && <Badge tone="saffron">مشرف المسجد</Badge>}
          {cloud.role === 'super' && <Badge tone="teal">المشرف العام</Badge>}
        </div>
        <p className="m-0 mt-2 text-[12px] leading-5 text-ink2">
          {remote
            ? <>تعدّل «{nameOf(e.target)}» — ليس مسجد هذه الشاشة. اضغط «حفظ» لإرسال التعديل إليه وحده.</>
            : e.target === LOCAL
              ? 'هذه الشاشة غير مرتبطة بمسجد — التعديل يُحفظ على هذا الجهاز فقط.'
              : <>تعدّل مسجد هذه الشاشة «{nameOf(e.target)}». يُحفظ كل تغيير فوراً ويُرفع لهذا المسجد وحده.</>}
          {' '}الإقامة والجمعة والعرض والسمة والأذكار لكل مسجد على حدة.
        </p>
        {e.loading && <div className="mt-2"><Note>جارٍ تحميل إعدادات المسجد…</Note></div>}
        {e.error && <div className="mt-2"><Note tone="error">{e.error}</Note></div>}
        {e.msg && <div className="mt-2"><Note tone="ok">{e.msg}</Note></div>}
      </section>
      {remote && e.remote && (
        <div className="no-print fixed inset-x-0 bottom-3 z-20 flex justify-center px-3" data-testid="save-bar">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white/95 p-3 shadow-lg backdrop-blur">
            <Btn kind="primary" disabled={!e.remote.dirty || e.saving} onClick={() => void saveTarget()}><IconCheck size={16} />{e.saving ? 'جارٍ الحفظ…' : `حفظ «${nameOf(e.remote.code)}»`}</Btn>
            <Btn disabled={!e.remote.dirty || e.saving} onClick={discardTarget}>تجاهل التغييرات</Btn>
            {e.remote.dirty ? <Badge tone="saffron">تغييرات غير محفوظة</Badge> : <Badge tone="teal">محفوظ</Badge>}
          </div>
        </div>
      )}
    </>
  );
}
