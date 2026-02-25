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
        const repoId = parseInt(id, 10);

        if (isNaN(repoId)) {
            requestLogger.warn({ id }, 'Invalid repository ID');
            return NextResponse.json({ error: 'Invalid repository ID' }, { status: 400 });
        }

        const repoAccess = await hasRepoAccess(repoId, session.sessionId);
        if (!repoAccess) {
            requestLogger.warn({ repoId, sessionId: session.sessionId }, 'Forbidden repository access');
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

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

        // Check if repo exists
        const repo = await db.select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            requestLogger.warn({ repoId }, 'Repository not found');
            return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
        }

        // Get total count
        const totalResult = await db.select({ count: sql<number>`count(*)` })
            .from(commits)
            .where(eq(commits.repoId, repoId));
        const total = Number(totalResult[0]?.count || 0);

        // Fetch commits with pagination ordered by their position (oldest first)
        const repoCommits = await db.select()
            .from(commits)
            .where(eq(commits.repoId, repoId))
            .orderBy(asc(commits.order))
            .limit(limit)
            .offset(offset);

        requestLogger.info({ repoId, page, limit, total }, 'Commits fetched successfully');

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
