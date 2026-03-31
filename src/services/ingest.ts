import { and, eq, sql } from 'drizzle-orm';
import { repositories, commits, files, ingestJobs } from '@/db/schema';
import {
    fetchRepository,
    fetchCommitHistoryPage,
    fetchFilesAtCommit,
    getLanguageFromPath,
} from './github';
import { logger } from '@/lib/logger';
import type { Database } from '@/db/index';
import { GITHUB, INGEST } from '@/lib/constants';
import { safeGrantRepoAccess } from './resource-access';

interface IngestOptions {
    jobId: string;
    url: string;
    clientId: string;
    db: Database;
}

export async function processRepoIngestion({
    jobId,
    url,
    clientId,
    db,
}: IngestOptions): Promise<void> {
    const processLogger = logger.child({ jobId, url, clientId, worker: true });

    try {
        processLogger.info('Starting background repository ingestion');

        // 1. Update job status to processing
        await db.update(ingestJobs)
            .set({
                status: 'processing',
                progress: 10,
                updatedAt: new Date(),
            })
            .where(eq(ingestJobs.jobId, jobId));

        // 2. Extract owner/repo
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

        // 3. Fetch repo details
        processLogger.debug({ owner, repoName }, 'Fetching repository details');
        const repoDetails = await fetchRepository(owner, repoName);

        // 4. Save/update repository in DB
        const now = new Date();
        await db.update(ingestJobs)
            .set({ progress: 20, updatedAt: now })
            .where(eq(ingestJobs.jobId, jobId));

        const repoResult = await db
            .insert(repositories)
            .values({
                url,
                owner,
                name: repoName,
                description: repoDetails.description,
                readme: null, // Readme fetched separately now
                stars: repoDetails.stars,
                defaultBranch: repoDetails.defaultBranch,
                lastFetched: now,
                createdAt: now,
            })
            .onConflictDoUpdate({
                target: [repositories.url],
                set: {
                    description: repoDetails.description,
                    readme: null,
                    stars: repoDetails.stars,
                    defaultBranch: repoDetails.defaultBranch,
                    lastFetched: now,
                },
            })
            .returning();

        if (!repoResult || repoResult.length === 0) {
            processLogger.error('Failed to get repository ID after insert/update');
            throw new Error('Database failed to return repository record');
        }

        const repoId = repoResult[0].id;
        processLogger.info({ repoId }, 'Repository record saved/updated');

        // Bind repository visibility to the originating session owner.
        await safeGrantRepoAccess(repoId, clientId);

        // 5. Fetch commits
        const maxCommits = Math.max(1, GITHUB.MAX_COMMITS_PER_REPO);
        await db.update(ingestJobs)
            .set({
                progress: 30,
                updatedAt: new Date(),
                repoId,
                totalCommits: maxCommits,
                processedCommits: 0,
            })
            .where(eq(ingestJobs.jobId, jobId));

        processLogger.debug({ owner, repoName, maxCommits }, 'Fetching commits in pages (parallel)');

        const BATCH_SIZE = 50; // DB insert batch size
        const PER_PAGE = GITHUB.MAX_COMMITS_PER_REQUEST;
        const PARALLEL = GITHUB.PARALLEL_PAGE_FETCHES;
        const totalPages = Math.ceil(maxCommits / PER_PAGE);

        let processedCommits = 0;
        let expectedCommits = maxCommits;
        let latestCommitShas: string[] = [];
        let firstBatchDone = false;

        // Fetch pages in groups of PARALLEL to stay within GitHub rate limits
        for (let pageGroupStart = 1; pageGroupStart <= totalPages; pageGroupStart += PARALLEL) {
            const pageNums: number[] = [];
            for (let p = pageGroupStart; p < pageGroupStart + PARALLEL && p <= totalPages; p++) {
                pageNums.push(p);
            }

            // Fetch all pages in this group concurrently
            const pageResults = await Promise.all(
                pageNums.map((page) =>
                    fetchCommitHistoryPage(owner, repoName, page, PER_PAGE).catch((err) => {
                        processLogger.warn({ page, error: err }, 'Failed to fetch commit page, skipping');
                        return [] as Awaited<ReturnType<typeof fetchCommitHistoryPage>>;
                    })
                )
            );

            // Flatten pages in order, stop if GitHub returned fewer than requested (last page)
            let hitLastPage = false;
            const allCommits: Awaited<ReturnType<typeof fetchCommitHistoryPage>> = [];
            for (let i = 0; i < pageResults.length; i++) {
                const page = pageResults[i];
                allCommits.push(...page);
                if (page.length < PER_PAGE) { hitLastPage = true; break; }
            }

            if (allCommits.length === 0) break;

            // Capture the latest SHA refs from the very first commits ever seen
            if (latestCommitShas.length === 0) {
                latestCommitShas = allCommits.slice(0, 5).map((c) => c.sha);
            }

            // Insert in DB batches
            for (let i = 0; i < allCommits.length; i += BATCH_SIZE) {
                const batch = allCommits.slice(i, i + BATCH_SIZE);
                const dbCommits = batch.map((c, idx) => ({
                    repoId,
                    sha: c.sha,
                    message: c.message,
                    authorName: c.authorName,
                    authorEmail: c.authorEmail,
                    date: new Date(c.date),
                    order: maxCommits - (processedCommits + i + idx) - 1,
                }));

                try {
                    await db.insert(commits).values(dbCommits).onConflictDoUpdate({
                        target: [commits.repoId, commits.sha],
                        set: {
                            message: sql`excluded.message`,
                            authorName: sql`excluded.author_name`,
                            authorEmail: sql`excluded.author_email`,
                            date: sql`excluded.date`,
                            order: sql`excluded."order"`,
                        },
                    });
                } catch {
                    // Fallback for environments without the composite unique index migration
                    await db.insert(commits).values(dbCommits).onConflictDoNothing().catch((e) => {
                        processLogger.warn({ batchSize: dbCommits.length, error: e }, 'Could not persist commit batch');
                    });
                }
            }

            processedCommits += allCommits.length;

            if (hitLastPage) {
                expectedCommits = Math.max(1, processedCommits);
            }

            // Mark job usable after first successful batch so users can start navigating
            if (!firstBatchDone && processedCommits > 0) {
                firstBatchDone = true;
                await db.update(ingestJobs)
                    .set({
                        progress: 40,
                        processedCommits,
                        totalCommits: expectedCommits,
                        repoId,
                        updatedAt: new Date(),
                    })
                    .where(eq(ingestJobs.jobId, jobId));
            } else {
                const progressBase = Math.max(1, expectedCommits);
                const progress = 30 + Math.floor((processedCommits / progressBase) * 30);
                await db.update(ingestJobs)
                    .set({ progress, processedCommits, totalCommits: expectedCommits, updatedAt: new Date() })
                    .where(eq(ingestJobs.jobId, jobId));
            }

            if (hitLastPage || processedCommits >= maxCommits) break;
        }


        if (processedCommits === 0) {
            throw new Error('No commits found in repository');
        }

        // 6. Pre-fetch files for the latest 5 commits
        // This is optional but improves UX dramatically for the initial timeline view
        await db.update(ingestJobs)
            .set({
                progress: 65,
                updatedAt: new Date(),
                totalCommits: expectedCommits,
                processedCommits,
            })
            .where(eq(ingestJobs.jobId, jobId));

        const isMassiveRepo = repoDetails.size > INGEST.MASSIVE_REPO_SIZE_KB;
        const latestCommitsToProcess = isMassiveRepo ? 0 : Math.min(INGEST.LATEST_COMMITS_TO_PREFETCH_DEFAULT, latestCommitShas.length);
        processLogger.debug(`Pre-fetching files for latest ${latestCommitsToProcess} commits`);

        for (let i = 0; i < latestCommitsToProcess; i++) {
            const sha = latestCommitShas[i];

            try {
                // Get the commit ID from DB
                const dbCommit = await db
                    .select()
                    .from(commits)
                    .where(and(eq(commits.repoId, repoId), eq(commits.sha, sha)))
                    .limit(1);

                if (dbCommit.length > 0) {
                    const commitId = dbCommit[0].id;

                    // Fetch files from GitHub
                    const githubFiles = await fetchFilesAtCommit(owner, repoName, sha);

                    // Prepare file records without content
                    const filesToSave = githubFiles.map((file) => ({
                        commitId,
                        path: file.path,
                        content: null, // Don't pre-fetch all file content yet
                        size: file.size,
                        language: getLanguageFromPath(file.path),
                    }));

                    if (filesToSave.length > 0) {
                        // Save in batches
                        const FILE_BATCH_SIZE = INGEST.FILE_BATCH_INSERT_SIZE;
                        for (let j = 0; j < filesToSave.length; j += FILE_BATCH_SIZE) {
                            const fileBatch = filesToSave.slice(j, j + FILE_BATCH_SIZE);
                            await db.insert(files).values(fileBatch);
                        }
                    }
                }
            } catch (fileErr) {
                processLogger.warn(
                    { sha, error: fileErr },
                    `Failed to pre-fetch files for commit`
                );
                // Continue with other commits even if one fails
            }

            const progress =
                65 +
                Math.floor(
                    ((i + 1) / latestCommitsToProcess) * 25
                );

            await db.update(ingestJobs)
                .set({
                    progress,
                    updatedAt: new Date(),
                    totalCommits: expectedCommits,
                    processedCommits,
                })
                .where(eq(ingestJobs.jobId, jobId));
        }

        // 7. Mark job as complete
        await db.update(ingestJobs)
            .set({
                status: 'completed',
                progress: 100,
                updatedAt: new Date(),
                repoId,
                totalCommits: expectedCommits,
                processedCommits,
            })
            .where(eq(ingestJobs.jobId, jobId));

        processLogger.info('Repository ingestion completed successfully');
    } catch (error) {
        processLogger.error(
            { error, errorMessage: error instanceof Error ? error.message : 'Unknown error' },
            'Repository ingestion failed'
        );

        // Update job status to failed
        try {
            await db.update(ingestJobs)
                .set({
                    status: 'failed',
                    error: error instanceof Error ? error.message : 'Unknown error',
                    updatedAt: new Date(),
                })
                .where(eq(ingestJobs.jobId, jobId));
        } catch (updateError) {
            processLogger.error({ updateError }, 'Failed to update job status to failed');
        }
    }
}
