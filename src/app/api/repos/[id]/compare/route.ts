import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { repositories, commits } from '@/db';
import { getDb } from '@/db';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, COMMIT_SHA_REGEX } from '@/lib/constants';
import { applyPrivateNoStoreHeaders, enforceRateLimit, resolveSession } from '@/lib/api-security';
import { ensureRepoAccess } from '@/services/resource-access';
import { fetchCompareDiff } from '@/services/github';
import { isSafeFilePath } from '@/lib/sanitize';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const requestLogger = logger.child({ endpoint: 'GET /api/repos/[id]/compare' });
    const db = getDb();

    try {
        const session = await resolveSession(request);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:repos:compare:get',
            limit: RATE_LIMITS.GENERAL_API,
            sessionId: session.sessionId,
        });
        if (rateLimitError) {
            return rateLimitError.response;
        }

        const { id } = await params;
        const repoId = id;

        await ensureRepoAccess(repoId, session.sessionId, requestLogger);

        const baseSha = request.nextUrl.searchParams.get('base')?.trim() || '';
        const headSha = request.nextUrl.searchParams.get('head')?.trim() || '';
        const filePathParam = request.nextUrl.searchParams.get('path');
        const filePath = filePathParam?.trim() || null;

        if (!baseSha || !headSha) {
            return NextResponse.json({ error: 'Both base and head commits are required' }, { status: 400 });
        }

        if (!COMMIT_SHA_REGEX.test(baseSha) || !COMMIT_SHA_REGEX.test(headSha)) {
            return NextResponse.json({ error: 'Invalid base/head commit SHA' }, { status: 400 });
        }

        if (filePath && !isSafeFilePath(filePath)) {
            return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
        }

        const repo = await db.select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);
        if (repo.length === 0) {
            return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
        }

        const uniqueShas = Array.from(new Set([baseSha, headSha]));
        const selectedCommits = await db.select({ sha: commits.sha })
            .from(commits)
            .where(and(eq(commits.repoId, repoId), inArray(commits.sha, uniqueShas)));

        if (baseSha === headSha) {
            if (selectedCommits.length === 0) {
                return NextResponse.json({ error: 'Commit must belong to this repository' }, { status: 400 });
            }

            return applyPrivateNoStoreHeaders(
                NextResponse.json({
                    baseSha,
                    headSha,
                    status: 'identical',
                    aheadBy: 0,
                    behindBy: 0,
                    totalCommits: 0,
                    files: [],
                    selectedPath: filePath,
                })
            );
        }

        if (selectedCommits.length < 2) {
            return NextResponse.json({ error: 'Base/head commits must belong to this repository' }, { status: 400 });
        }

        const compare = await fetchCompareDiff(repo[0].owner, repo[0].name, baseSha, headSha);
        const filteredFiles = filePath
            ? compare.files.filter(
                file => file.path === filePath || file.previousPath === filePath
            )
            : compare.files;

        return applyPrivateNoStoreHeaders(
            NextResponse.json({
                baseSha,
                headSha,
                status: compare.status,
                aheadBy: compare.aheadBy,
                behindBy: compare.behindBy,
                totalCommits: compare.totalCommits,
                files: filteredFiles,
                totalFiles: compare.files.length,
                selectedPath: filePath,
            })
        );
    } catch (error) {
        requestLogger.error({ error }, 'Failed to compare commits');
        return NextResponse.json(
            { error: 'Failed to compare commits' },
            { status: 500 }
        );
    }
}
