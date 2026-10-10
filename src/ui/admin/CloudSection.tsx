import { useEffect, useMemo, useState } from 'react';
import { GOVERNORATES, findGovernorate, locationLabel } from '../../domain/oman';
import {
  adminChangePassword, adminInit, adminLogin, adminLogout, adminStatus, bindDevice, createMosque, deleteMosque,
  listMosques, listTimetables, pushMosque, pushTimetable, syncNow, unbindDevice, useCloud,
  type MosqueSummary, type TimetableSummary,
} from '../../services/cloud';
import { useApp } from '../../store/appStore';
import { useOnline } from '../../services/platform';
import { Badge, Btn, Card, Field, Grid, Note, Select, useConfirm } from './kit';
import { IconCheck, IconDownload, IconLock, IconPlus, IconRestore, IconTrash, IconUpload, IconWifiOff } from '../common/icons';

const fmt = (iso: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString('ar-OM-u-nu-latn', { timeZone: 'Asia/Muscat', dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };
const linkFor = (code: string) => `${location.origin}/m/${code}`;
const inputCls = 'h-11 w-full rounded-xl border border-line bg-white px-3 text-[15px] text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal-soft';

function CopyLink({ code }: { code: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Btn small onClick={() => { void navigator.clipboard?.writeText(linkFor(code)).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }); }}>
      {ok ? <><IconCheck size={14} />نُسخ</> : 'نسخ الرابط'}
    </Btn>
  );
}

