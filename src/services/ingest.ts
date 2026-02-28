import { and, eq, sql } from 'drizzle-orm';
import { repositories, commits, ingestJobs } from '@/db/schema';
import { logger } from '@/lib/logger';
import type { Database } from '@/db/index';
import { GITHUB } from '@/lib/constants';
import { safeGrantRepoAccess } from './resource-access';
import { fetchRepository } from './github';
import {
  ensureBareMirror,
  isAncestor,
  listDeltaFirstParentShas,
  listInitialFirstParentShas,
  readCommitMetadataBatch,
  resolveBranchRef,
  resolveDefaultBranch,
  resolveHeadSha,
} from './git-mirror';

interface IngestOptions {
  jobId: string;
  url: string;
  clientId: string;
  db: Database;
}

const COMMIT_UPSERT_BATCH_SIZE = 100; // D1/SQLite caps at 999 params; 100 rows × 8 cols = 800 params (safe)
const CAT_FILE_SHA_BATCH_SIZE = 1000;
const MIN_FETCH_INTERVAL_MINUTES = 5;
const MAX_FETCH_INTERVAL_MINUTES = 24 * 60;
const REQUIRED_SCHEMA_COLUMNS = [
  'last_ingested_sha',
  'last_seen_head_sha',
  'last_fetch_at',
  'fetch_interval_minutes',
  'last_ingest_error',
  'in_default_lineage',
];

function parseOwnerRepo(url: string): { owner: string; repoName: string } {
  let normalized = url
    .replace(/^(https?:\/\/)?(www\.)?/i, '')
    .replace(/\.git\/?$/, '')
    .replace(/\/+$/, '');

  if (normalized.toLowerCase().startsWith('github.com/')) {
    normalized = normalized.substring('github.com/'.length);
  }

  const parts = normalized.split('/').filter(Boolean);
  const owner = parts[0];
  const repoName = parts[1];

  if (!owner || !repoName) {
    throw new Error('Invalid GitHub repository URL');
  }

  return { owner, repoName };
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function clampFetchInterval(minutes: number): number {
  return Math.max(MIN_FETCH_INTERVAL_MINUTES, Math.min(MAX_FETCH_INTERVAL_MINUTES, minutes));
}

function addJitter(minutes: number, ratio = 0.3): number {
  const jitter = minutes * ratio;
  const randomized = minutes + ((Math.random() * 2 - 1) * jitter);
  return clampFetchInterval(Math.round(randomized));
}

function computeNextFetchInterval(currentMinutes: number | null | undefined, commitsAdded: number): number {
  const base = clampFetchInterval(currentMinutes ?? 60);
  if (commitsAdded > 0) {
    return addJitter(Math.max(MIN_FETCH_INTERVAL_MINUTES, Math.floor(base * 0.7)));
  }
  return addJitter(Math.min(MAX_FETCH_INTERVAL_MINUTES, Math.ceil(base * 1.4)));
}

function normalizeIngestErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Unknown error';
  const lower = raw.toLowerCase();
  const looksLikeSchemaError =
    lower.includes('no such column') ||
    lower.includes('has no column') ||
    lower.includes('no such table');
  const referencesRequiredColumn = REQUIRED_SCHEMA_COLUMNS.some((column) => raw.includes(column));

  if (looksLikeSchemaError && referencesRequiredColumn) {
    return 'Database schema is outdated for git-mirror ingestion. Run `bun run db:push` to apply migration 0003_whole_white_queen, then retry.';
  }

  return raw;
}

async function upsertCommitBatch(
  db: Database,
  repoId: number,
  rows: Array<{
    sha: string;
    message: string;
    authorName: string | null;
    authorEmail: string | null;
    date: Date;
    order: number;
    inDefaultLineage: boolean;
  }>
): Promise<void> {
  if (rows.length === 0) return;

  await db
    .insert(commits)
    .values(rows.map(row => ({
      repoId,
      sha: row.sha,
      message: row.message,
      authorName: row.authorName,
      authorEmail: row.authorEmail,
      date: row.date,
      order: row.order,
      inDefaultLineage: row.inDefaultLineage,
    })))
    .onConflictDoUpdate({
      target: [commits.repoId, commits.sha],
      set: {
        message: sql`excluded.message`,
        authorName: sql`excluded.author_name`,
        authorEmail: sql`excluded.author_email`,
        date: sql`excluded.date`,
        order: sql`excluded."order"`,
        inDefaultLineage: sql`excluded.in_default_lineage`,
      },
    });
}

