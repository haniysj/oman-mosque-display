/**
 * Edit a mosque's details (name, wilayat, logo, coordinates) — replaces the old «المسجد» tab.
 * Cloud mosques are edited in the cloud (admin only); an unlinked device edits its local copy.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AppConfig } from '../../domain/types';
import { GOVERNORATES, findGovernorate, locationLabel } from '../../domain/oman';
import type { TimetableSummary } from '../../services/cloud';
import { Badge, Btn, Field, Grid, Note, Select } from './kit';
import { IconClose, IconTrash, IconUpload } from '../common/icons';

type MosqueDraft = AppConfig['mosque'];
const inputCls = 'h-11 w-full rounded-xl border border-line bg-white px-3 text-[15px] text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal-soft';

/** Shows whether the chosen wilayat already has a timetable stored in the system. */
export function WilayatTimetableHint({ tables, governorateId, wilayatId }: { tables: TimetableSummary[] | null; governorateId: string; wilayatId: string }) {
  if (!tables) return null;
  const t = tables.find((x) => x.wilayat_id === wilayatId);
  const label = locationLabel(governorateId, wilayatId);
  return t
    ? <Note tone="ok">يرتبط المسجد تلقائياً بجدول ولاية {label} المخزن: {t.days} يوماً{t.calibrated ? '، مع معايرة' : ''} (الإصدار v{t.version}).</Note>
    : <Note tone="warn">لا يوجد جدول مخزن لولاية {label} بعد. سيُربط المسجد به تلقائياً بمجرد رفعه من صفحة «جدول المواقيت».</Note>;
}

