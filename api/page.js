/**
 * A mosque's own address /m/<code>: the app page with the mosque's name already in it, so a shared
 * link shows «مسجد التقوى» (link previews and the browser tab), and the page installs that mosque's app.
 */
import { mosqueName } from './manifest.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderPage(html, code, name, origin) {
  const title = name ? `${name} — مواقيت الصلاة` : 'مواقيت المسجد';
  const desc = name ? `مواقيت الأذان والإقامة في ${name} — تتحدث تلقائياً وتعمل دون إنترنت` : 'مواقيت الصلاة والإقامة';
  const url = `${origin}/m/${code}`;
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*"\s*\/?>/, `<meta name="apple-mobile-web-app-title" content="${esc(name || 'مواقيت المسجد')}" />`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(desc)}" />`)
    .replace(/<link rel="manifest" href="[^"]*">/, `<link rel="manifest" href="/m/${code}/manifest.webmanifest">`);
  const head = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="مواقيت المسجد" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(origin)}/icon-512.png" />`,
    `<meta property="og:locale" content="ar_OM" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<script>window.__MOSQUE__=${JSON.stringify({ code, name: name || '' }).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ');
  return out.replace('</head>', `    ${head}\n  </head>`);
}

export default async function handler(req, res) {
  const code = String((req.query && req.query.code) || '').toLowerCase();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const origin = `${proto}://${host}`;
  let html = '';
  try { const r = await fetch(`${origin}/index.html`, { headers: { 'x-omd-page': '1' } }); if (r.ok) html = await r.text(); } catch { /* fall back below */ }
  if (!html) { res.setHeader('Location', `/?m=${encodeURIComponent(code)}`); res.status(302).end(); return; }
  const valid = /^[a-z0-9-]{3,40}$/.test(code);
  const name = valid ? await mosqueName(code) : null;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  res.status(200).send(valid ? renderPage(html, code, name, origin) : html);
}
