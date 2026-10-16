/**
 * «الحروف المرسلة»: stretches the last joint of a word with tatweel (ـ) before the round final letters
 * (ن ى ي ل ه ء) — the elongated calligraphic look of the Thmanyah specimen. Display only; the stored
 * text is never changed. Qur'anic text (with its pause marks) is left exactly as written.
 */
const FINALS = new Set(['ن', 'ى', 'ي', 'ل', 'ه', 'ء']);
// letters that do not join to the following letter (no kashida after them)
const NON_JOINING = new Set(['ا', 'أ', 'إ', 'آ', 'د', 'ذ', 'ر', 'ز', 'و', 'ؤ', 'ة', 'ء', 'ى']);
const LETTER = /[ء-ي]/;
const MARK = /[ً-ٰٟ]/;
const QURANIC = /[ۖ-ۭ]/;

export function addKashida(text: string, count = 3): string {
  if (!text || QURANIC.test(text)) return text;
  const tat = 'ـ'.repeat(count);
  return text.replace(/[ء-ٰٟ]+/g, (word) => {
    const chars = [...word];
    const letters: number[] = [];
    chars.forEach((c, i) => { if (LETTER.test(c) && !MARK.test(c)) letters.push(i); });
    if (letters.length < 2) return word;
    // the Name of Allah (الله، لله، بالله، والله…) keeps its own ligature
    if (/لله$/.test(letters.map((i) => chars[i]).join(''))) return word;
    const last = letters[letters.length - 1], prev = letters[letters.length - 2];
    if (!FINALS.has(chars[last]) || NON_JOINING.has(chars[prev])) return word;
    // short words: only before ن / ي / ى (مـن، حـي، فـي) — «له، به» stay compact
    if (letters.length === 2 && !'نيى'.includes(chars[last])) return word;
    // after the previous letter and its marks (shadda, fatha…), right before the final letter
    return chars.slice(0, last).join('') + tat + chars.slice(last).join('');
  });
}
