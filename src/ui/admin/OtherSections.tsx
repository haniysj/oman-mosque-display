import { useEffect, useState } from 'react';
import type { AdhkarGroup, AdhkarItem, LogEntry, PrayerKey, Theme } from '../../domain/types';
import { defaultAdhkar, defaultAdhkarGroups, suggestedAdhkar } from '../../domain/defaults';
import { createBackup, validateBackup, type BackupValidation } from '../../core/backup';
import { computeState, groupIdOf } from '../../core/engine';
import { editAdhkar, editConfig, useEditAdhkar, useEditCfg, useEditReady } from './editTarget';
import { classifyDevice, isPhone, readDeviceEnv } from '../../core/device';
import { formatTimestamp, muscatDateKey } from '../../core/time';
import { coverage } from '../../core/timetable';
import { restoreBackup, updateConfig, useApp } from '../../store/appStore';
import { clearLogs, readLogs, requestPersistentStorage } from '../../store/db';
import { measureServerOffset, now, realNow, simulationInfo, stopSimulation } from '../../services/clock';
import { applyUpdateNow, usePwaStatus } from '../../services/pwa';
import { useOnline } from '../../services/platform';
import { Badge, Btn, Card, download, Field, Grid, Note, NumberInput, Range, readFileText, Select, Toggle, useConfirm } from './kit';
import { IconDown, IconDownload, IconEdit, IconFileJson, IconPlus, IconRestore, IconTrash, IconUp } from '../common/icons';
import { SOURCE_AR } from './TimetableSection';
import { THEME_LABELS } from '../display/Background';

declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;

// ---------------------------------------------------------------- A. Mosque
// ---------------------------------------------------------------- F. Adhkar
const SLOT_AR: Record<PrayerKey | 'jumuah', string> = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء', jumuah: 'الجمعة' };
const SLOTS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'jumuah'] as const;
const afterText = (g: AdhkarGroup) => {
  const on = SLOTS.filter((k) => g.prayers?.[k]);
  return on.length ? on.length === SLOTS.length ? 'بعد كل الصلوات والجمعة' : `بعد صلاة ${on.map((k) => SLOT_AR[k]).join('، ')}` : 'لا تُعرض بعد أي صلاة';
};

