import { NextRequest, NextResponse } from 'next/server';
import { repositories, commits } from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import { answerQuestion } from '@/services/explain';
import type { AIProviderConfig } from '@/services/ai-providers';
import { explainRequestSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { rateLimiter } from '@/lib/rate-limit';
import { RATE_LIMITS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import { getDb } from '@/db';
import { getClientIdFromHeaders, resolveAvailableFilePathsForCommit } from '../utils';

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'POST /api/explain/question' });
    const startTime = Date.now();

    try {
        const clientId = getClientIdFromHeaders(request);
        const rateLimitResult = await rateLimiter.checkLimit(clientId, RATE_LIMITS.EXPLAIN_API, 60);

        if (!rateLimitResult.success) {
            requestLogger.warn({ clientId }, 'Rate limit exceeded');
            await analytics.trackRateLimit({ endpoint: '/api/explain/question', clientId, blocked: true });
            return NextResponse.json(
                { error: 'Rate limit exceeded', limit: rateLimitResult.limit, reset: rateLimitResult.reset },
                { status: 429, headers: { 'X-RateLimit-Limit': rateLimitResult.limit.toString(), 'X-RateLimit-Remaining': rateLimitResult.remaining.toString(), 'X-RateLimit-Reset': rateLimitResult.reset.toString() } }
            );
        }

        await analytics.trackRateLimit({ endpoint: '/api/explain/question', clientId, blocked: false });

        const db = getDb();
        const rawBody = await request.json().catch(() => null);
        const parseResult = explainRequestSchema.safeParse(rawBody);

        if (!parseResult.success) {
            return NextResponse.json({ error: 'Validation failed', details: parseResult.error.issues }, { status: 400 });
        }

        const { repoId, commitSha, question, provider, providerType, apiKey, model, baseUrl, visibleFiles } = parseResult.data;

        if (parseResult.data.type !== 'question' || !question) {
            return NextResponse.json({ error: 'Invalid request wrapper for question' }, { status: 400 });
        }

        const providerConfig: AIProviderConfig = {
            type: provider?.type ?? providerType!,
            apiKey: provider?.apiKey || apiKey,
            baseUrl: provider?.baseUrl || baseUrl,
            model: provider?.model || model,
        };

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

        return response;
    } catch (error) {
        const duration = Date.now() - startTime;
        const clientId = getClientIdFromHeaders(request);
        await analytics.trackRequest({ endpoint: '/api/explain/question', method: 'POST', statusCode: 500, duration, clientId });
        requestLogger.error({ error }, 'Error generating explanation');
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}
