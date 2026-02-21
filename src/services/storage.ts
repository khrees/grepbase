/**
 * Storage service for managing file content
 *
 * Automatically routes files based on size:
 * - Small files (<100KB) → D1 database
 * - Large files (100KB - 10MB) → R2 storage
 * - Very large files (>10MB) → Skipped
 */

import { getPlatformEnv } from '@/lib/platform/context';
import { logger } from '@/lib/logger';

const storageLogger = logger.child({ service: 'storage' });

export const STORAGE_LIMITS = {
  /**
   * Maximum size for D1 storage (100KB)
   * Files larger than this go to R2
   */
  MAX_D1_SIZE: 100 * 1024,

  /**
   * Maximum file size we'll ingest (10MB)
   * Files larger than this are skipped entirely
   */
  MAX_R2_SIZE: 10 * 1024 * 1024,
};

export type StorageLocation = 'db' | 'r2';

export interface StorageResult {
  location: StorageLocation;
  size: number;
}

export class StorageService {
  /**
   * Store file content in the appropriate location
   *
   * Small files go to D1, large files go to R2
   *
   * @param key - Storage key (e.g., "files/{owner}/{repo}/{sha}/{path}")
   * @param content - File content as string
   * @param metadata - Optional metadata (language, size, etc.)
   * @returns Storage location and actual size
   */
  async storeFileContent(
    key: string,
    content: string,
    metadata?: { language?: string; size?: number }
  ): Promise<StorageResult> {
    const size = new TextEncoder().encode(content).length;

    if (size <= STORAGE_LIMITS.MAX_D1_SIZE) {
      // Store in D1 (via files.content column)
      storageLogger.debug({ key, size }, 'Storing in D1');
      return { location: 'db', size };
    }

    // Store in R2
    try {
      const platform = getPlatformEnv();
      const storage = platform.getStorage();

      if (!storage) {
        storageLogger.warn({ key, size }, 'R2 not available, file too large for D1');
        throw new Error('File too large and R2 not configured');
      }

      // Convert metadata to Record<string, string> for R2
      const r2Metadata: Record<string, string> = {};
      if (metadata?.language) r2Metadata.language = metadata.language;
      if (metadata?.size !== undefined) r2Metadata.size = String(metadata.size);

      await storage.put(key, content, r2Metadata);
      storageLogger.debug({ key, size }, 'Stored in R2');
      return { location: 'r2', size };
    } catch (error) {
      storageLogger.error({ error, key }, 'Failed to store in R2');
      throw error;
    }
  }

  /**
   * Retrieve file content from R2
   *
   * @param key - Storage key
   * @returns File content as string, or null if not found
   */
  async getFileContent(key: string): Promise<string | null> {
    try {
      const platform = getPlatformEnv();
      const storage = platform.getStorage();

      if (!storage) {
        storageLogger.warn({ key }, 'R2 not available');
        return null;
      }

      const stream = await storage.get(key);
      if (!stream) {
        storageLogger.debug({ key }, 'File not found in R2');
        return null;
      }

      // Convert stream to string
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Concatenate chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const concatenated = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        concatenated.set(chunk, offset);
        offset += chunk.length;
      }

      const decoder = new TextDecoder();
      const content = decoder.decode(concatenated);

      storageLogger.debug({ key, size: content.length }, 'Retrieved from R2');
      return content;
    } catch (error) {
      storageLogger.error({ error, key }, 'Failed to get from R2');
      return null;
    }
  }

  /**
   * Check if file exists in R2
   *
   * @param key - Storage key
   * @returns true if file exists, false otherwise
   */
  async exists(key: string): Promise<boolean> {
    try {
      const platform = getPlatformEnv();
      const storage = platform.getStorage();

      if (!storage) return false;

      return await storage.exists(key);
    } catch (error) {
      storageLogger.error({ error, key }, 'Failed to check R2 existence');
      return false;
    }
  }

  /**
   * Delete file from R2
   *
   * @param key - Storage key
   */
  async delete(key: string): Promise<void> {
    try {
      const platform = getPlatformEnv();
      const storage = platform.getStorage();

      if (!storage) {
        storageLogger.warn({ key }, 'R2 not available for deletion');
        return;
      }

      await storage.delete(key);
      storageLogger.debug({ key }, 'Deleted from R2');
    } catch (error) {
      storageLogger.error({ error, key }, 'Failed to delete from R2');
    }
  }

  /**
   * Determine storage location without actually storing
   *
   * Useful for planning ingestion
   */
  determineLocation(size: number): StorageLocation {
    return size <= STORAGE_LIMITS.MAX_D1_SIZE ? 'db' : 'r2';
  }
}

export const storage = new StorageService();
