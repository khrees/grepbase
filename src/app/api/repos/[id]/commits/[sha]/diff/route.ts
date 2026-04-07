import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { repositories, commits } from '@/db';
import { getDb } from '@/db';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, COMMIT_SHA_REGEX } from '@/lib/constants';
import { applyPrivateNoStoreHeaders, enforceRateLimit, resolveSession } from '@/lib/api-security';
import { ensureRepoAccess } from '@/services/resource-access';
import { fetchCommitFileDiffs } from '@/services/github';
import { isSafeFilePath } from '@/lib/sanitize';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; sha: string }> }
) {
    const requestLogger = logger.child({ endpoint: 'GET /api/repos/[id]/commits/[sha]/diff' });
    const db = getDb();

    try {
        const session = await resolveSession(request);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:repos:commit-diff:get',
            limit: RATE_LIMITS.GENERAL_API,
            sessionId: session.sessionId,
        });
        if (rateLimitError) {
            return rateLimitError.response;
        }

        const { id, sha } = await params;
        const repoId = id;

        if (!COMMIT_SHA_REGEX.test(sha)) {
            return NextResponse.json({ error: 'Invalid commit SHA' }, { status: 400 });
        }

        const filePathParam = request.nextUrl.searchParams.get('path');
        const filePath = filePathParam?.trim() || null;
        if (filePath && !isSafeFilePath(filePath)) {
            return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
        }

        await ensureRepoAccess(repoId, session.sessionId, requestLogger);

        const [repo, commit] = await Promise.all([
            db.select().from(repositories).where(eq(repositories.id, repoId)).limit(1),
            db.select().from(commits).where(and(eq(commits.repoId, repoId), eq(commits.sha, sha))).limit(1),
        ]);
        if (repo.length === 0) {
            return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
        }
        if (commit.length === 0) {
            return NextResponse.json({ error: 'Commit not found' }, { status: 404 });
        }

        const allChangedFiles = await fetchCommitFileDiffs(repo[0].owner, repo[0].name, sha);
        const filteredFiles = filePath
            ? allChangedFiles.filter(file => file.path === filePath || file.previousPath === filePath)
            : allChangedFiles;
        const totalAdditions = filteredFiles.reduce((sum, file) => sum + file.additions, 0);
        const totalDeletions = filteredFiles.reduce((sum, file) => sum + file.deletions, 0);

        return applyPrivateNoStoreHeaders(
            NextResponse.json({
                commit: commit[0],
                files: filteredFiles,
                stats: {
                    changedFiles: filteredFiles.length,
                    additions: totalAdditions,
                    deletions: totalDeletions,
                },
            })
        );
    } catch (error) {
        requestLogger.error({ error }, 'Failed to fetch commit diff');
        return NextResponse.json(
            { error: 'Failed to fetch commit diff' },
            { status: 500 }
        );
    }
}
