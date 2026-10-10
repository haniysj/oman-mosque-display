import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AppConfig, PrayerKey, PrayerSchedule } from '../../domain/types';
import { PRAYER_KEYS } from '../../domain/types';
import type { DisplayState } from '../../core/engine';
import { formatClock, formatGregorianAr, WEEKDAYS_AR } from '../../core/time';
import { formatHijriAr, toHijri } from '../../core/hijri';
import { coverage } from '../../core/timetable';
import { updateConfig, useApp } from '../../store/appStore';
import { simulationInfo, stopSimulation } from '../../services/clock';
import { toggleFullscreen, useFullscreen, useWakeLock } from '../../services/platform';
import { IconExitFullscreen, IconFullscreen, IconSettings, IconStop, IconSun } from '../common/icons';
import { LightLayer, PatternLayer } from './Background';
import { eventPhrase, FitText, Pill, remainingText, StableDigits, TimeText } from './parts';
import { useDisplayState } from './useDisplay';
import { AdhkarScreen } from './AdhkarScreen';
import { MosquePicker } from './MosquePicker';
import { ReminderBell } from './ReminderBell';
import { useCloud } from '../../services/cloud';

const PRAYER_NAMES: Record<PrayerKey, string> = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
const STAGE_W = 1920, STAGE_H = 1080;
/** Large portrait screens (tablet, vertical TV): the phone layout scaled up so it fills the height. */
function portraitStage(vw: number, vh: number): { w: number; h: number } {
  const w = Math.min(680, Math.max(360, Math.round(900 * vw / vh)));
  return { w, h: Math.round(w * vh / vw) };
}

/** Stage size that fills the screen: 1920×1080 design, widened or heightened to the screen's aspect. */
function stageFor(vw: number, vh: number): { w: number; h: number } {
  const a = Math.min(3, Math.max(4 / 3, vw / Math.max(1, vh)));
  return a >= STAGE_W / STAGE_H ? { w: Math.round(STAGE_H * a), h: STAGE_H } : { w: STAGE_W, h: Math.round(STAGE_W / a) };
}

function useViewport() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const h = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return vp;
}

