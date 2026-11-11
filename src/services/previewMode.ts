/**
 * «معاينة الشاشة» (/m/<code>?preview=1, shown inside the administrator's page): the screen runs
 * isolated — its own temporary storage — so a preview never changes this device's mosque,
 * settings or sign-in. Imported first in main.tsx (before anything reads storage).
 */
export const PREVIEW = typeof location !== 'undefined' && /[?&]preview=1(&|$)/.test(location.search);

if (PREVIEW) {
  const mem = new Map<string, string>();
  const storage = {
    get length() { return mem.size; },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  } as Storage;
  try { Object.defineProperty(window, 'localStorage', { configurable: true, get: () => storage }); } catch { /* ignore */ }
}
