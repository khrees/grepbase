import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { repositories } from '@/db';
import { getDb } from '@/db';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/constants';
import { applyPrivateNoStoreHeaders, enforceRateLimit, resolveSession } from '@/lib/api-security';
import { ensureRepoAccess } from '@/services/resource-access';

export async function GET(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'GET /api/repos/lookup' });
    const db = getDb();

    try {
        const session = await resolveSession(request, { createIfMissing: true });
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:repos:lookup:get',
            limit: RATE_LIMITS.GENERAL_API,
            sessionId: session.sessionId,
        });
        if (rateLimitError) {
            return rateLimitError.response;
        }

        const url = new URL(request.url);
        const owner = url.searchParams.get('owner')?.trim();
        const repoName = url.searchParams.get('repo')?.trim();

        if (!owner || !repoName) {
            return NextResponse.json({ error: 'Missing owner or repo parameter' }, { status: 400 });
        }

        // Query repository in DB
        const repo = await db.select()
            .from(repositories)
            .where(and(
                eq(repositories.owner, owner),
                eq(repositories.name, repoName)
            ))
            .limit(1);

        if (repo.length === 0) {
            return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
        }

        const repository = repo[0];

        // Ensure session has access to this repository
        await ensureRepoAccess(repository.id, session.sessionId, requestLogger);

        return applyPrivateNoStoreHeaders(
            NextResponse.json({ repository })
        );
    } catch (error) {
        requestLogger.error({ error }, 'Failed to look up repository');
        return NextResponse.json({ error: 'Failed to look up repository' }, { status: 500 });
    }
}
