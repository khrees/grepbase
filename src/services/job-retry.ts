import { getDb } from '@/db';
import { ingestJobs, repositories, commits } from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { analytics } from '@/lib/analytics';
import { processRepoIngestion } from '@/services/ingest';
import { waitUntil } from '@vercel/functions';

const MAX_RETRIES = 3;

/**
 * Retry a single failed or stuck job
 */
export async function retryJob(jobId: string, clientId: string = 'system'): Promise<boolean> {
  const requestLogger = logger.child({ jobId, action: 'retryJob' });
  const database = getDb();

  try {
    // 1. Get the job
    const job = await database.select()
      .from(ingestJobs)
      .where(eq(ingestJobs.jobId, jobId))
      .limit(1);

    if (!job || job.length === 0) {
      requestLogger.warn('Job not found for retry');
      return false;
    }

    const currentJob = job[0];

    // Check if it's already processing
    if (currentJob.status === 'processing') {
      // If it hasn't been updated in 15 minutes, we can assume it got stuck
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      if (new Date(currentJob.updatedAt) > fifteenMinutesAgo) {
        requestLogger.info('Job is currently processing normally, skipping retry');
        return false;
      }
      requestLogger.info('Job seems stuck (no updates for 15m), retrying');
    }

    // Check retry count
    const retryCount = currentJob.retryCount || 0;
    if (retryCount >= MAX_RETRIES) {
      requestLogger.warn({ retryCount }, 'Job has reached maximum retries');
      return false;
    }

    // 2. Identify problems and clean up partial state if necessary
    requestLogger.info({ url: currentJob.url, status: currentJob.status }, 'Preparing to retry job');

    // Find if repo was partially created
    const existingRepo = await database.select()
      .from(repositories)
      .where(eq(repositories.url, currentJob.url))
      .limit(1);

    if (existingRepo && existingRepo.length > 0) {
      const repoId = existingRepo[0].id;

      // Check if we have commits
      const commitCount = await database.select({ count: sql<number>`count(*)` })
        .from(commits)
        .where(eq(commits.repoId, repoId));

      const hasCommits = Number(commitCount[0]?.count || 0) > 0;

      if (!hasCommits) {
        // Repo exists but no commits - this is the exact "stuck" state 
        // We'll let processRepoIngestion handle it since it checks for this
        requestLogger.info({ repoId }, 'Found repo with no commits, passing to ingest service');
      } else if (currentJob.status === 'failed') {
        // We have commits but job failed - probably failed during file processing
        // We might want to clear files for these commits, but processRepoIngestion
        // currently uses UPSERT for everything, so we can just re-run it
        requestLogger.info({ repoId, count: Number(commitCount[0]?.count) }, 'Found repo with commits on failed job');
      }
    }

    // 3. Reset job state
    const now = new Date();
    await database.update(ingestJobs)
      .set({
        status: 'pending',
        progress: 0,
        error: null,
        updatedAt: now,
        retryCount: retryCount + 1,
      })
      .where(eq(ingestJobs.jobId, jobId));

    // 4. Trigger processing in background using Next.js waitUntil
    waitUntil(
      processRepoIngestion({
        jobId,
        url: currentJob.url,
        clientId,
        db: database,
      }).catch((err) => {
        logger.error({ err }, 'Background ingestion retry failed');
      })
    );

    // Track analytics
    await analytics.trackRequest({
      endpoint: 'internal/retry-job',
      method: 'POST',
      statusCode: 202,
      duration: 0,
      clientId,
    });

    requestLogger.info('Retry triggered successfully');
    return true;
  } catch (error) {
    requestLogger.error({ error }, 'Failed to trigger job retry');
    return false;
  }
}

/**
 * Find and retry all stuck or failed jobs automatically
 * This could be called by a cron trigger or scheduled task
 */
