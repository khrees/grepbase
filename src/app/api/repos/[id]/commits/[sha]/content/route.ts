import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { repositories, commits, files } from '@/db';
import { getDb } from '@/db';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/constants';
import { applyPrivateNoStoreHeaders, enforceRateLimit, resolveSession } from '@/lib/api-security';
import { hasRepoAccess } from '@/services/resource-access';
import { fetchFileContent, getLanguageFromPath } from '@/services/github';

const COMMIT_SHA_REGEX = /^[0-9a-f]{7,64}$/i;
const MAX_FILE_PATH_LENGTH = 1024;

function isSafeFilePath(path: string): boolean {
    if (path.length === 0 || path.length > MAX_FILE_PATH_LENGTH) return false;
    if (path.includes('\0') || path.startsWith('/')) return false;
    if (path.includes('?') || path.includes('#') || path.includes('\\')) return false;
    return !path.split('/').some(segment => segment === '.' || segment === '..');
}

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
        const repoId = Number.parseInt(id, 10);
        const filePath = request.nextUrl.searchParams.get('path')?.trim() || '';

        if (Number.isNaN(repoId)) {
            return NextResponse.json({ error: 'Invalid repository ID' }, { status: 400 });
        }

        if (!COMMIT_SHA_REGEX.test(sha)) {
            return NextResponse.json({ error: 'Invalid commit SHA' }, { status: 400 });
        }

        if (!isSafeFilePath(filePath)) {
            return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
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
        requestLogger.error({ error }, 'Failed to fetch file content');
        return NextResponse.json(
            { error: 'Failed to fetch file content' },
            { status: 500 }
        );
    }
}
