/**
 * Shown while a mosque's own address (/m/<code>) loads that mosque — so another mosque
 * (e.g. the default one) never flashes on the screen first.
 */
import { useEffect, useState } from 'react';
import { useCloud, viewMosque } from '../../services/cloud';

const DHIKR = ['سبحان الله', 'الحمد لله', 'لا إله إلا الله', 'الله أكبر', 'لا حول ولا قوة إلا بالله'];

export function MosqueLoading({ code }: { code: string }) {
  const cloud = useCloud();
  const [i, setI] = useState(0);
  const [online, setOnline] = useState(typeof navigator === 'undefined' || navigator.onLine !== false);
  const injected = (window as unknown as { __MOSQUE__?: { code: string; name: string } }).__MOSQUE__;
  const name = (injected && injected.code === code && injected.name) || (cloud.binding?.code === code ? cloud.binding.name : '') || '';
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % DHIKR.length), 2200); return () => clearInterval(t); }, []);
  useEffect(() => {
    const on = () => { setOnline(true); void viewMosque(code); };
    const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [code]);
  const failed = !!cloud.lastError && !cloud.syncing;
  return (
    <div className="mosque-loading" role="status" aria-live="polite" data-testid="mosque-loading">
      <svg className="ml-star" viewBox="0 0 120 120" aria-hidden>
        <g className="ml-spin">
          <rect x="30" y="30" width="60" height="60" rx="3" />
          <rect x="30" y="30" width="60" height="60" rx="3" transform="rotate(45 60 60)" />
        </g>
        <circle cx="60" cy="60" r="13" className="ml-core" />
        <circle cx="60" cy="60" r="54" className="ml-ring" />
      </svg>
      {name && <div className="ml-name">{name}</div>}
      <div className="ml-text">
        {!online ? 'لا يوجد اتصال بالإنترنت — ستظهر مواقيت المسجد عند الاتصال'
          : failed ? 'تعذّر تحميل مواقيت المسجد'
          : 'جارٍ تحميل مواقيت الصلاة'}
        {online && !failed && <span className="ml-dots"><i /><i /><i /></span>}
      </div>
      {online && failed && <button className="ml-retry" onClick={() => void viewMosque(code)}>إعادة المحاولة</button>}
      <div className="ml-dhikr" key={i}>{DHIKR[i]}</div>
    </div>
  );
}
