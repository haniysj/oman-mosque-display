/** Layout preview: renders the real display inside an iframe of an exact size (e.g. 1920×1080 or 4K), scaled to fit. */
import { useEffect, useState } from 'react';

export function Preview() {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const w = Number(params.get('w')) || 1920;
  const h = Number(params.get('h')) || 1080;
  const [vp, setVp] = useState({ w: innerWidth, h: innerHeight });
  useEffect(() => { const f = () => setVp({ w: innerWidth, h: innerHeight }); addEventListener('resize', f); return () => removeEventListener('resize', f); }, []);
  const scale = Math.min((vp.w - 32) / w, (vp.h - 72) / h);
  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, background: '#1b2733', fontFamily: 'Cairo', direction: 'rtl', color: '#fff' }}>
      <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontWeight: 700 }}>
        معاينة {w}×{h} — مقياس {Math.round(scale * 100)}%
      </div>
      <div style={{ width: w * scale, height: h * scale, margin: '0 auto', overflow: 'hidden', borderRadius: 8, boxShadow: '0 0 0 1px #3a4a5a' }}>
        <iframe title="preview" src="/" style={{ width: w, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
      </div>
    </div>
  );
}
