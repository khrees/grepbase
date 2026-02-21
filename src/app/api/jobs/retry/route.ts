import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { retryFailedJobs, getRetryStats } from '@/services/job-retry';

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'POST /api/jobs/retry' });
    const startTime = Date.now();

    try {
        const retriedCount = await retryFailedJobs();
        const stats = await getRetryStats();
        const duration = Date.now() - startTime;

        requestLogger.info({ retriedCount, stats, duration }, 'Jobs retried successfully');

        return NextResponse.json({
            success: true,
            retriedCount,
            stats,
            duration,
            message: `Retried ${retriedCount?.successful || 0} failed jobs`,
        });
    } catch (error) {
        const duration = Date.now() - startTime;
        requestLogger.error({ error, duration }, 'Failed to retry jobs');

        return NextResponse.json(
            {
                success: false,
                error: 'Failed to retry jobs',
                message: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}

export async function GET(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'GET /api/jobs/retry' });

    try {
        const stats = await getRetryStats();

        requestLogger.debug({ stats }, 'Retry stats retrieved');

        return NextResponse.json({
            success: true,
            stats,
        });
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
