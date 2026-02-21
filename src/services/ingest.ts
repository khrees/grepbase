import { eq } from 'drizzle-orm';
import { repositories, commits, files, ingestJobs } from '@/db/schema';
import {
    fetchRepository,
    fetchCommitHistory,
    fetchCommitDiff,
    fetchFilesAtCommit,
    getLanguageFromPath,
} from './github';
import { logger } from '@/lib/logger';
import type { Database } from '@/db/index';

const MAX_FILE_SIZE = 100000; // 100KB

const CODE_EXTENSIONS = [
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.py',
    '.rs',
    '.go',
    '.java',
    '.cpp',
    '.c',
    '.h',
    '.hpp',
    '.rb',
    '.php',
    '.swift',
    '.kt',
    '.md',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.css',
    '.scss',
    '.html',
    '.xml',
    '.sql',
    '.sh',
    '.bash',
];

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
    const processLogger = logger.child({ jobId, url, worker: true });

    try {
        processLogger.info('Starting background repository ingestion');

        // 1. Update job status to processing
        await (db.update(ingestJobs) as any)
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
        await (db.update(ingestJobs) as any)
            .set({ progress: 20, updatedAt: now })
            .where(eq(ingestJobs.jobId, jobId));

        const repoResult = await (db
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
            } as any)
            .onConflictDoUpdate({
                target: repositories.url,
                set: {
                    description: repoDetails.description,
                    readme: null,
                    stars: repoDetails.stars,
                    defaultBranch: repoDetails.defaultBranch,
                    lastFetched: now,
                },
            })
            .returning() as any);

        const repoId = repoResult[0].id;

        // 5. Fetch commits
        await (db.update(ingestJobs) as any)
            .set({ progress: 30, updatedAt: new Date() })
            .where(eq(ingestJobs.jobId, jobId));

        processLogger.debug({ owner, repoName }, 'Fetching commits');
        const commitList = await fetchCommitHistory(owner, repoName, 100);

        if (commitList.length === 0) {
            throw new Error('No commits found in repository');
        }

        // Process commits in batches to avoid overwhelming the DB
        const BATCH_SIZE = 50;
        let processedCommits = 0;

        for (let i = 0; i < commitList.length; i += BATCH_SIZE) {
            const batch = commitList.slice(i, i + BATCH_SIZE);

            const dbCommits = batch.map((c: any, idx: number) => ({
                repoId,
                sha: c.sha,
                message: c.message,
                authorName: c.authorName,
                authorEmail: c.authorEmail,
                date: new Date(c.date),
                order: i + idx,
            }));

            // In SQLite/D1, we can't easily upsert with a complex ON CONFLICT DO UPDATE
            // without unique constraints. We should assume insert is safe since we
            // order commits chronologically and this is a full sync, but we should handle conflicts.
            // D1 doesn't support complex ON CONFLICT so we'll try/catch instead
            for (const commit of dbCommits) {
                try {
                    await (db
                        .insert(commits)
                        .values(commit as any)
                        .onConflictDoUpdate({
                            target: [commits.repoId, commits.sha],
                            set: commit as any,
                        }) as any);
                } catch (e) {
                    // Fallback if unique index isn't set up exactly right yet
                    console.warn(`Could not insert commit ${commit.sha}:`, e);
                }
            }

            processedCommits += batch.length;
            const progress = 30 + Math.floor((processedCommits / commitList.length) * 30);

            await (db.update(ingestJobs) as any)
                .set({ progress, updatedAt: new Date() })
                .where(eq(ingestJobs.jobId, jobId));
        }

        // 6. Pre-fetch files for the latest 5 commits
        // This is optional but improves UX dramatically for the initial timeline view
        await (db.update(ingestJobs) as any)
            .set({ progress: 65, updatedAt: new Date() })
            .where(eq(ingestJobs.jobId, jobId));

        const latestCommitsToProcess = Math.min(5, commitList.length);
        processLogger.debug(`Pre-fetching files for latest ${latestCommitsToProcess} commits`);

        for (let i = commitList.length - latestCommitsToProcess; i < commitList.length; i++) {
            const gitCommit = commitList[i];

            try {
                // Get the commit ID from DB
                const dbCommit = await (db
                    .select()
                    .from(commits)
                    .where(eq(commits.sha, gitCommit.sha))
                    .limit(1) as any);

                if (dbCommit.length > 0) {
                    const commitId = dbCommit[0].id;

                    // Fetch files from GitHub
                    const githubFiles = await fetchFilesAtCommit(owner, repoName, gitCommit.sha);

                    // Prepare file records without content
                    const filesToSave = githubFiles.map((file: any) => ({
                        commitId,
                        path: file.path,
                        content: null, // Don't pre-fetch all file content yet
                        size: file.size,
                        language: getLanguageFromPath(file.path),
                    }));

                    if (filesToSave.length > 0) {
                        // Save in batches
                        const FILE_BATCH_SIZE = 100;
                        for (let j = 0; j < filesToSave.length; j += FILE_BATCH_SIZE) {
                            const fileBatch = filesToSave.slice(j, j + FILE_BATCH_SIZE);
                            await (db.insert(files).values(fileBatch as any) as any);
                        }
                    }
                }
            } catch (fileErr) {
                processLogger.warn(
                    { sha: gitCommit.sha, error: fileErr },
                    `Failed to pre-fetch files for commit`
                );
                // Continue with other commits even if one fails
            }

            const progress =
                65 +
                Math.floor(
                    ((i - (commitList.length - latestCommitsToProcess) + 1) / latestCommitsToProcess) * 25
                );

            await (db.update(ingestJobs) as any)
                .set({ progress, updatedAt: new Date() })
                .where(eq(ingestJobs.jobId, jobId));
        }

        // Process waitlist entry if there's one for this user
        try {
            // NOTE: Removed `waitlist` dependencies. NextJS will handle queues later through edge DB logic if required.
        } catch (waitlistErr) {
            processLogger.warn({ err: waitlistErr }, 'Failed to process waitlist entry');
            // Non-fatal, continue with success
        }

        // 7. Mark job as complete
        await (db.update(ingestJobs) as any)
            .set({
                status: 'completed',
                progress: 100,
                updatedAt: new Date(),
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
            await (db.update(ingestJobs) as any)
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
