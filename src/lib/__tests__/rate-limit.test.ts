import { beforeEach, describe, expect, test, afterEach } from 'bun:test';
import { RateLimiter } from '../rate-limit';
import { setRuntimeEnv } from '../platform/runtime';
import type { PlatformCache, PlatformEnv } from '../platform/types';

class MockCache implements PlatformCache {
    private store = new Map<string, { value: unknown; expiresAt: number | null }>();

    async get<T>(key: string): Promise<T | null> {
        const entry = this.store.get(key);
        if (!entry) return null;

        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            this.store.delete(key);
            return null;
        }

        return entry.value as T;
    }

    async getText(key: string): Promise<string | null> {
        const value = await this.get<unknown>(key);
        if (value === null || value === undefined) return null;
        return typeof value === 'string' ? value : JSON.stringify(value);
    }

    async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
        const expiresAt = typeof ttlSeconds === 'number' ? Date.now() + ttlSeconds * 1000 : null;
        this.store.set(key, { value, expiresAt });
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key);
    }
}

function createMockRuntimeEnv(cache: PlatformCache | null): PlatformEnv {
    return {
        getDatabase: (() => {
            throw new Error('not used in tests');
        }) as unknown as () => D1Database,
        getStorage: () => null,
        getCache: () => cache,
        getAnalytics: () => null,
        getSecret: () => undefined,
        getContext: () => null,
    };
}

describe('RateLimiter', () => {
    const limiter = new RateLimiter();
    const originalDateNow = Date.now;
    let now = 1000;

    beforeEach(() => {
        now = 1000;
        Date.now = () => now;
    });

    afterEach(() => {
        Date.now = originalDateNow;
    });

    describe('getClientId', () => {
        test('extracts CF connecting IP', () => {
            const request = new Request('http://localhost', {
                headers: { 'cf-connecting-ip': '1.2.3.4' },
            });
            expect(limiter.getClientId(request)).toBe('1.2.3.4');
        });

        test('falls back to x-forwarded-for', () => {
            const request = new Request('http://localhost', {
                headers: { 'x-forwarded-for': '5.6.7.8, 1.2.3.4' },
            });
            expect(limiter.getClientId(request)).toBe('5.6.7.8');
        });

        test('returns unknown when no headers present', () => {
            const request = new Request('http://localhost');
            expect(limiter.getClientId(request)).toBe('unknown');
        });
    });

    describe('checkLimit', () => {
        test('enforces fixed-window limits using counter keys', async () => {
            const cache = new MockCache();

            setRuntimeEnv(createMockRuntimeEnv(cache));

            const first = await limiter.checkLimit('client-a', 2, 60);
            expect(first.success).toBe(true);
            expect(first.remaining).toBe(1);

            const second = await limiter.checkLimit('client-a', 2, 60);
            expect(second.success).toBe(true);
            expect(second.remaining).toBe(0);

            const third = await limiter.checkLimit('client-a', 2, 60);
            expect(third.success).toBe(false);
            expect(third.remaining).toBe(0);
            expect(third.reset).toBe(60_000);
        });

        test('resets counter on the next window', async () => {
            const cache = new MockCache();

            setRuntimeEnv(createMockRuntimeEnv(cache));

            const first = await limiter.checkLimit('client-b', 1, 60);
            expect(first.success).toBe(true);

            const blocked = await limiter.checkLimit('client-b', 1, 60);
            expect(blocked.success).toBe(false);

            now = 60_500;
            const afterWindow = await limiter.checkLimit('client-b', 1, 60);
            expect(afterWindow.success).toBe(true);
            expect(afterWindow.remaining).toBe(0);
            expect(afterWindow.reset).toBe(120_000);
        });

        test('fails open when cache is unavailable', async () => {
            setRuntimeEnv(createMockRuntimeEnv(null));

            const result = await limiter.checkLimit('client-c', 5, 60);
            expect(result.success).toBe(true);
            expect(result.remaining).toBe(5);
        });
    });
});
