import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/constants';
import {
    applyPrivateNoStoreHeaders,
    applySessionCookie,
    enforceCsrfProtection,
    enforceRateLimit,
    resolveSession,
} from '@/lib/api-security';
import {
    getStoredGithubToken,
    upsertStoredGithubToken,
} from '@/services/ai-credentials';

const tokenLogger = logger.child({ endpoint: '/api/github/token' });

const tokenPayloadSchema = z.object({
    token: z.string().max(4096),
});

export async function GET(request: NextRequest) {
    try {
        const session = await resolveSession(request, { createIfMissing: true });
        if (!session) {
            return NextResponse.json({ hasToken: false });
        }

        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:github:token:get',
            limit: RATE_LIMITS.GENERAL_API,
            sessionId: session.sessionId,
        });
        if (rateLimitError) {
            return rateLimitError.response;
        }

        const token = await getStoredGithubToken(session.sessionId);
        const response = applyPrivateNoStoreHeaders(NextResponse.json({ hasToken: !!token }));
        if (session.issuedToken) {
            applySessionCookie(response, session.issuedToken);
        }
        return response;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read github token status';
        tokenLogger.error({ error, message }, 'Failed to read stored github token status');
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
            keyPrefix: 'api:github:token:post',
            limit: RATE_LIMITS.GENERAL_API,
            sessionId: session.sessionId,
        });
        if (rateLimitError) {
            return rateLimitError.response;
        }

        const rawBody = await request.json().catch(() => null);
        const parseResult = tokenPayloadSchema.safeParse(rawBody);

        if (!parseResult.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: parseResult.error.issues },
                { status: 400 }
            );
        }

        const { token } = parseResult.data;
        await upsertStoredGithubToken(session.sessionId, token);

        const response = applyPrivateNoStoreHeaders(NextResponse.json({
            success: true,
            stored: token.trim().length > 0,
        }));
        if (session.issuedToken) {
            applySessionCookie(response, session.issuedToken);
        }
        return response;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to store github token';
        tokenLogger.error({ error, message }, 'Failed to store github token');
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
