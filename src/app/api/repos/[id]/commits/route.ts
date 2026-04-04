import { NextRequest, NextResponse } from 'next/server';
import { repositories, commits } from '@/db';
import { eq, asc, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { PAGINATION, RATE_LIMITS } from '@/lib/constants';
import { getDb } from '@/db';
import { applyPrivateNoStoreHeaders, enforceRateLimit, resolveSession } from '@/lib/api-security';
import { hasRepoAccess } from '@/services/resource-access';

/**
 * GET /api/repos/:id/commits - List commits for a repository
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const requestLogger = logger.child({ endpoint: 'GET /api/repos/[id]/commits' });
    const db = getDb();

    try {
        const session = await resolveSession(request);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:repos:commits:get',
            limit: RATE_LIMITS.GENERAL_API,
            sessionId: session.sessionId,
        });
        if (rateLimitError) {
            return rateLimitError.response;
        }

        const { id } = await params;
        const repoId = id;

        // Parse pagination params from query string
        const url = new URL(request.url);
        const requestedPage = Number.parseInt(url.searchParams.get('page') || '', 10);
        const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '', 10);

        const page = Number.isFinite(requestedPage) && requestedPage > 0
            ? requestedPage
            : PAGINATION.DEFAULT_PAGE;
        const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(PAGINATION.MAX_LIMIT, requestedLimit)
            : PAGINATION.DEFAULT_LIMIT;
        const offset = (page - 1) * limit;

        // Check if repo exists and get repo data
        const repo = await db.select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            requestLogger.warn({ repoId }, 'Repository not found');
            return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
        }

        // Access control: check KV-based access grant, but allow access if repo exists in DB
        // This supports both multi-tenant (with KV) and single-user (DB-only) deployments
        try {
            const repoAccess = await hasRepoAccess(repoId, session.sessionId);
            if (!repoAccess) {
                // No access grant - try to create one, but don't block access
                const { safeGrantRepoAccess } = await import('@/services/resource-access');
                await safeGrantRepoAccess(repoId, session.sessionId);
                requestLogger.info({ repoId, sessionId: session.sessionId }, 'Auto-granted repository access');
            }
        } catch {
            // Access control system unavailable - allow access to existing repos
            requestLogger.debug({ repoId, sessionId: session.sessionId }, 'Access control unavailable, allowing access to existing repo');
        }

        // Run count and data fetch in parallel
        const [totalResult, repoCommits] = await Promise.all([
            db.select({ count: sql<number>`count(*)` }).from(commits).where(eq(commits.repoId, repoId)),
            db.select().from(commits).where(eq(commits.repoId, repoId)).orderBy(asc(commits.order)).limit(limit).offset(offset),
        ]);
        const total = Number(totalResult[0]?.count || 0);

        requestLogger.info({ repoId, page, limit, total }, 'Commits fetched successfully');

        const now = new Date().toISOString();
        return applyPrivateNoStoreHeaders(
            NextResponse.json({
                repository: repo[0],
                commits: repoCommits,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                    hasNext: offset + limit < total,
                    hasPrev: page > 1,
                },
                cache: {
                    stale: false,
                    lastFetched: now,
                },
            })
        );
    } catch (error) {
        requestLogger.error(
            { error, errorMessage: error instanceof Error ? error.message : 'Unknown error' },
            'Error fetching commits'
        );
        return NextResponse.json({ error: 'Failed to fetch commits' }, { status: 500 });
    }
}
