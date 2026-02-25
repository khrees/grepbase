import { NextRequest, NextResponse } from 'next/server';
import { repositories, ingestJobs, commits } from '@/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ingestRepoSchema } from '@/lib/validation';
import { parseGitHubUrl, sanitizeGitHubUrl } from '@/lib/sanitize';
import { logger } from '@/lib/logger';
import { PAGINATION, RATE_LIMITS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import { processRepoIngestion } from '@/services/ingest';
import { getDb } from '@/db';
import { waitUntil } from '@vercel/functions';
import {
    applyPrivateNoStoreHeaders,
    applySessionCookie,
    enforceCsrfProtection,
    enforceRateLimit,
    resolveSession,
    type SessionResolutionResult,
} from '@/lib/api-security';
import {
    listRepoIdsForSession,
    safeGrantJobAccess,
    safeGrantRepoAccess,
} from '@/services/resource-access';

const ACTIVE_JOB_STATUSES = ['pending', 'processing'] as const;

function finalizeSessionResponse(
    session: SessionResolutionResult,
    response: NextResponse
): NextResponse {
    if (session.issuedToken) {
        applySessionCookie(response, session.issuedToken);
    }
    return applyPrivateNoStoreHeaders(response);
}

/**
 * GET /api/repos - List repositories accessible to the current session
 */
export async function GET(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'GET /api/repos' });
    const db = getDb();

    try {
        const session = await resolveSession(request, { createIfMissing: true });
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:repos:get',
            limit: RATE_LIMITS.GENERAL_API,
            sessionId: session.sessionId,
        });
        if (rateLimitError) {
            return finalizeSessionResponse(session, rateLimitError.response);
        }

        const url = new URL(request.url);
        const requestedPage = Number.parseInt(url.searchParams.get('page') || '', 10);
        const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '', 10);
        const page = Number.isFinite(requestedPage) && requestedPage > 0
            ? requestedPage
            : PAGINATION.DEFAULT_PAGE;
        const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(PAGINATION.MAX_LIMIT, requestedLimit)
            : PAGINATION.DEFAULT_LIMIT;

        const accessibleRepoIds = await listRepoIdsForSession(session.sessionId);
        if (accessibleRepoIds.length === 0) {
            return finalizeSessionResponse(
                session,
                NextResponse.json({
                    repositories: [],
                    pagination: {
                        page,
                        limit,
                        total: 0,
                        totalPages: 0,
                        hasNext: false,
                        hasPrev: false,
                    },
                })
            );
        }

        const uniqueRepoIds = Array.from(new Set(accessibleRepoIds));
        const offset = (page - 1) * limit;

        const totalResult = await db.select({ count: sql<number>`count(*)` })
            .from(repositories)
            .where(inArray(repositories.id, uniqueRepoIds));
        const total = Number(totalResult[0]?.count || 0);

        const repoList = await db.select()
            .from(repositories)
            .where(inArray(repositories.id, uniqueRepoIds))
            .orderBy(desc(repositories.lastFetched))
            .limit(limit)
            .offset(offset);

        requestLogger.info({ sessionId: session.sessionId, count: repoList.length }, 'Repositories fetched');

        return finalizeSessionResponse(
            session,
            NextResponse.json({
                repositories: repoList,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                    hasNext: offset + limit < total,
                    hasPrev: page > 1,
                },
            })
        );
    } catch (error) {
        requestLogger.error(
            { error, errorMessage: error instanceof Error ? error.message : 'Unknown error' },
            'Error fetching repositories'
        );
        return NextResponse.json({ error: 'Failed to fetch repositories' }, { status: 500 });
    }
}

/**
 * POST /api/repos - Fetch and cache a repository with background ingestion
 */
