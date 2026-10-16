/** «كلمة مرور المشرف»: change the administrator password (one password for the whole platform). */
import { useState } from 'react';
import { adminChangePassword } from '../../services/cloud';
import { useOnline } from '../../services/platform';
import { Btn, Card, Field, Note } from './kit';
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
    </div>
  );
}
