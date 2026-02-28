import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb, ingestJobs, repositories } from '@/db';
import type { Database } from '@/db';
import { logger } from '@/lib/logger';

const schedulerLogger = logger.child({ service: 'refresh-scheduler' });
const ACTIVE_JOB_STATUSES = ['pending', 'processing'] as const;
const DEFAULT_SCAN_LIMIT = 200;
const DEFAULT_ENQUEUE_LIMIT = 20;

interface SchedulerOptions {
  scanLimit?: number;
  enqueueLimit?: number;
  db?: Database;
}

export interface SchedulerResult {
  scanned: number;
  due: number;
  enqueued: number;
  jobIds: string[];
}

function clampPositive(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value as number));
}

function getLastFetchMs(repo: {
  lastFetchAt: Date | null;
  lastFetched: Date;
  createdAt: Date;
}): number {
  if (repo.lastFetchAt) return new Date(repo.lastFetchAt).getTime();
  if (repo.lastFetched) return new Date(repo.lastFetched).getTime();
  return new Date(repo.createdAt).getTime();
}

export async function enqueueDueRepositoryRefreshJobs({
  scanLimit = DEFAULT_SCAN_LIMIT,
  enqueueLimit = DEFAULT_ENQUEUE_LIMIT,
  db = getDb(),
}: SchedulerOptions = {}): Promise<SchedulerResult> {
  const boundedScanLimit = clampPositive(scanLimit, DEFAULT_SCAN_LIMIT);
  const boundedEnqueueLimit = clampPositive(enqueueLimit, DEFAULT_ENQUEUE_LIMIT);
  const now = new Date();
  const nowMs = Date.now();

  const candidates = await db.select({
    id: repositories.id,
    url: repositories.url,
    lastFetchAt: repositories.lastFetchAt,
    lastFetched: repositories.lastFetched,
    createdAt: repositories.createdAt,
    fetchIntervalMinutes: repositories.fetchIntervalMinutes,
  })
    .from(repositories)
    .orderBy(asc(repositories.lastFetchAt), asc(repositories.lastFetched), asc(repositories.id))
    .limit(boundedScanLimit);

  if (candidates.length === 0) {
    return {
      scanned: 0,
      due: 0,
      enqueued: 0,
      jobIds: [],
    };
  }

  const dueRepos = candidates.filter((repo) => {
    const intervalMinutes = Math.max(1, Number(repo.fetchIntervalMinutes || 60));
    const elapsedMs = nowMs - getLastFetchMs(repo);
    return elapsedMs >= intervalMinutes * 60 * 1000;
  });

  if (dueRepos.length === 0) {
    return {
      scanned: candidates.length,
      due: 0,
      enqueued: 0,
      jobIds: [],
    };
  }

  const dueRepoIds = dueRepos.map(repo => repo.id);
  const activeJobs = await db.select({
    repoId: ingestJobs.repoId,
  })
    .from(ingestJobs)
    .where(and(
      inArray(ingestJobs.repoId, dueRepoIds),
      inArray(ingestJobs.status, ACTIVE_JOB_STATUSES)
    ));
  const repoIdsWithActiveJobs = new Set(
    activeJobs
      .map(job => job.repoId)
      .filter((repoId): repoId is number => typeof repoId === 'number')
  );

  let enqueued = 0;
  const jobIds: string[] = [];
  for (const repo of dueRepos) {
    if (enqueued >= boundedEnqueueLimit) break;
    if (repoIdsWithActiveJobs.has(repo.id)) continue;

    const jobId = crypto.randomUUID();
    await db.insert(ingestJobs).values({
      jobId,
      url: repo.url,
      status: 'pending',
      progress: 0,
      repoId: repo.id,
      createdAt: now,
      updatedAt: now,
    });

    enqueued += 1;
    jobIds.push(jobId);
  }

  schedulerLogger.info(
    { scanned: candidates.length, due: dueRepos.length, enqueued, enqueueLimit: boundedEnqueueLimit },
    'Scheduled due repository refresh jobs'
  );

  return {
    scanned: candidates.length,
    due: dueRepos.length,
    enqueued,
    jobIds,
  };
}

export async function bumpRepoFetchTimestamp(repoId: number, db: Database = getDb()): Promise<void> {
  await db.update(repositories)
    .set({ lastFetchAt: new Date() })
    .where(eq(repositories.id, repoId));
}