export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'POST /api/repos' });
    const startTime = Date.now();
    const db = getDb();
    let analyticsClientId = 'unknown';

    try {
        const csrfError = enforceCsrfProtection(request);
        if (csrfError) {
            return csrfError;
        }

        const session = await resolveSession(request, { createIfMissing: true });
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        analyticsClientId = session.sessionId;

        const rateLimitError = await enforceRateLimit(request, {
            keyPrefix: 'api:repos:post',
            limit: RATE_LIMITS.REPO_INGEST,
            sessionId: session.sessionId,
        });
        if (rateLimitError) {
            requestLogger.warn({ sessionId: session.sessionId }, 'Rate limit exceeded');
            return finalizeSessionResponse(session, rateLimitError.response);
        }

        const rawBody = await request.json().catch(() => null);
        const parseResult = ingestRepoSchema.safeParse(rawBody);
        if (!parseResult.success) {
            requestLogger.warn({ errors: parseResult.error.issues }, 'Validation failed');
            return finalizeSessionResponse(
                session,
                NextResponse.json(
                    {
                        error: 'Validation failed',
                        details: parseResult.error.issues,
                    },
                    { status: 400 }
                )
            );
        }

        const { url } = parseResult.data;
        const sanitizedUrl = sanitizeGitHubUrl(url);
        const { owner, repo: repoName } = parseGitHubUrl(sanitizedUrl);
        requestLogger.info({ owner, repo: repoName, sessionId: session.sessionId }, 'Processing repository ingest');

        const existingRepoResult = await db.select()
            .from(repositories)
            .where(eq(repositories.url, sanitizedUrl))
            .limit(1);

        if (existingRepoResult.length > 0) {
            const existingRepo = existingRepoResult[0];
            await safeGrantRepoAccess(existingRepo.id, session.sessionId);

            const activeJobResult = await db.select()
                .from(ingestJobs)
                .where(and(
                    eq(ingestJobs.repoId, existingRepo.id),
                    inArray(ingestJobs.status, ACTIVE_JOB_STATUSES)
                ))
                .orderBy(desc(ingestJobs.updatedAt))
                .limit(1);

            if (activeJobResult.length > 0) {
                const activeJob = activeJobResult[0];
                await safeGrantJobAccess(activeJob.jobId, session.sessionId);

                return finalizeSessionResponse(
                    session,
                    NextResponse.json({
                        repository: existingRepo,
                        cached: true,
                        jobId: activeJob.jobId,
                        status: activeJob.status,
                    })
                );
            }

            const commitCountResult = await db.select({ count: sql<number>`count(*)` })
                .from(commits)
                .where(eq(commits.repoId, existingRepo.id));
            const existingCommitCount = Number(commitCountResult[0]?.count || 0);

            const jobId = crypto.randomUUID();
            const now = new Date();
            await db.insert(ingestJobs).values({
                jobId,
                url: sanitizedUrl,
                status: 'pending',
                progress: 0,
                createdAt: now,
                updatedAt: now,
                repoId: existingRepo.id,
            });
            await safeGrantJobAccess(jobId, session.sessionId);

            const ingestionPromise = processRepoIngestion({
                jobId,
                url: sanitizedUrl,
                clientId: session.sessionId,
                db,
            }).catch((err) => {
                logger.error({ err, jobId, owner, repo: repoName }, 'Background ingestion failed');
            });

            if (typeof waitUntil === 'function') {
                waitUntil(ingestionPromise);
            } else {
                requestLogger.debug('waitUntil not available, running ingestion promise directly');
                void ingestionPromise;
            }

            const duration = Date.now() - startTime;
            const trackRepoIngestPromise = analytics.trackRepoIngest({
                owner,
                repo: repoName,
                commitsCount: existingCommitCount,
                cached: true,
                duration,
            });
            if (typeof waitUntil === 'function') {
                waitUntil(trackRepoIngestPromise);
            } else {
                void trackRepoIngestPromise;
            }

            if (existingCommitCount > 0) {
                requestLogger.info({ owner, repo: repoName, duration }, 'Repository already cached, refreshing in background');
                return finalizeSessionResponse(
                    session,
                    NextResponse.json({
                        repository: existingRepo,
                        cached: true,
                        jobId,
                        status: 'pending',
                    })
                );
            }

            requestLogger.info({ owner, repo: repoName, duration }, 'Repository exists without commits, ingestion restarted');
            return finalizeSessionResponse(
                session,
                NextResponse.json(
                    {
                        jobId,
                        status: 'processing',
                        message: 'Fetching commits for existing repository',
                        repository: existingRepo,
                    },
                    { status: 202 }
                )
            );
        }

        const activeUrlJobResult = await db.select()
            .from(ingestJobs)
            .where(and(
                eq(ingestJobs.url, sanitizedUrl),
                inArray(ingestJobs.status, ACTIVE_JOB_STATUSES)
            ))
            .orderBy(desc(ingestJobs.updatedAt))
            .limit(1);

        if (activeUrlJobResult.length > 0) {
            const activeJob = activeUrlJobResult[0];
            await safeGrantJobAccess(activeJob.jobId, session.sessionId);

            const linkedRepo = activeJob.repoId
                ? await db.select()
                    .from(repositories)
                    .where(eq(repositories.id, activeJob.repoId))
                    .limit(1)
                : [];

            if (linkedRepo.length > 0) {
                await safeGrantRepoAccess(linkedRepo[0].id, session.sessionId);
            }

            return finalizeSessionResponse(
                session,
                NextResponse.json(
                    {
                        jobId: activeJob.jobId,
                        status: activeJob.status,
                        message: 'Repository ingestion already in progress',
                        repository: linkedRepo[0] || null,
                    },
                    { status: 202 }
                )
            );
        }

        const jobId = crypto.randomUUID();
        const now = new Date();
        await db.insert(ingestJobs).values({
            jobId,
            url: sanitizedUrl,
            status: 'pending',
            progress: 0,
            createdAt: now,
            updatedAt: now,
        });
        await safeGrantJobAccess(jobId, session.sessionId);

        const ingestionPromise = processRepoIngestion({
            jobId,
            url: sanitizedUrl,
            clientId: session.sessionId,
            db,
        }).catch((err) => {
            logger.error({ err, jobId, owner, repo: repoName }, 'Background ingestion failed');
        });

        if (typeof waitUntil === 'function') {
            waitUntil(ingestionPromise);
        } else {
            requestLogger.debug('waitUntil not available, running ingestion promise directly');
            void ingestionPromise;
        }

        requestLogger.info({ jobId, owner, repo: repoName }, 'Repository ingest started in background');

        return finalizeSessionResponse(
            session,
            NextResponse.json(
                {
                    jobId,
                    status: 'processing',
                    message: 'Repository ingestion started in background',
                },
                { status: 202 }
            )
        );
    } catch (error) {
        const duration = Date.now() - startTime;
        const message = error instanceof Error ? error.message : 'Unknown error';

        await analytics.trackRequest({
            endpoint: '/api/repos',
            method: 'POST',
            statusCode: 500,
            duration,
            clientId: analyticsClientId,
        });

        requestLogger.error({ error, errorMessage: message, duration }, 'Error creating repository');

        if (
            message.includes('publicly accessible') ||
            message.includes('Private repositories are not supported') ||
            message.includes('Repository not found')
        ) {
            return NextResponse.json({ error: message }, { status: 400 });
        }

        return NextResponse.json(
            { error: 'Failed to fetch repository. Please try again later.' },
            { status: 500 }
        );
    }
}
