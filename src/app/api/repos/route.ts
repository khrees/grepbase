import { NextRequest, NextResponse } from 'next/server';
import { repositories, ingestJobs, commits } from '@/db';
import { eq, desc, sql } from 'drizzle-orm';
import { ingestRepoSchema } from '@/lib/validation';
import { parseGitHubUrl, sanitizeGitHubUrl } from '@/lib/sanitize';
import { logger } from '@/lib/logger';
import { rateLimiter } from '@/lib/rate-limit';
import { RATE_LIMITS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import { processRepoIngestion } from '@/services/ingest';
import { getDb } from '@/db';
import { waitUntil } from '@vercel/functions';

/**
 * GET /api/repos - List all cached repositories
 */
export async function GET(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'GET /api/repos' });
    const db = getDb();

    try {
        const repoList = await (db.select() as any)
            .from(repositories)
            .orderBy(desc(repositories.lastFetched));

        requestLogger.info({ count: repoList.length }, 'Repositories fetched');
        return NextResponse.json({ repositories: repoList });
    } catch (error) {
        requestLogger.error(
            { error, errorMessage: error instanceof Error ? error.message : 'Unknown error' },
            'Error fetching repositories'
        );
        return NextResponse.json({ error: 'Failed to fetch repositories' }, { status: 500 });
    }
}

/**
 * POST /api/repos - Fetch and cache a new repository (non-blocking background processing)
 */
export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'POST /api/repos' });
    const startTime = Date.now();
    const db = getDb();

    try {
        // Rate limiting
        const clientId = rateLimiter.getClientId(request as any); // Adapt request object loosely for id
        const rateLimitResult = await rateLimiter.checkLimit(clientId, RATE_LIMITS.REPO_INGEST, 60);

        if (!rateLimitResult.success) {
            requestLogger.warn({ clientId }, 'Rate limit exceeded');
            return NextResponse.json(
                {
                    error: 'Rate limit exceeded',
                    limit: rateLimitResult.limit,
                    reset: rateLimitResult.reset,
                },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Limit': rateLimitResult.limit.toString(),
                        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
                        'X-RateLimit-Reset': rateLimitResult.reset.toString(),
                    },
                }
            );
        }

        const rawBody = await request.json().catch(() => null);

        // Validate and sanitize input
        const parseResult = ingestRepoSchema.safeParse(rawBody);
        if (!parseResult.success) {
            requestLogger.warn({ errors: parseResult.error.issues }, 'Validation failed');
            return NextResponse.json(
                {
                    error: 'Validation failed',
                    details: parseResult.error.issues,
                },
                { status: 400 }
            );
        }

        const { url } = parseResult.data;
        const sanitizedUrl = sanitizeGitHubUrl(url);
        const { owner, repo: repoName } = parseGitHubUrl(sanitizedUrl);

        requestLogger.info({ owner, repo: repoName }, 'Processing repository ingest');

        // Check if repo already exists
        const existing = await (db.select() as any)
            .from(repositories)
            .where(eq(repositories.url, sanitizedUrl))
            .limit(1);

        if (existing.length > 0) {
            const existingRepo = existing[0];

            // Check if commits exist
            const commitCount = await (db.select({ count: sql<number>`count(*)` }) as any)
                .from(commits)
                .where(eq(commits.repoId, existingRepo.id));

            const hasCommits = Number(commitCount[0]?.count || 0) > 0;

            if (hasCommits) {
                // Repo fully cached with commits
                const duration = Date.now() - startTime;
                await analytics.trackRepoIngest({
                    owner,
                    repo: repoName,
                    commitsCount: Number(commitCount[0]?.count),
                    cached: true,
                    duration,
                });

                requestLogger.info({ owner, repo: repoName, duration }, 'Repository already cached with commits');
                return NextResponse.json({ repository: existingRepo, cached: true });
            }

            // Repo exists but has no commits - trigger background fetch
            requestLogger.info({ owner, repo: repoName }, 'Repository cached but missing commits, fetching...');

            const jobId = crypto.randomUUID();
            const now = new Date();

            await (db.insert(ingestJobs) as any).values({
                jobId,
                url: sanitizedUrl,
                status: 'pending',
                progress: 0,
                createdAt: now,
                updatedAt: now,
            });

            // Fire-and-forget background processing using Next.js waitUntil
            waitUntil(
                processRepoIngestion({
                    jobId,
                    url: sanitizedUrl,
                    clientId,
                    db: db as any,
                }).catch((err) => {
                    logger.error({ err }, 'Background ingestion failed');
                })
            );

            return NextResponse.json(
                {
                    jobId,
                    status: 'processing',
                    message: 'Fetching commits for existing repository',
                    repository: existingRepo,
                },
                { status: 202 }
            );
        }

        // Create job for background processing
        const jobId = crypto.randomUUID();
        const now = new Date();

        // Create job record
        await (db.insert(ingestJobs) as any).values({
            jobId,
            url: sanitizedUrl,
            status: 'pending',
            progress: 0,
            createdAt: now,
            updatedAt: now,
        });

        // Fire-and-forget background processing using Next.js waitUntil
        waitUntil(
            processRepoIngestion({
                jobId,
                url: sanitizedUrl,
                clientId,
                db: db as any,
            }).catch((err) => {
                logger.error({ err }, 'Background ingestion failed');
            })
        );

        requestLogger.info({ jobId, owner, repo: repoName }, 'Repository ingest started in background');

        return NextResponse.json(
            {
                jobId,
                status: 'processing',
                message: 'Repository ingestion started in background',
            },
            { status: 202 }
        );
    } catch (error) {
        const duration = Date.now() - startTime;

        await analytics.trackRequest({
            endpoint: '/api/repos',
            method: 'POST',
            statusCode: 500,
            duration,
            clientId: rateLimiter.getClientId(request as any),
        });

        requestLogger.error(
            { error, errorMessage: error instanceof Error ? error.message : 'Unknown error', duration },
            'Error creating repository'
        );

        return NextResponse.json(
            { error: 'Failed to fetch repository. Please try again later.' },
            { status: 500 }
        );
    }
}
