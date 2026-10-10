import { describe, expect, it } from 'vitest';
import { latinDigits, ocrRowsToCsv, parseOcrWords, plausibleRow, suspiciousCells, type OcrWord } from './ocrTable';
import { parseTimetableFile } from './timetable';

/** Lays out words of one table row right-to-left as on the Ministry page. */
function rowWords(y: number, cells: string[]): OcrWord[] {
  return cells.map((text, i) => ({ text, x0: 1000 - (i + 1) * 100, x1: 1000 - i * 100 - 10, y0: y, y1: y + 20 }));
}

describe('OCR table parser', () => {
  const r1 = ['الخميس', '01/10/2026', '19/04/1448', '04:43', '05:58', '12:02', '03:26', '06:00', '07:10'];
  const r2 = ['الجمعة', '02/10/2026', '20/04/1448', '04:44', '05:59', '12:01', '03:25', '05:59', '07:09'];
  const header = ['اليوم', 'التاريخ', 'الهجري', 'الفجر', 'الشروق', 'الظهر', 'العصر', 'المغرب', 'العشاء'];

  it('reads RTL rows, ignores header and Hijri dates, detects month', () => {
    const t = parseOcrWords([...rowWords(0, header), ...rowWords(40, r1), ...rowWords(80, r2)]);
    expect(t.direction).toBe('rtl');
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].times).toEqual(['4:43', '5:58', '12:02', '3:26', '6:00', '7:10']);
    expect(t.rows[0].date).toBe('2026-10-01');
    expect(t.rows[1].date).toBe('2026-10-02');
    expect([t.detectedYear, t.detectedMonth]).toEqual([2026, 10]);
    expect(t.rows.every((r) => r.plausible)).toBe(true);
  });

  it('handles LTR tables and Arabic-Indic digits', () => {
    const ltr = (y: number, c: string[]) => c.map((text, i) => ({ text, x0: i * 100, x1: i * 100 + 90, y0: y, y1: y + 20 }));
    const t = parseOcrWords(ltr(0, ['٠٤:٤٣', '05:58', '12:02', '15:26', '18:00', '19:10']));
    expect(t.direction).toBe('ltr');
    expect(t.rows[0].times).toEqual(['4:43', '5:58', '12:02', '15:26', '18:00', '19:10']);
    expect(latinDigits('١٢:٣٠')).toBe('12:30');
  });

  it('flags implausible rows and jumps between days', () => {
    expect(plausibleRow(['4:43', '5:58', '12:02', '3:26', '6:00', '7:10'])).toBe(true);
    expect(plausibleRow(['9:43', '5:58', '12:02', '3:26', '6:00', '7:10'])).toBe(false);
    const f = suspiciousCells([['04:43', '05:58'], ['04:44', '06:59'], ['04:44', '05:59']]);
    expect(f[1]).toEqual([false, true]);
  });

  it('produces CSV accepted by the regular import (12-hour times converted)', () => {
    const csv = ocrRowsToCsv([{ date: '2026-10-01', times: ['04:43', '05:58', '12:02', '03:26', '06:00', '07:10'] }]);
    const res = parseTimetableFile('image.csv', csv);
    expect(res.errors).toEqual([]);
    expect(res.records[0]).toMatchObject({ date: '2026-10-01', fajr: '04:43', asr: '15:26', maghrib: '18:00', isha: '19:10' });
  });
});