export function DisplayScreen({ onOpenAdmin, adminOpen }: { onOpenAdmin: () => void; adminOpen: boolean }) {
  const cfg = useApp((s) => s.config);
  const schedule = useApp((s) => s.schedule);
  const { state, phone, dismissCurrent } = useDisplayState();
  const fs = useFullscreen();
  useWakeLock(cfg.display.wakeLock);
  const vp = useViewport();
  const portrait = vp.w < 760 || vp.h > vp.w * 1.05;

  // ---------------------------------------------------------------- controls visibility
  const [controls, setControls] = useState(!cfg.display.presentation);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const reveal = useCallback((ms = 8000) => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const autoHide = cfg.display.presentation || cfg.display.autoHideControls;
    if (autoHide && !phone) hideTimer.current = setTimeout(() => setControls(false), ms);
  }, [cfg.display.presentation, cfg.display.autoHideControls, phone]);
  useEffect(() => { if (cfg.display.presentation) setControls(false); else reveal(); }, [cfg.display.presentation, reveal]);

  // Full screen: every button disappears after 2 s; any touch brings back ONLY the exit button.
  const [fsBtn, setFsBtn] = useState(false);
  const fsTimer = useRef<ReturnType<typeof setTimeout>>();
  const showFsBtn = useCallback((ms: number) => {
    setFsBtn(true);
    if (fsTimer.current) clearTimeout(fsTimer.current);
    fsTimer.current = setTimeout(() => setFsBtn(false), ms);
  }, []);
  useEffect(() => {
    if (fs) showFsBtn(2000);
    else { setFsBtn(false); if (fsTimer.current) clearTimeout(fsTimer.current); if (!cfg.display.presentation) reveal(); }
  }, [fs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mosque picker: double tap / double click on the mosque name
  const [picker, setPicker] = useState(false);
  const nameTaps = useRef(0);
  const onNameTap = useCallback(() => {
    const t = Date.now();
    if (t - nameTaps.current < 450) { nameTaps.current = 0; setPicker(true); } else nameTaps.current = t;
  }, []);

  // emergency exit: OK/Enter pressed 3 times within 2 s, or triple tap
  const presses = useRef<number[]>([]);
  const emergencyPress = useCallback(() => {
    if (!cfg.quiet.emergencyExit || state.phase === 'normal') return false;
    const t = Date.now();
    presses.current = [...presses.current.filter((x) => t - x < 2000), t];
    if (presses.current.length >= 3) { presses.current = []; dismissCurrent(); }
    return true;
  }, [cfg.quiet.emergencyExit, state.phase, dismissCurrent]);

  useEffect(() => {
    if (adminOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'Enter' || k === ' ' || k === 'OK' || k === 'Select') { if (emergencyPress()) return; if (fs) { showFsBtn(4000); return; } reveal(10000); return; }
      if (k === 'Escape' || k === 'Back' || k === 'GoBack') { setControls((v) => !v); return; }
      if (k === 'f' || k === 'F') { void toggleFullscreen(); return; }
      if (k === 'p' || k === 'P') { void updateConfig((c) => { c.display.presentation = !c.display.presentation; }); return; }
      if ((k === 's' || k === 'S') && e.shiftKey) { onOpenAdmin(); return; }
      if (k.startsWith('Arrow') || k === 'ContextMenu' || k === 'Menu') reveal(10000);
    };
    const onMove = () => { if (!cfg.display.presentation && !fs) reveal(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousemove', onMove);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousemove', onMove); };
  }, [adminOpen, emergencyPress, reveal, cfg.display.presentation, onOpenAdmin, fs, showFsBtn]);

  const taps = useRef<number[]>([]);
  const onPointer = () => {
    if (emergencyPress()) return;
    if (fs) { showFsBtn(3000); return; }
    const t = Date.now();
    taps.current = [...taps.current.filter((x) => t - x < 600), t];
    if (taps.current.length >= 2 || !cfg.display.presentation) { taps.current = []; reveal(10000); }
  };

  const themeClass = [
    `theme-${cfg.display.highContrast ? 'contrast' : cfg.display.theme}`,
    state.plan?.isFriday && cfg.friday.themeVariation ? 'is-friday' : '',
  ].join(' ');

  const sim = simulationInfo();
  const cloudCode = useCloud().binding?.code ?? null;
  const showControls = controls && !(state.phase === 'quiet' && !phone);

  const controlBar = fs ? (fsBtn && (
    <div className="ctrl-bar" role="toolbar" aria-label="الخروج من ملء الشاشة">
      <button className="ctrl-btn" onClick={() => void toggleFullscreen()} aria-label="الخروج من ملء الشاشة"><IconExitFullscreen size={phone ? 22 : 26} /></button>
    </div>
  )) : showControls && (
    <div className="ctrl-bar" role="toolbar" aria-label="أزرار التحكم">
      <button className="ctrl-btn" onClick={onOpenAdmin} aria-label="الإعدادات"><IconSettings size={phone ? 22 : 26} /></button>
      <button className="ctrl-btn" onClick={() => void toggleFullscreen()} aria-label={fs ? 'الخروج من ملء الشاشة' : 'ملء الشاشة'}>
        {fs ? <IconExitFullscreen size={phone ? 22 : 26} /> : <IconFullscreen size={phone ? 22 : 26} />}
      </button>
    </div>
  );

  const simBanner = sim.active && (
    <div className="sim-banner" role="status">
      <span>وضع المحاكاة — الوقت المعروض ليس حقيقياً (×{sim.speed})</span>
      <button onClick={stopSimulation}><IconStop size={16} /> إيقاف المحاكاة</button>
    </div>
  );

  // Black screen after iqamah — nothing at all is rendered except a black surface.
  if (state.phase === 'quiet') {
    const qc = formatClock(state.parts.hour * 60 + state.parts.minute, 0, cfg.display.timeFormat, cfg.display.digits);
    const m = state.parts.minute; // drift a little every minute (no burn-in on the screen)
    const drift = { transform: `translate(${((m % 5) - 2) * 1.6}vmin, ${(((m * 3) % 5) - 2) * 1.6}vmin)` };
    return (
      <div className="quiet-screen" onPointerDown={onPointer} aria-label="وقت الصلاة">
        <div className="quiet-clock" style={drift} aria-hidden>
          <bdi className="num">{qc.text}</bdi>{qc.period && <span className="quiet-period">{qc.period}</span>}
        </div>
        {simBanner}
      </div>
    );
  }

  return (
    <div className={`display-root ${themeClass} ${portrait ? 'is-portrait' : ''} ${cfg.display.presentation ? 'is-presentation' : ''}`} onPointerDown={onPointer}>
      <div className="bg-base" aria-hidden />
      <PatternLayer theme={cfg.display.theme} highContrast={cfg.display.highContrast} />
      <LightLayer mode={cfg.display.background} intensity={cfg.display.highContrast ? Math.min(30, cfg.display.animationIntensity) : cfg.display.animationIntensity} theme={cfg.display.highContrast ? 'contrast' : cfg.display.theme} />
      {simBanner}
      {portrait && state.phase === 'adhkar' && !phone ? (
        // large portrait screen (vertical TV): adhkar on a tall stage
        <Stage vpW={vp.w} vpH={vp.h} w={1080} h={Math.round(1080 * vp.h / vp.w)} className="is-tall">
          <AdhkarScreen state={state} cfg={cfg} />
          {controlBar}
        </Stage>
      ) : portrait ? (
        vp.w < 760
          ? <MobileView state={state} cfg={cfg} hasSchedule={!!schedule} controls={controlBar} onNameTap={onNameTap} fs={fs} />
          : (
            // tablet / vertical TV: the phone layout, scaled to fill the screen
            <Stage vpW={vp.w} vpH={vp.h} {...portraitStage(vp.w, vp.h)} className="is-portrait-stage">
              <MobileView state={state} cfg={cfg} hasSchedule={!!schedule} controls={controlBar} onNameTap={onNameTap} fs={fs} />
            </Stage>
          )
      ) : (
        <Stage vpW={vp.w} vpH={vp.h} {...stageFor(vp.w, vp.h)}>
          {state.phase === 'adhkar'
            ? <AdhkarScreen state={state} cfg={cfg} />
            : <TvView state={state} cfg={cfg} hasSchedule={!!schedule} onOpenAdmin={onOpenAdmin} onNameTap={onNameTap} />}
          {controlBar}
        </Stage>
      )}
      {picker && <MosquePicker current={cloudCode} onClose={() => setPicker(false)} />}
    </div>
  );
}

