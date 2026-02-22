/**
 * HTTP-based platform implementation
 *
 * Uses Cloudflare's HTTP APIs instead of runtime bindings.
 * This allows deployment to any platform (Render, Vercel, etc.)
 * while still using Cloudflare infrastructure (D1, KV, R2).
 */

import type {
  PlatformEnv,
  PlatformStorage,
  PlatformCache,
  PlatformAnalytics,
  PlatformContext,
} from './types';
import { createHttpD1 } from '@/db/http';

/**
 * Get HTTP-based platform environment
 *
 * Requires environment variables:
 * - CLOUDFLARE_ACCOUNT_ID
 * - CLOUDFLARE_API_TOKEN
 * - CLOUDFLARE_D1_DATABASE_ID
 * - CLOUDFLARE_KV_NAMESPACE_ID
 * - CLOUDFLARE_R2_BUCKET_NAME
 * - GITHUB_TOKEN (optional)
 */
export function getHttpPlatformEnv(): PlatformEnv {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_D1_TOKEN;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const kvNamespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
  const r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;

  if (!accountId || !apiToken) {
    throw new Error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN / CLOUDFLARE_D1_TOKEN');
  }

  return {
    getDatabase: () => {
      if (!databaseId) throw new Error('Missing CLOUDFLARE_D1_DATABASE_ID');
      return createHttpD1(accountId, databaseId, apiToken);
    },

    getStorage: () => {
      if (!r2BucketName) return null;
      return new HttpR2Storage(accountId, r2BucketName, apiToken);
    },

    getCache: () => {
      if (!kvNamespaceId) return null;
      return new HttpKVCache(accountId, kvNamespaceId, apiToken);
    },

    getAnalytics: () => {
      // Analytics Engine doesn't have a simple HTTP API for writing
      // Return null for now (graceful degradation)
      return null;
    },

    getSecret: (key: string) => {
      return process.env[key];
    },

    getContext: () => {
      // No execution context in HTTP mode
      return null;
    },
  };
}

// D1 HTTP implementation is handled by Drizzle's d1-http driver
// See src/db/http.ts for the createHttpDb function

/**
 * HTTP-based R2 Storage implementation
 * Uses S3-compatible API
 */
class HttpR2Storage implements PlatformStorage {
  constructor(
    private accountId: string,
    private bucketName: string,
    private apiToken: string
  ) { }

  async get(key: string): Promise<ReadableStream | null> {
    const url = `https://${this.accountId}.r2.cloudflarestorage.com/${this.bucketName}/${key}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
      },
    });

    if (!response.ok) return null;
    return response.body;
  }

  async put(
    key: string,
    value: ReadableStream | string | Uint8Array,
    metadata?: Record<string, string>
  ): Promise<void> {
    const url = `https://${this.accountId}.r2.cloudflarestorage.com/${this.bucketName}/${key}`;

    let body: BodyInit;
    if (typeof value === 'string') {
      body = value;
    } else if (value instanceof Uint8Array) {
      body = new Blob([new Uint8Array(value)]);
    } else {
      const reader = value.getReader();
      const chunks: BlobPart[] = [];
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        chunks.push(new Uint8Array(chunk));
      }
      body = new Blob(chunks);
    }

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        ...metadata,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`R2 HTTP API error: ${response.status}`);
    }
  }

  async delete(key: string): Promise<void> {
    const url = `https://${this.accountId}.r2.cloudflarestorage.com/${this.bucketName}/${key}`;

    await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
      },
    });
  }

  async exists(key: string): Promise<boolean> {
    const url = `https://${this.accountId}.r2.cloudflarestorage.com/${this.bucketName}/${key}`;

    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
      },
    });

    return response.ok;
  }
}

/**
 * HTTP-based KV Cache implementation
 * Uses Cloudflare KV HTTP API
 */
class HttpKVCache implements PlatformCache {
  constructor(
    private accountId: string,
    private namespaceId: string,
    private apiToken: string
  ) { }

  async get<T>(key: string): Promise<T | null> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces/${this.namespaceId}/values/${key}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
      },
    });

    if (!response.ok) return null;

    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  async getText(key: string): Promise<string | null> {
    return await this.get<string>(key);
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces/${this.namespaceId}/values/${key}${ttlSeconds ? `?expiration_ttl=${ttlSeconds}` : ''}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(value),
    });

    if (!response.ok) {
      throw new Error(`KV HTTP API error: ${response.status}`);
    }
  }

  async delete(key: string): Promise<void> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces/${this.namespaceId}/values/${key}`;

    await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
      },
    });
  }
}
