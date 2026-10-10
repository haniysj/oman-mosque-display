/** Phone / screen mosque picker: choose a stored mosque; its settings and its wilayat's timetable are downloaded and kept for offline use. */
import { useEffect, useMemo, useState } from 'react';
import { GOVERNORATES, locationLabel } from '../../domain/oman';
import { bindDevice, listMosques, type MosqueSummary } from '../../services/cloud';
import { useOnline } from '../../services/platform';

const LS_LIST = 'omd-cloud-mosque-list';

export function MosquePicker({ current, onClose }: { current: string | null; onClose: () => void }) {
  const online = useOnline();
  const [list, setList] = useState<MosqueSummary[] | null>(() => { try { return JSON.parse(localStorage.getItem(LS_LIST) || 'null'); } catch { return null; } });
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    listMosques()
      .then((l) => { setList(l); try { localStorage.setItem(LS_LIST, JSON.stringify(l)); } catch { /* ignore */ } })
      .catch((e) => setErr((e as Error).message));
  }, [online]);

  const groups = useMemo(() => {
    const term = q.trim();
    const items = (list ?? []).filter((m) => !term || m.name_ar.includes(term) || locationLabel(m.governorate_id, m.wilayat_id).includes(term));
    const order = GOVERNORATES.map((g) => g.id);
    const map = new Map<string, MosqueSummary[]>();
    for (const m of items) { const k = locationLabel(m.governorate_id, m.wilayat_id); map.set(k, [...(map.get(k) ?? []), m]); }
    return [...map.entries()].sort((a, b) => order.indexOf(a[1][0].governorate_id) - order.indexOf(b[1][0].governorate_id) || a[0].localeCompare(b[0], 'ar'));
  }, [list, q]);

  const choose = async (m: MosqueSummary) => {
    if (!online) { setErr('اختيار المسجد يحتاج اتصالاً بالإنترنت لتنزيل مواقيته'); return; }
    setBusy(m.code); setErr('');
    const ok = await bindDevice(m.code, m.name_ar);
    setBusy(null);
    if (ok || current === m.code) onClose(); else setErr('تعذّر تنزيل بيانات المسجد — حاول مرة أخرى');
  };

  return (
    <div className="mp-backdrop" role="dialog" aria-modal aria-label="اختيار المسجد" onClick={onClose}>
      <div className="mp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mp-head">
          <b>اختيار المسجد</b>
          <button className="mp-close" onClick={onClose} aria-label="إغلاق">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <input className="mp-search" placeholder="ابحث باسم المسجد أو الولاية" value={q} onChange={(e) => setQ(e.target.value)} />
        {!online && <div className="mp-note">لا يوجد اتصال بالإنترنت — تظهر آخر قائمة محفوظة، والاختيار يحتاج اتصالاً.</div>}
        {err && <div className="mp-note mp-note--err">{err}</div>}
        <div className="mp-list">
          {list === null ? <div className="mp-empty">جارٍ التحميل…</div>
            : !groups.length ? <div className="mp-empty">{q ? 'لا توجد نتائج' : 'لا توجد مساجد مسجلة بعد'}</div>
            : groups.map(([label, items]) => (
              <section key={label}>
                <div className="mp-group">{label}</div>
                {items.map((m) => (
                  <button key={m.code} className={`mp-item ${current === m.code ? 'is-current' : ''}`} disabled={!!busy} onClick={() => void choose(m)}>
                    <span className="mp-name">{m.name_ar}</span>
                    <span className="mp-meta">
                      {busy === m.code ? 'جارٍ التنزيل…' : current === m.code ? 'المسجد الحالي ✓' : m.timetable_days ? `${m.timetable_days} يوماً من المواقيت` : 'لا يوجد جدول لهذه الولاية بعد'}
                    </span>
                  </button>
                ))}
              </section>
            ))}
        </div>
        <p className="mp-foot">تُحفظ مواقيت المسجد المختار على هذا الجهاز وتعمل دون إنترنت، وتتحدث تلقائياً عند الاتصال.</p>
      </div>
    </div>
  );
}
