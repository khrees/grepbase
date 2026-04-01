/**
 * Local in-memory KV implementation for development
 */

import type { PlatformCache } from './types';

export class LocalKVCache implements PlatformCache {
  private store: Map<string, { value: unknown; expires?: number }> = new Map();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    
    if (entry.expires && Date.now() > entry.expires) {
      this.store.delete(key);
      return null;
    }
    
    return entry.value as T;
  }

  async getText(key: string): Promise<string | null> {
    const value = await this.get<string>(key);
    return value;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const expires = ttlSeconds ? Date.now() + (ttlSeconds * 1000) : undefined;
    this.store.set(key, { value, expires });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const localKVCache = new LocalKVCache();
