/**
 * Tiered Cache - Multi-layer caching system for optimal performance
 * 
 * Provides:
 * - Tier-based TTL (fast/medium/slow/immutable)
 * - Shared cross-user cache for public data
 * - Local-first read pattern for immediate responses
 */

import { cache, CacheService } from '@/services/cache';
import { CACHE_TIER } from '@/lib/constants';
import { logger } from '@/lib/logger';

const tieredLogger = logger.child({ service: 'tiered-cache' });

export type CacheTier = 'fast' | 'medium' | 'slow' | 'immutable';

const TIER_TTL_SECONDS: Record<CacheTier, number> = {
    fast: CACHE_TIER.FAST,
    medium: CACHE_TIER.MEDIUM,
    slow: CACHE_TIER.SLOW,
    immutable: CACHE_TIER.IMMUTABLE,
};

const SHARED_PREFIX = 'shared:';

interface CacheEntry<T> {
    data: T;
    syncedAt: string;
    etag?: string | null;
}

class TieredCacheService {
    private cache: CacheService = cache;

    private getTierTTL(tier: CacheTier): number {
        return TIER_TTL_SECONDS[tier];
    }

    private buildKey(key: string, tier: CacheTier): string {
        return `${tier}:${key}`;
    }

    private buildSharedKey(key: string): string {
        return `${SHARED_PREFIX}${key}`;
    }

    async get<T>(key: string, tier: CacheTier = 'medium'): Promise<T | null> {
        const cacheKey = this.buildKey(key, tier);
        return this.cache.get<T>(cacheKey);
    }

    async set<T>(key: string, data: T, tier: CacheTier = 'medium'): Promise<void> {
        const cacheKey = this.buildKey(key, tier);
        const ttl = this.getTierTTL(tier);
        await this.cache.set(cacheKey, data, ttl);
        tieredLogger.debug({ key: cacheKey, tier, ttl }, 'Cached with tier');
    }

    async getOrSet<T>(
        key: string,
        tier: CacheTier,
        fetcher: () => Promise<T>
    ): Promise<T> {
        const cached = await this.get<T>(key, tier);
        if (cached) {
            tieredLogger.debug({ key, tier }, 'Cache hit');
            return cached;
        }

        tieredLogger.debug({ key, tier }, 'Cache miss, fetching');
        const data = await fetcher();
        await this.set(key, data, tier);
        return data;
    }

    async getShared<T>(key: string): Promise<T | null> {
        const sharedKey = this.buildSharedKey(key);
        const entry = await this.cache.get<CacheEntry<T>>(sharedKey);
        return entry?.data ?? null;
    }

    async setShared<T>(
        key: string,
        data: T,
        tier: CacheTier = 'medium'
    ): Promise<void> {
        const sharedKey = this.buildSharedKey(key);
        const entry: CacheEntry<T> = {
            data,
            syncedAt: new Date().toISOString(),
        };
        const ttl = this.getTierTTL(tier);
        await this.cache.set(sharedKey, entry, ttl);
        tieredLogger.debug({ key: sharedKey, tier, ttl }, 'Shared cache set');
    }

    async getSharedOrSet<T>(
        key: string,
        tier: CacheTier,
        fetcher: () => Promise<T>
    ): Promise<T> {
        const cached = await this.getShared<T>(key);
        if (cached) {
            tieredLogger.debug({ key, tier }, 'Shared cache hit');
            return cached;
        }

        tieredLogger.debug({ key, tier }, 'Shared cache miss, fetching');
        const data = await fetcher();
        await this.setShared(key, data, tier);
        return data;
    }

    async invalidate(key: string, tier: CacheTier = 'medium'): Promise<void> {
        const cacheKey = this.buildKey(key, tier);
        await this.cache.delete(cacheKey);
    }

    async invalidateShared(key: string): Promise<void> {
        const sharedKey = this.buildSharedKey(key);
        await this.cache.delete(sharedKey);
    }
}

export const tieredCache = new TieredCacheService();

export interface LocalFirstOptions<T> {
    key: string;
    tier: CacheTier;
    fallback: T;
    fetcher: () => Promise<T>;
    useShared?: boolean;
}

export async function localFirstRead<T>(options: LocalFirstOptions<T>): Promise<{
    data: T;
    stale: boolean;
    source: 'cache' | 'shared' | 'fetch';
}> {
    const { key, tier, fallback, fetcher, useShared = false } = options;

    if (useShared) {
        const sharedData = await tieredCache.getShared<T>(key);
        if (sharedData) {
            return { data: sharedData, stale: false, source: 'shared' };
        }
    }

    const cached = await tieredCache.get<T>(key, tier);
    if (cached) {
        return { data: cached, stale: false, source: 'cache' };
    }

    try {
        const fresh = await fetcher();
        
        await tieredCache.set(key, fresh, tier);
        if (useShared) {
            await tieredCache.setShared(key, fresh, tier);
        }
        
        return { data: fresh, stale: false, source: 'fetch' };
    } catch (error) {
        tieredLogger.warn({ key, error }, 'Fetch failed, returning fallback');
        return { data: fallback, stale: true, source: 'fetch' };
    }
}