export async function retryFailedJobs(clientId: string = 'cron'): Promise<{
  attempted: number;
  successful: number;
  failed: number;
}> {
  const requestLogger = logger.child({ action: 'retryFailedJobs' });
  const database = getDb();

  try {
    // Find failed jobs that haven't reached max retries
    const failedJobs = await database.select()
      .from(ingestJobs)
      .where(
        and(
          eq(ingestJobs.status, 'failed'),
          // Using raw SQL for the retryCount condition since it might be null
          sql`(${ingestJobs.retryCount} IS NULL OR ${ingestJobs.retryCount} < ${MAX_RETRIES})`
        )
      )
      .limit(10); // Process in batches

    // Find stuck processing jobs (no updates in 15 mins)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const stuckJobs = await database.select()
      .from(ingestJobs)
      .where(
        and(
          eq(ingestJobs.status, 'processing'),
          sql`${ingestJobs.updatedAt} < ${fifteenMinutesAgo.toISOString()}`,
          sql`(${ingestJobs.retryCount} IS NULL OR ${ingestJobs.retryCount} < ${MAX_RETRIES})`
        )
      )
      .limit(10);

    const jobsToRetry = [...failedJobs, ...stuckJobs];

    if (jobsToRetry.length === 0) {
      requestLogger.info('No failed or stuck jobs found to retry');
      return { attempted: 0, successful: 0, failed: 0 };
    }

    requestLogger.info({ count: jobsToRetry.length }, 'Found jobs to retry');

    let successful = 0;
    let failed = 0;

    for (const job of jobsToRetry) {
      try {
        const success = await retryJob(job.jobId, clientId);
        if (success) successful++;
        else failed++;
      } catch (err) {
        requestLogger.error({ jobId: job.jobId, err }, 'Exception during job retry');
        failed++;
      }
    }

    return {
      attempted: jobsToRetry.length,
      successful,
      failed
    };
  } catch (error) {
    requestLogger.error({ error }, 'Failed to run auto-retry process');
    throw error;
  }
}

/**
 * Get statistics about job retries
 */
export async function getRetryStats() {
  const database = getDb();

  try {
    const result = await database.select({
      total: sql<number>`count(*)`,
      pending: sql<number>`sum(case when ${ingestJobs.status} = 'pending' then 1 else 0 end)`,
      processing: sql<number>`sum(case when ${ingestJobs.status} = 'processing' then 1 else 0 end)`,
      completed: sql<number>`sum(case when ${ingestJobs.status} = 'completed' then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${ingestJobs.status} = 'failed' then 1 else 0 end)`,
      retriedPending: sql<number>`sum(case when ${ingestJobs.status} = 'pending' and coalesce(${ingestJobs.retryCount}, 0) > 0 then 1 else 0 end)`,
      retriedProcessing: sql<number>`sum(case when ${ingestJobs.status} = 'processing' and coalesce(${ingestJobs.retryCount}, 0) > 0 then 1 else 0 end)`,
      retriedCompleted: sql<number>`sum(case when ${ingestJobs.status} = 'completed' and coalesce(${ingestJobs.retryCount}, 0) > 0 then 1 else 0 end)`,
      permanentlyFailed: sql<number>`sum(case when ${ingestJobs.status} = 'failed' and coalesce(${ingestJobs.retryCount}, 0) >= 3 then 1 else 0 end)`,
    }).from(ingestJobs);

    const row = result[0];
    return {
      total: Number(row?.total || 0),
      pending: Number(row?.pending || 0),
      processing: Number(row?.processing || 0),
      completed: Number(row?.completed || 0),
      failed: Number(row?.failed || 0),
      retried: {
        pending: Number(row?.retriedPending || 0),
        processing: Number(row?.retriedProcessing || 0),
        completed: Number(row?.retriedCompleted || 0),
        permanentlyFailed: Number(row?.permanentlyFailed || 0),
      }
    };
  } catch (error) {
    logger.error({ error }, 'Failed to get retry stats');
    return null;
  }
}
