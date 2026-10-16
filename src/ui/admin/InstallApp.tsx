/** «تثبيت التطبيق» button (settings header) + instructions where the browser has no install prompt. */
import { useState } from 'react';
import { promptInstall, useInstallState } from '../../services/install';
import { getCloud } from '../../services/cloud';
import { Btn } from './kit';
import { IconCheck, IconClose, IconInstall, IconShareIos } from '../common/icons';

export function InstallAppButton() {
  const st = useInstallState();
  const [help, setHelp] = useState(false);
  const [done, setDone] = useState(false);
  if (st === 'installed' || done) {
    return <span className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-teal-soft px-3 text-[13px] font-bold text-teal" title="التطبيق مثبّت على هذا الجهاز"><IconCheck size={15} /><span className="hidden sm:inline">مثبّت</span></span>;
  }
  const click = async () => {
    if (st === 'prompt') { if (await promptInstall()) setDone(true); return; }
    setHelp(true);
  };
  const code = getCloud().binding?.code;
  return (
    <>
      <Btn kind="teal" onClick={() => void click()} title="تثبيت التطبيق على هذا الجهاز"><IconInstall size={16} /><span className="hidden sm:inline">تثبيت التطبيق</span></Btn>
      {help && (
        <div className="fixed inset-0 z-[95] grid place-items-center bg-ink/60 p-4" role="dialog" aria-modal aria-label="تثبيت التطبيق" onClick={() => setHelp(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 text-ink shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="m-0 flex items-center gap-2 text-[18px] font-extrabold"><IconInstall size={20} />تثبيت التطبيق</h2>
              <button className="rounded-lg p-1.5 text-muted hover:bg-paper" onClick={() => setHelp(false)} aria-label="إغلاق"><IconClose size={18} /></button>
            </div>
            {st === 'ios' ? (
              <ol className="m-0 list-decimal space-y-2 pr-5 text-[15px] leading-7">
                <li>افتح هذه الصفحة في <b>Safari</b>.</li>
                <li>اضغط زر المشاركة <span className="inline-flex translate-y-1 rounded-md bg-paper p-0.5 text-[#0A84FF]"><IconShareIos size={18} /></span> أسفل الشاشة (أو أعلاها في الآيباد).</li>
                <li>اختر <b>«إضافة إلى الشاشة الرئيسية»</b> ثم <b>«إضافة»</b>.</li>
                <li>افتح التطبيق من أيقونته — يرتبط تلقائياً {code ? <>بالمسجد «{getCloud().binding?.name || code}»</> : 'بالمسجد الافتراضي'}.</li>
              </ol>
            ) : (
              <ol className="m-0 list-decimal space-y-2 pr-5 text-[15px] leading-7">
                <li>Chrome أو Edge على الكمبيوتر: أيقونة التثبيت <b>⊕</b> في نهاية شريط العنوان، أو القائمة ⋮ ← <b>«تثبيت التطبيق»</b>.</li>
                <li>أندرويد: القائمة ⋮ ← <b>«تثبيت التطبيق»</b> أو <b>«إضافة إلى الشاشة الرئيسية»</b>.</li>
                <li>تلفزيون سامسونج/LG: افتح الرابط في متصفح التلفاز وأضفه للمفضلة — يعمل دون إنترنت بعد أول فتح.</li>
              </ol>
            )}
            <p className="m-0 mt-3 rounded-xl bg-paper px-3 py-2 text-[13px] text-ink2">التطبيق المثبّت يعمل دون إنترنت ويتحدث تلقائياً عند الاتصال.</p>
          </div>
        </div>
      )}
    </>
  );
}
