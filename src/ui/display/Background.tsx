/**
 * Restrained background: a static Omani 8-point-star lattice (SVG, tiled) plus, in animated
 * mode, a few slow drifting points of light on a canvas. The canvas pauses when the page is
 * hidden, honours prefers-reduced-motion, caps at ~24 fps and thins itself out automatically
 * if frames start taking too long (weak smart-TV hardware).
 */
import { useEffect, useRef } from 'react';
import type { Background as Bg, Theme } from '../../domain/types';

const STAR_TILE = (stroke: string, opacity: number) => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'><g fill='none' stroke='${stroke}' stroke-opacity='${opacity}' stroke-width='1'><path d='M60 18 72 48 102 60 72 72 60 102 48 72 18 60 48 48Z'/><path d='M30.3 30.3 60 42.4 89.7 30.3 77.6 60 89.7 89.7 60 77.6 30.3 89.7 42.4 60Z'/><circle cx='60' cy='60' r='9'/><path d='M0 0 18 18M120 0 102 18M0 120 18 102M120 120 102 102'/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};

export function PatternLayer({ theme, highContrast }: { theme: Theme; highContrast: boolean }) {
  if (highContrast || theme === 'minimal') return null;
  const op = theme === 'ornamental' ? 0.16 : 0.1;
  return <div className="bg-pattern" style={{ backgroundImage: STAR_TILE('#D4AF61', op) }} aria-hidden />;
}

export function LightLayer({ mode, intensity, theme }: { mode: Bg; intensity: number; theme: Theme }) {
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
    const gold = theme === 'navy' ? '200,214,255' : '241,223,168';
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
        ctx.fillStyle = `rgba(${gold},${alpha.toFixed(3)})`;
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
