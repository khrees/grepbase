import { NextRequest, NextResponse } from 'next/server';
import type { AIProviderConfig } from '@/services/ai-providers';
import { explainRequestSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { rateLimiter } from '@/lib/rate-limit';
import { RATE_LIMITS, AI_CONSTANTS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import { getClientIdFromHeaders } from '../utils';

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'POST /api/explain/day-summary' });
    const startTime = Date.now();

    try {
        const clientId = getClientIdFromHeaders(request);
        const rateLimitResult = await rateLimiter.checkLimit(clientId, RATE_LIMITS.EXPLAIN_API, 60);

        if (!rateLimitResult.success) {
            requestLogger.warn({ clientId }, 'Rate limit exceeded');
            await analytics.trackRateLimit({ endpoint: '/api/explain/day-summary', clientId, blocked: true });
            return NextResponse.json(
                { error: 'Rate limit exceeded', limit: rateLimitResult.limit, reset: rateLimitResult.reset },
                { status: 429, headers: { 'X-RateLimit-Limit': rateLimitResult.limit.toString(), 'X-RateLimit-Remaining': rateLimitResult.remaining.toString(), 'X-RateLimit-Reset': rateLimitResult.reset.toString() } }
            );
        }

        await analytics.trackRateLimit({ endpoint: '/api/explain/day-summary', clientId, blocked: false });

        const rawBody = await request.json().catch(() => null);
        const parseResult = explainRequestSchema.safeParse(rawBody);

        if (!parseResult.success) {
            return NextResponse.json({ error: 'Validation failed', details: parseResult.error.issues }, { status: 400 });
        }

        const { commits: dayCommits, projectName, projectOwner, provider, providerType, apiKey, model, baseUrl } = parseResult.data;

        if (parseResult.data.type !== 'day-summary' || !dayCommits || dayCommits.length === 0) {
            return NextResponse.json({ error: 'Invalid request wrapper for day-summary' }, { status: 400 });
        }

        const providerConfig: AIProviderConfig = {
            type: provider?.type ?? providerType!,
            apiKey: provider?.apiKey || apiKey,
            baseUrl: provider?.baseUrl || baseUrl,
            model: provider?.model || model,
        };

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

        return response;
    } catch (error) {
        const duration = Date.now() - startTime;
        const clientId = getClientIdFromHeaders(request);
        await analytics.trackRequest({ endpoint: '/api/explain/day-summary', method: 'POST', statusCode: 500, duration, clientId });
        requestLogger.error({ error }, 'Error generating explanation');
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}
