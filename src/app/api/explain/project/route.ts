import { NextRequest, NextResponse } from 'next/server';
import { repositories, commits } from '@/db';
import { eq, sql } from 'drizzle-orm';
import { explainProject } from '@/services/explain';
import { explainProjectSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import { getDb } from '@/db';
import { applyPrivateNoStoreHeaders, guardRoute, getClientIdFromHeaders } from '@/lib/api-security';
import { ensureRepoAccess } from '@/services/resource-access';
import { resolveProviderConfigFromRequest } from '../utils';

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'POST /api/explain/project' });
    const startTime = Date.now();

    try {
        const guard = await guardRoute(request, {
            rateLimit: { keyPrefix: 'api:explain:project', limit: RATE_LIMITS.EXPLAIN_API },
            analytics: { endpoint: '/api/explain/project' },
        });
        if (!guard.ok) return guard.response;
        const { session, clientId } = guard;

        const db = getDb();
        const rawBody = await request.json().catch(() => null);
        const parseResult = explainProjectSchema.safeParse(rawBody);

        if (!parseResult.success) {
            return NextResponse.json({ error: 'Validation failed', details: parseResult.error.issues }, { status: 400 });
        }

        const { repoId, provider } = parseResult.data;

        await ensureRepoAccess(repoId, session.sessionId, requestLogger);

        const providerConfig = await resolveProviderConfigFromRequest(request, provider, session.sessionId);

        const repo = await db.select().from(repositories).where(eq(repositories.id, repoId)).limit(1);
        if (repo.length === 0) return NextResponse.json({ error: 'Repository not found' }, { status: 404 });

        const commitCountResult = await db.select({ count: sql<number>`count(*)` }).from(commits).where(eq(commits.repoId, repoId));
        const totalCommits = Number(commitCountResult[0]?.count || 0);

        const projectContext = {
            name: repo[0].name,
            description: repo[0].description,
            readme: repo[0].readme,
            totalCommits,
            currentCommitIndex: 0,
        };

        const response = await explainProject(projectContext, providerConfig);

        const duration = Date.now() - startTime;
        await analytics.trackAIUsage({ provider: providerConfig.type, model: providerConfig.model, type: 'project', success: true, duration });
        await analytics.trackRequest({ endpoint: '/api/explain/project', method: 'POST', statusCode: 200, duration, clientId });

        return applyPrivateNoStoreHeaders(response);
    } catch (error) {
        const duration = Date.now() - startTime;
        const clientId = getClientIdFromHeaders(request);
        await analytics.trackRequest({ endpoint: '/api/explain/project', method: 'POST', statusCode: 500, duration, clientId });
        requestLogger.error({ error }, 'Error generating explanation');
        return NextResponse.json({ error: 'Failed to generate explanation' }, { status: 500 });
    }
}
