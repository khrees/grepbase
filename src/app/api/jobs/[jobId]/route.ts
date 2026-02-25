import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { ingestJobs } from '@/db';
import { getDb } from '@/db';
import { logger } from '@/lib/logger';
import { applyPrivateNoStoreHeaders, resolveSession } from '@/lib/api-security';
import { hasJobAccess, hasRepoAccess } from '@/services/resource-access';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ jobId: string }> }
) {
    const requestLogger = logger.child({ endpoint: '/api/jobs/[jobId]' });
    const db = getDb();

    try {
        const session = await resolveSession(request);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { jobId } = await params;
        if (!jobId || jobId.length > 128) {
            return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });
        }

        const job = await db.select()
            .from(ingestJobs)
            .where(eq(ingestJobs.jobId, jobId))
            .limit(1);
        if (!job || job.length === 0) {
            requestLogger.warn({ jobId }, 'Job not found');
            return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        const jobData = job[0];
        let hasAccess = await hasJobAccess(jobId, session.sessionId);

        // Compatibility path for older jobs that predate explicit job ownership mapping.
        if (!hasAccess && jobData.repoId) {
            hasAccess = await hasRepoAccess(jobData.repoId, session.sessionId);
        }

        if (!hasAccess) {
            requestLogger.warn({ jobId, sessionId: session.sessionId }, 'Forbidden job access');
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const processedCommits = Number(jobData.processedCommits || 0);
        const ready =
            jobData.status === 'completed' ||
            (jobData.status === 'processing' && processedCommits > 0);

        return applyPrivateNoStoreHeaders(
            NextResponse.json({
                jobId: jobData.jobId,
                status: jobData.status,
                progress: jobData.progress,
                totalCommits: jobData.totalCommits,
                processedCommits,
                repoId: jobData.repoId ?? null,
                repository: null,
                ready,
                error: jobData.error,
                updatedAt: jobData.updatedAt,
            })
        );
    } catch (error) {
        requestLogger.error(
            { error, errorMessage: error instanceof Error ? error.message : 'Unknown error' },
            'Error fetching job status'
        );
        return NextResponse.json({ error: 'Failed to fetch job status' }, { status: 500 });
    }
}