export function CloudSection() {
  const cloud = useCloud();
  const online = useOnline();
  const cfg = useApp((s) => s.config);
  const adhkar = useApp((s) => s.adhkar);
  const { ask, ui } = useConfirm();
  const [mosques, setMosques] = useState<MosqueSummary[] | null>(null);
  const [tables, setTables] = useState<TimetableSummary[] | null>(null);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setErr('');
    try {
      const [st, ms, ts] = await Promise.all([adminStatus(), listMosques(), listTimetables()]);
      setInitialized(st.initialized); setMosques(ms); setTables(ts);
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (online) void refresh(); }, [online]);

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); setMsg(okMsg); await refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const bound = cloud.binding;
  const boundMosque = mosques?.find((m) => m.code === bound?.code);

  return (
    <div className="flex flex-col gap-4">
      {ui}
      {!online && <Note tone="warn"><span className="inline-flex items-center gap-1.5"><IconWifiOff size={15} />لا يوجد اتصال بالإنترنت. الشاشة تعمل بآخر بيانات محفوظة، والمزامنة تُستأنف تلقائياً عند الاتصال.</span></Note>}
      {err && <Note tone="error">{err}</Note>}
      {msg && <Note tone="ok">{msg}</Note>}

      <Card title="هذا الجهاز" actions={bound ? <Badge tone="teal">مرتبط</Badge> : <Badge tone="muted">غير مرتبط</Badge>}>
        {bound ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-[15px]">
              <b className="text-ink">{bound.name || bound.code}</b>
              <span className="rounded-full bg-paper px-2.5 py-0.5 text-[12px] font-bold text-ink2" dir="ltr">{bound.code}</span>
              {cloud.wilayatId && boundMosque && <Badge tone="muted">{locationLabel(boundMosque.governorate_id, boundMosque.wilayat_id)}</Badge>}
            </div>
            <div className="rounded-xl border border-line bg-paper/60 px-3 py-2 text-[13px] text-ink2">
              رابط شاشة هذا المسجد:
              <div className="mt-1 break-all font-bold text-ink" dir="ltr">{linkFor(bound.code)}</div>
            </div>
            <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
              <div className="flex gap-2"><dt className="min-w-[120px] text-muted">آخر تحديث</dt><dd className="m-0">{fmt(cloud.lastSyncAt)}</dd></div>
              <div className="flex gap-2"><dt className="min-w-[120px] text-muted">إصدار الإعدادات</dt><dd className="m-0">{cloud.mosqueVersion ?? '—'}</dd></div>
              <div className="flex gap-2"><dt className="min-w-[120px] text-muted">إصدار جدول الولاية</dt><dd className="m-0">{cloud.timetableVersion ?? 'لا يوجد جدول للولاية بعد'}</dd></div>
              <div className="flex gap-2"><dt className="min-w-[120px] text-muted">الحالة</dt><dd className="m-0">{cloud.syncing ? 'جارٍ التحديث…' : cloud.pendingUpload ? 'جارٍ الرفع…' : cloud.lastError ? <span className="text-rose">{cloud.lastError}</span> : 'محدّث'}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Btn small onClick={() => void run(() => syncNow(true), 'تم تنزيل آخر نسخة من السحابة.')} disabled={!online || busy}><IconDownload size={14} />تحديث الآن</Btn>
              <CopyLink code={bound.code} />
              <Btn small kind="danger" onClick={() => ask('فك ربط هذا الجهاز بالمسجد؟ تبقى البيانات الحالية على الجهاز، لكنه لن يتحدث تلقائياً.', unbindDevice)}>فك الربط</Btn>
            </div>
            <p className="m-0 text-[12px] leading-5 text-muted">يتحقق الجهاز من التحديثات كل 5 دقائق، وعند عودة الإنترنت، وعند فتح الصفحة. بدون إنترنت يعمل بآخر نسخة محفوظة.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-[14px] text-ink2">اختر المسجد الذي تعرضه هذه الشاشة، فتُنزَّل إعداداته وجدول ولايته وتُحفظ على الجهاز.</p>
            {mosques?.length ? (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {mosques.map((m) => (
                  <li key={m.code} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                    <span className="min-w-0"><b className="text-ink">{m.name_ar}</b> <span className="text-[12px] text-muted">{locationLabel(m.governorate_id, m.wilayat_id)}</span></span>
                    <Btn small kind="primary" disabled={busy} onClick={() => ask(`ربط هذا الجهاز بـ «${m.name_ar}»؟\nستُستبدل الإعدادات والجدول الحاليان على هذا الجهاز بنسخة المسجد.`, () => void run(() => bindDevice(m.code, m.name_ar), `تم ربط الجهاز بـ «${m.name_ar}».`))}>ربط</Btn>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 text-[13px] text-muted">{mosques ? 'لا توجد مساجد مسجلة بعد — أضفها بعد تسجيل الدخول كمشرف.' : 'جارٍ التحميل…'}</p>}
          </div>
        )}
      </Card>

      <Card title="دخول المشرف" icon={<IconLock size={16} />} actions={cloud.admin ? <Badge tone="teal">مسجّل الدخول</Badge> : null}>
        {cloud.admin ? (
          <div className="flex flex-col gap-2">
            <Note tone="ok">
              {bound
                ? <>تعديلاتك على هذا الجهاز تُرفع تلقائياً: الإعدادات والأذكار إلى «{bound.name || bound.code}»، وجدول المواقيت والمعايرة إلى جدول ولاية {locationLabel(cfg.mosque.location.governorateId, cfg.mosque.location.wilayatId)} — فتصل لكل مساجد الولاية.</>
                : 'اربط هذا الجهاز بمسجد لتُرفع تعديلاتك إليه.'}
            </Note>
            <div className="flex flex-wrap gap-2">
              <Btn small disabled={!bound || busy} onClick={() => void run(pushMosque, 'رُفعت إعدادات المسجد.')}><IconUpload size={14} />رفع إعدادات المسجد الآن</Btn>
              <Btn small disabled={!bound || busy} onClick={() => ask(`رفع جدول هذا الجهاز ليكون جدول ولاية ${locationLabel(cfg.mosque.location.governorateId, cfg.mosque.location.wilayatId)} لكل مساجدها؟`, () => void run(pushTimetable, 'رُفع جدول الولاية.'))}><IconUpload size={14} />رفع جدول الولاية الآن</Btn>
              <Btn small kind="ghost" onClick={adminLogout}>تسجيل الخروج</Btn>
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer text-[13px] font-bold text-ink2">تغيير كلمة المرور</summary>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input className={inputCls} type="password" placeholder="الحالية" value={pw} onChange={(e) => setPw(e.target.value)} />
                <input className={inputCls} type="password" placeholder="الجديدة (6 أحرف على الأقل)" value={pw2} onChange={(e) => setPw2(e.target.value)} />
                <Btn kind="primary" disabled={busy || pw2.length < 6} onClick={() => void run(() => adminChangePassword(pw, pw2), 'تم تغيير كلمة المرور.').then(() => { setPw(''); setPw2(''); })}>حفظ</Btn>
              </div>
            </details>
          </div>
        ) : initialized === false ? (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (pw === pw2) void run(() => adminInit(pw), 'أُنشئت كلمة مرور الإدارة وتم تسجيل دخولك.').then(() => { setPw(''); setPw2(''); }); else setErr('كلمتا المرور غير متطابقتين'); }}>
            <Note>أول استخدام: أنشئ كلمة مرور الإدارة. تُطلب لإضافة المساجد ورفع الإعدادات والجداول. لا تُحفظ على أي جهاز.</Note>
            <Grid>
              <input className={inputCls} type="password" placeholder="كلمة المرور (6 أحرف على الأقل)" value={pw} onChange={(e) => setPw(e.target.value)} />
              <input className={inputCls} type="password" placeholder="تأكيد كلمة المرور" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </Grid>
            <div><Btn kind="primary" type="submit" disabled={busy || pw.length < 6}>إنشاء كلمة المرور</Btn></div>
          </form>
        ) : (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => adminLogin(pw), 'تم تسجيل الدخول.').then(() => setPw('')); }}>
            <input className={`${inputCls} max-w-xs`} type="password" placeholder="كلمة مرور الإدارة" value={pw} onChange={(e) => setPw(e.target.value)} />
            <Btn kind="primary" type="submit" disabled={busy || !pw || !online}>دخول</Btn>
            <span className="text-[12px] text-muted">تبقى في ذاكرة هذه الصفحة فقط، وتُنسى عند الإغلاق أو التحديث.</span>
          </form>
        )}
      </Card>

      {cloud.admin && <AddMosque busy={busy} onCreate={(code, name, gov, wil, bindAfter) => void run(async () => {
        await createMosque(code, name, gov, wil, cfg, adhkar);
        if (bindAfter) await bindDevice(code, name);
      }, `أُضيف «${name}».${bindAfter ? ' وربط هذا الجهاز به.' : ''}`)} />}

      <Card title="المساجد" actions={<Btn small kind="ghost" onClick={() => void refresh()} disabled={!online}><IconRestore size={14} />تحديث القائمة</Btn>}>
        {!mosques ? <p className="m-0 text-[13px] text-muted">{online ? 'جارٍ التحميل…' : 'غير متاح دون إنترنت'}</p> : !mosques.length ? <p className="m-0 text-[13px] text-muted">لا توجد مساجد بعد.</p> : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-paper"><tr><th className="px-2 py-2 text-right">المسجد</th><th className="px-2 py-2 text-right">الولاية</th><th className="px-2 py-2">جدول الولاية</th><th className="px-2 py-2">إجراءات</th></tr></thead>
              <tbody>
                {mosques.map((m) => (
                  <tr key={m.code} className={`border-t border-line ${bound?.code === m.code ? 'bg-teal-soft/40' : ''}`}>
                    <td className="px-2 py-2"><b className="text-ink">{m.name_ar}</b><div className="text-[11px] text-muted" dir="ltr">{m.code}</div></td>
                    <td className="whitespace-nowrap px-2 py-2">{locationLabel(m.governorate_id, m.wilayat_id)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-center">{m.timetable_days ? <Badge tone="teal">{m.timetable_days} يوماً</Badge> : <Badge tone="saffron">لا يوجد</Badge>}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {bound?.code === m.code ? <Badge tone="teal">هذا الجهاز</Badge> : <Btn small disabled={busy} onClick={() => ask(`ربط هذا الجهاز بـ «${m.name_ar}»؟\nستُستبدل إعدادات هذا الجهاز وجدوله بنسخة المسجد.`, () => void run(() => bindDevice(m.code, m.name_ar), `تم ربط الجهاز بـ «${m.name_ar}».`))}>ربط</Btn>}
                        <CopyLink code={m.code} />
                        {cloud.admin && <Btn small kind="danger" disabled={busy} onClick={() => ask(`حذف «${m.name_ar}» من السحابة؟`, () => ask(`تأكيد نهائي: حذف «${m.name_ar}» (${m.code}). الشاشات المرتبطة به تتوقف عن التحديث وتبقى بآخر نسخة.`, () => void run(() => deleteMosque(m.code), 'تم الحذف.')))}><IconTrash size={14} /></Btn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="جداول الولايات في السحابة">
        <p className="m-0 mb-2 text-[13px] text-muted">لكل ولاية جدول واحد تشترك فيه كل مساجدها. يُرفع من أي جهاز مرتبط بمسجد في تلك الولاية بعد تسجيل الدخول.</p>
        {!tables?.length ? <p className="m-0 text-[13px] text-muted">{tables ? 'لا توجد جداول بعد.' : '—'}</p> : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-paper"><tr><th className="px-2 py-2 text-right">الولاية</th><th className="px-2 py-2">الأيام</th><th className="px-2 py-2">المعايرة</th><th className="px-2 py-2">المساجد</th><th className="px-2 py-2">آخر تحديث</th></tr></thead>
              <tbody>
                {tables.map((t) => (
                  <tr key={t.wilayat_id} className="border-t border-line text-center">
                    <td className="px-2 py-2 text-right font-bold">{locationLabel(t.governorate_id, t.wilayat_id)}</td>
                    <td className="px-2 py-2">{t.days}</td>
                    <td className="px-2 py-2">{t.calibrated ? <Badge tone="teal">معايرة</Badge> : '—'}</td>
                    <td className="px-2 py-2">{t.mosques}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-muted">{fmt(t.updated_at)} · v{t.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="تشغيل نسخة المسجد على شاشة دون إنترنت">
        <ol className="m-0 list-decimal space-y-1 pr-5 text-[14px] leading-7 text-ink2">
          <li>افتح رابط المسجد على جهاز الشاشة مع وجود الإنترنت (مثل <span dir="ltr" className="font-bold">/m/رمز-المسجد</span>).</li>
          <li>انتظر حتى يظهر في «التشخيص»: العمل دون إنترنت «جاهز».</li>
          <li>اختياري: من قائمة المتصفح «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</li>
          <li>بعدها تعمل الشاشة دون إنترنت بآخر إعدادات وجدول محفوظين، وتتحدث تلقائياً كلما اتصلت.</li>
        </ol>
      </Card>
    </div>
  );
}

function AddMosque({ busy, onCreate }: { busy: boolean; onCreate: (code: string, name: string, gov: string, wil: string, bindAfter: boolean) => void }) {
  const cfg = useApp((s) => s.config);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [gov, setGov] = useState(cfg.mosque.location.governorateId);
  const [wil, setWil] = useState(cfg.mosque.location.wilayatId);
  const [bindAfter, setBindAfter] = useState(false);
  const codeOk = /^[a-z0-9-]{3,40}$/.test(code);
  const wilayats = useMemo(() => findGovernorate(gov)?.wilayats ?? [], [gov]);
  return (
    <Card title="إضافة مسجد" icon={<IconPlus size={16} />}>
      <Grid>
        <Field label="اسم المسجد"><input className={inputCls} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="جامع النور" /></Field>
        <Field label="رمز المسجد في الرابط" hint="أحرف إنجليزية صغيرة وأرقام وشرطة، مثل noor-bawshar">
          <input className={inputCls} dir="ltr" value={code} maxLength={40} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="noor-bawshar" />
        </Field>
        <Field label="المحافظة"><Select value={gov} options={GOVERNORATES.map((g) => ({ value: g.id, label: g.ar }))} onChange={(v) => { setGov(v); setWil(findGovernorate(v)!.wilayats[0].id); }} /></Field>
        <Field label="الولاية"><Select value={wil} options={wilayats.map((w) => ({ value: w.id, label: w.ar }))} onChange={setWil} /></Field>
      </Grid>
      <label className="mt-3 flex items-center gap-2 text-[14px] text-ink"><input type="checkbox" className="accent-[#1F7A6D]" checked={bindAfter} onChange={(e) => setBindAfter(e.target.checked)} />ربط هذا الجهاز بالمسجد الجديد بعد إضافته</label>
      <p className="m-0 mt-2 text-[12px] text-muted">يبدأ المسجد الجديد بنسخة من إعدادات الإقامة والعرض والأذكار الحالية على هذا الجهاز، ويمكن تعديلها لاحقاً.</p>
      {code && !codeOk && <div className="mt-2"><Note tone="warn">الرمز يجب أن يكون 3–40 حرفاً إنجليزياً صغيراً أو رقماً أو شرطة.</Note></div>}
      <div className="mt-3"><Btn kind="teal" disabled={busy || !codeOk || name.trim().length < 2} onClick={() => onCreate(code, name.trim(), gov, wil, bindAfter)}><IconPlus size={16} />إضافة المسجد</Btn></div>
    </Card>
  );
}
