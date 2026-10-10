// Copies the OCR engine (Tesseract) and its language data into public/ocr so the
// "import from image" feature is self-hosted (no third-party CDN). Runs before every build.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const out = new URL('../public/ocr/', import.meta.url);
mkdirSync(new URL('lang/', out), { recursive: true });
const nm = (p) => new URL(`../node_modules/${p}`, import.meta.url);
const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
];
for (const [from, to] of files) {
  if (!existsSync(nm(from))) { console.error(`copy-ocr: missing ${from}`); process.exit(1); }
  cpSync(nm(from), new URL(to, out));
}
console.log('copy-ocr: OK');
