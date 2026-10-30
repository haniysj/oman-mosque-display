/**
 * Every mosque has its own installable app: on /m/<code> the page uses that mosque's manifest
 * (named after the mosque, opening on its address only) and the mosque's name as the app title.
 * The general address (/) keeps the general app, where the mosque can be chosen on the screen.
 */
import { bindingFromUrl } from './cloud';

export function setupMosqueApp() {
  const code = bindingFromUrl();
  if (!code || !/^\/m\//.test(location.pathname)) return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link); }
  link.href = `/m/${code}/manifest.webmanifest`;
}

/** The app / home-screen name follows the mosque's name (iPhone uses the page title). */
export function setMosqueAppTitle(name: string) {
  if (!bindingFromUrl() || !name) return;
  if (document.title !== name) document.title = name;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'apple-mobile-web-app-title'; document.head.appendChild(meta); }
  meta.content = name;
}
