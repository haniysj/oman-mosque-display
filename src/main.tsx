import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './services/install'; // catches the browser's install prompt as early as possible
// Fonts are bundled locally (no Google Fonts request) so the display works offline.
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import '@fontsource/amiri/400.css';
import '@fontsource/amiri/700.css';
import './index.css';
import App from './App';
import { loadApp, log } from './store/appStore';
import { startClock } from './services/clock';
import { registerPwa } from './services/pwa';
import { requestPersistentStorage } from './store/db';
import { startCloud } from './services/cloud';

startClock();
void loadApp().then(() => {
  void registerPwa((m) => log('info', m));
  void requestPersistentStorage();
  startCloud();
});

window.addEventListener('error', (e) => log('error', `خطأ: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => log('error', `خطأ غير معالج: ${String((e as PromiseRejectionEvent).reason)}`));

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
