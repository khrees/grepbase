import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { repositories, commits, files } from '@/db';
import { getDb } from '@/db';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, COMMIT_SHA_REGEX } from '@/lib/constants';
import { applyPrivateNoStoreHeaders, enforceRateLimit, resolveSession } from '@/lib/api-security';
import { ensureRepoAccess } from '@/services/resource-access';
import { fetchFileContent, getLanguageFromPath } from '@/services/github';
import { isSafeFilePath } from '@/lib/sanitize';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; sha: string }> }
) {
    const requestLogger = logger.child({ endpoint: 'GET /api/repos/[id]/commits/[sha]/content' });
    const db = getDb();

    try {
        const session = await resolveSession(request);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:repos:file-content:get',
            limit: RATE_LIMITS.GENERAL_API,
            sessionId: session.sessionId,
        });
        if (rateLimitError) {
            return rateLimitError.response;
        }

        const { id, sha } = await params;
        const repoId = id;
        const filePath = request.nextUrl.searchParams.get('path')?.trim() || '';

        if (!COMMIT_SHA_REGEX.test(sha)) {
            return NextResponse.json({ error: 'Invalid commit SHA' }, { status: 400 });
        }

        if (!isSafeFilePath(filePath)) {
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

        const cachedFile = await db.select()
            .from(files)
            .where(and(eq(files.commitId, commit[0].id), eq(files.path, filePath)))
            .limit(1);

        if (cachedFile.length > 0 && cachedFile[0].content) {
            return applyPrivateNoStoreHeaders(
                NextResponse.json({
                    path: cachedFile[0].path,
                    content: cachedFile[0].content,
                    language: cachedFile[0].language,
                    cached: true,
                })
            );
        }

        const content = await fetchFileContent(repo[0].owner, repo[0].name, sha, filePath);
        if (content === null) {
            return NextResponse.json({ error: 'Failed to fetch file content' }, { status: 404 });
        }

        if (cachedFile.length > 0) {
            await db.update(files)
                .set({ content })
                .where(eq(files.id, cachedFile[0].id));
        }

        return applyPrivateNoStoreHeaders(
            NextResponse.json({
                path: filePath,
                content,
                language: cachedFile[0]?.language || getLanguageFromPath(filePath),
                cached: false,
            })
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('rate limit exceeded')) {
            requestLogger.warn({ error: { message: errorMessage } }, 'GitHub rate limit hit fetching file content');
            return NextResponse.json({ error: errorMessage }, { status: 429 });
        }
        requestLogger.error({ error }, 'Failed to fetch file content');
        return NextResponse.json(
            { error: 'Failed to fetch file content' },
            { status: 500 }
        );
    }
}
