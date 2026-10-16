/** «كلمة مرور المشرف»: change the administrator password (one password for the whole platform). */
import { useEffect, useState } from 'react';
import { adminChangePassword, listMosquePasswords, listMosques, setMosquePassword, type MosqueSummary } from '../../services/cloud';
import { locationLabel } from '../../domain/oman';
import { useOnline } from '../../services/platform';
import { Badge, Btn, Card, Field, Note, useConfirm } from './kit';
import { IconEye, IconLock } from '../common/icons';

const inputCls = 'h-11 w-full rounded-xl border border-line bg-white px-3 text-[15px] outline-none focus:border-teal';

export function PasswordSection() {
  const online = useOnline();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const problem = !cur ? 'أدخل كلمة المرور الحالية'
    : next.length < 6 ? 'كلمة المرور الجديدة 6 أحرف على الأقل'
      : next === cur ? 'كلمة المرور الجديدة مطابقة للحالية'
        : next !== next2 ? 'تأكيد كلمة المرور غير مطابق' : '';

  const save = async () => {
    if (problem) { setMsg({ tone: 'error', text: problem }); return; }
    setBusy(true); setMsg(null);
    try {
      await adminChangePassword(cur, next);
      setCur(''); setNext(''); setNext2('');
      setMsg({ tone: 'ok', text: 'تم تغيير كلمة مرور المشرف. استخدم الكلمة الجديدة من الآن على كل الأجهزة.' });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally { setBusy(false); }
  };

  const type = show ? 'text' : 'password';
  return (
    <div className="flex flex-col gap-4">
      <Card title="تغيير كلمة مرور المشرف" icon={<IconLock size={16} />}>
        <form className="flex max-w-xl flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Note>كلمة مرور واحدة للمنصة كلها: تُطلب لفتح الإعدادات وتعديل المساجد والجداول. لا تُحفظ على أي جهاز.</Note>
          <Field label="كلمة المرور الحالية"><input className={inputCls} type={type} autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
          <Field label="كلمة المرور الجديدة" hint="6 أحرف على الأقل"><input className={inputCls} type={type} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Field label="تأكيد كلمة المرور الجديدة"><input className={inputCls} type={type} autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} /></Field>
          <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] font-bold text-ink2">
            <input type="checkbox" className="accent-[#1F7A6D]" checked={show} onChange={(e) => setShow(e.target.checked)} /><IconEye size={15} />إظهار كلمات المرور
          </label>
          {!online && <Note tone="warn">تغيير كلمة المرور يحتاج اتصالاً بالإنترنت.</Note>}
          {msg && <Note tone={msg.tone}>{msg.text}</Note>}
          <div><Btn kind="primary" type="submit" disabled={busy || !online}>{busy ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور الجديدة'}</Btn></div>
        </form>
      </Card>
      <MosquePasswords />
    </div>
  );
}

/** General administrator: a separate password for each mosque (its supervisor edits that mosque only). */
function MosquePasswords() {
  const online = useOnline();
  const { ask, ui } = useConfirm();
  const [mosques, setMosques] = useState<MosqueSummary[] | null>(null);
  const [has, setHas] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const refresh = async () => {
    try {
      const [m, p] = await Promise.all([listMosques(), listMosquePasswords()]);
      setMosques(m); setHas(new Set(p.map((x) => x.code)));
    } catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); setMosques([]); }
  };
  useEffect(() => { if (online) void refresh(); }, [online]);
  const save = async (code: string, pw: string | null, okText: string) => {
    setBusy(true); setMsg(null);
    try { await setMosquePassword(code, pw); setEditing(null); setVal(''); setMsg({ tone: 'ok', text: okText }); await refresh(); }
    catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <Card title="كلمات مرور المساجد" icon={<IconLock size={16} />}>
      {ui}
      <Note>لكل مسجد كلمة مرور خاصة لمشرفه: يفتح بها الإعدادات ويعدّل إعدادات مسجده فقط (الإقامة، الجمعة، العرض والسمة، الأذكار). أنت وحدك — المشرف العام — من يعيّنها أو يغيّرها أو يزيلها.</Note>
      {!mosques ? <p className="m-0 mt-3 text-[13px] text-muted">{online ? 'جارٍ التحميل…' : 'غير متاح دون إنترنت'}</p> : (
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {mosques.map((m) => (
            <li key={m.code} className="rounded-xl border border-line bg-white p-3" data-testid={`mpw-${m.code}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><b className="text-ink">{m.name_ar}</b> <span className="text-[12px] text-muted">{locationLabel(m.governorate_id, m.wilayat_id)}</span></span>
                <span className="flex flex-wrap items-center gap-2">
                  {has.has(m.code) ? <Badge tone="teal">لها كلمة مرور</Badge> : <Badge tone="muted">بدون كلمة مرور</Badge>}
                  <Btn small disabled={busy || !online} onClick={() => { setEditing(editing === m.code ? null : m.code); setVal(''); setMsg(null); }}>{has.has(m.code) ? 'تغيير' : 'تعيين'}</Btn>
                  {has.has(m.code) && <Btn small kind="danger" disabled={busy || !online} onClick={() => ask(`إزالة كلمة مرور «${m.name_ar}»؟ لن يستطيع مشرفه الدخول بها.`, () => void save(m.code, null, `أُزيلت كلمة مرور «${m.name_ar}».`))}>إزالة</Btn>}
                </span>
              </div>
              {editing === m.code && (
                <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (val.length < 4) { setMsg({ tone: 'error', text: 'كلمة مرور المسجد 4 أحرف أو أرقام على الأقل' }); return; } void save(m.code, val, `حُفظت كلمة مرور «${m.name_ar}».`); }}>
                  <input className={`${inputCls} max-w-xs`} dir="ltr" type="text" autoComplete="off" placeholder="كلمة مرور المسجد (4 على الأقل)" aria-label={`كلمة مرور ${m.name_ar}`} value={val} onChange={(e) => setVal(e.target.value)} />
                  <Btn kind="primary" type="submit" disabled={busy}>حفظ</Btn>
                  <span className="text-[12px] text-muted">أبلغ بها مشرف المسجد — لا تظهر مرة أخرى.</span>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && <div className="mt-3"><Note tone={msg.tone}>{msg.text}</Note></div>}
    </Card>
  );
}
