import { NextRequest, NextResponse } from 'next/server';
import { repositories, commits } from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { fetchCompareDiff } from '@/services/github';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const db = getDb();

    try {
        const { id } = await params;
        const repoId = Number.parseInt(id, 10);

        if (Number.isNaN(repoId)) {
            return NextResponse.json({ error: 'Invalid repository ID' }, { status: 400 });
        }

        const baseSha = request.nextUrl.searchParams.get('base');
        const headSha = request.nextUrl.searchParams.get('head');
        const filePath = request.nextUrl.searchParams.get('path')?.trim() || null;

        if (!baseSha || !headSha) {
            return NextResponse.json({ error: 'Both base and head commits are required' }, { status: 400 });
        }

        const repo = await db
            .select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
        }

        const uniqueShas = Array.from(new Set([baseSha, headSha]));

        const selectedCommits = await db
            .select({ sha: commits.sha })
            .from(commits)
            .where(and(eq(commits.repoId, repoId), inArray(commits.sha, uniqueShas)));

        if (baseSha === headSha) {
            if (selectedCommits.length === 0) {
                return NextResponse.json({ error: 'Commit must belong to this repository' }, { status: 400 });
            }

            return NextResponse.json(
                {
                    baseSha,
                    headSha,
                    status: 'identical',
                    aheadBy: 0,
                    behindBy: 0,
                    totalCommits: 0,
                    files: [],
                    selectedPath: filePath,
                },
                {
                    headers: {
                        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
                    },
                }
            );
        }

        if (selectedCommits.length < 2) {
            return NextResponse.json({ error: 'Base/head commits must belong to this repository' }, { status: 400 });
        }

        const compare = await fetchCompareDiff(repo[0].owner, repo[0].name, baseSha, headSha);

        const filteredFiles = filePath
            ? compare.files.filter(
                file => file.path === filePath || file.previousPath === filePath
            )
            : compare.files;

        return NextResponse.json(
            {
                baseSha,
                headSha,
                status: compare.status,
                aheadBy: compare.aheadBy,
                behindBy: compare.behindBy,
                totalCommits: compare.totalCommits,
                files: filteredFiles,
                totalFiles: compare.files.length,
                selectedPath: filePath,
            },
            {
                headers: {
                    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
                },
            }
        );
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to compare commits' },
            { status: 500 }
        );
    }
}
