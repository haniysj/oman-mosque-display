import { useEffect, useState, type ReactNode } from 'react';
import type { PrayerKey } from '../../domain/types';
import { buildDayPlan } from '../../core/iqamah';
import { coverage } from '../../core/timetable';
import { muscatDateKey, addDays, weekdayOf } from '../../core/time';
import { useApp } from '../../store/appStore';
import { now, startSimulation } from '../../services/clock';
import { useOnline } from '../../services/platform';
import { usePwaStatus } from '../../services/pwa';
import { BrandMark, IconClose, IconLock, IconWifi, IconWifiOff, IconAlert } from '../common/icons';
import { Badge, Btn, Note } from './kit';
import { TimetableSection, SOURCE_AR, sourceTone } from './TimetableSection';
import { FridaySection, HijriSection, IqamahSection, QuietSection } from './PrayerSections';
import { AdhkarSection, BackupSection, DiagnosticsSection, DisplaySection } from './OtherSections';
import { CloudSection } from './CloudSection';
import { adminInit, adminLogin, adminLoginOffline, adminStatus, hasOfflineVerifier, useCloud } from '../../services/cloud';

const TABS = [
  { id: 'cloud', label: 'المساجد والمزامنة' },
  { id: 'timetable', label: 'جدول المواقيت' },
  { id: 'iqamah', label: 'الإقامة' },
  { id: 'friday', label: 'الجمعة' },
  { id: 'hijri', label: 'التاريخ الهجري' },
  { id: 'quiet', label: 'الشاشة السوداء والأذكار' },
  { id: 'adhkar', label: 'الأذكار' },
  { id: 'display', label: 'العرض' },
  { id: 'backup', label: 'النسخ الاحتياطي' },
  { id: 'diagnostics', label: 'التشخيص' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function Admin({ onClose }: { onClose: () => void }) {
  const cloud = useCloud();
  // The settings are shown only after the administrator password is entered (kept in memory only).
  if (!cloud.admin) return <AdminGate onClose={onClose} />;
  return <AdminPanel onClose={onClose} />;
}

function AdminGate({ onClose }: { onClose: () => void }) {
  const online = useOnline();
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!online) { setInitialized(true); return; }
    adminStatus().then((st) => setInitialized(st.initialized)).catch(() => setInitialized(true));
  }, [online]);

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      if (initialized === false) {
        if (pw.length < 6) throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
        if (pw !== pw2) throw new Error('كلمتا المرور غير متطابقتين');
        await adminInit(pw);
      } else if (!online) {
        await adminLoginOffline(pw);
      } else {
        try { await adminLogin(pw); } catch (e) {
          // server unreachable → fall back to the verifier saved at the last online sign-in
          if (/الخادم|مهلة/.test((e as Error).message) && hasOfflineVerifier()) await adminLoginOffline(pw); else throw e;
        }
      }
    } catch (e) { setErr((e as Error).message); setPw(''); } finally { setBusy(false); }
  };

  const first = initialized === false;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-ink/85 p-4 font-cairo" dir="rtl" role="dialog" aria-modal aria-label="دخول المشرف">
      <form className="w-full max-w-sm rounded-2xl bg-white p-5 text-center" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-paper text-ink"><IconLock size={22} /></div>
        <h2 className="m-0 mb-1 text-[18px] font-extrabold text-ink">دخول المشرف</h2>
        <p className="m-0 mb-3 text-[13px] text-muted">{first ? 'أول استخدام: أنشئ كلمة مرور المشرف لحماية الإعدادات.' : 'أدخل كلمة مرور المشرف لفتح الإعدادات.'}</p>
        {initialized === null ? <p className="m-0 text-[13px] text-muted">جارٍ التحقق…</p> : (
          <>
            <input autoFocus className="h-12 w-full rounded-xl border border-line px-3 text-center text-[16px]" dir="ltr" type="password" autoComplete={first ? 'new-password' : 'current-password'}
              placeholder={first ? 'كلمة المرور (6 أحرف على الأقل)' : 'كلمة مرور المشرف'} value={pw} onChange={(e) => { setErr(''); setPw(e.target.value); }} />
            {first && <input className="mt-2 h-12 w-full rounded-xl border border-line px-3 text-center text-[16px]" dir="ltr" type="password" autoComplete="new-password" placeholder="تأكيد كلمة المرور" value={pw2} onChange={(e) => setPw2(e.target.value)} />}
            {!online && <p className="m-0 mt-2 text-[12px] text-ink2">{hasOfflineVerifier() ? 'لا يوجد إنترنت — يتم التحقق على الجهاز.' : 'لا يوجد إنترنت — أول دخول على هذا الجهاز يحتاج اتصالاً.'}</p>}
            {err && <p className="m-0 mt-2 text-[13px] font-bold text-rose">{err}</p>}
          </>
        )}
        <div className="mt-4 flex justify-center gap-2">
          <Btn onClick={onClose}>رجوع</Btn>
          <Btn kind="primary" type="submit" disabled={busy || !pw || initialized === null}>{first ? 'إنشاء والدخول' : 'دخول'}</Btn>
        </div>
        <p className="m-0 mt-3 text-[11px] text-muted">كلمة المرور لا تُحفظ على الجهاز، وتُطلب من جديد عند إعادة تحميل الصفحة.</p>
      </form>
    </div>
  );
}

