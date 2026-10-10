/**
 * On-device OCR for "import timetable from an image". Uses Tesseract (self-hosted under /ocr/,
 * downloaded only the first time this feature is used, then cached for offline reuse).
 * The image never leaves the device.
 */
import type { OcrWord } from '../core/ocrTable';
import { parseOcrWords, type OcrTable } from '../core/ocrTable';

export type OcrProgress = (stage: string, pct: number) => void;

/** Upscales small screenshots and converts to greyscale — improves digit recognition a lot. */
async function prepare(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('تعذّر فتح الصورة — استخدم PNG أو JPG')); i.src = url; });
    const target = Math.min(3200, Math.max(2400, img.naturalWidth * 2));
    const scale = target / img.naturalWidth;
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) { const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; p[i] = p[i + 1] = p[i + 2] = g; }
    ctx.putImageData(d, 0, 0);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

interface TBlock { paragraphs: { lines: { words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] }

async function recognize(canvas: HTMLCanvasElement, onProgress: OcrProgress): Promise<OcrWord[]> {
  const { createWorker } = await import('tesseract.js');
  const base = `${location.origin}/ocr/`;
  const worker = await createWorker('eng', 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: `${base}lang`,
    gzip: true,
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      const s = m.status.includes('load') || m.status.includes('initializ') ? 'تحميل محرك القراءة (أول مرة فقط)…' : 'قراءة الصورة…';
      onProgress(s, Math.round((m.progress || 0) * 100));
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6' as never, preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas, { rotateAuto: true }, { blocks: true, text: false });
    const words: OcrWord[] = [];
    for (const b of ((data as unknown as { blocks: TBlock[] | null }).blocks ?? [])) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) words.push({ text: w.text, ...w.bbox });
    return words;
  } finally { await worker.terminate(); }
}

export async function readTimetableImage(file: File, onProgress: OcrProgress): Promise<OcrTable> {
  if (!/^image\//.test(file.type)) throw new Error('اختر صورة (PNG أو JPG)');
  if (file.size > 15 * 1024 * 1024) throw new Error('حجم الصورة أكبر من 15 ميجابايت');
  onProgress('تجهيز الصورة…', 0);
  const canvas = await prepare(file);
  // Latin digits only: tested Arabic-Indic digits (٠١٢…) were not read reliably by any model.
  return parseOcrWords(await recognize(canvas, onProgress));
}
