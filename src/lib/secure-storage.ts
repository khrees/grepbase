/**
 * Secure client-side storage for sensitive data
 * Uses sessionStorage for temporary data and localStorage with basic obfuscation
 */

const STORAGE_PREFIX = 'grepbase_';
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

interface StorageItem<T> {
    value: T;
    timestamp: number;
    encrypted?: boolean;
}

/**
 * Simple XOR obfuscation (not encryption, just prevents casual inspection)
 * For true security, API keys should be sent directly to API routes, not stored
 */
function obfuscate(text: string): string {
    const key = 'grepbase-obf-key';
    let result = '';
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(result);
}

function deobfuscate(encoded: string): string {
    try {
        const decoded = atob(encoded);
        const key = 'grepbase-obf-key';
        let result = '';
        for (let i = 0; i < decoded.length; i++) {
            result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    } catch {
        return '';
    }
}

export class SecureStorage {
    /**
     * Store sensitive data in sessionStorage (cleared on tab close)
     * Recommended for API keys during active sessions
     */
    setSessionItem<T>(key: string, value: T): void {
        const item: StorageItem<T> = {
            value,
            timestamp: Date.now(),
        };

        try {
            sessionStorage.setItem(
                STORAGE_PREFIX + key,
                JSON.stringify(item)
            );
        } catch (error) {
            console.warn('Failed to save to sessionStorage:', error);
        }
    }

    /**
     * Get item from sessionStorage with timeout check
     */
    getSessionItem<T>(key: string): T | null {
        try {
            const stored = sessionStorage.getItem(STORAGE_PREFIX + key);
            if (!stored) return null;

            const item: StorageItem<T> = JSON.parse(stored);

            // Check if expired
            if (Date.now() - item.timestamp > SESSION_TIMEOUT) {
                this.removeSessionItem(key);
                return null;
            }

            return item.value;
        } catch (error) {
            console.warn('Failed to read from sessionStorage:', error);
            return null;
        }
    }

    /**
     * Remove item from sessionStorage
     */
    removeSessionItem(key: string): void {
        sessionStorage.removeItem(STORAGE_PREFIX + key);
    }

    /**
     * Store sensitive data with basic obfuscation
     * Note: This is NOT encryption, just prevents casual inspection
     * For production, consider sending API keys only to server
     */
    setSecureItem<T>(key: string, value: T): void {
        const item: StorageItem<T> = {
            value,
            timestamp: Date.now(),
            encrypted: true,
        };

        try {
            const serialized = JSON.stringify(item);
            const obfuscated = obfuscate(serialized);
            localStorage.setItem(STORAGE_PREFIX + key, obfuscated);
        } catch (error) {
            console.warn('Failed to save secure item:', error);
        }
    }

    /**
     * Get secure item with deobfuscation
     */
    getSecureItem<T>(key: string): T | null {
        try {
            const stored = localStorage.getItem(STORAGE_PREFIX + key);
            if (!stored) return null;

            const deobfuscated = deobfuscate(stored);
            if (!deobfuscated) return null;

            const item: StorageItem<T> = JSON.parse(deobfuscated);
            return item.value;
        } catch (error) {
            console.warn('Failed to read secure item:', error);
            return null;
        }
    }

    /**
     * Remove secure item
     */
    removeSecureItem(key: string): void {
        localStorage.removeItem(STORAGE_PREFIX + key);
    }

    /**
     * Clear all session data
     */
    clearSession(): void {
        const keys = Object.keys(sessionStorage);
        for (const key of keys) {
            if (key.startsWith(STORAGE_PREFIX)) {
                sessionStorage.removeItem(key);
            }
        }
    }

    /**
     * Check if running in secure context
     */
    isSecureContext(): boolean {
        return window.isSecureContext;
    }
}

export const secureStorage = new SecureStorage();