function Stage({ vpW, vpH, w, h, className = '', children }: { vpW: number; vpH: number; w: number; h: number; className?: string; children: React.ReactNode }) {
  const scale = Math.min(vpW / w, vpH / h);
  const style: CSSProperties = {
    width: w, height: h,
    transform: `translate(${(vpW - w * scale) / 2}px, ${(vpH - h * scale) / 2}px) scale(${scale})`,
  };
  return <div className={`stage ${className}`} style={style}>{children}</div>;
}

// ------------------------------------------------------------------------------ helpers

function useDates(state: DisplayState, cfg: AppConfig) {
  const hijri = formatHijriAr(toHijri(state.hijriDate, cfg.hijri.adjustment), cfg.display.digits);
  const greg = formatGregorianAr(state.today, cfg.display.digits);
  const weekday = WEEKDAYS_AR[state.parts.weekday];
  return { hijri, greg, weekday };
}

/** Which badge today's data needs: demo always; uncalibrated calculation when enabled; official / calibrated none. */
function todaySourceBadge(schedule: PrayerSchedule | null, today: string, cfg: AppConfig): 'demo' | 'calculated' | null {
  if (!schedule) return null;
  const src = schedule.days[today]?.source ?? schedule.meta.source;
  if (src === 'demo' || schedule.meta.source === 'demo') return 'demo';
  if (src === 'calculated' && cfg.display.showSourceBadge) return 'calculated';
  return null;
}

function SourceBadge({ kind }: { kind: 'demo' | 'calculated' | null }) {
  if (kind === 'demo') return <div className="source-badge source-badge--demo">DEMO DATA — بيانات تجريبية، ليست مواقيت رسمية</div>;
  if (kind === 'calculated') return <div className="source-badge">مواقيت محسوبة تقديرياً — غير رسمية</div>;
  return null;
}

