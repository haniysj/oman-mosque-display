/** Timetables stored in the system per wilayat, and which mosques use each one. */
import { useEffect, useState } from 'react';
import { locationLabel } from '../../domain/oman';
import { listMosques, listTimetables, useCloud, type MosqueSummary, type TimetableSummary } from '../../services/cloud';
import { useOnline } from '../../services/platform';
import { Badge, Btn, Card, Note } from './kit';
import { IconRestore, IconWifiOff } from '../common/icons';

const fmt = (iso: string) => { try { return new Date(iso).toLocaleString('ar-OM-u-nu-latn', { timeZone: 'Asia/Muscat', dateStyle: 'medium' }); } catch { return iso; } };

export function WilayatTablesCard({ currentWilayat }: { currentWilayat: string }) {
  const online = useOnline();
  const cloud = useCloud();
  const [tables, setTables] = useState<TimetableSummary[] | null>(null);
  const [mosques, setMosques] = useState<MosqueSummary[] | null>(null);
  const [err, setErr] = useState('');
  const refresh = async () => {
    setErr('');
    try { const [t, m] = await Promise.all([listTimetables(), listMosques()]); setTables(t); setMosques(m); } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (online) void refresh(); }, [online, cloud.timetableVersion]);

  // Wilayats that have mosques but no timetable yet
  const missing = mosques && tables ? [...new Map(mosques.filter((m) => !tables.some((t) => t.wilayat_id === m.wilayat_id)).map((m) => [m.wilayat_id, m])).values()] : [];
  const namesIn = (w: string) => (mosques ?? []).filter((m) => m.wilayat_id === w).map((m) => m.name_ar);

  return (
    <Card title="جداول الولايات المخزنة" actions={<Btn small kind="ghost" onClick={() => void refresh()} disabled={!online}><IconRestore size={14} />تحديث</Btn>}>
      <p className="m-0 mb-2 text-[13px] text-muted">لكل ولاية جدول واحد. عند إضافة مسجد واختيار ولايته يُربط تلقائياً بجدولها، وأي تحديث للجدول يصل لكل مساجد الولاية.</p>
      {!online && <Note tone="warn"><span className="inline-flex items-center gap-1.5"><IconWifiOff size={15} />القائمة تحتاج اتصالاً بالإنترنت. الجدول المحفوظ على هذا الجهاز يعمل كالمعتاد.</span></Note>}
      {err && <Note tone="error">{err}</Note>}
      {online && !tables && !err && <p className="m-0 text-[13px] text-muted">جارٍ التحميل…</p>}
      {tables && !tables.length && <p className="m-0 text-[13px] text-muted">لا توجد جداول مخزنة بعد. استورد جدول ولايتك هنا، ثم ارفعه من «المساجد والمزامنة» (أو يُرفع تلقائياً عند تسجيل دخول المشرف).</p>}
      {tables && tables.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-paper"><tr><th className="px-2 py-2 text-right">الولاية</th><th className="px-2 py-2">الأيام</th><th className="px-2 py-2">المعايرة</th><th className="px-2 py-2 text-right">المساجد المرتبطة</th><th className="px-2 py-2">آخر تحديث</th></tr></thead>
            <tbody>
              {tables.map((t) => {
                const names = namesIn(t.wilayat_id);
                return (
                  <tr key={t.wilayat_id} className={`border-t border-line text-center ${t.wilayat_id === currentWilayat ? 'bg-teal-soft/40' : ''}`}>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-bold">{locationLabel(t.governorate_id, t.wilayat_id)}{t.wilayat_id === currentWilayat && <span className="mr-1.5"><Badge tone="teal">هذا الجهاز</Badge></span>}</td>
                    <td className="px-2 py-2"><Badge tone={t.days >= 300 ? 'teal' : 'saffron'}>{t.days} يوماً</Badge></td>
                    <td className="px-2 py-2">{t.calibrated ? <Badge tone="teal">معايرة</Badge> : '—'}</td>
                    <td className="px-2 py-2 text-right">{names.length ? names.join('، ') : <span className="text-muted">لا يوجد</span>}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-muted">{fmt(t.updated_at)} · v{t.version}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {missing.length > 0 && (
        <div className="mt-2"><Note tone="warn">ولايات فيها مساجد دون جدول مخزن: {missing.map((m) => locationLabel(m.governorate_id, m.wilayat_id)).join('، ')}.</Note></div>
      )}
    </Card>
  );
}
