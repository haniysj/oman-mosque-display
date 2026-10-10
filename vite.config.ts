/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json';

const BUILD_ID = new Date().toISOString();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  // Older smart-TV browsers: syntax is down-levelled to ES2017 (Chrome 73+ / Safari 12.1+ supported)
  build: { target: ['es2017', 'chrome73', 'safari12'], cssTarget: ['chrome73', 'safari12'] },
  plugins: [
    react(),
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
        start_url: '/',
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