function useAdminWarnings(): { tone: 'warn' | 'error'; text: string; tab: TabId }[] {
  const cfg = useApp((s) => s.config);
  const schedule = useApp((s) => s.schedule);
  const today = muscatDateKey(now());
  const out: { tone: 'warn' | 'error'; text: string; tab: TabId }[] = [];
  const cov = coverage(schedule, today);
  if (!schedule) out.push({ tone: 'error', text: 'لا يوجد جدول مواقيت — الشاشة لا تعرض أوقات الصلاة.', tab: 'timetable' });
  else if (!cov.coversToday) out.push({ tone: 'error', text: `الجدول لا يغطي تاريخ اليوم (${today}).`, tab: 'timetable' });
  else if (cov.daysRemaining < 30) out.push({ tone: 'warn', text: `الجدول ينتهي بعد ${cov.daysRemaining} يوماً.`, tab: 'timetable' });
  if (schedule?.meta.source === 'demo') out.push({ tone: 'error', text: 'الجدول الحالي بيانات تجريبية (DEMO) وليس مواقيت رسمية.', tab: 'timetable' });
  if (schedule?.meta.source === 'calculated') out.push({ tone: 'warn', text: 'الجدول الحالي محسوب تقديرياً وليس جدول الوزارة الرسمي.', tab: 'timetable' });
  if (cfg.friday.enabled && !cfg.friday.configured) out.push({ tone: 'warn', text: 'إعدادات صلاة الجمعة غير مضبوطة.', tab: 'friday' });
  // validation warnings for the coming week's iqamah calculations
  if (schedule) {
    const seen = new Set<string>();
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i);
      const rec = schedule.days[d];
      if (!rec) continue;
      for (const w of buildDayPlan(rec, cfg).warnings) {
        if (w.includes('الجمعة') && weekdayOf(d) === 5 && !cfg.friday.configured) continue;
        if (!seen.has(w)) { seen.add(w); out.push({ tone: 'warn', text: w, tab: 'iqamah' }); }
      }
    }
  }
  return out;
}

