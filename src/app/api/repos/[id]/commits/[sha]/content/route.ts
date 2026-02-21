import { NextRequest, NextResponse } from 'next/server';
import { repositories, commits, files } from '@/db';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/db';
import { fetchFileContent } from '@/services/github';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; sha: string }> }
) {
    const db = getDb();

    try {
        const { id, sha } = await params;
        const repoId = parseInt(id, 10);

        const url = new URL(request.url);
        const filePath = url.searchParams.get('path');

        if (isNaN(repoId)) {
            return NextResponse.json({ error: 'Invalid repository ID' }, { status: 400 });
        }

        if (!filePath) {
            return NextResponse.json({ error: 'File path is required' }, { status: 400 });
        }

        // Get repo info
        const repo = await (db.select() as any)
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
        }

        // Get commit info
        const commit = await (db.select() as any)
            .from(commits)
            .where(and(eq(commits.repoId, repoId), eq(commits.sha, sha)))
            .limit(1);

        if (commit.length === 0) {
            return NextResponse.json({ error: 'Commit not found' }, { status: 404 });
        }

        // Check if we have cached content for this file
        const cachedFile = await (db.select() as any)
            .from(files)
            .where(and(eq(files.commitId, commit[0].id), eq(files.path, filePath)))
            .limit(1);

        if (cachedFile.length > 0 && cachedFile[0].content) {
            return NextResponse.json({
                path: cachedFile[0].path,
                content: cachedFile[0].content,
                language: cachedFile[0].language,
                cached: true,
            }, {
                headers: {
                    'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800', // Cache for CDN
                },
            });
        }

        // Fetch content from GitHub
        const { owner, name } = repo[0];
        const content = await fetchFileContent(owner, name, sha, filePath);

        if (content === null) {
            return NextResponse.json({ error: 'Failed to fetch file content' }, { status: 404 });
        }

        // Update cache in database
        if (cachedFile.length > 0) {
            await (db.update(files) as any)
                .set({ content })
                .where(eq(files.id, cachedFile[0].id));
        }

        return NextResponse.json({
            path: filePath,
            content,
            language: cachedFile[0]?.language || 'plaintext',
            cached: false,
        }, {
            headers: {
                'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800', // Cache for CDN
            },
        });
    } catch (error) {
        console.error('Error fetching file content:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch file content' },
            { status: 500 }
        );
    }
}
