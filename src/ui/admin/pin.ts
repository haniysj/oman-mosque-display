/** Optional admin PIN. Stored only as a salted hash; unlocking lasts for the current page session. */
const SALT = 'omd-pin-v1:';

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export async function hashPin(pin: string): Promise<string> {
  try {
    if (crypto?.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SALT + pin));
      return 'sha256:' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* insecure context: fall back */ }
  return 'fnv:' + fnv(SALT + pin);
}

export async function checkPin(pin: string, stored: string): Promise<boolean> {
  if (!stored) return true;
  if (stored.startsWith('fnv:')) return stored === 'fnv:' + fnv(SALT + pin);
  return (await hashPin(pin)) === stored;
}
