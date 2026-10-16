/**
 * Core data model. All clock times are "HH:MM" (24-hour) strings interpreted in
 * Asia/Muscat local time (UTC+04:00, Oman observes no daylight saving).
 * All dates are ISO "YYYY-MM-DD" Gregorian dates in Muscat local time.
 */

export const DATA_VERSION = 1;

export type PrayerKey = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
export const PRAYER_KEYS: PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
export type TimeKey = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
export const TIME_KEYS: TimeKey[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** Where a timetable came from. Shown in the admin panel and (for demo/calculated) on the display. */
export type DataSourceKind =
  | 'official' // transcribed/imported by the administrator from the Ministry (MARA) timetable
  | 'admin' // entered or edited manually by the administrator
  | 'calibrated' // calculated on this device with a profile fitted to official ministry days — NOT official
  | 'calculated' // astronomically calculated on this device — NOT official
  | 'demo'; // development sample — NOT official

export interface Location {
  governorateId: string;
  wilayatId: string;
  /** Optional custom coordinates (used only for the calculated generator). */
  customLat?: number | null;
  customLng?: number | null;
}

export interface DailyPrayerTimes {
  date: string; // YYYY-MM-DD
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
  /** Optional Friday-specific prayer (Jumu'ah) start time for this date. */
  jumuah?: string;
  /** Optional iqamah overrides for this date (HH:MM). */
  iqamah?: Partial<Record<PrayerKey | 'jumuah', string>>;
  /** Per-record source when it differs from the schedule (e.g. one day edited by the admin). */
  source?: DataSourceKind;
}

export interface TimetableMetadata {
  id: string; // stable identifier
  version: number; // increments on every change
  source: DataSourceKind;
  sourceNote: string; // e.g. "تقويم وزارة الأوقاف 2026 — ولاية بوشر"
  locationLabel: string; // e.g. "مسقط — بوشر"
  wilayatId: string;
  years: number[];
  firstDate: string;
  lastDate: string;
  dayCount: number;
  importedAt: string; // ISO timestamp
  lastUpdated: string; // ISO timestamp of last successful change
  calcMethod?: string; // for calculated schedules
}

export interface PrayerSchedule {
  dataVersion: number;
  meta: TimetableMetadata;
  days: Record<string, DailyPrayerTimes>;
}

export type IqamahMode = 'delay' | 'fixed';

export interface IqamahRule {
  mode: IqamahMode;
  delay: number; // minutes after adhan
  fixedTime: string; // HH:MM, used when mode = 'fixed'
}

export interface IqamahConfiguration {
  rules: Record<PrayerKey, IqamahRule>;
  /** Weekday-specific rules: weekday 0=Sunday … 6=Saturday. */
  weekdayRules: Partial<Record<number, Partial<Record<PrayerKey, IqamahRule>>>>;
  /** Date-specific exceptions (highest priority). */
  dateExceptions: { id: string; date: string; prayer: PrayerKey | 'jumuah'; time: string; note?: string }[];
  /** Frozen iqamah: a prayer's iqamah held at one clock time every day (overrides the daily and
   *  weekday rules and timetable overrides; date exceptions still win). Not shown on the screen. */
  locks: Partial<Record<PrayerKey, { enabled: boolean; time: string }>>;
}

export interface FridayConfiguration {
  enabled: boolean;
  /** Set once the administrator has saved Friday settings explicitly. */
  configured: boolean;
  label: string; // "الجمعة"
  startMode: 'dhuhr' | 'fixed'; // Jumu'ah start = verified Dhuhr time, or a fixed mosque time
  startTime: string; // HH:MM when startMode = 'fixed'
  iqamah: IqamahRule; // independent of the normal Dhuhr iqamah
  quietMinutes: number;
  adhkarMinutes: number;
  countdownEnabled: boolean;
  announcement: string;
  rowMode: 'replace' | 'relabel'; // replace the Dhuhr iqamah row, or keep it and relabel
  themeVariation: boolean;
}

export interface HijriSettings {
  adjustment: number; // days, admin-controlled
  maxAdjustment: number; // range limit (default 3, expandable)
  changeAtMaghrib: boolean; // advance the displayed Hijri date after Maghrib
}

export interface QuietSettings {
  enabled: boolean;
  minutes: number;
  prayers: Record<PrayerKey | 'jumuah', boolean>;
  mobileException: boolean; // never black-screen on phones (always true by default)
  emergencyExit: boolean; // allow a remote/keyboard key to end the current sequence
}

/** A set of adhkar (e.g. after the prayer, morning, evening) shown after the chosen prayers. */
export interface AdhkarGroup {
  id: string;
  name: string;
  enabled: boolean;
  prayers: Record<PrayerKey | 'jumuah', boolean>; // after which prayers this group is shown
}

export interface AdhkarSettings {
  enabled: boolean;
  minutes: number;
  defaultSeconds: number; // 60 by default
  audio: boolean; // never used unless enabled explicitly (no audio assets bundled)
  groups: AdhkarGroup[]; // display order = array order
}

export interface AdhkarItem {
  id: string;
  text: string;
  category: string;
  source: string;
  seconds: number | null; // null → defaultSeconds
  enabled: boolean;
  order: number;
  groupId?: string; // AdhkarGroup.id (older items: inferred from the category)
}

export type DeviceMode = 'auto' | 'tv' | 'desktop' | 'mobile';
export type Theme = 'ornamental' | 'minimal' | 'navy' | 'maroon' | 'turquoise' | 'amethyst' | 'sand';
export type Background = 'static' | 'animated';
export type DigitStyle = 'arabic' | 'western';

export interface DisplayPreferences {
  theme: Theme;
  background: Background;
  animationIntensity: number; // 0..100
  highContrast: boolean;
  digits: DigitStyle;
  timeFormat: '12' | '24';
  clockScale: number; // 70..130 %
  nameScale: number; // 60..140 %
  panelScale: number; // 80..120 %
  namePosition: 'center' | 'right';
  panelsSwapped: boolean; // swap left/right panels
  showSeconds: boolean;
  countdownFocus: boolean;
  screenLayout: 'full' | 'third' | 'half'; // TV/desktop: share of the screen for the prayer times (rest = adhkar)
  layoutSide: 'right' | 'left'; // side of the prayer times when the screen is split
  splitAdhkarSeconds: number; // seconds per dhikr in the split adhkar area
  adhkarKashida: boolean; // «الحروف المرسلة»: elongated word endings in the adhkar text (display only)
  showEnglishName: boolean;
  showSourceBadge: boolean; // badge for calculated data (demo is always labelled)
  autoHideControls: boolean;
  presentation: boolean; // kiosk mode: controls hidden
  deviceMode: DeviceMode;
  wakeLock: boolean;
  duhaMinutesAfterSunrise: number;
  adminPinHash: string; // empty = no PIN
  clockOffsetMs: number; // manual / server-derived correction applied to the device clock
  autoClockCorrection: boolean;
}

export interface MosqueSettings {
  nameAr: string;
  nameEn: string;
  logoDataUrl: string; // optional, stored locally
  location: Location;
}

export interface CalcSettings {
  /** Fitted to official ministry days (see core/calibrate.ts). Stored as plain data. */
  profile: import('../core/calibrate').CalibrationProfile | null;
  /** Keep the timetable filled ahead automatically with calibrated times (official days are never overwritten). */
  autoExtend: boolean;
  /** Generate for the mosque's own coordinates (if set) instead of the wilayat centre. */
  useMosqueCoords: boolean;
}

export interface AppConfig {
  dataVersion: number;
  mosque: MosqueSettings;
  iqamah: IqamahConfiguration;
  friday: FridayConfiguration;
  hijri: HijriSettings;
  quiet: QuietSettings;
  adhkar: AdhkarSettings;
  display: DisplayPreferences;
  calc: CalcSettings;
  /** This mosque's own changes to its wilayat timetable: date → times (HH:MM) that replace the
   *  wilayat's. Never changes the wilayat table or other mosques. */
  timeOverrides?: Record<string, Partial<Record<TimeKey | 'jumuah', string>>>;
}

export interface ApplicationBackup {
  kind: 'oman-mosque-display-backup';
  dataVersion: number;
  appVersion: string;
  createdAt: string;
  config: AppConfig;
  schedule: PrayerSchedule | null;
  adhkar: AdhkarItem[];
}

export interface LogEntry {
  id?: number;
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}
