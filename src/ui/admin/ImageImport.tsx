/**
 * "Import from image": OCR a photo / screenshot of a monthly timetable (e.g. the Ministry's
 * page), let the admin review & correct every cell next to the original image, then hand a CSV
 * to the normal import pipeline (which validates it again before anything is saved).
 */
import { useEffect, useMemo, useState } from 'react';
import { TIME_KEYS } from '../../domain/types';
import { ocrRowsToCsv, suspiciousCells } from '../../core/ocrTable';
import { parseTimetableFile, type ImportResult } from '../../core/timetable';
import { daysInMonth, GREGORIAN_MONTHS_AR } from '../../core/time';
import { readTimetableImage } from '../../services/ocr';
import { useOnline } from '../../services/platform';
import { now } from '../../services/clock';
import { Badge, Btn, Field, Grid, Note, Select } from './kit';
import { IconFileImage, IconPlus, IconTrash, IconUpload } from '../common/icons';

/** Tips shown under the button. */
export const IMAGE_TIPS = 'أفضل نتيجة: لقطة شاشة واضحة لجدول شهر واحد، بأرقام إنجليزية، مكبّرة بحيث يملأ الجدول الصورة.';

const T_AR = ['الفجر', 'الشروق', 'الظهر', 'العصر', 'المغرب', 'العشاء'];
const pad = (n: number) => String(n).padStart(2, '0');

interface Row { printed: string | null; times: string[] }