function AdminPanel({ onClose }: { onClose: () => void }) {
  const cfg = useApp((s) => s.config);
  const schedule = useApp((s) => s.schedule);
  const online = useOnline();
  const cloud = useCloud();
  const pwa = usePwaStatus();
  const [tab, setTab] = useState<TabId>(() => ((t) => (TABS.some((x) => x.id === t) ? t : 'cloud'))(sessionStorage.getItem('omd-admin-tab') as TabId));
  useEffect(() => { try { sessionStorage.setItem('omd-admin-tab', tab); } catch { /* ignore */ } }, [tab]);
  const warnings = useAdminWarnings();
  const [clockWarn, setClockWarn] = useState(false);

  // device clock sanity: obviously wrong year, or a check against the server when online
  useEffect(() => {
    const y = new Date(now()).getUTCFullYear();
    if (y < 2024 || y > 2100) setClockWarn(true);
  }, []);

  const simulate = (at: number, speed: number) => { startSimulation(at, speed); onClose(); };
  const previewSequence = (slot: PrayerKey) => {
    const today = muscatDateKey(now());
    const rec = schedule?.days[today];
    if (!rec) { alert('لا توجد مواقيت لهذا اليوم — استورد الجدول أولاً'); return; }
    simulate(buildDayPlan(rec, cfg).iqamah[slot].at - 20_000, 10);
  };
  const previewAdhkar = () => {
    const today = muscatDateKey(now());
    const rec = schedule?.days[today];
    if (!rec) { alert('لا توجد مواقيت لهذا اليوم — استورد الجدول أولاً'); return; }
    const plan = buildDayPlan(rec, cfg);
    const slot = (['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as PrayerKey[]).find((s) => cfg.quiet.prayers[plan.isFriday && s === 'dhuhr' ? 'jumuah' : s]) ?? 'asr';
    const quiet = plan.isFriday && slot === 'dhuhr' ? cfg.friday.quietMinutes : cfg.quiet.minutes;
    simulate(plan.iqamah[slot].at + quiet * 60_000 - 3_000, 5);
  };

  const content: Record<TabId, ReactNode> = {
    cloud: <CloudSection />,
    timetable: <TimetableSection />,
    iqamah: <IqamahSection />,
    friday: <FridaySection />,
    hijri: <HijriSection />,
    quiet: <QuietSection onPreview={previewSequence} />,
    adhkar: <AdhkarSection onPreview={previewAdhkar} />,
    display: <DisplaySection />,
    backup: <BackupSection />,
    diagnostics: <DiagnosticsSection onSimulate={simulate} />,
  };

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-paper font-cairo text-ink" dir="rtl" role="dialog" aria-label="لوحة الإدارة">
      <header className="no-print sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark size={36} />
            <div className="flex min-w-0 flex-col gap-0.5 lg:flex-row lg:items-center lg:gap-3">
              <h1 className="m-0 truncate text-[18px] font-extrabold">إعدادات شاشة المسجد</h1>
              <span className="inline-flex max-w-[220px] items-center self-start truncate rounded-full bg-teal-soft px-2.5 py-0.5 text-[12px] font-bold text-teal">{cfg.mosque.nameAr || 'بدون اسم'}</span>
            </div>
          </div>
          <div className="flex flex-none items-center gap-2">
            <span className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold sm:inline-flex ${online ? 'bg-teal-soft text-teal' : 'bg-saffron-soft text-[#8A5A0B]'}`}>
              {online ? <IconWifi size={14} /> : <IconWifiOff size={14} />}{online ? 'متصل' : 'دون إنترنت'}
            </span>
            {schedule && <span className="hidden md:inline-flex"><Badge tone={sourceTone(schedule.meta.source)}>{SOURCE_AR[schedule.meta.source]}</Badge></span>}
            <Btn kind="primary" onClick={onClose}><IconClose size={16} /><span className="hidden sm:inline">العودة للشاشة</span></Btn>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1.5 overflow-x-auto px-4 pb-2 lg:hidden" aria-label="الأقسام">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`h-9 flex-none rounded-full border px-3.5 text-[13px] font-bold ${tab === t.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink2'}`}>{t.label}</button>
          ))}
        </nav>
      </header>

      <div className="mx-auto flex max-w-6xl gap-5 px-4 py-4">
        <aside className="no-print hidden w-56 flex-none lg:block">
          <nav className="sticky top-[84px] flex flex-col gap-1" aria-label="الأقسام">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`flex h-11 items-center justify-between rounded-xl px-3 text-right text-[14px] font-bold ${tab === t.id ? 'bg-ink text-white' : 'text-ink2 hover:bg-white'}`}>
                {t.label}
                {warnings.some((w) => w.tab === t.id) && <span className={`h-2 w-2 rounded-full ${warnings.some((w) => w.tab === t.id && w.tone === 'error') ? 'bg-rose' : 'bg-saffron'}`} />}
              </button>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          {cloud.binding && !cloud.admin && tab !== 'cloud' && (
            <div className="no-print mb-3">
              <button className="w-full text-right" onClick={() => setTab('cloud')}>
                <Note tone="warn">هذا الجهاز مرتبط بمسجد «{cloud.binding.name || cloud.binding.code}». التعديلات هنا تبقى على هذا الجهاز فقط، وقد تُستبدل عند وصول تحديث من السحابة. سجّل الدخول كمشرف من «المساجد والمزامنة» لترفع تعديلاتك.</Note>
              </button>
            </div>
          )}
          {(warnings.length > 0 || clockWarn || pwa.updateWaiting) && (
            <div className="no-print mb-4 flex flex-col gap-2">
              {clockWarn && <Note tone="error"><span className="inline-flex items-center gap-1.5"><IconAlert size={15} />ساعة الجهاز تبدو غير صحيحة — افحصها من قسم «التشخيص».</span></Note>}
              {warnings.slice(0, 5).map((w, i) => (
                <button key={i} onClick={() => setTab(w.tab)} className="text-right"><Note tone={w.tone}><span className="inline-flex items-center gap-1.5"><IconAlert size={15} />{w.text}</span></Note></button>
              ))}
              {pwa.updateWaiting && <Note tone="ok">يتوفر إصدار جديد من التطبيق — سيُطبَّق تلقائياً في وقت آمن بعيداً عن مواعيد الصلاة.</Note>}
            </div>
          )}
          <h2 className="no-print m-0 mb-3 text-[20px] font-extrabold">{TABS.find((t) => t.id === tab)?.label}</h2>
          {content[tab]}
          <footer className="no-print mt-8 border-t border-line pt-3 text-center text-[12px] text-muted" dir="ltr">
            Prepared by: Hani Al Ghatrifi · v{typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''}
          </footer>
        </main>
      </div>
    </div>
  );
}

declare const __APP_VERSION__: string;
