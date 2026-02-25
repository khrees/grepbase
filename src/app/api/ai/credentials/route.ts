import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { aiProviderTypeSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/constants';
import {
    applyPrivateNoStoreHeaders,
    applySessionCookie,
    enforceCsrfProtection,
    enforceRateLimit,
    resolveSession,
} from '@/lib/api-security';
import type { AIProviderType } from '@/services/ai-providers';
import {
    getStoredProviderStatus,
    upsertStoredProviderApiKey,
} from '@/services/ai-credentials';

const credentialsLogger = logger.child({ endpoint: '/api/ai/credentials' });

const credentialPayloadSchema = z.object({
    provider: aiProviderTypeSchema,
    apiKey: z.string().max(4096),
});

function getEmptyProviderStatus(): Record<AIProviderType, boolean> {
    return {
        gemini: false,
        openai: false,
        anthropic: false,
        ollama: false,
        lmstudio: false,
        glm: false,
        kimi: false,
    };
}

export async function GET(request: NextRequest) {
    try {
        const session = await resolveSession(request, { createIfMissing: true });
        if (!session) {
            return NextResponse.json({ providers: getEmptyProviderStatus() });
        }

        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:ai:credentials:get',
            limit: RATE_LIMITS.GENERAL_API,
            sessionId: session.sessionId,
        });
        if (rateLimitError) {
            return rateLimitError.response;
        }

        const providers = await getStoredProviderStatus(session.sessionId);
        const response = applyPrivateNoStoreHeaders(NextResponse.json({ providers }));
        if (session.issuedToken) {
            applySessionCookie(response, session.issuedToken);
        }
        return response;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read credential status';
        credentialsLogger.error({ error, message }, 'Failed to read stored credentials status');
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const csrfError = enforceCsrfProtection(request);
        if (csrfError) {
            return csrfError;
        }

        const session = await resolveSession(request, { createIfMissing: true });
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:ai:credentials:post',
            limit: RATE_LIMITS.GENERAL_API,
            sessionId: session.sessionId,
        });
        if (rateLimitError) {
            return rateLimitError.response;
        }

        const rawBody = await request.json().catch(() => null);
        const parseResult = credentialPayloadSchema.safeParse(rawBody);

        if (!parseResult.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: parseResult.error.issues },
                { status: 400 }
            );
        }

        const { provider, apiKey } = parseResult.data;
        await upsertStoredProviderApiKey(session.sessionId, provider, apiKey);

        const response = applyPrivateNoStoreHeaders(NextResponse.json({
            success: true,
            provider,
            stored: apiKey.trim().length > 0,
        }));
        if (session.issuedToken) {
            applySessionCookie(response, session.issuedToken);
        }
        return response;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to store credential';
        credentialsLogger.error({ error, message }, 'Failed to store provider credential');
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