export async function processRepoIngestion({
  jobId,
  url,
  clientId,
  db,
}: IngestOptions): Promise<void> {
  const processLogger = logger.child({ service: 'ingest', strategy: 'git-bare-first-parent', jobId, url, clientId });
  let repoId: number | null = null;

  try {
    processLogger.info('Starting repository ingestion via bare git mirror strategy');

    await db.update(ingestJobs)
      .set({
        status: 'processing',
        progress: 5,
        updatedAt: new Date(),
      })
      .where(eq(ingestJobs.jobId, jobId));

    const { owner, repoName } = parseOwnerRepo(url);
    const now = new Date();

    const repoResult = await db
      .insert(repositories)
      .values({
        url,
        owner,
        name: repoName,
        description: null,
        readme: null,
        stars: 0,
        defaultBranch: 'main',
        lastFetched: now,
        createdAt: now,
        lastFetchAt: now,
        fetchIntervalMinutes: 60,
        lastIngestError: null,
      })
      .onConflictDoUpdate({
        target: [repositories.url],
        set: {
          owner,
          name: repoName,
          lastFetched: now,
          lastFetchAt: now,
          lastIngestError: null,
        },
      })
      .returning();

    if (repoResult.length === 0) {
      throw new Error('Failed to upsert repository state');
    }

    const repo = repoResult[0];
    repoId = repo.id;

    await safeGrantRepoAccess(repoId, clientId);

    await db.update(ingestJobs)
      .set({
        repoId,
        progress: 10,
        updatedAt: new Date(),
      })
      .where(eq(ingestJobs.jobId, jobId));

    // Fetch GitHub metadata and set up the git mirror in parallel to save time.
    const [mirrorPathResult, ghMetaResult] = await Promise.allSettled([
      ensureBareMirror(url),
      fetchRepository(owner, repoName),
    ]);

    if (mirrorPathResult.status === 'rejected') {
      throw mirrorPathResult.reason;
    }
    const mirrorPath = mirrorPathResult.value;

    // If GitHub metadata resolved, persist real description/stars/defaultBranch immediately.
    if (ghMetaResult.status === 'fulfilled') {
      const ghMeta = ghMetaResult.value;
      await db.update(repositories)
        .set({
          description: ghMeta.description,
          stars: ghMeta.stars,
          defaultBranch: ghMeta.defaultBranch,
        })
        .where(eq(repositories.id, repoId));
      processLogger.debug({ repoId, stars: ghMeta.stars }, 'Updated repo metadata from GitHub API');
    } else {
      processLogger.warn({ error: ghMetaResult.reason }, 'GitHub metadata fetch failed; proceeding with placeholders');
    }

    const resolvedDefaultBranch = ghMetaResult.status === 'fulfilled'
      ? ghMetaResult.value.defaultBranch
      : (repo.defaultBranch ?? 'main');
    const defaultBranch = await resolveDefaultBranch(mirrorPath, resolvedDefaultBranch);
    const defaultBranchRef = await resolveBranchRef(mirrorPath, defaultBranch);
    const headSha = await resolveHeadSha(mirrorPath, defaultBranch);

    const lastIngestedSha = repo.lastIngestedSha ?? null;
    const maxFirstParentCommits = Math.max(
      0,
      parseIntEnv('INGEST_FIRST_PARENT_MAX_COMMITS', GITHUB.MAX_COMMITS_PER_REPO)
    );

    let divergence = false;
    if (lastIngestedSha) {
      try {
        divergence = !(await isAncestor(mirrorPath, lastIngestedSha, defaultBranchRef));
      } catch (ancestorError) {
        processLogger.warn({ ancestorError, lastIngestedSha, headSha }, 'Ancestor check failed; treating as divergence');
        divergence = true;
      }
    }

    if (lastIngestedSha === headSha && !divergence) {
      const existingCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(commits)
        .where(and(eq(commits.repoId, repoId), eq(commits.inDefaultLineage, true)));
      const totalCommits = Number(existingCount[0]?.count || 0);
      const nextFetchInterval = computeNextFetchInterval(repo.fetchIntervalMinutes, 0);
      const completedAt = new Date();

      await db.update(repositories)
        .set({
          defaultBranch,
          lastSeenHeadSha: headSha,
          lastIngestedSha: headSha,
          lastFetchAt: completedAt,
          lastFetched: completedAt,
          fetchIntervalMinutes: nextFetchInterval,
          lastIngestError: null,
        })
        .where(eq(repositories.id, repoId));

      await db.update(ingestJobs)
        .set({
          status: 'completed',
          progress: 100,
          updatedAt: completedAt,
          repoId,
          totalCommits,
          processedCommits: 0,
        })
        .where(eq(ingestJobs.jobId, jobId));

      processLogger.info({ repoId, defaultBranch, headSha }, 'Repository already up to date; no delta commits');
      return;
    }

    const shas = (!lastIngestedSha || divergence)
      ? await listInitialFirstParentShas(mirrorPath, defaultBranch, maxFirstParentCommits)
      : await listDeltaFirstParentShas(mirrorPath, lastIngestedSha, defaultBranch);

    if (shas.length === 0) {
      const completedAt = new Date();
      const nextFetchInterval = computeNextFetchInterval(repo.fetchIntervalMinutes, 0);

      await db.update(repositories)
        .set({
          defaultBranch,
          lastSeenHeadSha: headSha,
          lastIngestedSha: headSha,
          lastFetchAt: completedAt,
          lastFetched: completedAt,
          fetchIntervalMinutes: nextFetchInterval,
          lastIngestError: null,
        })
        .where(eq(repositories.id, repoId));

      await db.update(ingestJobs)
        .set({
          status: 'completed',
          progress: 100,
          updatedAt: completedAt,
          repoId,
          totalCommits: 0,
          processedCommits: 0,
        })
        .where(eq(ingestJobs.jobId, jobId));

      processLogger.info({ repoId, defaultBranch, divergence, headSha }, 'No commits returned for ingest window');
      return;
    }

    await db.update(ingestJobs)
      .set({
        progress: 25,
        updatedAt: new Date(),
        totalCommits: shas.length,
        processedCommits: 0,
      })
      .where(eq(ingestJobs.jobId, jobId));

    if (divergence) {
      processLogger.warn({ repoId, lastIngestedSha, headSha }, 'Detected rewritten history; recomputing first-parent lineage');
      await db.update(commits)
        .set({ inDefaultLineage: false })
        .where(eq(commits.repoId, repoId));
    }

    const maxOrderResult = (!lastIngestedSha || divergence)
      ? [{ maxOrder: -1 }]
      : await db
        .select({ maxOrder: sql<number>`max(${commits.order})` })
        .from(commits)
        .where(and(eq(commits.repoId, repoId), eq(commits.inDefaultLineage, true)));
    const startingOrder = Number(maxOrderResult[0]?.maxOrder ?? -1) + 1;

    let processedCommits = 0;
    for (let shaIndex = 0; shaIndex < shas.length; shaIndex += CAT_FILE_SHA_BATCH_SIZE) {
      const shaBatch = shas.slice(shaIndex, shaIndex + CAT_FILE_SHA_BATCH_SIZE);
      const metadataBatch = await readCommitMetadataBatch(mirrorPath, shaBatch);

      for (let commitIndex = 0; commitIndex < metadataBatch.length; commitIndex += COMMIT_UPSERT_BATCH_SIZE) {
        const commitChunk = metadataBatch.slice(commitIndex, commitIndex + COMMIT_UPSERT_BATCH_SIZE);
        const chunkBaseOffset = shaIndex + commitIndex;

        await upsertCommitBatch(
          db,
          repoId,
          commitChunk.map((commit, offset) => ({
            sha: commit.sha,
            message: commit.subject,
            authorName: commit.authorName,
            authorEmail: commit.authorEmail,
            date: commit.authorDate,
            order: startingOrder + chunkBaseOffset + offset,
            inDefaultLineage: true,
          }))
        );

        // Update progress after every chunk so the explore page can render
        // as soon as the first batch of commits hits the DB, rather than
        // waiting for the entire SHA-batch loop to complete.
        processedCommits += commitChunk.length;
        const progress = 25 + Math.floor((processedCommits / shas.length) * 65);
        await db.update(ingestJobs)
          .set({
            progress,
            updatedAt: new Date(),
            totalCommits: shas.length,
            processedCommits,
          })
          .where(eq(ingestJobs.jobId, jobId));
      }
    }

    const completedAt = new Date();
    const nextFetchInterval = computeNextFetchInterval(repo.fetchIntervalMinutes, processedCommits);

    await db.update(repositories)
      .set({
        defaultBranch,
        lastSeenHeadSha: headSha,
        lastIngestedSha: headSha,
        lastFetchAt: completedAt,
        lastFetched: completedAt,
        fetchIntervalMinutes: nextFetchInterval,
        lastIngestError: null,
      })
      .where(eq(repositories.id, repoId));

    await db.update(ingestJobs)
      .set({
        status: 'completed',
        progress: 100,
        updatedAt: completedAt,
        repoId,
        totalCommits: shas.length,
        processedCommits,
      })
      .where(eq(ingestJobs.jobId, jobId));

    processLogger.info({
      repoId,
      defaultBranch,
      divergence,
      commitsProcessed: processedCommits,
      headSha,
      lastIngestedSha,
      nextFetchIntervalMinutes: nextFetchInterval,
    }, 'Repository ingestion completed');
  } catch (error) {
    const normalizedErrorMessage = normalizeIngestErrorMessage(error);
    processLogger.error(
      { error, errorMessage: normalizedErrorMessage },
      'Repository ingestion failed'
    );

    try {
      const errorMessage = normalizedErrorMessage;

      if (repoId !== null) {
        await db.update(repositories)
          .set({
            lastIngestError: errorMessage,
            lastFetchAt: new Date(),
          })
          .where(eq(repositories.id, repoId));
      }

      await db.update(ingestJobs)
        .set({
          status: 'failed',
          error: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(ingestJobs.jobId, jobId));
    } catch (updateError) {
      processLogger.error({ updateError }, 'Failed to persist ingestion failure state');
    }
  }
}
