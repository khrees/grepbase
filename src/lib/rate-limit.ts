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

        // If KV is not available, fail closed in production (deny request)
        if (!kv) {
            if (shouldFailOpen(process.env.RATE_LIMIT_FAIL_OPEN)) {
                logger.warn({ key }, 'Rate limiting disabled: KV unavailable, failing open');
                return { success: true, limit, remaining: limit, reset: windowReset };
            }
            logger.warn({ key }, 'Rate limiting unavailable: KV not configured, failing closed');
            return { success: false, limit, remaining: 0, reset: windowReset };
        }

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