function iqamahRowLabel(slot: PrayerKey, state: DisplayState, cfg: AppConfig) {
  if (slot === 'dhuhr' && state.plan?.isFriday) return cfg.friday.rowMode === 'replace' ? cfg.friday.label || 'الجمعة' : `الظهر / ${cfg.friday.label || 'الجمعة'}`;
  return PRAYER_NAMES[slot];
}
function prayerRowLabel(slot: PrayerKey, state: DisplayState, cfg: AppConfig) {
  return slot === 'dhuhr' && state.plan?.isFriday ? cfg.friday.label || 'الجمعة' : PRAYER_NAMES[slot];
}

// ------------------------------------------------------------------------------ TV (16:9)

function TvView({ state, cfg, hasSchedule, onOpenAdmin, onNameTap }: { state: DisplayState; cfg: AppConfig; hasSchedule: boolean; onOpenAdmin: () => void; onNameTap: () => void }) {
  const d = cfg.display;
  const { hijri, greg, weekday } = useDates(state, cfg);
  const clock = formatClock(state.parts.hour * 60 + state.parts.minute, state.parts.second, d.timeFormat, d.digits);
  const plan = state.plan;
  const panelStyle = { '--panel-scale': d.panelScale / 100 } as CSSProperties;
  const schedule = useApp((s) => s.schedule);
  const cov = coverage(schedule, state.today);
  const badge = todaySourceBadge(schedule, state.today, cfg);
  const badgeShown = !!badge;

  const prayers = (
    <section className="panel" style={panelStyle} aria-label="الأذان">
      <h2 className="panel-title">الأذان</h2>
      {plan ? (
        <ul className="rows">
          {(['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const).map((k) => {
            if (k === 'sunrise') {
              return (
                <li key={k} className="row row--sunrise">
                  <span className="row-name"><IconSun size={34} className="sun-ico" />الشروق</span>
                  <TimeText ms={plan.sunrise} cfg={cfg} className="row-time" />
                </li>
              );
            }
            const next = state.nextPrayerSlot === k;
            return (
              <li key={k} className={`row ${next ? 'is-next' : ''}`}>
                <span className="row-name">{prayerRowLabel(k, state, cfg)}{next && <Pill tone="gold">القادمة</Pill>}</span>
                <TimeText ms={plan.adhan[k]} cfg={cfg} className="row-time" />
              </li>
            );
          })}
        </ul>
      ) : <p className="panel-empty">لا توجد مواقيت لهذا اليوم</p>}
    </section>
  );

  const iqamah = (
    <section className="panel" style={panelStyle} aria-label="الإقامة">
      <h2 className="panel-title">الإقامة</h2>
      {plan ? (
        <ul className="rows">
          {PRAYER_KEYS.flatMap((k) => {
            const cur = state.currentIqamahSlot === k;
            const row = (
              <li key={k} className={`row ${cur ? 'is-current' : ''}`}>
                <span className="row-name">{iqamahRowLabel(k, state, cfg)}{cur && <Pill tone="ivory">الآن</Pill>}</span>
                <TimeText ms={plan.iqamah[k].at} cfg={cfg} className="row-time" />
              </li>
            );
            if (k !== 'fajr') return [row];
            return [row, (
              <li key="duha" className="row row--duha">
                <span className="row-name">صلاة الضحى</span>
                <TimeText ms={plan.duha} cfg={cfg} className="row-time" />
              </li>
            )];
          })}
        </ul>
      ) : <p className="panel-empty">—</p>}
    </section>
  );

  const cd = state.countdown;
  const final = cd && cd.seconds <= 10;

  return (
    <div className={`tv ${cd && d.countdownFocus ? 'is-countdown' : ''}`}>
      <header className={`tv-head tv-head--${d.namePosition}`}>
        {cfg.mosque.logoDataUrl && <img className="tv-logo" src={cfg.mosque.logoDataUrl} alt="" />}
        <div className="tv-names name-tap" onClick={onNameTap} title="اضغط مرتين لتغيير المسجد">
          <FitText text={cfg.mosque.nameAr || 'اسم المسجد'} base={Math.round(84 * d.nameScale / 100)} min={40} lines={2} className="tv-name" />
          {d.showEnglishName && cfg.mosque.nameEn && <div className="tv-name-en" dir="ltr">{cfg.mosque.nameEn}</div>}
        </div>
      </header>

      <main className={`tv-main ${d.panelsSwapped ? 'is-swapped' : ''}`}>
        {prayers}
        <section className="tv-center" aria-live="polite">
          <svg className="mihrab" viewBox="0 0 640 660" preserveAspectRatio="none" aria-hidden>
            <path d="M24 652V300C24 150 170 52 320 10 470 52 616 150 616 300V652" />
            <path className="inner" d="M48 652V306C48 172 182 84 320 44 458 84 592 172 592 306V652" />
          </svg>
          {cd ? (
            <div className={`countdown ${final ? 'is-final' : ''}`} role="timer">
              <div className="countdown-clock"><bdi className="num">{clock.text}</bdi> <span>{clock.period}</span></div>
              <div className="countdown-label">{eventPhrase(cd.event)} بعد</div>
              <StableDigits className="countdown-digits" text={remainingText(state, cd.event, d.digits)} />
              <div className="countdown-unit">ثانية</div>
            </div>
          ) : (
            <div className="clock" style={{ '--clock-scale': d.clockScale / 100 } as CSSProperties}>
              <div className="clock-row">
                {clock.period && <span className="clock-period" dir="rtl">{clock.period}</span>}
                <StableDigits className="clock-time" text={clock.text} />
                {d.showSeconds && <StableDigits className="clock-sec" text={clock.seconds} />}
              </div>
              <div className="clock-meta">
                <div className="clock-day">{weekday}</div>
                <div className="meta-sep" aria-hidden />
                <div className="clock-dates">
                  <div className="date-hijri">{hijri}</div>
                  <div className="date-greg">{greg}</div>
                </div>
              </div>
            </div>
          )}
        </section>
        {iqamah}
      </main>

      <footer className="tv-foot">
        {!hasSchedule ? (
          <div className="foot-warn">
            لم يُضبط جدول المواقيت بعد
            {!cfg.display.presentation && <button className="foot-btn" onClick={onOpenAdmin}>فتح الإعدادات</button>}
          </div>
        ) : !cov.coversToday ? (
          <div className="foot-warn">جدول المواقيت لا يغطي تاريخ اليوم — يرجى تحديث الجدول من الإعدادات</div>
        ) : (
          <>
            <div className="foot-item">
              <span className="foot-label">{state.nextAdhan ? eventPhrase(state.nextAdhan) : 'الأذان القادم'}</span>
              <span className="foot-sep" aria-hidden />
              <span className="foot-value">بعد <StableDigits text={remainingText(state, state.nextAdhan, d.digits)} /></span>
            </div>
            {badgeShown
              ? <SourceBadge kind={badge} />
              : plan?.isFriday && cfg.friday.announcement
                ? <div className="foot-note">{cfg.friday.announcement}</div>
                : <div className="foot-dot" aria-hidden />}
            <div className="foot-item">
              <span className="foot-label">{state.nextIqamah ? eventPhrase(state.nextIqamah) : 'الإقامة القادمة'}</span>
              <span className="foot-sep" aria-hidden />
              <span className="foot-value">بعد <StableDigits text={remainingText(state, state.nextIqamah, d.digits)} /></span>
            </div>
          </>
        )}
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------------------ Phone / portrait

function MobileView({ state, cfg, hasSchedule, controls, onNameTap, fs }: { state: DisplayState; cfg: AppConfig; hasSchedule: boolean; controls: React.ReactNode; onNameTap: () => void; fs: boolean }) {
  const mSchedule = useApp((s) => s.schedule);
  const d = cfg.display;
  const { hijri, greg, weekday } = useDates(state, cfg);
  const clock = formatClock(state.parts.hour * 60 + state.parts.minute, state.parts.second, d.timeFormat, d.digits);
  const plan = state.plan;
  const cd = state.countdown;
  const inSequence = state.suppressedByMobile && state.sequence;

  return (
    <div className={`m-root ${cd && d.countdownFocus ? 'is-countdown' : ''}`}>
      <header className={`m-head m-head--${d.namePosition}`}>
        <div className="m-names">
          <div onClick={onNameTap} role="button" aria-label="اضغط مرتين لتغيير المسجد" className="m-name-tap name-tap">
            <FitText text={cfg.mosque.nameAr || 'اسم المسجد'} base={30} min={20} lines={2} className="m-name" />
          </div>
          {d.showEnglishName && cfg.mosque.nameEn && <div className="m-name-en" dir="ltr">{cfg.mosque.nameEn}</div>}
        </div>
        <div className="m-actions">
          {!fs && <ReminderBell />}
          {controls}
        </div>
      </header>
      <SourceBadge kind={todaySourceBadge(mSchedule, state.today, cfg)} />

      <section className="m-clock" aria-live="polite">
        {cd ? (
          <div className={`m-count ${cd.seconds <= 10 ? 'is-final' : ''}`} role="timer">
            <div className="m-count-label">{eventPhrase(cd.event)} بعد</div>
            <StableDigits className="m-count-digits" text={remainingText(state, cd.event, d.digits)} />
          </div>
        ) : (
          <div className="m-time">
            {clock.period && <span className="m-time-period">{clock.period}</span>}
            <StableDigits text={clock.text} className="m-time-main" />
            {d.showSeconds && <StableDigits text={clock.seconds} className="m-time-sec" />}
          </div>
        )}
        <div className="m-meta">
          <div className="m-day">{weekday}</div>
          <div className="meta-sep" aria-hidden />
          <div className="m-dates"><span>{hijri}</span><span>{greg}</span></div>
        </div>
      </section>

      {inSequence && (
        <div className="m-note">{state.phase === 'normal' ? `صلاة ${state.sequence!.label} قائمة الآن` : ''}</div>
      )}

      {plan ? (
        <table className="m-table">
          <thead><tr><th scope="col">الأذان</th><th scope="col" className="m-col-name">الصلاة</th><th scope="col">الإقامة</th></tr></thead>
          <tbody>
            {PRAYER_KEYS.flatMap((k) => {
              const row = (
                <tr key={k} className={`${state.nextPrayerSlot === k ? 'is-next' : ''} ${state.currentIqamahSlot === k ? 'is-current' : ''}`}>
                  <td><TimeText ms={plan.adhan[k]} cfg={cfg} /></td>
                  <th scope="row" className="m-col-name">
                    <span className="m-pname">{prayerRowLabel(k, state, cfg)}</span>
                    {state.nextPrayerSlot === k && <span className="m-tag">القادمة</span>}
                    {state.currentIqamahSlot === k && <span className="m-tag m-tag--now">الآن</span>}
                  </th>
                  <td><TimeText ms={plan.iqamah[k].at} cfg={cfg} /></td>
                </tr>
              );
              if (k !== 'fajr') return [row];
              return [row, (
                <tr key="sunrise" className="is-sunrise">
                  <td><TimeText ms={plan.sunrise} cfg={cfg} /></td>
                  <th scope="row" className="m-col-name"><span className="m-pname">الشروق / الضحى</span></th>
                  <td><TimeText ms={plan.duha} cfg={cfg} /></td>
                </tr>
              )];
            })}
          </tbody>
        </table>
      ) : (
        <div className="m-empty">{hasSchedule ? 'جدول المواقيت لا يغطي تاريخ اليوم' : 'اضغط مرتين على اسم المسجد لاختيار مسجدك'}</div>
      )}

      {plan && (state.nextAdhan || state.nextIqamah) && (
        <div className="m-next">
          {state.nextAdhan && <div><span>{eventPhrase(state.nextAdhan)}</span><b>بعد <StableDigits text={remainingText(state, state.nextAdhan, d.digits)} /></b></div>}
          {state.nextIqamah && <div><span>{eventPhrase(state.nextIqamah)}</span><b>بعد <StableDigits text={remainingText(state, state.nextIqamah, d.digits)} /></b></div>}
        </div>
      )}
      {plan?.isFriday && cfg.friday.announcement && <div className="m-announce">{cfg.friday.announcement}</div>}
    </div>
  );
}
