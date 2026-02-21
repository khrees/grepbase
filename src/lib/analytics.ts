/**
 * Cloudflare Workers Analytics Engine integration
 */
import { getPlatformEnv } from './platform/context';
import { logger } from './logger';
import type { PlatformAnalytics } from './platform/types';

const analyticsLogger = logger.child({ service: 'analytics' });

// Keeping for documentation/type reference
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface _AnalyticsEvent {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
}

export class Analytics {
    private getAnalyticsEngine(): PlatformAnalytics | null {
        try {
            const platform = getPlatformEnv();
            return platform.getAnalytics();
        } catch {
            // Not in request context or analytics not bound
            return null;
        }
    }

    /**
     * Track an API request
     */
    async trackRequest(params: {
        endpoint: string;
        method: string;
        statusCode: number;
        duration: number;
        clientId?: string;
    }) {
        const analytics = this.getAnalyticsEngine();
        if (!analytics) return;

        try {
            analytics.writeDataPoint({
                blobs: [params.endpoint, params.method, params.clientId || 'unknown'],
                doubles: [params.statusCode, params.duration],
                indexes: [params.endpoint],
            });

            analyticsLogger.debug(params, 'Analytics event tracked');
        } catch (error) {
            analyticsLogger.error({ error }, 'Failed to write analytics');
        }
    }

    /**
     * Track rate limit event
     */
    async trackRateLimit(params: {
        endpoint: string;
        clientId: string;
        blocked: boolean;
    }) {
        const analytics = this.getAnalyticsEngine();
        if (!analytics) return;

        try {
            analytics.writeDataPoint({
                blobs: ['rate_limit', params.endpoint, params.clientId],
                doubles: [params.blocked ? 1 : 0],
                indexes: ['rate_limit'],
            });
        } catch (error) {
            analyticsLogger.error({ error }, 'Failed to track rate limit');
        }
    }

    /**
     * Track AI provider usage
     */
    async trackAIUsage(params: {
        provider: string;
        model?: string;
        type: 'commit' | 'project' | 'question' | 'day-summary';
        success: boolean;
        duration: number;
    }) {
        const analytics = this.getAnalyticsEngine();
        if (!analytics) return;

        try {
            analytics.writeDataPoint({
                blobs: ['ai_usage', params.provider, params.model || 'default', params.type],
                doubles: [params.success ? 1 : 0, params.duration],
                indexes: ['ai_usage'],
            });

            analyticsLogger.debug(params, 'AI usage tracked');
        } catch (error) {
            analyticsLogger.error({ error }, 'Failed to track AI usage');
        }
    }

    /**
     * Track repository ingest
     */
    async trackRepoIngest(params: {
        owner: string;
        repo: string;
        commitsCount: number;
        cached: boolean;
        duration: number;
    }) {
        const analytics = this.getAnalyticsEngine();
        if (!analytics) return;

        try {
            analytics.writeDataPoint({
                blobs: ['repo_ingest', params.owner, params.repo],
                doubles: [params.commitsCount, params.cached ? 1 : 0, params.duration],
                indexes: ['repo_ingest'],
            });

            analyticsLogger.debug(params, 'Repo ingest tracked');
        } catch (error) {
            analyticsLogger.error({ error }, 'Failed to track repo ingest');
        }
    }

    /**
     * Track cache performance
     */
    async trackCacheHit(params: {
        key: string;
        hit: boolean;
    }) {
        const analytics = this.getAnalyticsEngine();
        if (!analytics) return;

        try {
            analytics.writeDataPoint({
                blobs: ['cache', params.key],
                doubles: [params.hit ? 1 : 0],
                indexes: ['cache'],
            });
        } catch (error) {
            analyticsLogger.error({ error }, 'Failed to track cache hit');
        }
    }
}

export const analytics = new Analytics();
