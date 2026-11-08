/**
 * Per-mosque app manifest: /m/<code>/manifest.webmanifest → an installable app named after that
 * mosque, opening on /m/<code> only (its own app id, so every mosque is a separate app).
 */
const URL_BASE = process.env.VITE_SUPABASE_URL || 'https://gfuvletkmpdeykwlqtah.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_yJo_1cjKfA5y_40F88lw6g_1MyktLwU';

export async function mosqueName(code) {
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/mosque_list`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) return null;
    const list = await r.json();
    const m = Array.isArray(list) ? list.find((x) => x && x.code === code) : null;
    return m ? String(m.name_ar || '').replace(/\s+/g, ' ').trim() : null;
  } catch { return null; }
}

export function buildManifest(code, name) {
  const title = name || 'مواقيت المسجد';
  return {
    id: `/m/${code}`,
    name: title,
    short_name: title.length > 14 ? title.replace(/^(مسجد|جامع)\s+/, '') : title,
    description: `مواقيت الصلاة والإقامة — ${title}`,
    lang: 'ar',
    dir: 'rtl',
    start_url: `/m/${code}`,
    scope: `/m/${code}`,
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'any',
    background_color: '#062A22',
    theme_color: '#062A22',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

export default async function handler(req, res) {
  const code = String((req.query && req.query.code) || '').toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(code)) { res.status(404).send('not found'); return; }
  const name = await mosqueName(code);
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  res.status(200).send(JSON.stringify(buildManifest(code, name)));
}
