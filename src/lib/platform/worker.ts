/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare Workers platform environment (bindings-based)
 */

import type {
  PlatformEnv,
  PlatformStorage,
  PlatformCache,
  PlatformAnalytics,
  PlatformContext,
} from './types';

export type WorkerBindings = {
  grepbase_db: D1Database;
  grepbase_cache?: KVNamespace;
  grepbase_storage?: R2Bucket;
  ANALYTICS?: AnalyticsEngineDataset;
  GITHUB_TOKEN?: string;
  FRONTEND_URL?: string;
  [key: string]: unknown;
};

export function createWorkerPlatformEnv(
  env: WorkerBindings,
  ctx?: ExecutionContext
): PlatformEnv {
  return {
    getDatabase: () => env.grepbase_db,

    getStorage: () => {
      const storage = env.grepbase_storage;
      return storage ? new WorkerR2Storage(storage) : null;
    },

    getCache: () => {
      const cache = env.grepbase_cache;
      return cache ? new WorkerKVCache(cache) : null;
    },

    getAnalytics: () => {
      const analytics = env.ANALYTICS;
      return analytics ? new WorkerAnalytics(analytics) : null;
    },

    getSecret: (key: string) => {
      const value = env[key as keyof WorkerBindings];
      return typeof value === 'string' ? value : undefined;
    },

    getContext: () => (ctx ? new WorkerPlatformContext(ctx) : null),
  };
}

class WorkerR2Storage implements PlatformStorage {
  constructor(private bucket: R2Bucket) { }

  async get(key: string): Promise<ReadableStream | null> {
    const obj = await this.bucket.get(key);
    return obj?.body || null;
  }

  async put(
    key: string,
    value: ReadableStream | string | Uint8Array,
    metadata?: Record<string, string>
  ): Promise<void> {
    let stream: ReadableStream;

    if (typeof value === 'string') {
      stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(value));
          controller.close();
        },
      });
    } else if (value instanceof Uint8Array) {
      stream = new ReadableStream({
        start(controller) {
          controller.enqueue(value);
          controller.close();
        },
      });
    } else {
      stream = value;
    }

    await this.bucket.put(key, stream, { customMetadata: metadata });
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const obj = await this.bucket.head(key);
    return obj !== null;
  }
}

class WorkerKVCache implements PlatformCache {
  constructor(private kv: KVNamespace) { }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.kv.get(key, 'json');
    return value as T;
  }

  async getText(key: string): Promise<string | null> {
    return await this.kv.get(key, 'text');
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const options: KVNamespacePutOptions = {};
    if (ttlSeconds) options.expirationTtl = ttlSeconds;
    await this.kv.put(key, JSON.stringify(value), options);
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}

class WorkerAnalytics implements PlatformAnalytics {
  constructor(private analytics: AnalyticsEngineDataset) { }

  writeDataPoint(data: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void {
    this.analytics.writeDataPoint(data);
  }
}

class WorkerPlatformContext implements PlatformContext {
  constructor(private ctx: ExecutionContext) { }

  waitUntil(promise: Promise<unknown>): void {
    this.ctx.waitUntil(promise);
  }

  passThroughOnException(): void {
    this.ctx.passThroughOnException();
  }
}
