/**
 * Client-side secure storage for sensitive data
 * Uses Web Crypto API (AES-GCM) for actual encryption of persistent data
 * Uses sessionStorage for temporary session data
 */

const STORAGE_PREFIX = 'grepbase_';
const CRYPTO_KEY_NAME = `${STORAGE_PREFIX}crypto_key`;

/**
 * Get or create a persistent AES-GCM key for this device.
 * The key is stored in localStorage as a JWK — this is intentional:
 * the goal is to prevent trivial decode (base64/atob) and raise the bar
 * for extraction, NOT to defend against a determined attacker with full
 * access to the same origin (which is impossible client-side).
 */
async function getOrCreateKey(): Promise<CryptoKey> {
  const stored = localStorage.getItem(CRYPTO_KEY_NAME);
  if (stored) {
    try {
      const jwk = JSON.parse(stored);
      return await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    } catch {
      // Corrupted key — regenerate
    }
  }

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const jwk = await crypto.subtle.exportKey('jwk', key);
  localStorage.setItem(CRYPTO_KEY_NAME, JSON.stringify(jwk));
  return key;
}

async function encrypt(plaintext: string): Promise<string> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  // Concatenate IV + ciphertext, then base64
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

async function decrypt(encoded: string): Promise<string> {
  const key = await getOrCreateKey();
  const combined = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

export const secureStorage = {
  // Session storage (not persistent, uses sessionStorage)
  setSessionItem(key: string, value: unknown): void {
    if (typeof window === 'undefined') return;
    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, stringValue);
    } catch (error) {
      console.error('Failed to store session value:', error);
    }
  },

  getSessionItem<T = unknown>(key: string): T | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${key}`);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as T;
      }
    } catch (error) {
      console.error('Failed to retrieve session value:', error);
      return null;
    }
  },

  // Encrypted persistent storage using AES-GCM
  async setSecureItem(key: string, value: unknown): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      const encrypted = await encrypt(stringValue);
      localStorage.setItem(`${STORAGE_PREFIX}secure_${key}`, encrypted);
    } catch (error) {
      console.error('Failed to store secure value:', error);
    }
  },

  async getSecureItem<T = unknown>(key: string): Promise<T | null> {
    if (typeof window === 'undefined') return null;
    try {
      const encrypted = localStorage.getItem(`${STORAGE_PREFIX}secure_${key}`);
      if (!encrypted) return null;

      // Try decryption first (new format)
      try {
        const decrypted = await decrypt(encrypted);
        return JSON.parse(decrypted) as T;
      } catch {
        // Fall back to legacy base64 format for migration
        try {
          const decoded = atob(encrypted);
          const parsed = JSON.parse(decoded) as T;
          // Re-encrypt with proper crypto
          await secureStorage.setSecureItem(key, parsed);
          return parsed;
        } catch {
          return null;
        }
      }
    } catch (error) {
      console.error('Failed to retrieve secure value:', error);
      return null;
    }
  },

  removeSecureItem(key: string): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(`${STORAGE_PREFIX}secure_${key}`);
  },

  clear(): void {
    if (typeof window === 'undefined') return;
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(STORAGE_PREFIX)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.error('Failed to clear storage:', error);
    }
  }
};
