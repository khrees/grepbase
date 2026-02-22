import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { ingestJobs, repositories } from '@/db';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ jobId: string }> }
) {
    const requestLogger = logger.child({ endpoint: '/api/jobs/[jobId]' });

    try {
        const { jobId } = await params;
        const db = getDb();

        const job = await db.select()
            .from(ingestJobs)
            .where(eq(ingestJobs.jobId, jobId))
            .limit(1);

        if (!job || job.length === 0) {
            requestLogger.warn({ jobId }, 'Job not found');
            return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        const jobData = job[0];
        let repository = null;

        if (jobData.repoId) {
            const repo = await db.select()
                .from(repositories)
                .where(eq(repositories.id, jobData.repoId))
                .limit(1);
            repository = repo[0] || null;
        }

        const processedCommits = Number(jobData.processedCommits || 0);
        const ready =
            jobData.status === 'completed' ||
            (jobData.status === 'processing' && processedCommits > 0);

        return NextResponse.json({
            jobId: jobData.jobId,
            status: jobData.status,
            progress: jobData.progress,
            totalCommits: jobData.totalCommits,
            processedCommits,
            repository,
            ready,
            error: jobData.error,
            updatedAt: jobData.updatedAt,
        });
    } catch (error) {
        requestLogger.error(
            { error, errorMessage: error instanceof Error ? error.message : 'Unknown error' },
            'Error fetching job status'
        );
        return NextResponse.json({ error: 'Failed to fetch job status' }, { status: 500 });
    }
}
