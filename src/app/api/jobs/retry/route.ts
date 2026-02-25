import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/constants';
import { retryFailedJobs, getRetryStats } from '@/services/job-retry';
import {
    applyPrivateNoStoreHeaders,
    enforceCsrfProtection,
    enforceRateLimit,
} from '@/lib/api-security';

const ADMIN_HEADER = 'x-admin-key';

function timingSafeStringEqual(left: string, right: string): boolean {
    const maxLength = Math.max(left.length, right.length);
    let diff = left.length === right.length ? 0 : 1;

    for (let i = 0; i < maxLength; i += 1) {
        const leftCode = i < left.length ? left.charCodeAt(i) : 0;
        const rightCode = i < right.length ? right.charCodeAt(i) : 0;
        diff |= leftCode ^ rightCode;
    }

    return diff === 0;
}

function enforceAdminAccess(request: NextRequest): NextResponse | null {
    const expectedAdminKey = process.env.ADMIN_API_KEY?.trim();
    if (!expectedAdminKey) {
        return applyPrivateNoStoreHeaders(NextResponse.json(
            { success: false, error: 'Server admin key is not configured' },
            { status: 503 }
        ));
    }

    const providedAdminKey = request.headers.get(ADMIN_HEADER)?.trim() || '';
    if (!providedAdminKey || !timingSafeStringEqual(providedAdminKey, expectedAdminKey)) {
        return applyPrivateNoStoreHeaders(NextResponse.json(
            { success: false, error: 'Unauthorized' },
            { status: 401 }
        ));
    }

    return null;
}

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'POST /api/jobs/retry' });
    const startTime = Date.now();

    try {
        const csrfError = enforceCsrfProtection(request);
        if (csrfError) {
            return csrfError;
        }

        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:jobs:retry:post',
            limit: RATE_LIMITS.REPO_INGEST,
        });
        if (rateLimitError) {
            return rateLimitError.response;
        }

        const adminError = enforceAdminAccess(request);
        if (adminError) {
            return adminError;
        }

        const retriedCount = await retryFailedJobs('admin');
        const stats = await getRetryStats();
        const duration = Date.now() - startTime;

        requestLogger.info({ retriedCount, stats, duration }, 'Jobs retried successfully');

        return applyPrivateNoStoreHeaders(
            NextResponse.json({
                success: true,
                retriedCount,
                stats,
                duration,
                message: `Retried ${retriedCount?.successful || 0} failed jobs`,
            })
        );
    } catch (error) {
        const duration = Date.now() - startTime;
        requestLogger.error({ error, duration }, 'Failed to retry jobs');

        return NextResponse.json(
            {
                success: false,
                error: 'Failed to retry jobs',
            },
            { status: 500 }
        );
    }
}

export async function GET(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'GET /api/jobs/retry' });

    try {
        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:jobs:retry:get',
            limit: RATE_LIMITS.GENERAL_API,
        });
        if (rateLimitError) {
            return rateLimitError.response;
        }

        const adminError = enforceAdminAccess(request);
        if (adminError) {
            return adminError;
        }

        const stats = await getRetryStats();
        requestLogger.debug({ stats }, 'Retry stats retrieved');

        return applyPrivateNoStoreHeaders(
            NextResponse.json({
                success: true,
                stats,
            })
        );
    } catch (error) {
        requestLogger.error({ error }, 'Failed to get retry stats');
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to get retry stats',
            },
            { status: 500 }
        );
    }
}
