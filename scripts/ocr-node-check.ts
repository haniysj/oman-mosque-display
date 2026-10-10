// Dev check: OCR the fixture images in Node and compare with the source CSV.
import { createWorker } from 'tesseract.js';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
const SCALE = Number(process.env.SCALE || 2);
import { parseOcrWords, type OcrWord } from '../src/core/ocrTable';
const truth = readFileSync('research/mara-muscat-2026-10.csv', 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const norm = (t: string) => t.replace(/^0/, '');
for (const [img, lang] of [['mara-latin', 'eng'], ['mara-small', 'eng']] as const) {
  const w = await createWorker(lang, 1, { langPath: 'node_modules/@tesseract.js-data/' + lang + '/4.0.0_best_int', gzip: true, cachePath: '/tmp/claude-0/tess-cache' });
  await w.setParameters({ tessedit_pageseg_mode: '6' as never, preserve_interword_spaces: '1' });
  const { data } = await w.recognize(await (async () => { const im = sharp(`scripts/ocr-fixtures/${img}.png`); const m = await im.metadata(); const W = Math.min(3200, Math.max(1800, m.width!)); return im.resize(W).greyscale().png().toBuffer(); })(), {}, { blocks: true });
  const words: OcrWord[] = [];
  for (const b of (data as any).blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const x of l.words) words.push({ text: x.text, ...x.bbox });
  await w.terminate();
  const t = parseOcrWords(words);
  let ok = 0, bad: string[] = [];
  t.rows.forEach((r, i) => { const tr = truth[i]; if (!tr) return; const exp = tr.slice(1).map(norm); const got = r.times.map(norm); if (exp.join() === got.join() && (!r.date || r.date === tr[0])) ok++; else bad.push(`${tr[0]} exp ${exp.join(' ')} got ${got.join(' ')} date ${r.date}`); });
  console.log(img, lang, 'rows', t.rows.length, 'exact', ok, 'dir', t.direction, 'ym', t.detectedYear, t.detectedMonth, 'plausible', t.rows.filter((r) => r.plausible).length);
  bad.slice(0, 5).forEach((b) => console.log('   ', b));
}
