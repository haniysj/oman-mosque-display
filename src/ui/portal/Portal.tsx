/**
 * The main address (/): the general administrator's page — sign-in, then statistics of the
 * registered mosques and timetables. Prayer times are shown only on each mosque's own address.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { adminLogin, adminLoginOffline, adminLogout, getCloud, listMosquePasswords, listMosques, listTimetables, useCloud, type MosqueSummary, type TimetableSummary } from '../../services/cloud';
import { locationLabel } from '../../domain/oman';
import { IconAlert, IconCheck, IconClose, IconClock, IconEye, IconLock, IconLogout, IconMosque, IconRestore, IconSettings } from '../common/icons';

export function Portal({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const cloud = useCloud();
  const signedIn = cloud.admin && cloud.role === 'super';
  useEffect(() => { document.title = 'لوحة المشرف العام — مواقيت المساجد'; }, []);
  return (
    <div className="portal min-h-full bg-[#F3F1EA] font-[Cairo] text-ink" dir="rtl">
      <header className="bg-[#062A22] text-[#F5EBD3]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          <StarMark />
          <div className="min-w-0 flex-1">
            <div className="text-[19px] font-extrabold leading-7">منصة مواقيت المساجد</div>
            <div className="text-[13px] text-[#D4A845]">سلطنة عُمان · لوحة المشرف العام</div>
          </div>
          {signedIn && (
            <div className="flex flex-wrap gap-2">
              <button onClick={onOpenAdmin} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#D4A845] px-4 text-[14px] font-bold text-[#062A22] hover:brightness-105"><IconSettings size={16} />لوحة التحكم</button>
              <button onClick={adminLogout} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#D4A845]/50 px-3 text-[14px] font-bold text-[#F5EBD3] hover:bg-white/5"><IconLogout size={16} />خروج</button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {signedIn ? <Dashboard /> : <SignIn />}
      </main>
      <footer className="pb-6 text-center text-[12px] text-muted">مواقيت كل مسجد تُعرض فقط على رابطه الخاص: <span dir="ltr">/m/رمز-المسجد</span></footer>
    </div>
  );
}

function StarMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 120 120" aria-hidden>
      <rect x="30" y="30" width="60" height="60" rx="3" fill="none" stroke="#D4A845" strokeWidth="6" />
      <rect x="30" y="30" width="60" height="60" rx="3" fill="none" stroke="#D4A845" strokeWidth="6" transform="rotate(45 60 60)" />
      <circle cx="60" cy="60" r="12" fill="#D4A845" />
    </svg>
  );
}

// ------------------------------------------------------------------ sign-in (general administrator only)

function SignIn() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const tries = useRef(0);
  const submit = async (auto = false) => {
    const mine = ++tries.current;
    setBusy(true); setErr('');
    try {
      if (navigator.onLine === false) await adminLoginOffline(pw); else await adminLogin(pw);
      const role = getCloud().role;
      if (role !== 'super') { adminLogout(); throw new Error('هذه الصفحة للمشرف العام فقط — مشرف المسجد يدخل من رابط مسجده.'); }
    } catch (e) { if (mine === tries.current) { setErr((e as Error).message); if (!auto) setPw(''); } }
    finally { if (mine === tries.current) setBusy(false); }
  };
  useEffect(() => {
    if (pw.length < 4) return;
    const t = setTimeout(() => void submit(true), 700);
    return () => clearTimeout(t);
  }, [pw]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mx-auto mt-6 max-w-md rounded-3xl border border-line bg-white p-6 shadow-sm" data-testid="portal-signin">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#062A22] text-[#D4A845]"><IconLock size={20} /></span>
        <div>
          <h1 className="m-0 text-[20px] font-extrabold">دخول المشرف العام</h1>
          <p className="m-0 text-[13px] text-muted">إحصائيات المساجد المسجلة وإدارتها</p>
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (pw) void submit(); }}>
        <input autoFocus type="password" placeholder="كلمة المرور" value={pw} onChange={(e) => { setPw(e.target.value); setErr(''); }}
          className="h-12 w-full rounded-xl border border-line px-4 text-center text-[16px] outline-none focus:border-teal" />
        <button type="submit" disabled={!pw} className="mt-3 h-11 w-full rounded-xl bg-[#1F7A6D] text-[15px] font-bold text-white disabled:opacity-50">دخول</button>
      </form>
      {busy && !err && <p className="m-0 mt-2 text-center text-[12px] text-muted">جارٍ التحقق…</p>}
      {err && <p className="m-0 mt-2 text-center text-[13px] font-bold text-rose">{err}</p>}
      <p className="m-0 mt-4 text-center text-[12px] leading-5 text-muted">يتم الدخول تلقائياً بعد كتابة كلمة المرور الصحيحة. لا تُحفظ كلمة المرور على الجهاز.</p>
    </div>
  );
}

// ------------------------------------------------------------------ dashboard

const fmtDate = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(+d) ? '—' : new Intl.DateTimeFormat('ar-OM', { timeZone: 'Asia/Muscat', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
};

function Dashboard() {
  const [mosques, setMosques] = useState<MosqueSummary[] | null>(null);
  const [tables, setTables] = useState<TimetableSummary[] | null>(null);
  const [pwds, setPwds] = useState<Set<string> | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const [preview, setPreview] = useState<MosqueSummary | null>(null);
  const load = async () => {
    setErr('');
    try {
      const [m, t] = await Promise.all([listMosques(), listTimetables()]);
      setMosques(m); setTables(t);
      setPwds(new Set((await listMosquePasswords().catch(() => [])).map((x) => x.code)));
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);

  const stats = useMemo(() => {
    if (!mosques || !tables) return null;
    const wil = new Set(mosques.map((m) => m.wilayat_id));
    const gov = new Set(mosques.map((m) => m.governorate_id));
    const withTable = mosques.filter((m) => m.timetable_days > 0).length;
    const last = [...mosques.map((m) => m.updated_at), ...tables.map((t) => t.updated_at)].filter(Boolean).sort().pop() ?? '';
    return { count: mosques.length, wil: wil.size, gov: gov.size, withTable, tables: tables.length, days: tables.reduce((a, t) => a + t.days, 0), last };
  }, [mosques, tables]);

  const copy = (code: string) => {
    const url = `${location.origin}/m/${code}`;
    const done = () => { setCopied(code); setTimeout(() => setCopied(''), 1800); };
    try { void navigator.clipboard.writeText(url).then(done, done); } catch { done(); }
  };

  if (err) return <div className="rounded-2xl border border-rose/40 bg-white p-4 text-[14px] text-rose">{err} <button className="mr-2 underline" onClick={() => void load()}>إعادة المحاولة</button></div>;
  if (!mosques || !tables || !stats) return <p className="text-center text-[14px] text-muted">جارٍ تحميل الإحصائيات…</p>;
  const noTable = mosques.filter((m) => m.timetable_days === 0);
  const noPw = pwds ? mosques.filter((m) => !pwds.has(m.code)) : [];

  return (
    <div className="flex flex-col gap-5" data-testid="portal-dashboard">
      {preview && <ScreenPreview mosque={preview} onClose={() => setPreview(null)} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={<IconMosque size={20} />} label="المساجد المسجلة" value={stats.count} sub={`في ${stats.wil} ${stats.wil === 1 ? 'ولاية' : 'ولايات'} · ${stats.gov} ${stats.gov === 1 ? 'محافظة' : 'محافظات'}`} tone="#1F7A6D" testId="kpi-mosques" />
        <Kpi icon={<IconClock size={20} />} label="جداول الولايات" value={stats.tables} sub={`${stats.days.toLocaleString('ar-OM')} يوماً مخزّناً`} tone="#2563EB" />
        <Kpi icon={<IconCheck size={20} />} label="مساجد لها جدول مواقيت" value={`${stats.withTable}/${stats.count}`} sub={noTable.length ? `${noTable.length} بدون جدول` : 'كل المساجد جاهزة'} tone={noTable.length ? '#C9861A' : '#1F7A6D'} />
        <Kpi icon={<IconLock size={20} />} label="مشرفو المساجد" value={pwds ? `${stats.count - noPw.length}/${stats.count}` : '—'} sub={pwds ? (noPw.length ? `${noPw.length} بدون كلمة مرور` : 'لكل مسجد مشرف') : ''} tone="#7C3AED" />
      </div>

      {(noTable.length > 0 || noPw.length > 0) && (
        <div className="rounded-2xl border border-[#E8C766] bg-[#FFF8E1] p-3 text-[13px] leading-7 text-ink2">
          <div className="mb-1 inline-flex items-center gap-1.5 font-extrabold text-[#8A5A0B]"><IconAlert size={15} />تحتاج انتباهاً</div>
          {noTable.length > 0 && <div>بدون جدول مواقيت لولايتها: {noTable.map((m) => m.name_ar).join('، ')}</div>}
          {noPw.length > 0 && <div>بدون كلمة مرور مشرف: {noPw.map((m) => m.name_ar).join('، ')}</div>}
        </div>
      )}

      <section className="rounded-2xl border border-line bg-white">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="m-0 flex-1 text-[16px] font-extrabold">المساجد المسجلة</h2>
          <span className="text-[12px] text-muted">آخر تحديث: {fmtDate(stats.last)}</span>
          <button onClick={() => void load()} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2 text-[12px] font-bold text-ink2 hover:bg-paper"><IconRestore size={13} />تحديث</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <thead><tr className="bg-paper text-right text-[12px] text-muted">
              <th className="px-4 py-2 font-bold">المسجد</th><th className="px-2 py-2 font-bold">الولاية</th><th className="px-2 py-2 font-bold">جدول المواقيت</th>
              <th className="px-2 py-2 font-bold">مشرف المسجد</th><th className="px-2 py-2 font-bold">آخر تعديل</th><th className="px-4 py-2 font-bold">الرابط</th>
            </tr></thead>
            <tbody>
              {mosques.map((m) => (
                <tr key={m.code} className="border-t border-line" data-testid={`portal-row-${m.code}`}>
                  <td className="px-4 py-2.5"><b>{m.name_ar}</b><div className="text-[11px] text-muted" dir="ltr">{m.code}</div></td>
                  <td className="px-2 py-2.5">{locationLabel(m.governorate_id, m.wilayat_id)}</td>
                  <td className="px-2 py-2.5">{m.timetable_days > 0 ? <Pill ok>{m.timetable_days.toLocaleString('ar-OM')} يوماً</Pill> : <Pill>لا يوجد</Pill>}</td>
                  <td className="px-2 py-2.5">{pwds ? (pwds.has(m.code) ? <Pill ok>محددة</Pill> : <Pill>غير محددة</Pill>) : '—'}</td>
                  <td className="px-2 py-2.5 text-ink2">{fmtDate(m.updated_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1.5">
                      <a href={`/m/${m.code}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-lg bg-[#1F7A6D] px-2.5 text-[12px] font-bold text-white">فتح</a>
                      <button onClick={() => copy(m.code)} className="inline-flex h-8 items-center rounded-lg border border-line px-2.5 text-[12px] font-bold text-ink2 hover:bg-paper">{copied === m.code ? 'نُسخ ✓' : 'نسخ الرابط'}</button>
                      <button onClick={() => setPreview(m)} title={`معاينة شاشة ${m.name_ar}`} aria-label={`معاينة شاشة ${m.name_ar}`} data-testid={`preview-${m.code}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#2563EB]/40 bg-[#EEF4FF] text-[#2563EB] hover:bg-[#E0EBFF]"><IconEye size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!mosques.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">لا توجد مساجد بعد — أضفها من «لوحة التحكم ← المساجد والمزامنة».</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-4 py-3"><h2 className="m-0 text-[16px] font-extrabold">جداول مواقيت الولايات</h2></div>
        <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map((t) => (
            <div key={t.wilayat_id} className="rounded-xl border border-line bg-paper p-3">
              <div className="font-extrabold">{locationLabel(t.governorate_id, t.wilayat_id)}</div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[12px]">
                <Pill ok>{t.days.toLocaleString('ar-OM')} يوماً</Pill>
                {t.calibrated && <Pill ok>معاير</Pill>}
                <span className="rounded-full bg-white px-2 py-0.5 text-ink2">{t.mosques} {t.mosques === 1 ? 'مسجد' : 'مساجد'}</span>
              </div>
              <div className="mt-1 text-[11.5px] text-muted">آخر تحديث: {fmtDate(t.updated_at)}</div>
            </div>
          ))}
          {!tables.length && <p className="m-0 p-2 text-[13px] text-muted">لم يُرفع أي جدول بعد.</p>}
        </div>
      </section>
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone, testId }: { icon: ReactNode; label: string; value: ReactNode; sub?: string; tone: string; testId?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4" data-testid={testId}>
      <div className="flex items-center gap-2 text-[13px] font-bold text-ink2"><span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: tone }}>{icon}</span>{label}</div>
      <div className="mt-2 text-[28px] font-extrabold leading-9" style={{ color: tone }}>{value}</div>
      {sub && <div className="text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

function Pill({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-bold ${ok ? 'bg-teal-soft text-teal' : 'bg-[#FDECEA] text-rose'}`}>{children}</span>;
}

/** «معاينة الشاشة»: the mosque's real screen inside a frame (TV 1920×1080 or phone), scaled to fit. */
function ScreenPreview({ mosque, onClose }: { mosque: MosqueSummary; onClose: () => void }) {
  const [device, setDevice] = useState<'tv' | 'phone'>('tv');
  const [vp, setVp] = useState({ w: innerWidth, h: innerHeight });
  useEffect(() => {
    const f = () => setVp({ w: innerWidth, h: innerHeight });
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('resize', f); addEventListener('keydown', k);
    return () => { removeEventListener('resize', f); removeEventListener('keydown', k); };
  }, [onClose]);
  const [w, h] = device === 'tv' ? [1920, 1080] : [390, 844];
  const scale = Math.min((vp.w - 48) / w, (vp.h - 120) / h, 1);
  const tab = (d: 'tv' | 'phone', label: string) => (
    <button onClick={() => setDevice(d)} className={`h-8 rounded-lg px-3 text-[13px] font-bold ${device === d ? 'bg-[#D4A845] text-[#062A22]' : 'text-[#F5EBD3] hover:bg-white/10'}`}>{label}</button>
  );
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center bg-[#041C17] p-4" role="dialog" aria-label={`معاينة شاشة ${mosque.name_ar}`} data-testid="screen-preview">
      <div className="mb-3 flex w-full max-w-5xl flex-wrap items-center gap-2 text-[#F5EBD3]">
        <IconEye size={18} />
        <b className="text-[16px]">معاينة شاشة {mosque.name_ar}</b>
        <span className="flex-1" />
        <div className="flex gap-1 rounded-xl border border-[#D4A845]/40 p-1">{tab('tv', 'شاشة تلفاز')}{tab('phone', 'هاتف')}</div>
        <a href={`/m/${mosque.code}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-lg border border-[#D4A845]/50 px-3 text-[13px] font-bold text-[#F5EBD3] hover:bg-white/10">فتح في نافذة</a>
        <button onClick={onClose} aria-label="إغلاق المعاينة" className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"><IconClose size={18} /></button>
      </div>
      <div dir="ltr" style={{ width: w * scale, height: h * scale, position: 'relative' }} className={`overflow-hidden bg-black shadow-2xl ${device === 'phone' ? 'rounded-[28px] ring-4 ring-[#1f2a2a]' : 'rounded-lg ring-1 ring-[#D4A845]/30'}`}>
        <iframe key={device} title={`شاشة ${mosque.name_ar}`} src={`/m/${mosque.code}`} style={{ position: 'absolute', left: 0, top: 0, display: 'block', width: w, height: h, maxWidth: 'none', maxHeight: 'none', border: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
      </div>
      <p className="m-0 mt-2 text-[12px] text-[#F5EBD3]/60">هذه هي الشاشة الحقيقية للمسجد كما تظهر الآن ({w}×{h}).</p>
    </div>
  );
}
