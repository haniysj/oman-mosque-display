// Generates PNG icons from public/favicon.svg (run: node scripts/icons.mjs)
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url));
const out = (n) => new URL(`../public/${n}`, import.meta.url).pathname;
await sharp(svg).resize(32, 32).png().toFile(out('favicon-32.png'));
await sharp(svg).resize(192, 192).png().toFile(out('icon-192.png'));
await sharp(svg).resize(512, 512).png().toFile(out('icon-512.png'));
// maskable: full-bleed background, artwork inside the safe zone
const inner = await sharp(svg).resize(360, 360).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0B3D30' } }).composite([{ input: inner, top: 76, left: 76 }]).png().toFile(out('icon-512-maskable.png'));
// apple-touch: white background, padded
const at = await sharp(svg).resize(140, 140).png().toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 4, background: '#FFFFFF' } }).composite([{ input: at, top: 20, left: 20 }]).png().toFile(out('apple-touch-icon.png'));
console.log('icons ok');