export function ImageImportButton({ onParsed }: { onParsed: (name: string, res: ImportResult) => void }) {
  const online = useOnline();
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ stage: string; pct: number } | null>(null);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const today = new Date(now());
  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth() + 1);
  const [startDay, setStartDay] = useState(1);

  useEffect(() => () => { if (img) URL.revokeObjectURL(img); }, [img]);

  const onPick = async (f?: File) => {
    if (!f) return;
    setErr(''); setRows(null); setFile(f);
    if (img) URL.revokeObjectURL(img);
    setImg(URL.createObjectURL(f));
    setBusy({ stage: 'تجهيز الصورة…', pct: 0 });
    try {
      const t = await readTimetableImage(f, (stage, pct) => setBusy({ stage, pct }));
      if (!t.rows.length) throw new Error('لم أجد في الصورة صفوفاً فيها مواقيت. تأكد أن الصورة واضحة ومستقيمة، وأن الأرقام إنجليزية (0–9)، وأن الجدول يملأ معظم الصورة.');
      if (t.detectedYear) setYear(t.detectedYear);
      if (t.detectedMonth) setMonth(t.detectedMonth);
      const first = t.rows.find((r) => r.date)?.date;
      const firstIdx = t.rows.findIndex((r) => r.date);
      setStartDay(first ? Math.max(1, +first.slice(8, 10) - firstIdx) : 1);
      setRows(t.rows.map((r) => ({ printed: r.date, times: r.times.map((x) => x.replace(/^(\d):/, '0$1:')) })));
    } catch (e) {
      setErr((e as Error).message || 'تعذّرت قراءة الصورة');
    } finally { setBusy(null); }
  };

  const dim = daysInMonth(year, month);
  const dates = useMemo(() => (rows ?? []).map((_, i) => { const d = startDay + i; return d <= dim ? `${year}-${pad(month)}-${pad(d)}` : null; }), [rows, startDay, year, month, dim]);
  const flags = useMemo(() => suspiciousCells((rows ?? []).map((r) => r.times)), [rows]);
  const mismatched = (rows ?? []).filter((r, i) => r.printed && r.printed !== dates[i]).length;
  const flagged = flags.reduce((n, r) => n + r.filter(Boolean).length, 0);
  const overflow = dates.filter((d) => !d).length;

  const setCell = (i: number, c: number, v: string) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, times: r.times.map((t, k) => (k === c ? v.trim() : t)) } : r)));
  const delRow = (i: number) => setRows((rs) => rs!.filter((_, j) => j !== i));
  const addRow = (i: number) => setRows((rs) => [...rs!.slice(0, i + 1), { printed: null, times: ['', '', '', '', '', ''] }, ...rs!.slice(i + 1)]);
  const reset = () => { setRows(null); setFile(null); setErr(''); if (img) URL.revokeObjectURL(img); setImg(null); };

  const proceed = () => {
    const csv = ocrRowsToCsv(rows!.map((r, i) => ({ date: dates[i]!, times: r.times })).filter((r) => r.date));
    onParsed(`صورة: ${file?.name ?? ''}`, parseTimetableFile('image.csv', csv));
    reset();
  };

  return (
    <>
      <label className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-4 text-[14px] font-bold text-ink hover:border-ink2 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        <IconFileImage />استيراد من صورة
        <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={!!busy} onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      <span className="basis-full text-[12px] text-muted">{IMAGE_TIPS}</span>

      {(busy || err || rows) && (
        <div className="mt-3 basis-full rounded-xl border border-line bg-paper/60 p-3">
          {busy && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[14px] font-bold text-ink"><span>{busy.stage}</span><span dir="ltr">{busy.pct}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full bg-teal transition-all" style={{ width: `${busy.pct}%` }} /></div>
              {!online && <Note tone="warn">لا يوجد إنترنت: إذا لم يُستخدم الاستيراد من صورة على هذا الجهاز من قبل فلن يتوفر محرك القراءة.</Note>}
            </div>
          )}
          {err && <div className="flex flex-col gap-2"><Note tone="error">{err}</Note><div><Btn small onClick={reset}>إغلاق</Btn></div></div>}
          {rows && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 text-[14px]">
                <b className="text-ink">قراءة الصورة</b>
                <Badge tone="muted">{rows.length} صفاً</Badge>
                <Badge tone={rows.length === dim ? 'teal' : 'saffron'}>الشهر {dim} يوماً</Badge>
                {flagged > 0 ? <Badge tone="saffron">{flagged} خانة تحتاج مراجعة</Badge> : <Badge tone="teal">لا خانات مشكوك فيها</Badge>}
              </div>
              <Note tone="warn">راجع كل الأرقام مع الصورة قبل المتابعة — القراءة الآلية قد تخطئ. الخانات الملوّنة بالأصفر تختلف عن اليوم السابق أو اللاحق بأكثر من 4 دقائق. ثم تمر البيانات بفحص الاستيراد المعتاد.</Note>
              <Grid cols={3}>
                <Field label="الشهر"><Select value={String(month)} onChange={(v) => setMonth(+v)} options={GREGORIAN_MONTHS_AR.map((m, i) => ({ value: String(i + 1), label: `${i + 1} — ${m}` }))} /></Field>
                <Field label="السنة"><Select value={String(year)} onChange={(v) => setYear(+v)} options={[year - 1, year, year + 1, year + 2].map((y) => ({ value: String(y), label: String(y) }))} /></Field>
                <Field label="أول صف هو يوم"><Select value={String(startDay)} onChange={(v) => setStartDay(+v)} options={Array.from({ length: dim }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} /></Field>
              </Grid>
              {mismatched > 0 && <Note tone="warn">{mismatched} صفاً تاريخه المطبوع لا يطابق الترتيب — تحقق من «أول صف هو يوم» أو احذف الصفوف الزائدة (مثل صف العناوين).</Note>}
              {rows.length < dim - startDay + 1 && <Note tone="warn">عدد الصفوف ({rows.length}) أقل من أيام الشهر من اليوم {startDay} ({dim - startDay + 1}). ربما لم تُقرأ بعض الصفوف فتتأخر التواريخ بعدها — قارن عمود «التاريخ» بالصورة وأضف الصف الناقص بزر +، أو استخدم صورة أوضح (لقطة شاشة مكبّرة بدل تصوير الشاشة).</Note>}
              {overflow > 0 && <Note tone="warn">{overflow} صفاً يتجاوز نهاية الشهر ولن يُستورد.</Note>}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                {img && (
                  <div className="max-h-[560px] overflow-auto rounded-lg border border-line bg-white">
                    <img src={img} alt="الصورة الأصلية" className="block w-full" />
                  </div>
                )}
                <div className="max-h-[560px] overflow-auto rounded-lg border border-line bg-white">
                  <table className="w-full border-collapse text-[13px]">
                    <thead className="sticky top-0 bg-paper"><tr><th className="px-1.5 py-1.5">التاريخ</th>{T_AR.map((t) => <th key={t} className="px-1 py-1.5">{t}</th>)}<th /></tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className={`whitespace-nowrap px-1.5 py-1 text-center ${!dates[i] || (r.printed && r.printed !== dates[i]) ? 'text-rose' : 'text-ink2'}`} dir="ltr">{dates[i] ? dates[i]!.slice(5) : '—'}</td>
                          {TIME_KEYS.map((k, c) => (
                            <td key={k} className="p-0.5">
                              <input dir="ltr" aria-label={`${T_AR[c]} ${dates[i] ?? ''}`} value={r.times[c]} onChange={(e) => setCell(i, c, e.target.value)}
                                className={`h-8 w-[62px] rounded-md border text-center text-[13px] outline-none focus:border-teal ${flags[i]?.[c] ? 'border-saffron bg-[#FFF4D6]' : 'border-line bg-white'}`} />
                            </td>
                          ))}
                          <td className="whitespace-nowrap px-1">
                            <button className="rounded-md p-1 text-muted hover:text-teal" onClick={() => addRow(i)} aria-label="إضافة صف بعده" title="إضافة صف بعده"><IconPlus size={14} /></button>
                            <button className="rounded-md p-1 text-muted hover:text-rose" onClick={() => delRow(i)} aria-label="حذف الصف" title="حذف الصف"><IconTrash size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn kind="teal" disabled={!rows.length || overflow === rows.length} onClick={proceed}><IconUpload size={16} />متابعة إلى فحص الاستيراد</Btn>
                <Btn onClick={reset}>إلغاء</Btn>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
