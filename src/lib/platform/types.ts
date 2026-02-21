/// <reference types="@cloudflare/workers-types" />

/**
 * Platform abstraction types
 *
 * These interfaces decouple the application from Cloudflare-specific APIs,
 * making it easier to migrate to other platforms in the future.
 */

/**
 * Main platform environment interface
 * Provides access to platform-specific services
 */
export interface PlatformEnv {
  /**
   * Get the D1 database instance
   */
  getDatabase(): D1Database;

  /**
   * Get the storage service (R2)
   * Returns null if storage is not available
   */
  getStorage(): PlatformStorage | null;

  /**
   * Get the cache service (KV)
   * Returns null if cache is not available
   */
  getCache(): PlatformCache | null;

  /**
   * Get the analytics service
   * Returns null if analytics is not available
   */
  getAnalytics(): PlatformAnalytics | null;

  /**
   * Get environment secret/variable
   */
  getSecret(key: string): string | undefined;

  /**
   * Get the execution context (for waitUntil, passThroughOnException)
   */
  getContext(): PlatformContext | null;
}

/**
 * Platform storage interface (R2)
 */
export interface PlatformStorage {
  /**
   * Get an object from storage
   * @returns ReadableStream of the object content, or null if not found
   */
  get(key: string): Promise<ReadableStream | null>;

  /**
   * Store an object in storage
   */
  put(
    key: string,
    value: ReadableStream | string | Uint8Array,
    metadata?: Record<string, string>
  ): Promise<void>;

  /**
   * Delete an object from storage
   */
  delete(key: string): Promise<void>;

  /**
   * Check if an object exists in storage
   */
  exists(key: string): Promise<boolean>;
}

/**
 * Platform cache interface (KV)
 */
export interface PlatformCache {
  /**
   * Get a value from cache
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Get a value as text from cache
   */
  getText(key: string): Promise<string | null>;

  /**
   * Set a value in cache with optional TTL
   */
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;

  /**
   * Delete a value from cache
   */
  delete(key: string): Promise<void>;
}

/**
 * Platform analytics interface
 */
export interface PlatformAnalytics {
  /**
   * Write a data point to analytics
   */
  writeDataPoint(data: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

/**
 * Platform execution context interface
 */
export interface PlatformContext {
  /**
   * Schedule background work to continue after response is sent
   */
  waitUntil(promise: Promise<unknown>): void;

  /**
   * Pass through to origin on exception
   */
  passThroughOnException?(): void;
}
