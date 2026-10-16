/**
 * Theme backgrounds: every theme has its own colours AND its own Islamic geometric pattern
 * (SVG tile, generated in code — no image files), plus the slow points-of-light animation.
 * The canvas pauses when the page is hidden, honours prefers-reduced-motion, caps at ~24 fps
 * and thins itself out automatically on weak smart-TV hardware.
 */
import { useEffect, useRef } from 'react';
import type { Background as Bg, Theme } from '../../domain/types';

export type ThemeKey = Theme | 'contrast';

const f = (n: number) => n.toFixed(2);
const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
const star = (cx: number, cy: number, n: number, rOut: number, step: number) =>
  poly(Array.from({ length: n }, (_, i) => { const a = (Math.PI * 2 * ((i * step) % n)) / n - Math.PI / 2; return [cx + rOut * Math.cos(a), cy + rOut * Math.sin(a)] as [number, number]; }));
const ngon = (cx: number, cy: number, n: number, r: number, rot = 0) =>
  poly(Array.from({ length: n }, (_, i) => { const a = rot + (Math.PI * 2 * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number]; }));

interface PatternDef { size: [number, number]; paths: string; width?: number }

/** One distinct traditional motif per theme. */
const PATTERNS: Record<ThemeKey, PatternDef> = {
  // Khatam — eight-pointed star of two squares, with linking diagonals (Omani carved doors)
  ornamental: { size: [120, 120], paths: `<path d='M60 18 72 48 102 60 72 72 60 102 48 72 18 60 48 48Z'/><path d='M30.3 30.3 60 42.4 89.7 30.3 77.6 60 89.7 89.7 60 77.6 30.3 89.7 42.4 60Z'/><circle cx='60' cy='60' r='9'/><path d='M0 0 18 18M120 0 102 18M0 120 18 102M120 120 102 102'/>` },
  // Twelve-pointed rosette {12/5} with petal ring
  navy: { size: [150, 150], paths: `<path d='${star(75, 75, 12, 52, 5)}'/><circle cx='75' cy='75' r='18'/><path d='${ngon(75, 75, 12, 30, Math.PI / 12)}'/><path d='M0 0 22 22M150 0 128 22M0 150 22 128M150 150 128 128'/>` },
  // Hexagram lattice (six-pointed stars on a triangular grid)
  minimal: { size: [104, 60], paths: `<path d='M0 0 104 60M0 60 104 0M52 0 52 60'/><path d='M0 30 104 30' stroke-dasharray='2 6'/><path d='${star(52, 30, 6, 16, 2)}'/>` },
  // Rub el Hizb — two interlaced squares with an inner octagon and connecting bands
  maroon: { size: [130, 130], paths: `<path d='${ngon(65, 65, 4, 44, Math.PI / 4)}'/><path d='${ngon(65, 65, 4, 44, 0)}'/><path d='${ngon(65, 65, 8, 18, Math.PI / 8)}'/><path d='M65 0 65 21M65 109 65 130M0 65 21 65M109 65 130 65'/><circle cx='0' cy='0' r='14'/><circle cx='130' cy='0' r='14'/><circle cx='0' cy='130' r='14'/><circle cx='130' cy='130' r='14'/>` },
  // Overlapping circles (seed of the girih rosette)
  turquoise: { size: [80, 138.56], paths: `<circle cx='40' cy='0' r='40'/><circle cx='0' cy='69.28' r='40'/><circle cx='80' cy='69.28' r='40'/><circle cx='40' cy='138.56' r='40'/><circle cx='40' cy='69.28' r='40'/><circle cx='40' cy='69.28' r='6'/>` },
  // Zellige — octagons and squares with eight-point centres
  // Daylight: eight-pointed khatam stars linked by small squares (light carved-plaster look)
  sand: { size: [110, 110], width: 1.2, paths: `<path d='${star(55, 55, 8, 34, 3)}'/><path d='${ngon(55, 55, 8, 20, Math.PI / 8)}'/><path d='${ngon(0, 0, 4, 15, Math.PI / 4)}'/><path d='${ngon(110, 0, 4, 15, Math.PI / 4)}'/><path d='${ngon(0, 110, 4, 15, Math.PI / 4)}'/><path d='${ngon(110, 110, 4, 15, Math.PI / 4)}'/><path d='M0 55 21 55M89 55 110 55M55 0 55 21M55 89 55 110'/>` },
  amethyst: { size: [100, 100], paths: `<path d='${ngon(50, 50, 8, 38, Math.PI / 8)}'/><path d='${ngon(0, 0, 4, 13.6, Math.PI / 4)}'/><path d='${ngon(100, 0, 4, 13.6, Math.PI / 4)}'/><path d='${ngon(0, 100, 4, 13.6, Math.PI / 4)}'/><path d='${ngon(100, 100, 4, 13.6, Math.PI / 4)}'/><path d='${star(50, 50, 8, 22, 3)}'/>` },
  // High contrast — light, sparse eight-point stars
  contrast: { size: [160, 160], paths: `<path d='${star(80, 80, 8, 30, 3)}'/>` },
};

