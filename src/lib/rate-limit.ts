/**
 * KV-based rate limiting for Cloudflare Pages
 */
import { getPlatformEnv } from './platform/context';
import { logger } from './logger';
import { shouldFailOpen } from './env';
import type { PlatformCache } from './platform/types';

interface RateLimitResult {
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
}

// In-memory fallback map for environments where KV binding is not present
const inMemoryRateLimit = new Map<string, number>();

export class RateLimiter {
    private getKv(): PlatformCache | null {
        try {
            const platform = getPlatformEnv();
            return platform.getCache();
        } catch {
            logger.warn('KV not available for rate limiting');
            return null;
        }
    }

    /**
     * Check rate limit for a given key
     * @param key Unique identifier (e.g., IP address, user ID)
     * @param limit Maximum requests allowed
     * @param windowSeconds Time window in seconds
     */
    async checkLimit(
        key: string,
        limit: number,
        windowSeconds: number = 60
    ): Promise<RateLimitResult> {
        const kv = this.getKv();
        const now = Date.now();
        const windowMs = windowSeconds * 1000;
        const windowBucket = Math.floor(now / windowMs);
        const windowReset = (windowBucket + 1) * windowMs;
        const rateLimitKey = `ratelimit:${key}:${windowBucket}`;

        // If KV is not available, use in-memory rate limit map fallback instead of hard-blocking (failing closed)
        if (!kv) {
            const currentCount = inMemoryRateLimit.get(rateLimitKey) ?? 0;
            if (currentCount >= limit) {
                return { success: false, limit, remaining: 0, reset: windowReset };
            }
            inMemoryRateLimit.set(rateLimitKey, currentCount + 1);
            // Evict oldest entries instead of clearing everything
            if (inMemoryRateLimit.size > 1000) {
                const keysToDelete = Array.from(inMemoryRateLimit.keys()).slice(0, 500);
                for (const key of keysToDelete) {
                    inMemoryRateLimit.delete(key);
                }
            }
            return { success: true, limit, remaining: Math.max(0, limit - (currentCount + 1)), reset: windowReset };
        }

        // Note: KV get-then-set has a small TOCTOU window under concurrent requests.
        // Cloudflare KV does not support atomic increment. This is acceptable for
        // non-critical rate limiting — the worst case is a small burst above the limit.
        try {
            const data = await kv.get<number>(rateLimitKey);
            const currentCount = typeof data === 'number' && Number.isFinite(data) ? data : 0;

            if (currentCount >= limit) {
                return {
                    success: false,
                    limit,
                    remaining: 0,
                    reset: windowReset,
                };
            }

            const nextCount = currentCount + 1;
            await kv.set(rateLimitKey, nextCount, windowSeconds + 1);

            return {
                success: true,
                limit,
                remaining: Math.max(0, limit - nextCount),
                reset: windowReset,
            };
        } catch (error) {
            logger.error({ error, key: rateLimitKey }, 'Rate limit check failed');
            // Fail closed on errors in production, fail open in dev
            if (shouldFailOpen(process.env.RATE_LIMIT_FAIL_OPEN)) {
                logger.warn({ key: rateLimitKey }, 'Rate limit check error, failing open');
                return { success: true, limit, remaining: limit, reset: windowReset };
            }
            logger.error({ key: rateLimitKey }, 'Rate limit check error, failing closed');
            return { success: false, limit, remaining: 0, reset: windowReset };
        }
    }

    /**
     * Get client identifier from request
     */
    getClientId(request: Request): string {
        // Try to get IP from Cloudflare headers
        const cfConnectingIp = request.headers.get('cf-connecting-ip');
        if (cfConnectingIp) return cfConnectingIp;

        // Fallback to x-forwarded-for
        const xForwardedFor = request.headers.get('x-forwarded-for');
        if (xForwardedFor) return xForwardedFor.split(',')[0].trim();

        // Last resort: use a generic identifier
        return 'unknown';
    }
}

export const rateLimiter = new RateLimiter();