export function AdhkarSection({ onPreview }: { onPreview: () => void }) {
  const list = useEditAdhkar();
  const cfg = useEditCfg();
  const ready = useEditReady();
  const groups: AdhkarGroup[] = cfg.adhkar.groups?.length ? cfg.adhkar.groups : defaultAdhkarGroups();
  const [edit, setEdit] = useState<AdhkarItem | null>(null);
  const [err, setErr] = useState('');
  const { ask, ui } = useConfirm();
  const save = (l: AdhkarItem[]) => editAdhkar(l);
  const setGroups = (fn: (g: AdhkarGroup[]) => AdhkarGroup[]) => editConfig((c) => { c.adhkar.groups = fn(JSON.parse(JSON.stringify(c.adhkar.groups?.length ? c.adhkar.groups : defaultAdhkarGroups())) as AdhkarGroup[]); });
  const gid = (a: AdhkarItem) => groupIdOf(a, groups);
  const ordered = [...list].sort((a, b) => a.order - b.order);
  const enabledCount = list.filter((a) => a.enabled && a.text.trim()).length;

  // move a dhikr up/down inside its own group (swaps with the neighbour of the same group)
  const moveItem = (id: string, d: number) => {
    const l = [...ordered];
    const i = l.findIndex((a) => a.id === id); const g = gid(l[i]);
    let j = i + d;
    while (j >= 0 && j < l.length && gid(l[j]) !== g) j += d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]]; save(l);
  };
  const moveGroup = (i: number, d: number) => setGroups((g) => { const j = i + d; if (j < 0 || j >= g.length) return g; [g[i], g[j]] = [g[j], g[i]]; return g; });
  const patchGroup = (id: string, fn: (g: AdhkarGroup) => void) => setGroups((gs) => gs.map((g) => { if (g.id !== id) return g; const c = { ...g, prayers: { ...g.prayers } }; fn(c); return c; }));
  const addGroup = () => setGroups((gs) => [...gs, { id: `group-${Date.now()}`, name: 'مجموعة جديدة', enabled: true, prayers: { fajr: false, dhuhr: false, asr: false, maghrib: false, isha: false, jumuah: false } }]);
  const deleteGroup = (g: AdhkarGroup) => {
    const items = ordered.filter((a) => gid(a) === g.id);
    const target = groups.find((x) => x.id !== g.id);
    if (!target) { setErr('يجب أن تبقى مجموعة واحدة على الأقل'); return; }
    ask(items.length ? `حذف «${g.name}»؟ تُنقل أذكارها (${items.length}) إلى «${target.name}».` : `حذف «${g.name}»؟`, () => {
      if (items.length) save(ordered.map((a) => (gid(a) === g.id ? { ...a, groupId: target.id } : a)));
      setGroups((gs) => gs.filter((x) => x.id !== g.id));
    });
  };

  const commitEdit = () => {
    if (!edit) return;
    if (!edit.text.trim()) { setErr('نص الذكر لا يمكن أن يكون فارغاً'); return; }
    const gName = groups.find((g) => g.id === edit.groupId)?.name ?? edit.category;
    const item = { ...edit, category: gName };
    const exists = list.some((a) => a.id === edit.id);
    if (exists) save(ordered.map((a) => (a.id === edit.id ? item : a)));
    else {
      // a new dhikr goes to the end of its group
      const lastIdx = ordered.map((a) => gid(a)).lastIndexOf(item.groupId ?? null);
      const l = [...ordered]; l.splice(lastIdx >= 0 ? lastIdx + 1 : l.length, 0, item); save(l);
    }
    setEdit(null); setErr('');
  };

  const importJson = async (f?: File) => {
    if (!f) return;
    try {
      const data = JSON.parse(await readFileText(f)) as unknown;
      const arr = Array.isArray(data) ? data : (data as { adhkar?: unknown[] }).adhkar;
      if (!Array.isArray(arr)) throw new Error('الملف يجب أن يحتوي مصفوفة أذكار');
      const items: AdhkarItem[] = arr.map((x, i) => {
        const o = x as Partial<AdhkarItem>;
        if (typeof o.text !== 'string' || !o.text.trim()) throw new Error(`الذكر رقم ${i + 1} بلا نص`);
        return { id: `dhikr-i${Date.now()}-${i}`, text: o.text.trim(), category: String(o.category ?? ''), source: String(o.source ?? ''), seconds: typeof o.seconds === 'number' ? o.seconds : null, enabled: o.enabled !== false, order: i, ...(typeof o.groupId === 'string' ? { groupId: o.groupId } : {}) };
      });
      ask(`استيراد ${items.length} ذكراً سيستبدل القائمة الحالية (${list.length}). متابعة؟`, () => save(items));
    } catch (e) { setErr((e as Error).message); }
  };

  const newItem = (g: AdhkarGroup): AdhkarItem => ({ id: `dhikr-${Date.now()}`, text: '', category: g.name, source: '', seconds: null, enabled: true, order: list.length, groupId: g.id });

  if (!ready) return null;
  return (
    <div className="flex flex-col gap-4">
      {ui}
      <Card title="شكل نص الأذكار">
        <Toggle checked={cfg.display.adhkarKashida !== false} onChange={(v) => editConfig((c) => { c.display.adhkarKashida = v; })}
          label="الحروف المرسلة (تطويل نهايات الكلمات)" hint="بخط ثمانية: تطويل جميل قبل الحروف الأخيرة (ن، ى، ي، ل، ه). للعرض فقط — لا يغيّر النص المحفوظ، ولا يُطبَّق على آيات القرآن ولا على لفظ الجلالة." />
      </Card>
      <Card title="مجموعات الأذكار" actions={<Btn small onClick={addGroup}><IconPlus size={14} />مجموعة جديدة</Btn>}>
        <Note>تُعرض المجموعات بعد الصلاة بالترتيب أدناه: كل مجموعة بعد الصلوات المحددة لها فقط (مثل أذكار الصباح بعد الفجر، وأذكار المساء بعد العصر). داخل كل مجموعة تُعرض الأذكار بترتيبها.</Note>
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0" aria-label="المجموعات">
          {groups.map((g, i) => {
            const count = ordered.filter((a) => gid(a) === g.id && a.enabled && a.text.trim()).length;
            return (
              <li key={g.id} data-testid={`group-${g.id}`} className={`rounded-xl border p-3 ${g.enabled ? 'border-line bg-white' : 'border-dashed border-line bg-paper opacity-75'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-ink text-[13px] font-extrabold text-white">{i + 1}</span>
                  <input aria-label="اسم المجموعة" className="h-10 min-w-0 flex-1 rounded-xl border border-line px-3 text-[15px] font-bold" value={g.name}
                    onChange={(e) => patchGroup(g.id, (x) => { x.name = e.target.value; })} />
                  <Badge tone={count ? "teal" : "saffron"}>الأذكار: {count}</Badge>
                  <label className="flex items-center gap-1.5 text-[13px] font-bold text-ink2"><input type="checkbox" className="accent-[#1F7A6D]" checked={g.enabled} onChange={(e) => patchGroup(g.id, (x) => { x.enabled = e.target.checked; })} />مفعّلة</label>
                  <span className="flex flex-none">
                    <button className="rounded-lg p-1.5 hover:bg-paper disabled:opacity-30" disabled={i === 0} aria-label={`تقديم ${g.name}`} onClick={() => moveGroup(i, -1)}><IconUp size={16} /></button>
                    <button className="rounded-lg p-1.5 hover:bg-paper disabled:opacity-30" disabled={i === groups.length - 1} aria-label={`تأخير ${g.name}`} onClick={() => moveGroup(i, 1)}><IconDown size={16} /></button>
                    <button className="rounded-lg p-1.5 text-rose hover:bg-rose-soft" aria-label={`حذف ${g.name}`} onClick={() => deleteGroup(g)}><IconTrash size={16} /></button>
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] font-bold text-muted">تُعرض بعد:</span>
                  {SLOTS.map((k) => (
                    <button key={k} aria-pressed={!!g.prayers?.[k]} onClick={() => patchGroup(g.id, (x) => { x.prayers[k] = !x.prayers[k]; })}
                      className={`h-8 rounded-full border px-3 text-[13px] font-bold ${g.prayers?.[k] ? 'border-teal bg-teal text-white' : 'border-line bg-white text-ink2'}`}>{SLOT_AR[k]}</button>
                  ))}
                </div>
                <p className="m-0 mt-1.5 text-[12px] text-ink2">{afterText(g)}</p>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="الأذكار" actions={<Badge tone="teal">{enabledCount} مفعّل</Badge>}>
        <Note>تأكد من صحة النصوص ومراجعها قبل اعتمادها. استخدم الأسهم لترتيب الأذكار داخل مجموعتها.</Note>
        <div className="mt-3 flex flex-col gap-4">
          {groups.map((g) => {
            const items = ordered.filter((a) => gid(a) === g.id);
            const sec = items.filter((a) => a.enabled && a.text.trim()).reduce((s2, a) => s2 + (a.seconds ?? cfg.adhkar.defaultSeconds), 0);
            const sugg = g.id === 'morning' || g.id === 'evening' ? g.id : null;
            return (
              <section key={g.id} aria-label={g.name} className="rounded-2xl border border-line bg-paper/50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-[16px] text-ink">{g.name}</b>
                    <Badge tone="muted">{afterText(g)}</Badge>
                    {!g.enabled && <Badge tone="saffron">المجموعة معطّلة</Badge>}
                    {sec > 0 && <Badge tone="muted">{Math.round(sec / 6) / 10} دقيقة</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {sugg && !items.length && <Btn small onClick={() => save([...ordered, ...suggestedAdhkar(sugg).map((a, k) => ({ ...a, id: `${a.id}-${Date.now()}-${k}` }))])}><IconPlus size={14} />إضافة الأذكار المقترحة</Btn>}
                    <Btn small kind="primary" onClick={() => setEdit(newItem(g))}><IconPlus size={14} />إضافة ذكر</Btn>
                  </div>
                </div>
                {!items.length ? <p className="m-0 text-[13px] text-muted">لا توجد أذكار في هذه المجموعة بعد.</p> : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {items.map((a, k) => (
                      <li key={a.id} className={`rounded-xl border p-3 ${a.enabled ? 'border-line bg-white' : 'border-dashed border-line bg-paper opacity-70'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="mb-1 flex flex-wrap items-center gap-1.5">
                              <Badge tone="muted">{k + 1}</Badge>
                              {!a.enabled && <Badge tone="saffron">معطّل</Badge>}
                            </div>
                            <p className="m-0 line-clamp-3 whitespace-pre-line font-amiri text-[17px] leading-8 text-ink">{a.text}</p>
                            {a.source && <p className="m-0 text-[12px] text-muted">{a.source}</p>}
                          </div>
                          <div className="flex flex-none flex-col gap-1">
                            <button className="rounded-lg p-1.5 hover:bg-paper disabled:opacity-30" disabled={k === 0} aria-label="أعلى" onClick={() => moveItem(a.id, -1)}><IconUp size={16} /></button>
                            <button className="rounded-lg p-1.5 hover:bg-paper disabled:opacity-30" disabled={k === items.length - 1} aria-label="أسفل" onClick={() => moveItem(a.id, 1)}><IconDown size={16} /></button>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <DurationInput testId={`dur-${a.id}`} value={a.seconds} fallback={cfg.adhkar.defaultSeconds}
                            onCommit={(v) => save(ordered.map((x) => (x.id === a.id ? { ...x, seconds: v } : x)))} />
                          <Btn small onClick={() => setEdit({ ...a, groupId: gid(a) ?? undefined })}><IconEdit size={14} />تعديل</Btn>
                          <Btn small onClick={() => save(ordered.map((x) => (x.id === a.id ? { ...x, enabled: !x.enabled } : x)))}>{a.enabled ? 'تعطيل' : 'تفعيل'}</Btn>
                          <Btn small kind="danger" onClick={() => ask('حذف هذا الذكر نهائياً؟', () => save(ordered.filter((x) => x.id !== a.id)))}><IconTrash size={14} />حذف</Btn>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn onClick={onPreview} disabled={!enabledCount}>معاينة الدورة</Btn>
          <Btn onClick={() => download('adhkar.json', JSON.stringify(ordered.map((a) => ({ ...a, groupId: gid(a) })), null, 2), 'application/json')}><IconFileJson />تصدير JSON</Btn>
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-4 text-[14px] font-bold text-ink hover:border-ink2">
            <IconFileJson />استيراد JSON
            <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { void importJson(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <Btn kind="ghost" onClick={() => ask('استعادة الأذكار والمجموعات الافتراضية؟ ستُستبدل القائمة الحالية.', () => { save(defaultAdhkar()); setGroups(() => defaultAdhkarGroups()); })}><IconRestore size={16} />الافتراضي</Btn>
        </div>
        {err && !edit && <div className="mt-2"><Note tone="error">{err}</Note></div>}
      </Card>

      {edit && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/50 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="m-0 mb-3 text-[17px] font-extrabold text-ink">{list.some((a) => a.id === edit.id) ? 'تعديل ذكر' : 'ذكر جديد'}</h3>
            <div className="flex flex-col gap-3">
              <Field label="النص"><textarea className="min-h-[140px] w-full rounded-xl border border-line p-3 font-amiri text-[18px] leading-8 outline-none focus:border-teal" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} /></Field>
              <Grid>
                <Field label="المجموعة" hint={afterText(groups.find((g) => g.id === edit.groupId) ?? groups[0])}>
                  <Select value={edit.groupId ?? groups[0].id} onChange={(v) => setEdit({ ...edit, groupId: v })} options={groups.map((g) => ({ value: g.id, label: g.name }))} />
                </Field>
                <Field label="المصدر / التخريج" hint="مثال: رواه مسلم (591)"><input className="h-11 rounded-xl border border-line px-3" value={edit.source} onChange={(e) => setEdit({ ...edit, source: e.target.value })} /></Field>
                <Field label="مدة العرض (ثانية)" hint={`أي رقم — اتركه فارغاً للمدة الافتراضية (${cfg.adhkar.defaultSeconds} ث)`}>
                  <DurationInput value={edit.seconds} fallback={cfg.adhkar.defaultSeconds} wide onCommit={(v) => setEdit((e) => (e ? { ...e, seconds: v } : e))} />
                </Field>
              </Grid>
            </div>
            {err && <div className="mt-3"><Note tone="error">{err}</Note></div>}
            <div className="mt-4 flex justify-end gap-2"><Btn onClick={() => { setEdit(null); setErr(''); }}>إلغاء</Btn><Btn kind="primary" onClick={commitEdit}>حفظ</Btn></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- G. Display
export function DisplaySection() {
  const cfg = useEditCfg();
  const ready = useEditReady();
  const local = useApp((s) => s.config.display);
  const d = cfg.display;
  // appearance belongs to the mosque being edited; the «التشغيل على الشاشة» card belongs to this device
  const set = (fn: (c: typeof cfg) => void) => editConfig(fn);
  const setDevice = (fn: (c: typeof cfg) => void) => void updateConfig(fn);
  const detected = classifyDevice(readDeviceEnv());
  const DEV_AR = { tv: 'تلفاز', desktop: 'حاسوب', tablet: 'جهاز لوحي', mobile: 'هاتف' };
  if (!ready) return null;
  return (
    <div className="flex flex-col gap-4">
      <Card title="المظهر">
        <Grid>
          <Field label="السمة"><Select value={d.theme} onChange={(v) => set((c) => { c.display.theme = v; })} options={(Object.keys(THEME_LABELS) as Theme[]).map((value) => ({ value, label: THEME_LABELS[value] }))} /></Field>
          <Field label="الخلفية"><Select value={d.background} onChange={(v) => set((c) => { c.display.background = v; })} options={[{ value: 'animated', label: 'حركة هادئة' }, { value: 'static', label: 'ثابتة' }]} /></Field>
          <Field label="شدة الحركة"><Range value={d.animationIntensity} min={0} max={100} onCommit={(v) => set((c) => { c.display.animationIntensity = v; })} /></Field>
          <Field label="الأرقام"><Select value={d.digits} onChange={(v) => set((c) => { c.display.digits = v; })} options={[{ value: 'western', label: '0123456789' }, { value: 'arabic', label: '٠١٢٣٤٥٦٧٨٩' }]} /></Field>
          <Field label="صيغة الوقت"><Select value={d.timeFormat} onChange={(v) => set((c) => { c.display.timeFormat = v; })} options={[{ value: '12', label: '12 ساعة (ص / م)' }, { value: '24', label: '24 ساعة' }]} /></Field>
          <Field label="موضع اسم المسجد"><Select value={d.namePosition} onChange={(v) => set((c) => { c.display.namePosition = v; })} options={[{ value: 'center', label: 'في الوسط' }, { value: 'right', label: 'إلى اليمين مع الشعار' }]} /></Field>
          <Field label="حجم الساعة"><Range value={d.clockScale} min={70} max={130} onCommit={(v) => set((c) => { c.display.clockScale = v; })} /></Field>
          <Field label="حجم اسم المسجد"><Range value={d.nameScale} min={60} max={140} onCommit={(v) => set((c) => { c.display.nameScale = v; })} /></Field>
          <Field label="حجم لوحات المواقيت"><Range value={d.panelScale} min={80} max={115} onCommit={(v) => set((c) => { c.display.panelScale = v; })} /></Field>
          <Field label="صلاة الضحى بعد الشروق"><NumberInput value={d.duhaMinutesAfterSunrise} min={10} max={60} suffix="دقيقة" onCommit={(v) => set((c) => { c.display.duhaMinutesAfterSunrise = v; })} /></Field>
        </Grid>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Toggle checked={d.highContrast} onChange={(v) => set((c) => { c.display.highContrast = v; })} label="تباين عالٍ" hint="خلفية سوداء ونص أبيض وذهبي ساطع لقاعات واسعة أو شاشات ضعيفة." />
          <Toggle checked={d.showSeconds} onChange={(v) => set((c) => { c.display.showSeconds = v; })} label="عرض الثواني" />
          <Toggle checked={d.countdownFocus} onChange={(v) => set((c) => { c.display.countdownFocus = v; })} label="تمييز العد التنازلي" hint="خلال آخر 60 ثانية قبل الأذان أو الإقامة: تخفت بقية الشاشة وتُغبَّش قليلاً، ويكبر العد التنازلي بلون مميز." />
          <Toggle checked={d.panelsSwapped} onChange={(v) => set((c) => { c.display.panelsSwapped = v; })} label="تبديل موضع اللوحتين" hint="الافتراضي: الأذان يميناً، الإقامة يساراً." />
          <Toggle checked={d.showEnglishName} onChange={(v) => set((c) => { c.display.showEnglishName = v; })} label="عرض الاسم الإنجليزي" />
          <Toggle checked={d.showSourceBadge} onChange={(v) => set((c) => { c.display.showSourceBadge = v; })} label="شارة «مواقيت محسوبة»" hint="بيانات DEMO تُوسم دائماً ولا يمكن إخفاء وسمها." />
        </div>
      </Card>

      <Card title="تقسيم الشاشة (التلفاز والحاسوب)">
        <Grid>
          <Field label="ما يُعرض على الشاشة"><Select value={d.screenLayout} onChange={(v) => set((c) => { c.display.screenLayout = v; })} options={[
            { value: 'full', label: 'الشاشة كاملة للمواقيت والإقامة' },
            { value: 'third', label: 'ثلث للمواقيت — والباقي للأذكار' },
            { value: 'half', label: 'نصف للمواقيت — والنصف الآخر للأذكار' },
          ]} /></Field>
          {d.screenLayout !== 'full' && <Field label="جهة المواقيت"><Select value={d.layoutSide} onChange={(v) => set((c) => { c.display.layoutSide = v; })} options={[{ value: 'right', label: 'يمين الشاشة' }, { value: 'left', label: 'يسار الشاشة' }]} /></Field>}
          {d.screenLayout !== 'full' && <Field label="مدة عرض كل ذكر"><NumberInput value={d.splitAdhkarSeconds} min={8} max={120} suffix="ثانية" onCommit={(v) => set((c) => { c.display.splitAdhkarSeconds = v; })} /></Field>}
        </Grid>
        <p className="m-0 mt-2 text-[12px] text-muted">تُعرض الأذكار المفعّلة من قسم «الأذكار» بالتناوب. في آخر 60 ثانية قبل الأذان أو الإقامة يحلّ العد التنازلي محل الأذكار. الهاتف والشاشات العمودية لا تتأثر.</p>
      </Card>

      <Card title="التشغيل على الشاشة (هذا الجهاز فقط)">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Toggle checked={local.presentation} onChange={(v) => setDevice((c) => { c.display.presentation = v; })} label="وضع العرض (Kiosk)" hint="يخفي جميع الأزرار. Esc أو زر الرجوع يُظهرها، و P يبدّل الوضع. بجهاز التحكم: OK أو الأسهم تُظهر الأزرار مؤقتاً." />
          <Toggle checked={local.autoHideControls} onChange={(v) => setDevice((c) => { c.display.autoHideControls = v; })} label="إخفاء الأزرار تلقائياً" hint="بعد 8 ثوانٍ دون حركة." />
          <Toggle checked={local.wakeLock} onChange={(v) => setDevice((c) => { c.display.wakeLock = v; })} label="منع إطفاء الشاشة" hint="يعمل في المتصفحات التي تدعم Screen Wake Lock؛ قد يتطلب الأمر ضبط إعدادات التلفاز نفسه." />
        </div>
        <div className="mt-3"><Grid>
          <Field label="نوع الجهاز" hint={`الكشف التلقائي: ${DEV_AR[detected]}. الهاتف لا يعرض الشاشة السوداء.`}>
            <Select value={local.deviceMode} onChange={(v) => setDevice((c) => { c.display.deviceMode = v; })} options={[{ value: 'auto', label: `تلقائي (${DEV_AR[detected]})` }, { value: 'tv', label: 'تلفاز / شاشة مسجد' }, { value: 'desktop', label: 'حاسوب' }, { value: 'mobile', label: 'هاتف' }]} />
          </Field>
        </Grid></div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="inline-flex h-9 items-center rounded-xl border border-line bg-white px-3 text-[13px] font-bold text-ink no-underline" href="#/preview?w=1920&h=1080" target="_blank" rel="noreferrer">معاينة 16:9 (1920×1080)</a>
          <a className="inline-flex h-9 items-center rounded-xl border border-line bg-white px-3 text-[13px] font-bold text-ink no-underline" href="#/preview?w=3840&h=2160" target="_blank" rel="noreferrer">معاينة 4K</a>
        </div>
      </Card>

    </div>
  );
}

// ---------------------------------------------------------------- H. Backup
export function BackupSection() {
  const cfg = useApp((s) => s.config);
  const schedule = useApp((s) => s.schedule);
  const adhkar = useApp((s) => s.adhkar);
  const [val, setVal] = useState<BackupValidation | null>(null);
  const [done, setDone] = useState('');
  const { ask, ui } = useConfirm();
  const stamp = muscatDateKey(now());
  const onFile = async (f?: File) => { if (!f) return; setDone(''); setVal(validateBackup(await readFileText(f))); };
  return (
    <div className="flex flex-col gap-4">
      {ui}
      <Card title="نسخة احتياطية">
        <p className="m-0 mb-3 text-[14px] text-ink2">ملف JSON واحد يحتوي: إعدادات المسجد، جدول المواقيت، الإقامة والجمعة، التعديل الهجري، الأذكار، وإعدادات العرض. احفظه على ذاكرة USB أو هاتفك لنقل الإعداد إلى شاشة أخرى.</p>
        <Btn kind="primary" onClick={() => download(`mosque-display-backup-${stamp}.json`, JSON.stringify(createBackup(cfg, schedule, adhkar, new Date().toISOString()), null, 2), 'application/json')}><IconDownload size={16} />تنزيل نسخة احتياطية</Btn>
      </Card>
      <Card title="استعادة">
        <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-4 text-[14px] font-bold text-ink hover:border-ink2">
          <IconFileJson />اختيار ملف النسخة
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {val && !val.ok && <div className="mt-3"><Note tone="error"><b>الملف غير صالح — لم يتغير أي شيء.</b><ul className="m-0 mt-1 list-disc pr-5">{val.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Note></div>}
        {val?.ok && val.summary && (
          <div className="mt-3 flex flex-col gap-2">
            <Note tone="ok">ملف صالح: «{val.summary.mosque}» — {val.summary.days} يوماً من المواقيت، {val.summary.adhkar} ذكراً{val.summary.createdAt ? ` — أُنشئ ${val.summary.createdAt.slice(0, 10)}` : ''}.</Note>
            <div><Btn kind="teal" onClick={() => ask('ستُستبدل جميع الإعدادات والأذكار' + (val.summary!.days ? ' وجدول المواقيت' : '') + ' بمحتوى النسخة.\nالجدول الحالي يُحفظ كـ«جدول سابق». متابعة؟', () => void restoreBackup(val.backup!).then(() => { setVal(null); setDone('تمت الاستعادة بنجاح.'); }).catch((e) => setDone(`فشلت الاستعادة ولم يتغير شيء: ${(e as Error).message}`)))}><IconRestore size={16} />استعادة النسخة</Btn></div>
          </div>
        )}
        {done && <div className="mt-3"><Note tone={done.startsWith('فشلت') ? 'error' : 'ok'}>{done}</Note></div>}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Diagnostics
export function DiagnosticsSection({ onSimulate }: { onSimulate: (at: number, speed: number) => void }) {
  const cfg = useApp((s) => s.config);
  const schedule = useApp((s) => s.schedule);
  const adhkar = useApp((s) => s.adhkar);
  const online = useOnline();
  const pwa = usePwaStatus();
  const [, force] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [server, setServer] = useState<number | null | 'checking'>(null);
  const [persist, setPersist] = useState<boolean | null>(null);
  const [simAt, setSimAt] = useState('');
  const [speed, setSpeed] = useState(10);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { void readLogs(150).then(setLogs); }, []);
  useEffect(() => { void navigator.storage?.persisted?.().then(setPersist).catch(() => undefined); }, []);

  const n = now();
  const device = classifyDevice(readDeviceEnv());
  const st = computeState({ now: n, config: cfg, schedule, adhkar, isMobile: isPhone(cfg.display.deviceMode, device) });
  const sim = simulationInfo();
  const f = (ms?: number | null) => { if (!ms) return '—'; const t = formatTimestamp(ms, '24', 'western'); return `${t.text}:${t.seconds}`; };
  const cov = coverage(schedule, st.today);
  const PH = { normal: 'العرض العادي', quiet: 'الشاشة السوداء', adhkar: 'الأذكار' };

  const check = async () => {
    setServer('checking');
    const off = await measureServerOffset();
    setServer(off);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title="الحالة الآن" actions={sim.active ? <Badge tone="rose">محاكاة ×{sim.speed}</Badge> : <Badge tone="teal">الوقت الحقيقي</Badge>}>
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
          {[
            ['الوقت (مسقط)', <bdi dir="ltr" key="t">{f(n)}</bdi>],
            ['التاريخ المعتمد', <bdi dir="ltr" key="d">{st.today}</bdi>],
            ['الأذان القادم', st.nextAdhan ? <span key="a">{st.nextAdhan.label} — <bdi dir="ltr">{f(st.nextAdhan.at)}</bdi></span> : '—'],
            ['الإقامة القادمة', st.nextIqamah ? <span key="i">{st.nextIqamah.label} — <bdi dir="ltr">{f(st.nextIqamah.at)}</bdi></span> : '—'],
            ['حالة العرض', `${PH[st.phase]}${st.sleep ? ' (توفير الطاقة)' : ''}${st.suppressedByMobile ? ' (مستثنى: هاتف)' : ''}${st.countdown ? ` · عد تنازلي ${st.countdown.seconds}ث` : ''}`],
            ['الاتصال', online ? 'متصل' : 'غير متصل — يعمل محلياً'],
            ['الجدول النشط', schedule ? `${schedule.meta.locationLabel} · v${schedule.meta.version} · ${SOURCE_AR[schedule.meta.source]}` : 'لا يوجد'],
            ['تغطية اليوم', cov.coversToday ? `نعم (+${cov.daysRemaining} يوماً)` : 'لا'],
            ['نوع الجهاز', `${device}${cfg.display.deviceMode !== 'auto' ? ` (يدوي: ${cfg.display.deviceMode})` : ''}`],
            ['تصحيح الساعة', `${Math.round(cfg.display.clockOffsetMs / 1000)} ثانية`],
            ['الإصدار', <bdi dir="ltr" key="v">{__APP_VERSION__} · {__BUILD_ID__.slice(0, 16)}</bdi>],
            ['العمل دون إنترنت', pwa.offlineReady ? 'جاهز (الملفات محفوظة)' : pwa.supported ? 'جارٍ التجهيز…' : 'غير مدعوم في هذا المتصفح'],
            ['التخزين الدائم', persist === null ? 'غير معروف' : persist ? 'ممنوح' : 'غير ممنوح'],
            ['نافذة الإقامة الحالية', st.currentIqamahSlot ?? '—'],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex gap-2"><dt className="min-w-[130px] font-bold text-muted">{k}</dt><dd className="m-0 text-ink">{v}</dd></div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {pwa.updateWaiting && <Btn kind="teal" onClick={() => void applyUpdateNow()}>تطبيق التحديث الآن</Btn>}
          {persist === false && <Btn onClick={() => void requestPersistentStorage().then(setPersist)}>طلب تخزين دائم</Btn>}
        </div>
      </Card>

      <Card title="ساعة الجهاز">
        <p className="m-0 mb-3 text-[13px] text-muted">تعتمد الشاشة على ساعة الجهاز بتوقيت مسقط (UTC+4). إن كانت ساعة التلفاز خاطئة، اضبطها من إعدادات الجهاز، أو أدخل تصحيحاً هنا.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Btn onClick={() => void check()} disabled={!online || server === 'checking'}>فحص الساعة مع الخادم</Btn>
          {typeof server === 'number' && (
            <>
              <Badge tone={Math.abs(server) > 60_000 ? 'rose' : Math.abs(server) > 5_000 ? 'saffron' : 'teal'}>فرق الجهاز: {Math.round(server / 1000)} ثانية</Badge>
              {Math.abs(server) > 2000 && <Btn small kind="primary" onClick={() => void updateConfig((c) => { c.display.clockOffsetMs = c.display.clockOffsetMs + Math.round(server / 1000) * 1000; })}>تطبيق التصحيح</Btn>}
            </>
          )}
          {server === null && !online && <span className="text-[13px] text-muted">الفحص يتطلب اتصالاً بالإنترنت.</span>}
        </div>
        <div className="mt-3"><Grid>
          <Field label="تصحيح يدوي" hint="موجب = تقديم الساعة."><NumberInput value={Math.round(cfg.display.clockOffsetMs / 1000)} min={-86400} max={86400} suffix="ثانية" onCommit={(v) => void updateConfig((c) => { c.display.clockOffsetMs = v * 1000; })} /></Field>
          <Field label="الوقت دون تصحيح"><div className="flex h-11 items-center font-bold" dir="ltr">{f(realNow() - cfg.display.clockOffsetMs)}</div></Field>
        </Grid></div>
      </Card>

      <Card title="المحاكاة (للاختبار فقط)">
        <Note tone="warn">المحاكاة تغيّر الوقت المعروض مؤقتاً لاختبار الانتقالات دون انتظار. تظهر شريطاً أحمر على الشاشة، ولا تُحفظ، وتتوقف عند تحديث الصفحة أو بعد 30 دقيقة.</Note>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_auto_auto]">
          <input type="datetime-local" dir="ltr" step={1} className="h-11 rounded-xl border border-line px-3" value={simAt} onChange={(e) => setSimAt(e.target.value)} />
          <Select value={String(speed)} onChange={(v) => setSpeed(+v)} options={[1, 5, 10, 30, 60].map((x) => ({ value: String(x), label: `السرعة ×${x}` }))} />
          <Btn kind="primary" disabled={!simAt} onClick={() => {
            const [d, t] = simAt.split('T'); const [hh, mm, ss = '0'] = t.split(':');
            const [Y, M, D] = d.split('-').map(Number);
            onSimulate(Date.UTC(Y, M - 1, D, +hh, +mm, +ss) - 4 * 3600_000, speed);
          }}>بدء المحاكاة</Btn>
          <Btn kind="danger" disabled={!sim.active} onClick={stopSimulation}>إيقاف</Btn>
        </div>
        <p className="m-0 mt-2 text-[12px] text-muted">الوقت المُدخل يُفسَّر بتوقيت مسقط.</p>
      </Card>

      <Card title="سجل الأحداث المحلي" actions={<><Btn small onClick={() => void readLogs(150).then(setLogs)}>تحديث</Btn><Btn small kind="danger" onClick={() => void clearLogs().then(() => setLogs([]))}>مسح</Btn></>}>
        <div className="max-h-[320px] overflow-y-auto rounded-xl border border-line">
          {logs.length === 0 ? <p className="m-0 p-3 text-[13px] text-muted">لا توجد أحداث.</p> : (
            <ul className="m-0 list-none p-0 text-[13px]">
              {logs.map((l) => (
                <li key={l.id} className="flex gap-2 border-b border-line px-3 py-1.5 last:border-0">
                  <bdi dir="ltr" className="whitespace-nowrap text-muted">{new Date(l.at).toLocaleString('en-GB', { timeZone: 'Asia/Muscat', hour12: false })}</bdi>
                  <span className={l.level === 'error' ? 'text-rose' : l.level === 'warn' ? 'text-[#8A5A0B]' : 'text-ink'}>{l.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}


/** Seconds for one dhikr: any number (≥ 1, decimals allowed); empty = the default length. */
export function parseSeconds(raw: string): number | null | undefined {
  const t = raw.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[٫,]/g, '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return undefined; // invalid → keep the previous value
  return Math.max(1, Math.round(n * 10) / 10);
}
function DurationInput({ value, fallback, onCommit, testId, wide }: { value: number | null | undefined; fallback: number; onCommit: (v: number | null) => void; testId?: string; wide?: boolean }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  useEffect(() => setV(value == null ? '' : String(value)), [value]);
  const commit = () => {
    const n = parseSeconds(v);
    if (n === undefined) { setV(value == null ? '' : String(value)); return; }
    setV(n == null ? '' : String(n));
    if (n !== (value ?? null)) onCommit(n);
  };
  return (
    <span className={`inline-flex items-center gap-1.5 ${wide ? 'w-full' : ''}`}>
      {!wide && <span className="text-[12px] font-bold text-ink2">مدة العرض</span>}
      <input data-testid={testId} className={`h-9 rounded-xl border border-line px-2 text-center text-[14px] outline-none focus:border-teal ${wide ? 'h-11 w-full' : 'w-[72px]'}`}
        dir="ltr" inputMode="decimal" value={v} placeholder={String(fallback)} aria-label="مدة عرض الذكر بالثواني"
        onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <span className="text-[12px] text-muted">{v.trim() ? 'ثانية' : 'ثانية (افتراضي)'}</span>
    </span>
  );
}
