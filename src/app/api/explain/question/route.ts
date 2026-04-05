import { NextRequest, NextResponse } from 'next/server';
import { repositories, commits } from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import { answerQuestion } from '@/services/explain';
import { explainQuestionSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import { getDb } from '@/db';
import { applyPrivateNoStoreHeaders, guardRoute, getClientIdFromHeaders } from '@/lib/api-security';
import { ensureRepoAccess } from '@/services/resource-access';
import { resolveAvailableFilePathsForCommit, resolveProviderConfigFromRequest } from '../utils';

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'POST /api/explain/question' });
    const startTime = Date.now();

    try {
        const guard = await guardRoute(request, {
            rateLimit: { keyPrefix: 'api:explain:question', limit: RATE_LIMITS.EXPLAIN_API },
            analytics: { endpoint: '/api/explain/question' },
        });
        if (!guard.ok) return guard.response;
        const { session, clientId } = guard;

        const db = getDb();
        const rawBody = await request.json().catch(() => null);
        const parseResult = explainQuestionSchema.safeParse(rawBody);

        if (!parseResult.success) {
            return NextResponse.json({ error: 'Validation failed', details: parseResult.error.issues }, { status: 400 });
        }

        const { repoId, commitSha, question, provider, visibleFiles } = parseResult.data;

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

        let commitContext;
        if (commitSha) {
            const commit = await db.select().from(commits).where(and(eq(commits.repoId, repoId), eq(commits.sha, commitSha))).limit(1);
            if (commit.length > 0) {
                commitContext = {
                    sha: commit[0].sha,
                    message: commit[0].message,
                    authorName: commit[0].authorName,
                    date: commit[0].date,
                    diff: null,
                    filesChanged: [],
                    availableFiles: await resolveAvailableFilePathsForCommit(db, commit[0].id, visibleFiles),
                };
                projectContext.currentCommitIndex = commit[0].order;
            }
        }

        const response = await answerQuestion(question, { commit: commitContext, project: projectContext }, providerConfig);

        const duration = Date.now() - startTime;
        await analytics.trackAIUsage({ provider: providerConfig.type, model: providerConfig.model, type: 'question', success: true, duration });
        await analytics.trackRequest({ endpoint: '/api/explain/question', method: 'POST', statusCode: 200, duration, clientId });

        return applyPrivateNoStoreHeaders(response);
    } catch (error) {
        const duration = Date.now() - startTime;
        const clientId = getClientIdFromHeaders(request);
        await analytics.trackRequest({ endpoint: '/api/explain/question', method: 'POST', statusCode: 500, duration, clientId });
        requestLogger.error({ error }, 'Error generating explanation');
        return NextResponse.json({ error: 'Failed to generate answer' }, { status: 500 });
    }
}