export function MosqueEditor({ title, initial, tables, busy, onSave, onClose, codeLabel }: {
  title: string; initial: MosqueDraft; tables: TimetableSummary[] | null; busy: boolean; codeLabel?: string;
  onSave: (m: MosqueDraft) => void; onClose: () => void;
}) {
  const [m, setM] = useState<MosqueDraft>(() => JSON.parse(JSON.stringify(initial)) as MosqueDraft);
  const [err, setErr] = useState('');
  const [geo, setGeo] = useState('');
  const wilayats = useMemo(() => findGovernorate(m.location.governorateId)?.wilayats ?? [], [m.location.governorateId]);
  const set = (patch: Partial<MosqueDraft>) => setM((x) => ({ ...x, ...patch }));
  const setLoc = (patch: Partial<MosqueDraft['location']>) => setM((x) => ({ ...x, location: { ...x.location, ...patch } }));
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

  const onLogo = (f?: File) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(f.type)) { setErr('الصيغ المسموحة للشعار: PNG أو JPG أو SVG أو WebP'); return; }
    if (f.size > 600 * 1024) { setErr('حجم الشعار أكبر من 600 كيلوبايت — صغّر الصورة ثم أعد المحاولة'); return; }
    const r = new FileReader();
    r.onload = () => { setErr(''); set({ logoDataUrl: String(r.result) }); };
    r.readAsDataURL(f);
  };
  const locate = () => {
    if (!navigator.geolocation) { setErr('هذا المتصفح لا يدعم تحديد الموقع — أدخل الإحداثيات يدوياً.'); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude: la, longitude: lo, accuracy } = pos.coords;
      if (la < 16 || la > 27 || lo < 51 || lo > 60) { setErr('الموقع الحالي خارج سلطنة عُمان — لم يُحفظ.'); return; }
      setErr(''); setLoc({ customLat: +la.toFixed(5), customLng: +lo.toFixed(5) }); setGeo(`دقة الموقع ±${Math.round(accuracy)} م`);
    }, (e) => setErr(`تعذّر تحديد الموقع: ${e.message}`), { enableHighAccuracy: true, timeout: 15000 });
  };
  const num = (v: string, lo: number, hi: number) => { const n = parseFloat(v); return Number.isFinite(n) && n > lo && n < hi ? n : null; };
  const valid = m.nameAr.trim().length >= 2;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-ink/50 p-3" role="dialog" aria-modal aria-label={title} onClick={onClose}>
      <div className="my-6 w-full max-w-2xl rounded-2xl bg-white p-4 shadow-xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="m-0 flex items-center gap-2 text-[18px] font-extrabold text-ink">{title}{codeLabel && <span className="rounded-full bg-paper px-2.5 py-0.5 text-[12px] font-bold text-ink2" dir="ltr">{codeLabel}</span>}</h3>
          <button className="rounded-lg p-1.5 text-muted hover:bg-paper" onClick={onClose} aria-label="إغلاق"><IconClose size={18} /></button>
        </div>
        <div className="flex flex-col gap-3">
          <Grid>
            <Field label="اسم المسجد بالعربية" hint="يظهر أعلى الشاشة." wide><input className={inputCls} value={m.nameAr} maxLength={90} onChange={(e) => set({ nameAr: e.target.value })} /></Field>
            <Field label="الاسم بالإنجليزية (اختياري)" wide><input className={inputCls} dir="ltr" value={m.nameEn} maxLength={90} onChange={(e) => set({ nameEn: e.target.value })} /></Field>
            <Field label="المحافظة"><Select value={m.location.governorateId} options={GOVERNORATES.map((g) => ({ value: g.id, label: g.ar }))} onChange={(v) => setLoc({ governorateId: v, wilayatId: findGovernorate(v)!.wilayats[0].id })} /></Field>
            <Field label="الولاية"><Select value={m.location.wilayatId} options={wilayats.map((w) => ({ value: w.id, label: w.ar }))} onChange={(v) => setLoc({ wilayatId: v })} /></Field>
          </Grid>
          <WilayatTimetableHint tables={tables} governorateId={m.location.governorateId} wilayatId={m.location.wilayatId} />

          <div className="rounded-xl border border-line p-3">
            <div className="mb-2 text-[14px] font-bold text-ink">الشعار (اختياري)</div>
            <div className="flex flex-wrap items-center gap-2">
              {m.logoDataUrl ? <img src={m.logoDataUrl} alt="الشعار" className="h-14 w-auto rounded-lg border border-line bg-[#0B3D30] p-1.5" /> : <span className="text-[13px] text-muted">لا يوجد شعار</span>}
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3 text-[13px] font-bold text-ink hover:border-ink2">
                <IconUpload size={15} />رفع شعار
                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="sr-only" onChange={(e) => { onLogo(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {m.logoDataUrl && <Btn small kind="danger" onClick={() => set({ logoDataUrl: '' })}><IconTrash size={14} />إزالة</Btn>}
            </div>
          </div>

          <div className="rounded-xl border border-line p-3">
            <div className="mb-1 text-[14px] font-bold text-ink">إحداثيات المسجد (اختياري)</div>
            <p className="m-0 mb-2 text-[12px] text-muted">تُستخدم في التوليد المعاير فقط عند تفعيل «استخدام إحداثيات المسجد». اتركها فارغة لاستخدام مركز الولاية.</p>
            <Grid>
              <Field label="خط العرض"><input className={inputCls} dir="ltr" placeholder="23.588" defaultValue={m.location.customLat ?? ''} key={`la${m.location.customLat}`} onBlur={(e) => setLoc({ customLat: num(e.target.value, 16, 27) })} /></Field>
              <Field label="خط الطول"><input className={inputCls} dir="ltr" placeholder="58.383" defaultValue={m.location.customLng ?? ''} key={`lo${m.location.customLng}`} onBlur={(e) => setLoc({ customLng: num(e.target.value, 51, 60) })} /></Field>
            </Grid>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Btn small onClick={locate}>استخدام موقعي الحالي (وأنا في المسجد)</Btn>
              {(m.location.customLat != null || m.location.customLng != null) && <Btn small kind="ghost" onClick={() => setLoc({ customLat: null, customLng: null })}>مسح</Btn>}
              {geo && <Badge tone="teal">{geo}</Badge>}
            </div>
          </div>

          {err && <Note tone="error">{err}</Note>}
          <div className="flex justify-end gap-2">
            <Btn onClick={onClose}>إلغاء</Btn>
            <Btn kind="primary" disabled={busy || !valid} onClick={() => onSave({ ...m, nameAr: m.nameAr.trim(), nameEn: m.nameEn.trim() })}>حفظ</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
