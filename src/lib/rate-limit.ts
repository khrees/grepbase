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

        const rateLimitKey = `ratelimit:${key}`;
        const now = Date.now();
        const windowStart = now - windowSeconds * 1000;

        try {
            // Get current request timestamps
            const data = await kv.get<number[]>(rateLimitKey);
            const requests = data || [];

            // Filter out requests outside the current window
            const recentRequests = requests.filter(timestamp => timestamp > windowStart);

            // Check if limit exceeded
            if (recentRequests.length >= limit) {
                const oldestRequest = Math.min(...recentRequests);
                const resetTime = oldestRequest + windowSeconds * 1000;

                return {
                    success: false,
                    limit,
                    remaining: 0,
                    reset: resetTime,
                };
            }

            // Add current request
            recentRequests.push(now);

            // Store updated timestamps (expire after window)
            await kv.set(rateLimitKey, recentRequests, windowSeconds);

            return {
                success: true,
                limit,
                remaining: limit - recentRequests.length,
                reset: now + windowSeconds * 1000,
            };
        } catch (error) {
            logger.error({ error, key: rateLimitKey }, 'Rate limit check failed');
            // Fail open on errors
            return {
                success: true,
                limit,
                remaining: limit,
                reset: now + windowSeconds * 1000,
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
