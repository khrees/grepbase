import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { logger } from '../lib/logger';
import { processPendingIngestJobs } from '../services/ingest-worker';
import { enqueueDueRepositoryRefreshJobs } from '../services/refresh-scheduler';

const workerLogger = logger.child({ script: 'ingest-worker' });

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorker(): Promise<void> {
  const runOnce = parseBoolean(process.env.INGEST_WORKER_RUN_ONCE);
  const pollIntervalMs = parsePositiveInt(process.env.INGEST_WORKER_POLL_MS, 5000);
  const maxJobsPerTick = parsePositiveInt(process.env.INGEST_WORKER_MAX_JOBS_PER_TICK, 5);
  const enableScheduler = parseBoolean(process.env.INGEST_WORKER_ENABLE_SCHEDULER);
  const schedulerScanLimit = parsePositiveInt(process.env.INGEST_SCHEDULER_SCAN_LIMIT, 200);
  const schedulerEnqueueLimit = parsePositiveInt(process.env.INGEST_SCHEDULER_ENQUEUE_LIMIT, 20);

  workerLogger.info(
    { runOnce, pollIntervalMs, maxJobsPerTick, enableScheduler, schedulerScanLimit, schedulerEnqueueLimit },
    'Starting ingest worker'
  );

  while (true) {
    if (enableScheduler) {
      const scheduleResult = await enqueueDueRepositoryRefreshJobs({
        scanLimit: schedulerScanLimit,
        enqueueLimit: schedulerEnqueueLimit,
      });

      if (scheduleResult.enqueued > 0) {
        workerLogger.info({ scheduleResult }, 'Scheduled repository refresh jobs');
      }
    }

    const processed = await processPendingIngestJobs({
      maxJobs: maxJobsPerTick,
      clientId: 'worker-script',
    });

    if (processed > 0) {
      workerLogger.info({ processed }, 'Processed pending ingest jobs');
    }

    if (runOnce) {
      break;
    }

    if (processed === 0) {
      await sleep(pollIntervalMs);
    }
  }

  workerLogger.info('Ingest worker stopped');
}

runWorker().catch((error) => {
  workerLogger.error({ error }, 'Ingest worker crashed');
  process.exit(1);
});
