import { and, asc, eq } from 'drizzle-orm';
import { getDb, ingestJobs } from '@/db';
import type { Database } from '@/db';
import { logger } from '@/lib/logger';
import { getPlatformEnv } from '@/lib/platform/context';
import { processRepoIngestion } from '@/services/ingest';

const ingestWorkerLogger = logger.child({ service: 'ingest-worker' });
const MAX_CLAIM_RETRIES = 5;

interface ClaimedIngestJob {
  jobId: string;
  url: string;
}

interface ProcessPendingIngestJobsOptions {
  maxJobs?: number;
  clientId?: string;
  db?: Database;
}

interface TriggerIngestWorkerOptions {
  maxJobs?: number;
  clientId?: string;
}

async function claimNextPendingIngestJob(db: Database): Promise<ClaimedIngestJob | null> {
  for (let attempt = 0; attempt < MAX_CLAIM_RETRIES; attempt += 1) {
    const nextPending = await db
      .select({
        jobId: ingestJobs.jobId,
        url: ingestJobs.url,
      })
      .from(ingestJobs)
      .where(eq(ingestJobs.status, 'pending'))
      .orderBy(asc(ingestJobs.updatedAt), asc(ingestJobs.id))
      .limit(1);

    if (nextPending.length === 0) {
      return null;
    }

    const candidate = nextPending[0];
    const claimed = await db
      .update(ingestJobs)
      .set({
        status: 'processing',
        progress: 10,
        updatedAt: new Date(),
      })
      .where(and(eq(ingestJobs.jobId, candidate.jobId), eq(ingestJobs.status, 'pending')))
      .returning({
        jobId: ingestJobs.jobId,
        url: ingestJobs.url,
      });

    if (claimed.length > 0) {
      return claimed[0];
    }
  }

  return null;
}

export async function processPendingIngestJobs({
  maxJobs = 1,
  clientId = 'worker',
  db = getDb(),
}: ProcessPendingIngestJobsOptions = {}): Promise<number> {
  const boundedMaxJobs = Math.max(1, Math.min(maxJobs, 100));
  let processed = 0;

  while (processed < boundedMaxJobs) {
    const claimedJob = await claimNextPendingIngestJob(db);
    if (!claimedJob) {
      break;
    }

    ingestWorkerLogger.info(
      { jobId: claimedJob.jobId, clientId, position: processed + 1, maxJobs: boundedMaxJobs },
      'Claimed pending ingestion job'
    );

    await processRepoIngestion({
      jobId: claimedJob.jobId,
      url: claimedJob.url,
      clientId,
      db,
    });

    processed += 1;
  }

  return processed;
}

export function triggerIngestWorker({
  maxJobs = 1,
  clientId = 'api',
}: TriggerIngestWorkerOptions = {}): void {
  const boundedMaxJobs = Math.max(1, Math.min(maxJobs, 100));

  const run = async (): Promise<void> => {
    try {
      await processPendingIngestJobs({
        maxJobs: boundedMaxJobs,
        clientId,
      });
    } catch (error) {
      ingestWorkerLogger.error({ error, maxJobs: boundedMaxJobs, clientId }, 'Ingest worker dispatch failed');
    }
  };

  try {
    const context = getPlatformEnv().getContext();
    if (context) {
      context.waitUntil(run());
      return;
    }
  } catch {
    // Ignore context lookup errors and fall back to local scheduling.
  }

  void run();
}
