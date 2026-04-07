import { NextRequest, NextResponse } from 'next/server';
import { explainDaySummarySchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, AI_CONSTANTS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import { applyPrivateNoStoreHeaders, guardRoute, getClientIdFromHeaders } from '@/lib/api-security';
import { ensureRepoAccess } from '@/services/resource-access';
import { resolveProviderConfigFromRequest } from '../utils';

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'POST /api/explain/day-summary' });
    const startTime = Date.now();

    try {
        const guard = await guardRoute(request, {
            rateLimit: { keyPrefix: 'api:explain:day-summary', limit: RATE_LIMITS.EXPLAIN_API },
            analytics: { endpoint: '/api/explain/day-summary' },
        });
        if (!guard.ok) return guard.response;
        const { session, clientId } = guard;

        const rawBody = await request.json().catch(() => null);
        const parseResult = explainDaySummarySchema.safeParse(rawBody);

        if (!parseResult.success) {
            return NextResponse.json({ error: 'Validation failed', details: parseResult.error.issues }, { status: 400 });
        }

        const { repoId, commits: dayCommits, projectName, projectOwner, provider } = parseResult.data;

        await ensureRepoAccess(repoId, session.sessionId, requestLogger);

        const providerConfig = await resolveProviderConfigFromRequest(request, provider, session.sessionId);

        const { streamText } = await import('ai');
        const { createAIProviderAsync } = await import('@/services/ai-providers');

        const aiModel = await createAIProviderAsync(providerConfig);

        const commitsList = dayCommits
            .map(
                (c: { sha: string; message: string; authorName: string | null; date: string }) =>
                    `• ${c.sha?.substring(0, 7) || 'unknown'}: ${c.message?.split('\n')[0] || 'No message'} (by ${c.authorName || 'Unknown'})`
            )
            .join('\n');

        const systemPrompt = `You are an expert code reviewer helping developers understand commit activity.
Your job is to summarize what happened in a repository on a specific day.
Be concise but insightful. Focus on the narrative - what was the developer trying to accomplish?`;

        const userPrompt = `Summarize the following commits from ${projectOwner || 'a repository'}/${projectName || 'repo'}:

${commitsList}

Provide a brief, engaging summary of what was accomplished. Use markdown formatting.`;

        const streamResult = streamText({
            model: aiModel,
            system: systemPrompt,
            prompt: userPrompt,
            maxOutputTokens: AI_CONSTANTS.MAX_OUTPUT_TOKENS.DAY_SUMMARY,
        });

        const response = streamResult.toTextStreamResponse();

        const duration = Date.now() - startTime;
        await analytics.trackAIUsage({ provider: providerConfig.type, model: providerConfig.model, type: 'day-summary', success: true, duration });
        await analytics.trackRequest({ endpoint: '/api/explain/day-summary', method: 'POST', statusCode: 200, duration, clientId });

        return applyPrivateNoStoreHeaders(response);
    } catch (error) {
        const duration = Date.now() - startTime;
        const clientId = getClientIdFromHeaders(request);
        await analytics.trackRequest({ endpoint: '/api/explain/day-summary', method: 'POST', statusCode: 500, duration, clientId });
        requestLogger.error({ error }, 'Error generating explanation');
        return NextResponse.json({ error: 'Failed to generate summary' }, { status: 500 });
    }
}
