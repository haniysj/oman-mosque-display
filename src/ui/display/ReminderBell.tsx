import { useState } from 'react';
import { disableReminders, enableReminders, useNotifyState } from '../../services/notify';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const standalone = () => (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;

/** Phone: reminder 5 minutes before each iqamah. */
export function ReminderBell() {
  const st = useNotifyState();
  const [tip, setTip] = useState('');
  const show = (t: string) => { setTip(t); setTimeout(() => setTip(''), 5000); };
  const on = st === 'on';
  const click = async () => {
    if (on) { disableReminders(); show('أُوقف تنبيه الإقامة'); return; }
    if (st === 'unsupported') { show(isIOS() && !standalone() ? 'في الآيفون: أضف المنصة إلى الشاشة الرئيسية (مشاركة ← إضافة إلى الشاشة الرئيسية) ثم فعّل التنبيه منها' : 'هذا المتصفح لا يدعم التنبيهات'); return; }
    if (st === 'denied') { show('التنبيهات محظورة لهذا الموقع — فعّلها من إعدادات المتصفح'); return; }
    const r = await enableReminders();
    show(r === 'on' ? 'سيصلك تنبيه قبل كل إقامة بـ 5 دقائق' : 'لم يُسمح بالتنبيهات');
  };
  return (
    <div className="m-bell-wrap">
      <button className={`ctrl-btn m-bell ${on ? 'is-on' : ''}`} onClick={() => void click()} aria-pressed={on} aria-label={on ? 'إيقاف تنبيه الإقامة' : 'تفعيل تنبيه قبل الإقامة بـ 5 دقائق'}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
      </button>
      {tip && <div className="m-tip" role="status">{tip}</div>}
    </div>
  );
}
