import { NextRequest, NextResponse } from 'next/server';
import { repositories, commits } from '@/db';
import { asc, eq } from 'drizzle-orm';
import { explainStory } from '@/services/explain';
import { explainStorySchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import { getDb } from '@/db';
import { applyPrivateNoStoreHeaders, guardRoute, getClientIdFromHeaders } from '@/lib/api-security';
import { ensureRepoAccess } from '@/services/resource-access';
import { resolveProviderConfigFromRequest } from '../utils';

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'POST /api/explain/story' });
    const startTime = Date.now();

    try {
        const guard = await guardRoute(request, {
            rateLimit: { keyPrefix: 'api:explain:story', limit: RATE_LIMITS.EXPLAIN_API },
            analytics: { endpoint: '/api/explain/story' },
        });
        if (!guard.ok) return guard.response;
        const { session, clientId } = guard;

        const db = getDb();
        const rawBody = await request.json().catch(() => null);
        const parseResult = explainStorySchema.safeParse(rawBody);

        if (!parseResult.success) {
            return NextResponse.json({ error: 'Validation failed', details: parseResult.error.issues }, { status: 400 });
        }

        const { repoId, startSha, endSha, chapterSize, provider } = parseResult.data;

        const repo = await db.select().from(repositories).where(eq(repositories.id, repoId)).limit(1);
        if (repo.length === 0) return NextResponse.json({ error: 'Repository not found' }, { status: 404 });

        await ensureRepoAccess(repoId, session.sessionId, requestLogger);

        const providerConfig = await resolveProviderConfigFromRequest(request, provider, session.sessionId);

        const repoCommits = await db.select().from(commits).where(eq(commits.repoId, repoId)).orderBy(asc(commits.order));
        if (repoCommits.length === 0) return NextResponse.json({ error: 'No commits found' }, { status: 404 });

        let startIndex = startSha
            ? repoCommits.findIndex(commit => commit.sha === startSha)
            : Math.max(0, repoCommits.length - 30);
        let endIndex = endSha
            ? repoCommits.findIndex(commit => commit.sha === endSha)
            : repoCommits.length - 1;

        if (startSha && startIndex < 0) return NextResponse.json({ error: 'startSha not found in repository commits' }, { status: 400 });
        if (endSha && endIndex < 0) return NextResponse.json({ error: 'endSha not found in repository commits' }, { status: 400 });
        if (startIndex > endIndex) [startIndex, endIndex] = [endIndex, startIndex];

        const MAX_STORY_COMMITS = 120;
        let selectedCommits = repoCommits.slice(startIndex, endIndex + 1);
        if (selectedCommits.length > MAX_STORY_COMMITS) {
            selectedCommits = selectedCommits.slice(selectedCommits.length - MAX_STORY_COMMITS);
        }

        const projectContext = {
            name: repo[0].name,
            description: repo[0].description,
            readme: repo[0].readme,
            totalCommits: repoCommits.length,
            currentCommitIndex: endIndex,
        };

        const response = await explainStory(
            selectedCommits.map(commit => ({
                sha: commit.sha,
                message: commit.message,
                authorName: commit.authorName,
                date: commit.date,
            })),
            projectContext,
            providerConfig,
            chapterSize || 5
        );

        const duration = Date.now() - startTime;
        await analytics.trackAIUsage({ provider: providerConfig.type, model: providerConfig.model, type: 'story', success: true, duration });
        await analytics.trackRequest({ endpoint: '/api/explain/story', method: 'POST', statusCode: 200, duration, clientId });

        return applyPrivateNoStoreHeaders(response);
    } catch (error) {
        const duration = Date.now() - startTime;
        const clientId = getClientIdFromHeaders(request);
        await analytics.trackRequest({ endpoint: '/api/explain/story', method: 'POST', statusCode: 500, duration, clientId });
        requestLogger.error({ error }, 'Error generating story');
        return NextResponse.json({ error: 'Failed to generate story' }, { status: 500 });
    }
}