/** Pattern stroke colour + opacity, and points-of-light colour, per theme. */
export const THEME_INK: Record<ThemeKey, { stroke: string; opacity: number; light: string }> = {
  ornamental: { stroke: '#D4AF61', opacity: 0.16, light: '241,223,168' },
  navy: { stroke: '#D4AF61', opacity: 0.13, light: '200,214,255' },
  minimal: { stroke: '#C9CFD6', opacity: 0.09, light: '220,226,232' },
  maroon: { stroke: '#E0A46B', opacity: 0.15, light: '246,206,160' },
  turquoise: { stroke: '#F2D9A0', opacity: 0.12, light: '214,246,238' },
  amethyst: { stroke: '#D8C3F0', opacity: 0.12, light: '232,218,250' },
  sand: { stroke: '#8A6326', opacity: 0.14, light: '176,128,52' },
  contrast: { stroke: '#FFFFFF', opacity: 0.07, light: '255,255,255' },
};

export const THEME_LABELS: Record<Theme, string> = {
  ornamental: 'زمردي وذهبي — نجمة ثمانية',
  navy: 'كحلي وذهبي — زهرة اثنا عشرية',
  maroon: 'عنابي ونحاسي — ربع الحزب',
  turquoise: 'فيروزي ورملي — دوائر متداخلة',
  amethyst: 'بنفسجي وفضي — زليج مثمّن',
  sand: 'نهاري فاتح — بيج ونقش خاتم خفيف',
  minimal: 'فحمي وفضي — نجمة سداسية',
};

function tile(theme: ThemeKey) {
  const p = PATTERNS[theme];
  const ink = THEME_INK[theme];
  const [w, h] = p.size;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><g fill='none' stroke='${ink.stroke}' stroke-opacity='${ink.opacity}' stroke-width='${p.width ?? 1.1}'>${p.paths}</g></svg>`;
  return { image: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, size: `${w}px ${h}px` };
}

/**
 * Mosaic for the arch ornament: twelve-pointed star rosettes on a hexagonal grid, with petal rings,
 * three-armed (Y) links between every three rosettes and small six-pointed stars between neighbours
 * — the classic zellige layout, drawn in the theme's own colours (several tones, filled + outlined).
 */
export function archMosaic(theme: ThemeKey) {
  const ink = THEME_INK[theme];
  const A = 97, H = 168; // hexagonal lattice: H ≈ A·√3 so the tile repeats without seams
  const out: string[] = [];
  const P = (x: number, y: number, r: number, a: number): [number, number] => [x + r * Math.cos(a), y + r * Math.sin(a)];
  const lattice: [number, number][] = [];
  for (let j = -2; j <= 4; j++) for (let i = -2; i <= 3; i++) lattice.push([i * A + (j & 1 ? A / 2 : 0), (j * H) / 2]);
  const star12: string[] = [], petals: string[] = [], rings: string[] = [], links: string[] = [], small: string[] = [];
  for (const [x, y] of lattice) {
    star12.push(star(x, y, 12, A * 0.17, 5));
    for (let k = 0; k < 12; k++) {
      const t = (Math.PI * 2 * k) / 12 - Math.PI / 2;
      petals.push(poly([P(x, y, A * 0.19, t), P(x, y, A * 0.29, t - 0.2), P(x, y, A * 0.37, t), P(x, y, A * 0.29, t + 0.2)]));
    }
    rings.push(ngon(x, y, 12, A * 0.41, Math.PI / 12));
    // small six-pointed stars half-way to the three "forward" neighbours
    for (const [dx, dy] of [[A / 2, 0], [A / 4, H / 4], [-A / 4, H / 4]] as [number, number][]) small.push(poly(Array.from({ length: 12 }, (_, q) => P(x + dx, y + dy, q % 2 ? A * 0.05 : A * 0.09, (Math.PI * q) / 6 - Math.PI / 2))));
    // Y links at the centres of the two triangles below/right of this point
    for (const [cx, cy, rot] of [[x + A / 2, y + H / 6, Math.PI / 2], [x, y + H / 3, -Math.PI / 2]] as [number, number, number][]) {
      for (let k = 0; k < 3; k++) {
        const t = rot + (Math.PI * 2 * k) / 3, w = 0.55, L = A * 0.21;
        links.push(poly([P(cx, cy, A * 0.05, t - 1.0), P(cx, cy, L, t - w * 0.45), P(cx, cy, L * 1.08, t), P(cx, cy, L, t + w * 0.45), P(cx, cy, A * 0.05, t + 1.0)]));
      }
    }
  }
  const lt = `rgb(${ink.light})`;
  out.push(`<g fill='${lt}' fill-opacity='.20' stroke='${lt}' stroke-opacity='.45' stroke-width='.9'><path d='${petals.join('')}'/></g>`);
  out.push(`<g fill='none' stroke='${ink.stroke}' stroke-opacity='.55' stroke-width='1.1'><path d='${rings.join('')}'/></g>`);
  out.push(`<g fill='${ink.stroke}' fill-opacity='.38' stroke='${ink.stroke}' stroke-opacity='.6' stroke-width='.9'><path d='${links.join('')}'/></g>`);
  out.push(`<g fill='${lt}' fill-opacity='.42'><path d='${small.join('')}'/></g>`);
  out.push(`<g fill='${ink.stroke}' fill-opacity='.62' stroke='${lt}' stroke-opacity='.5' stroke-width='.8'><path d='${star12.join('')}'/></g>`);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${A}' height='${H}' viewBox='0 0 ${A} ${H}'>${out.join('')}</svg>`;
  return { image: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, size: `${A}px ${H}px` };
}

