import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { repositories, commits, files } from '@/db';
import { getDb } from '@/db';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, INGEST, shouldFetchFileContent } from '@/lib/constants';
import { applyPrivateNoStoreHeaders, enforceRateLimit, resolveSession } from '@/lib/api-security';
import { hasRepoAccess } from '@/services/resource-access';
import { fetchFilesAtCommit, getLanguageFromPath } from '@/services/github';

const COMMIT_SHA_REGEX = /^[0-9a-f]{7,64}$/i;

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; sha: string }> }
) {
    const requestLogger = logger.child({ endpoint: 'GET /api/repos/[id]/commits/[sha]' });
    const db = getDb();

    try {
        const session = await resolveSession(request);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:repos:commit:get',
            limit: RATE_LIMITS.GENERAL_API,
            sessionId: session.sessionId,
        });
        if (rateLimitError) {
            return rateLimitError.response;
        }

        const { id, sha } = await params;
        const repoId = Number.parseInt(id, 10);

        if (Number.isNaN(repoId)) {
            return NextResponse.json({ error: 'Invalid repository ID' }, { status: 400 });
        }

        if (!COMMIT_SHA_REGEX.test(sha)) {
            return NextResponse.json({ error: 'Invalid commit SHA' }, { status: 400 });
        }

        const repoAccess = await hasRepoAccess(repoId, session.sessionId);
        if (!repoAccess) {
            requestLogger.warn({ repoId, sessionId: session.sessionId }, 'Forbidden repository access');
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const repo = await db.select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);
        if (repo.length === 0) {
            return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
        }

        const commit = await db.select()
            .from(commits)
            .where(and(eq(commits.repoId, repoId), eq(commits.sha, sha)))
            .limit(1);
        if (commit.length === 0) {
            return NextResponse.json({ error: 'Commit not found' }, { status: 404 });
        }

        const cachedFiles = await db.select({
            id: files.id,
            path: files.path,
            size: files.size,
            language: files.language,
            hasContent: files.content,
        })
            .from(files)
            .where(eq(files.commitId, commit[0].id));

        if (cachedFiles.length > 0) {
            const fileList = cachedFiles.map((file) => ({
                id: file.id,
                path: file.path,
                size: file.size,
                language: file.language,
                hasContent: Boolean(file.hasContent),
                shouldFetchContent: shouldFetchFileContent(file.path, Number(file.size || 0)),
            }));

            return applyPrivateNoStoreHeaders(
                NextResponse.json({
                    commit: commit[0],
                    files: fileList,
                    cached: true,
                })
            );
        }

        const githubFiles = await fetchFilesAtCommit(repo[0].owner, repo[0].name, sha);

        const filesToSave = githubFiles.map((file) => ({
            commitId: commit[0].id,
            path: file.path,
            content: null as string | null,
            size: file.size,
            language: getLanguageFromPath(file.path),
            shouldFetchContent: shouldFetchFileContent(file.path, file.size),
        }));

        const isMassiveCommit = githubFiles.length > 3000;

        if (filesToSave.length > 0 && !isMassiveCommit) {
            const dbFiles = filesToSave.map((file) => ({
                commitId: file.commitId,
                path: file.path,
                content: file.content,
                size: file.size,
                language: file.language,
            }));

            const batchSize = INGEST.FILE_BATCH_INSERT_SIZE;
            for (let i = 0; i < dbFiles.length; i += batchSize) {
                await db.insert(files).values(dbFiles.slice(i, i + batchSize));
            }
        }

        return applyPrivateNoStoreHeaders(
            NextResponse.json({
                commit: commit[0],
                files: filesToSave.map((file) => ({
                    path: file.path,
                    size: file.size,
                    language: file.language,
                    hasContent: false,
                    shouldFetchContent: file.shouldFetchContent,
                })),
                cached: false,
            })
        );
    } catch (error) {
        requestLogger.error({ error }, 'Failed to fetch commit files');
        return NextResponse.json(
            { error: 'Failed to fetch files' },
            { status: 500 }
        );
    }
}
