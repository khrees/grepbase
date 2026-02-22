import { NextRequest, NextResponse } from 'next/server';
import { repositories, commits, files } from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import { fetchCommitDiff } from '@/services/github';
import { explainCommit, explainProject, answerQuestion } from '@/services/explain';
import type { AIProviderConfig } from '@/services/ai-providers';
import { explainRequestSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { rateLimiter } from '@/lib/rate-limit';
import { RATE_LIMITS, AI_CONSTANTS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import { getDb } from '@/db';

const CODE_EXTENSIONS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.py', '.rs', '.go', '.java',
    '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.swift', '.kt',
    '.md', '.json', '.yaml', '.yml', '.toml', '.css', '.scss',
    '.html', '.xml', '.sql', '.sh', '.bash',
]);
const MAX_FILE_SIZE = 100000; // 100KB max for content fetching

function getClientIdFromHeaders(req: NextRequest): string {
    const cfConnectingIp = req.headers.get('cf-connecting-ip');
    if (cfConnectingIp) return cfConnectingIp;

    const xForwardedFor = req.headers.get('x-forwarded-for');
    if (xForwardedFor) return xForwardedFor.split(',')[0].trim();

    const xRealIp = req.headers.get('x-real-ip');
    if (xRealIp) return xRealIp;

    return 'unknown';
}

