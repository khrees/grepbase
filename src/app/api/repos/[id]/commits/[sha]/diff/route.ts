import { NextResponse } from 'next/server';
import { repositories, commits } from '@/db';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { fetchCommitFileDiffs } from '@/services/github';

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string; sha: string }> }
) {
    const db = getDb();

    try {
        const { id, sha } = await params;
        const repoId = Number.parseInt(id, 10);

        if (Number.isNaN(repoId)) {
            return NextResponse.json({ error: 'Invalid repository ID' }, { status: 400 });
        }

        const repo = await db
            .select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
        }

        const commit = await db
            .select()
            .from(commits)
            .where(and(eq(commits.repoId, repoId), eq(commits.sha, sha)))
            .limit(1);

        if (commit.length === 0) {
            return NextResponse.json({ error: 'Commit not found' }, { status: 404 });
        }

        const files = await fetchCommitFileDiffs(repo[0].owner, repo[0].name, sha);

        const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
        const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);

        return NextResponse.json(
            {
                commit: commit[0],
                files,
                stats: {
                    changedFiles: files.length,
                    additions: totalAdditions,
                    deletions: totalDeletions,
                },
            },
            {
                headers: {
                    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
                },
            }
        );
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch commit diff' },
            { status: 500 }
        );
    }
}
