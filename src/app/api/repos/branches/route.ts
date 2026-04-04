import { NextRequest, NextResponse } from 'next/server';
import { parseGitHubUrl, sanitizeGitHubUrl } from '@/lib/sanitize';
import { fetchRepoBranches } from '@/services/github';
import {
    applyPrivateNoStoreHeaders,
    enforceRateLimit,
    resolveSession,
} from '@/lib/api-security';
import { RATE_LIMITS } from '@/lib/constants';

/**
 * GET /api/repos/branches?url=<github-url>
 * Returns the list of branches and the default branch for a public repository.
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get('url');

    if (!rawUrl) {
        return NextResponse.json({ error: 'url parameter is required' }, { status: 400 });
    }

    try {
        const sanitizedUrl = sanitizeGitHubUrl(rawUrl);
        const { owner, repo } = parseGitHubUrl(sanitizedUrl);

        const session = await resolveSession(request, { createIfMissing: false });
        if (session?.sessionId) {
            const rateLimitError = await enforceRateLimit(request, {
                keyPrefix: 'api:branches:get',
                limit: RATE_LIMITS.GENERAL_API,
                sessionId: session.sessionId,
            });
            if (rateLimitError) {
                return applyPrivateNoStoreHeaders(rateLimitError.response);
            }
        }

        const result = await fetchRepoBranches(owner, repo);
        return applyPrivateNoStoreHeaders(NextResponse.json(result));
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch branches';
        return NextResponse.json({ error: message }, { status: 400 });
    }
}
