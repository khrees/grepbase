/**
 * Platform context management
 *
 * Provides a centralized way to access platform-specific services
 * through the abstraction layer.
 */

import { getHttpPlatformEnv } from './http';
import { getRuntimeEnv } from './runtime';
import type { PlatformEnv } from './types';

/**
 * Get the current platform environment
 *
 * Automatically detects the platform:
 * - Cloudflare runtime (via bindings)
 * - HTTP-based (via environment variables)
 *
 * @throws Error if platform cannot be detected
 */
export function getPlatformEnv(): PlatformEnv {
  const runtimeEnv = getRuntimeEnv();
  if (runtimeEnv) return runtimeEnv;

  // Check if we have HTTP API credentials (for non-Cloudflare runtime)
  if (
    typeof process !== 'undefined' &&
    process.env.CLOUDFLARE_ACCOUNT_ID &&
    (process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_D1_TOKEN)
  ) {
    return getHttpPlatformEnv();
  }

  throw new Error(
    'No platform detected. Provide CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN or run with Cloudflare bindings.'
  );
}

/**
 * Check if we're currently in a request context
 *
 * Useful for code that may run both in request context
 * (API routes) and outside of it (build time, tests).
 */
export function isInRequestContext(): boolean {
  try {
    getPlatformEnv();
    return true;
  } catch {
    return false;
  }
}
