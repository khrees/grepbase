import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { repositories, commits } from '@/db';
import { getDb } from '@/db';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, COMMIT_SHA_REGEX } from '@/lib/constants';
import { applyPrivateNoStoreHeaders, enforceRateLimit, resolveSession } from '@/lib/api-security';
import { hasRepoAccess } from '@/services/resource-access';
import { fetchCommitFileDiffs } from '@/services/github';

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

        try {
            const repoAccess = await hasRepoAccess(repoId, session.sessionId);
            if (!repoAccess) {
                const { safeGrantRepoAccess } = await import('@/services/resource-access');
                await safeGrantRepoAccess(repoId, session.sessionId);
                requestLogger.info({ repoId, sessionId: session.sessionId }, 'Auto-granted repository access');
            }
        } catch {
            requestLogger.debug({ repoId, sessionId: session.sessionId }, 'Access control unavailable, allowing access to existing repo');
        }

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

        const changedFiles = await fetchCommitFileDiffs(repo[0].owner, repo[0].name, sha);
        const totalAdditions = changedFiles.reduce((sum, file) => sum + file.additions, 0);
        const totalDeletions = changedFiles.reduce((sum, file) => sum + file.deletions, 0);

        return applyPrivateNoStoreHeaders(
            NextResponse.json({
                commit: commit[0],
                files: changedFiles,
                stats: {
                    changedFiles: changedFiles.length,
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