/**
 * Light Islamic ornament inside the arch: follows the arch's inner edge and fades out towards the
 * middle, so the clock, day and dates in the centre stay perfectly clear.
 */
export function ArchOrnament({ theme }: { theme: ThemeKey }) {
  const t = archMosaic(theme);
  return (
    <div className="arch-orn" aria-hidden>
      <div className="arch-orn-tile" style={{ backgroundImage: t.image, backgroundSize: t.size }} />
    </div>
  );
}

/**
 * Phone layout: the same zellige mosaic as a band along the top and the bottom of the screen,
 * fading out (linear gradient) towards the inside so the times stay clear.
 */
export function EdgeOrnament({ theme }: { theme: ThemeKey }) {
  const t = archMosaic(theme);
  const style = { backgroundImage: t.image, backgroundSize: t.size };
  return (
    <>
      <div className="edge-orn edge-orn--top" style={style} aria-hidden />
      <div className="edge-orn edge-orn--bottom" style={style} aria-hidden />
    </>
  );
}

export function PatternLayer({ theme, highContrast }: { theme: Theme; highContrast: boolean }) {
  const t = tile(highContrast ? 'contrast' : theme);
  return <div className="bg-pattern" style={{ backgroundImage: t.image, backgroundSize: t.size }} aria-hidden />;
}

export function LightLayer({ mode, intensity, theme }: { mode: Bg; intensity: number; theme: ThemeKey }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || mode !== 'animated' || intensity <= 0) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0, h = 0, raf = 0, last = 0, slowFrames = 0;
    let count = Math.round(8 + (intensity / 100) * 34);
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const resize = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const rgb = (THEME_INK[theme] ?? THEME_INK.ornamental).light;
    const pts = Array.from({ length: 60 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8,
      vy: -(0.004 + Math.random() * 0.01), vx: (Math.random() - 0.5) * 0.004, a: 0.15 + Math.random() * 0.35, p: Math.random() * Math.PI * 2,
    }));
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = t - last;
      if (dt < 41) return; // ~24 fps cap
      if (dt > 120 && last) { if (++slowFrames > 20 && count > 6) { count = Math.max(6, Math.round(count * 0.6)); slowFrames = 0; } }
      else slowFrames = Math.max(0, slowFrames - 1);
      const s = Math.min(dt, 200) / 1000;
      last = t;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < count; i++) {
        const q = pts[i];
        q.y += q.vy * s; q.x += q.vx * s; q.p += s * 0.6;
        if (q.y < -0.02) { q.y = 1.02; q.x = Math.random(); }
        if (q.x < 0) q.x = 1; if (q.x > 1) q.x = 0;
        const alpha = q.a * (0.55 + 0.45 * Math.sin(q.p)) * (0.4 + intensity / 160);
        ctx.beginPath();
        ctx.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
        ctx.arc(q.x * w, q.y * h, q.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); ctx.clearRect(0, 0, w, h); };
  }, [mode, intensity, theme]);
  if (mode !== 'animated') return null;
  return <canvas ref={ref} className="bg-lights" aria-hidden />;
}
