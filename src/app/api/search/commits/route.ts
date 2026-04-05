import { NextRequest, NextResponse } from 'next/server';
import { commits } from '@/db';
import { eq } from 'drizzle-orm';
import { generateText } from 'ai';
import { createAIProviderAsync } from '@/services/ai-providers';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import { getDb } from '@/db';
import { applyPrivateNoStoreHeaders, guardRoute, getClientIdFromHeaders } from '@/lib/api-security';
import { ensureRepoAccess } from '@/services/resource-access';
import { resolveProviderConfigFromRequest } from '../../explain/utils';
import { z } from 'zod';
import { clientProviderSchema } from '@/lib/validation';

const searchCommitsSchema = z.object({
    repoId: z.string().min(1),
    query: z.string().min(1).max(500),
    provider: clientProviderSchema,
});

const MAX_COMMITS = 300;

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'POST /api/search/commits' });
    const startTime = Date.now();

    try {
        const guard = await guardRoute(request, {
            rateLimit: { keyPrefix: 'api:search:commits', limit: RATE_LIMITS.EXPLAIN_API },
            analytics: { endpoint: '/api/search/commits' },
        });
        if (!guard.ok) return guard.response;
        const { session, clientId } = guard;

        const rawBody = await request.json().catch(() => null);
        const parseResult = searchCommitsSchema.safeParse(rawBody);
        if (!parseResult.success) {
            return NextResponse.json({ error: 'Validation failed', details: parseResult.error.issues }, { status: 400 });
        }

        const { repoId, query, provider } = parseResult.data;

        await ensureRepoAccess(repoId, session.sessionId, requestLogger);

        const providerConfig = await resolveProviderConfigFromRequest(request, provider, session.sessionId);

        const db = getDb();
        const allCommits = await db
            .select({ sha: commits.sha, message: commits.message, authorName: commits.authorName })
            .from(commits)
            .where(eq(commits.repoId, repoId))
            .limit(MAX_COMMITS);

        if (allCommits.length === 0) {
            return applyPrivateNoStoreHeaders(NextResponse.json({ shas: [] }));
        }

        const commitList = allCommits
            .map((c, i) => `${i + 1}. [${c.sha.slice(0, 7)}] ${c.message.split('\n')[0].slice(0, 120)}${c.authorName ? ` (${c.authorName})` : ''}`)
            .join('\n');

        const aiModel = await createAIProviderAsync(providerConfig);

        const { text } = await generateText({
            model: aiModel,
            system: `You are a commit search engine. When given a list of git commits and a search query, you identify which commits semantically match what the user is looking for — even if they use different words.

Return ONLY a raw JSON array of 7-character SHA strings for the matching commits, ordered by relevance (best match first). No explanation, no markdown, no extra text. Just the JSON array.

Example output: ["abc1234","def5678"]
If nothing matches, return: []`,
            prompt: `Search query: "${query.replace(/"/g, '\\"')}"\n\nCommits:\n${commitList}`,
            maxOutputTokens: 500,
        });

        let shas: string[] = [];
        try {
            const match = text.match(/\[[\s\S]*?\]/);
            if (match) {
                const parsed = JSON.parse(match[0]);
                if (Array.isArray(parsed)) {
                    shas = parsed.filter((s): s is string => typeof s === 'string' && /^[0-9a-f]{7,}$/i.test(s));
                }
            }
        } catch (err) {
            requestLogger.warn({ text, err }, 'Failed to parse AI response as JSON');
        }

        const duration = Date.now() - startTime;
        await analytics.trackAIUsage({ provider: providerConfig.type, model: providerConfig.model, type: 'question', success: true, duration });
        await analytics.trackRequest({ endpoint: '/api/search/commits', method: 'POST', statusCode: 200, duration, clientId });

        return applyPrivateNoStoreHeaders(NextResponse.json({ shas }));
    } catch (error) {
        const duration = Date.now() - startTime;
        const clientId = getClientIdFromHeaders(request);
        await analytics.trackRequest({ endpoint: '/api/search/commits', method: 'POST', statusCode: 500, duration, clientId });
        requestLogger.error({ error }, 'Error searching commits');
        return NextResponse.json({ error: 'Failed to search commits' }, { status: 500 });
    }
}
