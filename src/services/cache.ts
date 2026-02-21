import { getPlatformEnv } from '@/lib/platform/context';
import { logger } from '@/lib/logger';
import type { PlatformCache } from '@/lib/platform/types';

const cacheLogger = logger.child({ service: 'cache' });

export const CACHE_TTL = {
    HOUR: 3600,
    DAY: 86400,
    WEEK: 604800,
};

export class CacheService {
    private getKv(): PlatformCache | null {
        try {
            const platform = getPlatformEnv();
            return platform.getCache();
        } catch {
            // Silently fail if not in a request context (e.g. build time)
            return null;
        }
    }

    /**
     * Get a value from the cache
     */
    async get<T>(key: string): Promise<T | null> {
        const kv = this.getKv();
        if (!kv) return null;
        try {
            const value = await kv.get<T>(key);
            if (value) {
                cacheLogger.debug({ key }, 'Cache hit');
            } else {
                cacheLogger.debug({ key }, 'Cache miss');
            }
            return value;
        } catch (e) {
            cacheLogger.error({ key, error: e }, 'Cache get failed');
            return null;
        }
    }

    /**
     * Set a value in the cache
     * @param ttl Time to live in seconds
     */
    async set(key: string, value: unknown, ttl?: number): Promise<void> {
        const kv = this.getKv();
        if (!kv) return;
        try {
            await kv.set(key, value, ttl);
            cacheLogger.debug({ key, ttl }, 'Cache set');
        } catch (e) {
            cacheLogger.error({ key, error: e }, 'Cache set failed');
        }
    }

    /**
     * Delete a value from the cache
     */
    async delete(key: string): Promise<void> {
        const kv = this.getKv();
        if (!kv) return;
        try {
            await kv.delete(key);
            cacheLogger.debug({ key }, 'Cache deleted');
        } catch (e) {
            cacheLogger.error({ key, error: e }, 'Cache delete failed');
        }
    }

    /**
     * Delete multiple keys matching a pattern
     * Note: KV doesn't support pattern matching natively, so this is a workaround
     */
    async deletePattern(pattern: string): Promise<void> {
        const kv = this.getKv();
        if (!kv) return;

        try {
            // For KV, we need to track keys separately or use a prefix list
            // This is a placeholder - in production, you'd maintain a separate list
            cacheLogger.warn({ pattern }, 'Pattern deletion not fully implemented for KV');
        } catch (e) {
            cacheLogger.error({ pattern, error: e }, 'Pattern deletion failed');
        }
    }

    /**
     * Invalidate cache for a specific repository
     */
    async invalidateRepo(owner: string, repo: string): Promise<void> {
        const keys = [
            `repo:${owner}:${repo}`,
            `commits:${owner}:${repo}:100`,
        ];

        cacheLogger.info({ owner, repo, keysCount: keys.length }, 'Invalidating repository cache');

        for (const key of keys) {
            await this.delete(key);
        }
    }

    /**
     * Invalidate cache for a specific commit
     */
    async invalidateCommit(owner: string, repo: string, sha: string): Promise<void> {
        const keys = [
            `diff:${owner}:${repo}:${sha}`,
            `files:${owner}:${repo}:${sha}`,
        ];

        cacheLogger.info({ owner, repo, sha, keysCount: keys.length }, 'Invalidating commit cache');

        for (const key of keys) {
            await this.delete(key);
        }
    }
}

export const cache = new CacheService();
