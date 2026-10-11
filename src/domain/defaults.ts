import { DATA_VERSION, type AdhkarItem, type AppConfig, type IqamahRule, type PrayerKey } from './types';

const rule = (delay: number): IqamahRule => ({ mode: 'delay', delay, fixedTime: '' });

/** Demonstration defaults only — every value is editable in the administration panel. */
export const DEFAULT_IQAMAH_DELAYS: Record<PrayerKey, number> = { fajr: 20, dhuhr: 20, asr: 20, maghrib: 10, isha: 20 };

export function defaultConfig(): AppConfig {
  return {
    dataVersion: DATA_VERSION,
    mosque: {
      nameAr: 'جامع النور',
      nameEn: '',
      logoDataUrl: '',
      location: { governorateId: 'muscat', wilayatId: 'bawshar', customLat: null, customLng: null },
    },
    iqamah: {
      rules: {
        fajr: rule(DEFAULT_IQAMAH_DELAYS.fajr),
        dhuhr: rule(DEFAULT_IQAMAH_DELAYS.dhuhr),
        asr: rule(DEFAULT_IQAMAH_DELAYS.asr),
        maghrib: rule(DEFAULT_IQAMAH_DELAYS.maghrib),
        isha: rule(DEFAULT_IQAMAH_DELAYS.isha),
      },
      weekdayRules: {},
      dateExceptions: [],
      locks: {},
    },
    friday: {
      enabled: true,
      configured: false,
      label: 'الجمعة',
      startMode: 'dhuhr',
      startTime: '12:30',
      iqamah: { mode: 'fixed', delay: 30, fixedTime: '' },
      quietMinutes: 5,
      adhkarMinutes: 5,
      countdownEnabled: true,
      announcement: '',
      rowMode: 'replace',
      themeVariation: true,
    },
    hijri: { adjustment: 0, maxAdjustment: 3, changeAtMaghrib: false },
    quiet: {
      enabled: true,
      minutes: 5,
      prayers: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true, jumuah: true },
      mobileException: true,
      emergencyExit: true,
    },
    adhkar: { enabled: true, minutes: 5, defaultSeconds: 60, audio: false },
    display: {
      theme: 'ornamental',
      background: 'animated',
      animationIntensity: 50,
      highContrast: false,
      digits: 'western',
      timeFormat: '12',
      clockScale: 100,
      nameScale: 100,
      panelScale: 100,
      namePosition: 'center',
      panelsSwapped: false,
      showSeconds: true,
      countdownFocus: true,
      screenLayout: 'full',
      layoutSide: 'right',
      splitAdhkarSeconds: 20,
      showEnglishName: true,
      showSourceBadge: true,
      autoHideControls: true,
      presentation: false,
      deviceMode: 'auto',
      wakeLock: true,
      duhaMinutesAfterSunrise: 20,
      adminPinHash: '',
      clockOffsetMs: 0,
      autoClockCorrection: false,
    },
    calc: { profile: null, autoExtend: true, useMosqueCoords: false },
  };
}

/**
 * Default post-prayer adhkar. Texts are from the Qur'an and well-known authenticated
 * hadith collections; references are given so administrators can verify them.
 */
export function defaultAdhkar(): AdhkarItem[] {
  const items: Omit<AdhkarItem, 'id' | 'order'>[] = [
    {
      text: 'أستغفرُ الله، أستغفرُ الله، أستغفرُ الله.\nاللهمّ أنت السلام ومنك السلام، تباركتَ يا ذا الجلال والإكرام',
      category: 'أذكار بعد الصلاة', source: 'رواه مسلم (591)', seconds: null, enabled: true,
    },
    {
      text: 'لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير.\nاللهمّ لا مانع لما أعطيت، ولا معطي لما منعت، ولا ينفع ذا الجدّ منك الجدّ',
      category: 'أذكار بعد الصلاة', source: 'رواه البخاري (844) ومسلم (593)', seconds: null, enabled: true,
    },
    {
      text: 'سبحان الله (٣٣) — الحمد لله (٣٣) — الله أكبر (٣٣)\nوتمام المائة: لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير',
      category: 'أذكار بعد الصلاة', source: 'رواه مسلم (597)', seconds: null, enabled: true,
    },
    {
      text: 'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ ۚ لَّهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ ۗ مَن ذَا الَّذِي يَشْفَعُ عِندَهُ إِلَّا بِإِذْنِهِ ۚ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ ۖ وَلَا يُحِيطُونَ بِشَيْءٍ مِّنْ عِلْمِهِ إِلَّا بِمَا شَاءَ ۚ وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ ۖ وَلَا يَئُودُهُ حِفْظُهُمَا ۚ وَهُوَ الْعَلِيُّ الْعَظِيمُ',
      category: 'آية الكرسي', source: 'سورة البقرة: 255', seconds: null, enabled: true,
    },
    {
      text: 'اللهمّ أعنّي على ذكرك وشكرك وحسن عبادتك',
      category: 'أذكار بعد الصلاة', source: 'رواه أبو داود (1522) والنسائي (1303)', seconds: null, enabled: true,
    },
    {
      text: 'قُلْ هُوَ اللَّهُ أَحَدٌ ۝ اللَّهُ الصَّمَدُ ۝ لَمْ يَلِدْ وَلَمْ يُولَدْ ۝ وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ',
      category: 'المعوذات', source: 'سورة الإخلاص', seconds: null, enabled: true,
    },
  ];
  return items.map((x, i) => ({ ...x, id: `dhikr-${i + 1}`, order: i }));
}

/** Deep-merges stored config over defaults so new settings fields get sane values after upgrades. */
export function mergeConfig(stored: unknown): AppConfig {
  const base = defaultConfig();
  if (!stored || typeof stored !== 'object') return base;
  const deep = (a: unknown, b: unknown): unknown => {
    if (Array.isArray(a)) return Array.isArray(b) ? b : a;
    if (a && typeof a === 'object') {
      const out: Record<string, unknown> = { ...(a as object) } as Record<string, unknown>;
      if (b && typeof b === 'object' && !Array.isArray(b)) {
        for (const [k, v] of Object.entries(b as object)) {
          out[k] = k in out ? deep(out[k], v) : v;
        }
      }
      return out;
    }
    if (a === null || a === undefined) return b === undefined ? a : b;
    return b === undefined || b === null ? a : typeof b === typeof a ? b : a;
  };
  const merged = deep(base, stored) as AppConfig;
  // weekdayRules is a sparse map — take it as stored
  const s = stored as Partial<AppConfig>;
  if (s.iqamah?.weekdayRules) merged.iqamah.weekdayRules = s.iqamah.weekdayRules;
  merged.dataVersion = DATA_VERSION;
  return merged;
}
