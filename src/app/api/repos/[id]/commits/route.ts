import { NextRequest, NextResponse } from 'next/server';
import { repositories, commits } from '@/db';
import { eq, asc, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { PAGINATION } from '@/lib/constants';
import { getDb } from '@/db';

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
        const { id } = await params;
        const repoId = parseInt(id, 10);

        if (isNaN(repoId)) {
            requestLogger.warn({ id }, 'Invalid repository ID');
            return NextResponse.json({ error: 'Invalid repository ID' }, { status: 400 });
        }

        // Parse pagination params from query string
        const url = new URL(request.url);
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const limit = Math.min(
            PAGINATION.MAX_LIMIT,
            Math.max(1, parseInt(url.searchParams.get('limit') || String(PAGINATION.DEFAULT_LIMIT), 10))
        );
        const offset = (page - 1) * limit;

        // Check if repo exists
        const repo = await (db.select() as any)
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            requestLogger.warn({ repoId }, 'Repository not found');
            return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
        }

        // Get total count
        const totalResult = await (db.select({ count: sql<number>`count(*)` }) as any)
            .from(commits)
            .where(eq(commits.repoId, repoId));
        const total = Number(totalResult[0]?.count || 0);

        // Fetch commits with pagination ordered by their position (oldest first)
        const repoCommits = await (db.select() as any)
            .from(commits)
            .where(eq(commits.repoId, repoId))
            .orderBy(asc(commits.order))
            .limit(limit)
            .offset(offset);

        requestLogger.info({ repoId, page, limit, total }, 'Commits fetched successfully');

        return NextResponse.json({
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
        });
    } catch (error) {
        requestLogger.error(
            { error, errorMessage: error instanceof Error ? error.message : 'Unknown error' },
            'Error fetching commits'
        );
        return NextResponse.json({ error: 'Failed to fetch commits' }, { status: 500 });
    }
}
