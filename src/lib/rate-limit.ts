/**
 * KV-based rate limiting for Cloudflare Pages
 */
import { getPlatformEnv } from './platform/context';
import { logger } from './logger';
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

        // If KV is not available, allow the request (fail open)
        if (!kv) {
            return {
                success: true,
                limit,
                remaining: limit,
                reset: Date.now() + windowSeconds * 1000,
            };
        }

        const now = Date.now();
        const windowMs = windowSeconds * 1000;
        const windowBucket = Math.floor(now / windowMs);
        const reset = (windowBucket + 1) * windowMs;
        const rateLimitKey = `ratelimit:${key}:${windowBucket}`;

        try {
            const data = await kv.get<number | string | number[]>(rateLimitKey);
            let currentCount = 0;

            // Backward compatibility for previously stored array payloads.
            if (typeof data === 'number' && Number.isFinite(data)) {
                currentCount = data;
            } else if (typeof data === 'string') {
                const parsed = Number.parseInt(data, 10);
                currentCount = Number.isFinite(parsed) ? parsed : 0;
            } else if (Array.isArray(data)) {
                currentCount = data.length;
            }

            if (currentCount >= limit) {
                return {
                    success: false,
                    limit,
                    remaining: 0,
                    reset,
                };
            }

            const nextCount = currentCount + 1;
            await kv.set(rateLimitKey, nextCount, windowSeconds + 1);

            return {
                success: true,
                limit,
                remaining: Math.max(0, limit - nextCount),
                reset,
            };
        } catch (error) {
            logger.error({ error, key: rateLimitKey }, 'Rate limit check failed');
            // Fail open on errors
            return {
                success: true,
                limit,
                remaining: limit,
                reset,
            };
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
