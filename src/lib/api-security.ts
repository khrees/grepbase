import { NextRequest, NextResponse } from 'next/server';
import { rateLimiter } from './rate-limit';
import {
    AI_CREDENTIALS_SESSION_COOKIE,
    AI_CREDENTIALS_TTL_SECONDS,
    issueCredentialSessionToken,
    resolveCredentialSessionId,
} from '@/services/ai-credentials';
import { analytics } from '@/lib/analytics';

export const CSRF_HEADER = 'x-grepbase-csrf';
export const CSRF_HEADER_VALUE = '1';
export const PRIVATE_NO_STORE_HEADERS = {
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    Vary: 'Cookie',
} as const;

export interface SessionResolutionResult {
    sessionId: string;
    issuedToken?: string;
}

export interface RateLimitErrorResult {
    response: NextResponse;
}

export function enforceCsrfProtection(request: NextRequest): NextResponse | null {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
        return null;
    }

    const origin = request.headers.get('origin');
    if (origin) {
        const requestOrigin = new URL(request.url).origin;
        if (origin !== requestOrigin) {
            return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
        }
    }

    const csrfHeader = request.headers.get(CSRF_HEADER);
    if (csrfHeader === CSRF_HEADER_VALUE) {
        return null;
    }

    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
}

export async function resolveSession(
    request: NextRequest,
    options?: { createIfMissing?: boolean }
): Promise<SessionResolutionResult | null> {
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieName = isProduction ? `__Host-${AI_CREDENTIALS_SESSION_COOKIE}` : AI_CREDENTIALS_SESSION_COOKIE;
    const token = request.cookies.get(cookieName)?.value;
    const existingSessionId = await resolveCredentialSessionId(token);

    if (existingSessionId) {
        return { sessionId: existingSessionId };
    }

    if (!options?.createIfMissing) {
        return null;
    }

    const issued = await issueCredentialSessionToken();
    return {
        sessionId: issued.sessionId,
        issuedToken: issued.token,
    };
}

export function applySessionCookie(response: NextResponse, sessionToken: string): void {
    const isProduction = process.env.NODE_ENV === 'production';
    response.cookies.set({
        name: isProduction ? `__Host-${AI_CREDENTIALS_SESSION_COOKIE}` : AI_CREDENTIALS_SESSION_COOKIE,
        value: sessionToken,
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: AI_CREDENTIALS_TTL_SECONDS,
    });
}

export function applyPrivateNoStoreHeaders<T extends Response>(response: T): T {
    for (const [header, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
        response.headers.set(header, value);
    }
    return response;
}

export function getClientIdFromHeaders(req: NextRequest): string {
    const cfConnectingIp = req.headers.get('cf-connecting-ip');
    if (cfConnectingIp) return cfConnectingIp;

    const xForwardedFor = req.headers.get('x-forwarded-for');
    if (xForwardedFor) return xForwardedFor.split(',')[0].trim();

    const xRealIp = req.headers.get('x-real-ip');
    if (xRealIp) return xRealIp;

    return 'unknown';
}

export async function enforceRateLimit(
    request: NextRequest,
    options: { keyPrefix: string; limit: number; windowSeconds?: number; sessionId?: string }
): Promise<RateLimitErrorResult | null> {
    const clientIp = rateLimiter.getClientId(request);
    const keyBase = options.sessionId
        ? `${options.keyPrefix}:session:${options.sessionId}`
        : `${options.keyPrefix}:ip:${clientIp}`;

    const result = await rateLimiter.checkLimit(keyBase, options.limit, options.windowSeconds ?? 60);
    if (result.success) {
        return null;
    }

    return {
        response: NextResponse.json(
            {
                error: 'Rate limit exceeded',
                limit: result.limit,
                reset: result.reset,
            },
            {
                status: 429,
                headers: {
                    'X-RateLimit-Limit': result.limit.toString(),
                    'X-RateLimit-Remaining': result.remaining.toString(),
                    'X-RateLimit-Reset': result.reset.toString(),
                },
            }
        ),
    };
}

export type GuardResult =
    | { ok: false; response: NextResponse }
    | { ok: true; session: SessionResolutionResult; clientId: string };

/**
 * Run standard API guards (CSRF + session + rate limit + analytics) for POST routes.
 * Returns { ok: false, response } on any failure, or { ok: true, session, clientId } on success.
 */
export async function guardRoute(
    request: NextRequest,
    options: {
        rateLimit: { keyPrefix: string; limit: number };
        analytics: { endpoint: string };
    }
): Promise<GuardResult> {
    const csrfError = enforceCsrfProtection(request);
    if (csrfError) return { ok: false, response: csrfError };

    const session = await resolveSession(request);
    if (!session) {
        return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    const clientId = getClientIdFromHeaders(request);

    const rateLimitError = await enforceRateLimit(request, {
        keyPrefix: options.rateLimit.keyPrefix,
        limit: options.rateLimit.limit,
        sessionId: session.sessionId,
    });

    if (rateLimitError) {
        await analytics.trackRateLimit({ endpoint: options.analytics.endpoint, clientId, blocked: true });
        return { ok: false, response: rateLimitError.response };
    }

    await analytics.trackRateLimit({ endpoint: options.analytics.endpoint, clientId, blocked: false });

    return { ok: true, session, clientId };
}
