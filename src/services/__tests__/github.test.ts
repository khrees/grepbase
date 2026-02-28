import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fetchFilesAtCommit } from '../github';
import { setRuntimeEnv } from '@/lib/platform/runtime';
import type { PlatformCache, PlatformEnv } from '@/lib/platform/types';

class MockCache implements PlatformCache {
    private store = new Map<string, unknown>();

    async get<T>(key: string): Promise<T | null> {
        return (this.store.get(key) as T | undefined) ?? null;
    }

    async getText(key: string): Promise<string | null> {
        const value = this.store.get(key);
        if (value === undefined || value === null) return null;
        return typeof value === 'string' ? value : JSON.stringify(value);
    }

    async set(key: string, value: unknown): Promise<void> {
        this.store.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key);
    }
}

function createMockRuntimeEnv(cache: PlatformCache): PlatformEnv {
    return {
        getDatabase: (() => {
            throw new Error('not used');
        }) as unknown as () => D1Database,
        getStorage: () => null,
        getCache: () => cache,
        getAnalytics: () => null,
        getSecret: () => undefined,
        getContext: () => null,
    };
}

describe('github service in-flight dedupe', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        const cache = new MockCache();
        setRuntimeEnv(createMockRuntimeEnv(cache));
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test('deduplicates concurrent misses for the same commit file tree', async () => {
        let fetchCalls = 0;

        globalThis.fetch = (async () => {
            fetchCalls += 1;
            await new Promise(resolve => setTimeout(resolve, 20));
            return new Response(
                JSON.stringify({
                    tree: [{ path: 'src/index.ts', type: 'blob', size: 42, sha: 'abc123' }],
                }),
                { status: 200 }
            );
        }) as typeof fetch;

        const [first, second] = await Promise.all([
            fetchFilesAtCommit('owner', 'repo', 'deadbeef'),
            fetchFilesAtCommit('owner', 'repo', 'deadbeef'),
        ]);

        expect(fetchCalls).toBe(1);
        expect(first).toEqual(second);
        expect(first.length).toBe(1);
        expect(first[0]?.path).toBe('src/index.ts');
    });
});
