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
        const branch = url.searchParams.get('branch')?.trim();

        if (!owner || !repoName) {
            return NextResponse.json({ error: 'Missing owner or repo parameter' }, { status: 400 });
        }

        // Query repository in DB
        // Non-default branches are stored with URL format: https://github.com/owner/repo@branch
        // When a branch is specified, look up by exact URL to find the correct entry
        let repo;
        if (branch) {
            const branchUrl = `https://github.com/${owner}/${repoName}@${branch}`;
            repo = await db.select()
                .from(repositories)
                .where(eq(repositories.url, branchUrl))
                .limit(1);
        }

        // Fall back to owner+name lookup (for default branch or if branch URL not found)
        if (!repo || repo.length === 0) {
            const baseUrl = `https://github.com/${owner}/${repoName}`;
            repo = await db.select()
                .from(repositories)
                .where(and(
                    eq(repositories.owner, owner),
                    eq(repositories.name, repoName),
                    eq(repositories.url, baseUrl)
                ))
                .limit(1);
        }

        // Final fallback: just owner+name (legacy entries)
        if (repo.length === 0) {
            repo = await db.select()
                .from(repositories)
                .where(and(
                    eq(repositories.owner, owner),
                    eq(repositories.name, repoName)
                ))
                .limit(1);
        }

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
