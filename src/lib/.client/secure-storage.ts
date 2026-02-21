/**
 * Client-side secure storage for sensitive data
 * Uses localStorage with basic obfuscation (not encryption)
 */

const STORAGE_PREFIX = 'grepbase_';

export const secureStorage = {
  // Session storage (not persistent, uses sessionStorage)
  setSessionItem(key: string, value: any): void {
    if (typeof window === 'undefined') return;
    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, btoa(stringValue));
    } catch (error) {
      console.error('Failed to store session value:', error);
    }
  },

  getSessionItem(key: string): any {
    if (typeof window === 'undefined') return null;
    try {
      const encoded = sessionStorage.getItem(`${STORAGE_PREFIX}${key}`);
      if (!encoded) return null;
      const decoded = atob(encoded);
      try {
        return JSON.parse(decoded);
      } catch {
        return decoded;
      }
    } catch (error) {
      console.error('Failed to retrieve session value:', error);
      return null;
    }
  },

  // Secure storage (persistent, uses localStorage with obfuscation)
  setSecureItem(key: string, value: any): void {
    if (typeof window === 'undefined') return;
    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      localStorage.setItem(`${STORAGE_PREFIX}secure_${key}`, btoa(stringValue));
    } catch (error) {
      console.error('Failed to store secure value:', error);
    }
  },

  getSecureItem(key: string): any {
    if (typeof window === 'undefined') return null;
    try {
      const encoded = localStorage.getItem(`${STORAGE_PREFIX}secure_${key}`);
      if (!encoded) return null;
      const decoded = atob(encoded);
      try {
        return JSON.parse(decoded);
      } catch {
        return decoded;
      }
    } catch (error) {
      console.error('Failed to retrieve secure value:', error);
      return null;
    }
  },

  // Legacy methods (kept for compatibility)
  set(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
      // Basic obfuscation - not real encryption
      const encoded = btoa(value);
      localStorage.setItem(`${STORAGE_PREFIX}${key}`, encoded);
    } catch (error) {
      console.error('Failed to store value:', error);
    }
  },

  get(key: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const encoded = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
      if (!encoded) return null;
      return atob(encoded);
    } catch (error) {
      console.error('Failed to retrieve value:', error);
      return null;
    }
  },

  remove(key: string): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
    } catch (error) {
      console.error('Failed to remove value:', error);
    }
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
