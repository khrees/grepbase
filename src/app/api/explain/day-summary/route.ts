import { NextRequest, NextResponse } from 'next/server';
import { explainRequestSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, AI_CONSTANTS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import {
    applyPrivateNoStoreHeaders,
    enforceCsrfProtection,
    enforceRateLimit,
    resolveSession,
} from '@/lib/api-security';
import { hasRepoAccess } from '@/services/resource-access';
import { getClientIdFromHeaders, resolveProviderConfigFromRequest } from '../utils';

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'POST /api/explain/day-summary' });
    const startTime = Date.now();

    try {
        const csrfError = enforceCsrfProtection(request);
        if (csrfError) {
            return csrfError;
        }

        const session = await resolveSession(request);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:explain:day-summary',
            limit: RATE_LIMITS.EXPLAIN_API,
            sessionId: session.sessionId,
        });
        if (rateLimitError) {
            const clientId = getClientIdFromHeaders(request);
            requestLogger.warn({ clientId }, 'Rate limit exceeded');
            await analytics.trackRateLimit({ endpoint: '/api/explain/day-summary', clientId, blocked: true });
            return rateLimitError.response;
        }

        const clientId = getClientIdFromHeaders(request);
        await analytics.trackRateLimit({ endpoint: '/api/explain/day-summary', clientId, blocked: false });

        const rawBody = await request.json().catch(() => null);
        const parseResult = explainRequestSchema.safeParse(rawBody);

        if (!parseResult.success) {
            return NextResponse.json({ error: 'Validation failed', details: parseResult.error.issues }, { status: 400 });
        }

        const { repoId, commits: dayCommits, projectName, projectOwner, provider, providerType, model, baseUrl } = parseResult.data;

        if (parseResult.data.type !== 'day-summary' || !dayCommits || dayCommits.length === 0) {
            return NextResponse.json({ error: 'Invalid request wrapper for day-summary' }, { status: 400 });
        }

        const repoAccess = await hasRepoAccess(repoId, session.sessionId);
        if (!repoAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const providerConfig = await resolveProviderConfigFromRequest(request, {
            provider,
            providerType,
            baseUrl,
            model,
        }, session.sessionId);

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
