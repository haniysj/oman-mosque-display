/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json';

const BUILD_ID = new Date().toISOString();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  // Smart-TV browsers (Samsung Tizen, LG webOS, Android TV) are often old Chromium builds.
  // CSS is lowered for Chromium 56+ (e.g. `inset`), and @vitejs/plugin-legacy adds the missing
  // JS features (flatMap, Object.fromEntries, …) — plus a full legacy bundle for browsers
  // without ES modules.
  build: { cssTarget: ['chrome56', 'safari11'] },
  plugins: [
    react(),
    legacy({
      targets: ['chrome >= 49', 'safari >= 10', 'samsung >= 5', 'android >= 5'],
      modernTargets: ['chrome >= 64', 'safari >= 12', 'edge >= 79', 'firefox >= 67'],
      modernPolyfills: true,
    }),
    VitePWA({
      // "prompt": the new service worker waits; the app applies it only at a safe moment
      // (no adhan / iqamah / quiet sequence nearby) — see src/services/pwa.ts
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'data/*'],
      manifest: {
        id: '/',
        name: 'شاشة مواقيت الصلاة — مساجد عُمان',
        short_name: 'مواقيت المسجد',
        description: 'شاشة مواقيت الصلاة والإقامة للمساجد في سلطنة عُمان — تعمل دون إنترنت',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/', // a home-screen app starting with empty storage (iPhone) opens the mosque list itself
        scope: '/',
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
      },
      workbox: {
        cacheId: 'oman-mosque-display',
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,json,csv,webmanifest}'],
        // The OCR engine (~10 MB) is NOT precached: it is downloaded the first time an admin
        // imports a timetable from an image, then kept in its own cache for offline reuse.
        globIgnores: ['ocr/**'],
        runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.startsWith('/ocr/'), handler: 'CacheFirst', options: { cacheName: 'omd-ocr', expiration: { maxEntries: 10 } } }],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
