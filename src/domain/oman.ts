/**
 * Administrative divisions of the Sultanate of Oman: 11 governorates, 63 wilayats.
 * Basis: Governorates system (Royal Decree 36/2022) and the Ministry of Interior statement
 * of 19 June 2022 on Al Jabal Al Akhdar (Ad Dakhiliyah) and Sinaw (North Al Sharqiyah)
 * being represented as wilayats.
 *
 * Coordinates are APPROXIMATE town-centre values used only by the on-device astronomical
 * calculator. They never affect imported official timetables. Administrators may enter
 * precise coordinates for their mosque in the settings.
 */

export interface Wilayat {
  id: string;
  ar: string;
  en: string;
  lat: number;
  lng: number;
}

export interface Governorate {
  id: string;
  ar: string;
  en: string;
  wilayats: Wilayat[];
}

const w = (id: string, ar: string, en: string, lat: number, lng: number): Wilayat => ({ id, ar, en, lat, lng });

export const GOVERNORATES: Governorate[] = [
  {
    id: 'muscat', ar: 'مسقط', en: 'Muscat', wilayats: [
      w('muscat', 'مسقط', 'Muscat', 23.614, 58.593),
      w('muttrah', 'مطرح', 'Muttrah', 23.617, 58.565),
      w('bawshar', 'بوشر', 'Bawshar', 23.577, 58.4),
      w('seeb', 'السيب', 'As Seeb', 23.67, 58.189),
      w('amerat', 'العامرات', 'Al Amerat', 23.523, 58.497),
      w('qurayyat', 'قريات', 'Qurayyat', 23.264, 58.919),
    ],
  },
  {
    id: 'dhofar', ar: 'ظفار', en: 'Dhofar', wilayats: [
      w('salalah', 'صلالة', 'Salalah', 17.019, 54.089),
      w('taqah', 'طاقة', 'Taqah', 17.037, 54.403),
      w('mirbat', 'مرباط', 'Mirbat', 16.993, 54.692),
      w('rakhyut', 'رخيوت', 'Rakhyut', 16.745, 53.416),
      w('thumrait', 'ثمريت', 'Thumrait', 17.666, 54.025),
      w('dhalkut', 'ضلكوت', 'Dhalkut', 16.708, 53.252),
      w('mazyunah', 'المزيونة', 'Al Mazyunah', 17.846, 52.651),
      w('muqshin', 'مقشن', 'Muqshin', 19.556, 54.881),
      w('shalim', 'شليم وجزر الحلانيات', 'Shalim and Al Hallaniyat Islands', 18.14, 55.6),
      w('sadah', 'سدح', 'Sadah', 17.051, 55.071),
    ],
  },
  {
    id: 'musandam', ar: 'مسندم', en: 'Musandam', wilayats: [
      w('khasab', 'خصب', 'Khasab', 26.18, 56.248),
      w('dibba', 'دبا', 'Dibba', 25.618, 56.257),
      w('bukha', 'بخا', 'Bukha', 26.143, 56.15),
      w('madha', 'مدحاء', 'Madha', 25.284, 56.333),
    ],
  },
  {
    id: 'buraimi', ar: 'البريمي', en: 'Al Buraimi', wilayats: [
      w('buraimi', 'البريمي', 'Al Buraimi', 24.25, 55.793),
      w('mahdah', 'محضة', 'Mahdah', 24.4, 55.97),
      w('sunaynah', 'السنينة', 'As Sunaynah', 23.66, 55.95),
    ],
  },
  {
    id: 'dakhiliyah', ar: 'الداخلية', en: 'Ad Dakhiliyah', wilayats: [
      w('nizwa', 'نزوى', 'Nizwa', 22.933, 57.53),
      w('bahla', 'بهلاء', 'Bahla', 22.979, 57.3),
      w('manah', 'منح', 'Manah', 22.795, 57.6),
      w('hamra', 'الحمراء', 'Al Hamra', 23.118, 57.284),
      w('adam', 'أدم', 'Adam', 22.379, 57.527),
      w('izki', 'إزكي', 'Izki', 22.934, 57.77),
      w('samail', 'سمائل', 'Samail', 23.303, 57.977),
      w('bidbid', 'بدبد', 'Bidbid', 23.41, 58.13),
      w('jabal-akhdar', 'الجبل الأخضر', 'Al Jabal Al Akhdar', 23.071, 57.665),
    ],
  },
  {
    id: 'batinah-north', ar: 'شمال الباطنة', en: 'North Al Batinah', wilayats: [
      w('sohar', 'صحار', 'Sohar', 24.347, 56.709),
      w('shinas', 'شناص', 'Shinas', 24.742, 56.465),
      w('liwa', 'لوى', 'Liwa', 24.533, 56.563),
      w('saham', 'صحم', 'Saham', 24.172, 56.889),
      w('khaburah', 'الخابورة', 'Al Khaburah', 23.973, 57.093),
      w('suwaiq', 'السويق', 'As Suwaiq', 23.849, 57.438),
    ],
  },
  {
    id: 'batinah-south', ar: 'جنوب الباطنة', en: 'South Al Batinah', wilayats: [
      w('rustaq', 'الرستاق', 'Ar Rustaq', 23.391, 57.424),
      w('awabi', 'العوابي', 'Al Awabi', 23.305, 57.528),
      w('nakhal', 'نخل', 'Nakhal', 23.395, 57.829),
      w('wadi-maawil', 'وادي المعاول', 'Wadi Al Maawil', 23.45, 57.79),
      w('barka', 'بركاء', 'Barka', 23.678, 57.889),
      w('musanaah', 'المصنعة', 'Al Musanaah', 23.746, 57.633),
    ],
  },
  {
    id: 'sharqiyah-north', ar: 'شمال الشرقية', en: 'North Al Sharqiyah', wilayats: [
      w('ibra', 'إبراء', 'Ibra', 22.69, 58.532),
      w('mudhaibi', 'المضيبي', 'Al Mudhaibi', 22.57, 58.123),
      w('bidiyah', 'بدية', 'Bidiyah', 22.45, 58.8),
      w('qabil', 'القابل', 'Al Qabil', 22.564, 58.69),
      w('wadi-bani-khalid', 'وادي بني خالد', 'Wadi Bani Khalid', 22.62, 59.09),
      w('dima-tayeen', 'دماء والطائيين', 'Dima Wa Al Tayeen', 23.03, 58.66),
      w('sinaw', 'سناو', 'Sinaw', 22.512, 58.034),
    ],
  },
  {
    id: 'sharqiyah-south', ar: 'جنوب الشرقية', en: 'South Al Sharqiyah', wilayats: [
      w('sur', 'صور', 'Sur', 22.567, 59.529),
      w('kamil-wafi', 'الكامل والوافي', 'Al Kamil Wal Wafi', 22.21, 59.2),
      w('jaalan-bbh', 'جعلان بني بو حسن', 'Jaalan Bani Bu Hassan', 22.084, 59.325),
      w('jaalan-bba', 'جعلان بني بو علي', 'Jaalan Bani Bu Ali', 22.012, 59.341),
      w('masirah', 'مصيرة', 'Masirah', 20.668, 58.876),
    ],
  },
  {
    id: 'dhahirah', ar: 'الظاهرة', en: 'Adh Dhahirah', wilayats: [
      w('ibri', 'عبري', 'Ibri', 23.226, 56.515),
      w('yanqul', 'ينقل', 'Yanqul', 23.585, 56.543),
      w('dhank', 'ضنك', 'Dhank', 23.556, 56.258),
    ],
  },
  {
    id: 'wusta', ar: 'الوسطى', en: 'Al Wusta', wilayats: [
      w('haima', 'هيماء', 'Haima', 19.958, 56.316),
      w('mahout', 'محوت', 'Mahout', 20.62, 58.27),
      w('duqm', 'الدقم', 'Duqm', 19.663, 57.705),
      w('jazer', 'الجازر', 'Al Jazer', 18.95, 57.35),
    ],
  },
];

export const WILAYAT_COUNT = GOVERNORATES.reduce((n, g) => n + g.wilayats.length, 0);

export function findGovernorate(id: string): Governorate | undefined {
  return GOVERNORATES.find((g) => g.id === id);
}

export function findWilayat(govId: string, wilId: string): Wilayat | undefined {
  return findGovernorate(govId)?.wilayats.find((x) => x.id === wilId);
}

export function locationLabel(govId: string, wilId: string): string {
  const g = findGovernorate(govId);
  const wl = g?.wilayats.find((x) => x.id === wilId);
  if (!g || !wl) return 'غير محدد';
  return g.ar === wl.ar ? `محافظة ${g.ar} — ولاية ${wl.ar}` : `${g.ar} — ${wl.ar}`;
}