function normalizePath(path: string): string {
    return path.trim().replace(/^\/+/, '').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

function isOpenableFilePath(path: string, size: number, hasContent: boolean): boolean {
    if (hasContent) return true;

    const ext = `.${path.split('.').pop() || ''}`.toLowerCase();
    const isCodeFile = CODE_EXTENSIONS.has(ext);
    const isSmallEnough = size <= MAX_FILE_SIZE;

    return isCodeFile && isSmallEnough;
}

async function resolveAvailableFilePathsForCommit(
    db: ReturnType<typeof getDb>,
    commitId: number,
    visibleFiles?: string[]
): Promise<string[]> {
    if (visibleFiles && visibleFiles.length > 0) {
        return Array.from(
            new Set(
                visibleFiles
                    .map(normalizePath)
                    .filter(Boolean)
            )
        );
    }

    const commitFiles = await (db.select({
        path: files.path,
        size: files.size,
        content: files.content,
    }) as any)
        .from(files)
        .where(eq(files.commitId, commitId));

    return commitFiles
        .filter((file: { path: string; size: number | null; content: string | null }) =>
            isOpenableFilePath(file.path, Number(file.size || 0), Boolean(file.content))
        )
        .map((file: { path: string }) => normalizePath(file.path));
}

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: 'POST /api/explain' });
    const startTime = Date.now();

    try {
        const clientId = getClientIdFromHeaders(request);
        const rateLimitResult = await rateLimiter.checkLimit(clientId, RATE_LIMITS.EXPLAIN_API, 60);

        if (!rateLimitResult.success) {
            requestLogger.warn({ clientId, remaining: rateLimitResult.remaining }, 'Rate limit exceeded');

            await analytics.trackRateLimit({
                endpoint: '/api/explain',
                clientId,
                blocked: true,
            });

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

        await analytics.trackRateLimit({
            endpoint: '/api/explain',
            clientId,
            blocked: false,
        });

        const db = getDb();
        const rawBody = await request.json().catch(() => null);

        const parseResult = explainRequestSchema.safeParse(rawBody);
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

        const body = parseResult.data;
        const {
            type,
            repoId,
            commitSha,
            question,
            provider,
            providerType,
            commits: dayCommits,
            projectName,
            projectOwner,
            apiKey,
            model,
            baseUrl,
            visibleFiles,
        } = body;

        const providerConfig: AIProviderConfig = {
            type: provider?.type ?? providerType!,
            apiKey: provider?.apiKey || apiKey,
            baseUrl: provider?.baseUrl || baseUrl,
            model: provider?.model || model,
        };

        requestLogger.info({ type, repoId, provider: providerConfig.type }, 'Processing explain request');

        const repo = await (db.select() as any)
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            requestLogger.warn({ repoId }, 'Repository not found');
            return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
        }

        // Use count query instead of loading all commits (performance fix)
        const commitCountResult = await (db.select({ count: sql<number>`count(*)` }) as any)
            .from(commits)
            .where(eq(commits.repoId, repoId));

        const totalCommits = Number(commitCountResult[0]?.count || 0);

        const projectContext = {
            name: repo[0].name,
            description: repo[0].description,
            readme: repo[0].readme,
            totalCommits,
            currentCommitIndex: 0,
        };

        let response: Response;

        if (type === 'project') {
            response = await explainProject(projectContext, providerConfig);
        } else if (type === 'commit' && commitSha) {
            const commit = await (db.select() as any)
                .from(commits)
                .where(and(eq(commits.repoId, repoId), eq(commits.sha, commitSha)))
                .limit(1);

            if (commit.length === 0) {
                requestLogger.warn({ repoId, commitSha }, 'Commit not found');
                return NextResponse.json({ error: 'Commit not found' }, { status: 404 });
            }

            const diff = await fetchCommitDiff(repo[0].owner, repo[0].name, commitSha);
            const availableFiles = await resolveAvailableFilePathsForCommit(
                db,
                commit[0].id,
                visibleFiles
            );

            const commitContext = {
                sha: commit[0].sha,
                message: commit[0].message,
                authorName: commit[0].authorName,
                date: commit[0].date,
                diff,
                filesChanged: [],
                availableFiles,
            };

            projectContext.currentCommitIndex = commit[0].order;

            response = await explainCommit(commitContext, projectContext, providerConfig);
        } else if (type === 'question' && question) {
            let commitContext;
            if (commitSha) {
                const commit = await (db.select() as any)
                    .from(commits)
                    .where(and(eq(commits.repoId, repoId), eq(commits.sha, commitSha)))
                    .limit(1);

                if (commit.length > 0) {
                    commitContext = {
                        sha: commit[0].sha,
                        message: commit[0].message,
                        authorName: commit[0].authorName,
                        date: commit[0].date,
                        diff: null,
                        filesChanged: [],
                        availableFiles: await resolveAvailableFilePathsForCommit(
                            db,
                            commit[0].id,
                            visibleFiles
                        ),
                    };
                    projectContext.currentCommitIndex = commit[0].order;
                }
            }

            response = await answerQuestion(
                question,
                { commit: commitContext, project: projectContext },
                providerConfig
            );
        } else if (type === 'day-summary' && dayCommits && dayCommits.length > 0) {
            const { streamText } = await import('ai');
            const { createAIProviderAsync } = await import('@/services/ai-providers');

            const aiModel = await createAIProviderAsync(providerConfig);

            const commitsList = dayCommits
                .map(
                    (c: { sha: string; message: string; authorName: string | null; date: string }) =>
                        `• ${c.sha?.substring(0, 7) || 'unknown'}: ${c.message?.split('\n')[0] || 'No message'} (by ${c.authorName || 'Unknown'
                        })`
                )
                .join('\n');

            const systemPrompt = `You are an expert code reviewer helping developers understand commit activity.
Your job is to summarize what happened in a repository on a specific day.
Be concise but insightful. Focus on the narrative - what was the developer trying to accomplish?`;

            const userPrompt = `Summarize the following commits from ${projectOwner || 'a repository'}/${projectName || 'repo'
                }:

${commitsList}

Provide a brief, engaging summary of what was accomplished. Use markdown formatting.`;

            const streamResult = streamText({
                model: aiModel,
                system: systemPrompt,
                prompt: userPrompt,
                maxOutputTokens: AI_CONSTANTS.MAX_OUTPUT_TOKENS.DAY_SUMMARY,
            });
            response = streamResult.toTextStreamResponse();
        } else {
            requestLogger.warn({ type }, 'Invalid request type');
            return NextResponse.json({ error: 'Invalid request type' }, { status: 400 });
        }

        const duration = Date.now() - startTime;
        await analytics.trackAIUsage({
            provider: providerConfig.type,
            model: providerConfig.model,
            type,
            success: true,
            duration,
        });

        await analytics.trackRequest({
            endpoint: '/api/explain',
            method: 'POST',
            statusCode: 200,
            duration,
            clientId,
        });

        requestLogger.info({ type, repoId, duration }, 'Explanation generated successfully');

        return response;
    } catch (error) {
        const duration = Date.now() - startTime;
        const clientId = getClientIdFromHeaders(request);

        await analytics.trackRequest({
            endpoint: '/api/explain',
            method: 'POST',
            statusCode: 500,
            duration,
            clientId,
        });

        requestLogger.error(
            { error, errorMessage: error instanceof Error ? error.message : 'Unknown error', duration },
            'Error generating explanation'
        );
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Failed to generate explanation',
            },
            { status: 500 }
        );
    }
}
