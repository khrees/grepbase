import { NextRequest, NextResponse } from 'next/server';
import { repositories, commits, files } from '@/db';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/db';
import { fetchFilesAtCommit, getLanguageFromPath } from '@/services/github';
import { shouldFetchFileContent } from '@/lib/constants';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; sha: string }> }
) {
    const db = getDb();

    try {
        const { id, sha } = await params;
        const repoId = parseInt(id, 10);

        if (isNaN(repoId)) {
            return NextResponse.json({ error: 'Invalid repository ID' }, { status: 400 });
        }

        // Get repo and commit info
        const repo = await db.select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
        }

        const commit = await db.select()
            .from(commits)
            .where(and(eq(commits.repoId, repoId), eq(commits.sha, sha)))
            .limit(1);

        if (commit.length === 0) {
            return NextResponse.json({ error: 'Commit not found' }, { status: 404 });
        }

        // Check if we have cached files for this commit
        const cachedFiles = await db.select({
            id: files.id,
            path: files.path,
            size: files.size,
            language: files.language,
            hasContent: files.content,
        })
            .from(files)
            .where(eq(files.commitId, commit[0].id));

        if (cachedFiles.length > 0) {
            // Return metadata only (no content) to prevent stack overflow
            const fileList = cachedFiles.map((f) => ({
                id: f.id,
                path: f.path,
                size: f.size,
                language: f.language,
                hasContent: !!f.hasContent,
                shouldFetchContent: shouldFetchFileContent(f.path, Number(f.size || 0)),
            }));

            return NextResponse.json({
                commit: commit[0],
                files: fileList,
                cached: true,
            }, {
                headers: {
                    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400', // Cache for CDN
                },
            });
        }

        // Fetch files from GitHub
        const { owner, name } = repo[0];
        const githubFiles = await fetchFilesAtCommit(owner, name, sha);

        // Filter to code files - but don't fetch content yet (lazy loading)
        const filesToSave = [];
        for (const file of githubFiles) {
            filesToSave.push({
                commitId: commit[0].id,
                path: file.path,
                content: null, // Content will be fetched lazily
                size: file.size,
                language: getLanguageFromPath(file.path),
                shouldFetchContent: shouldFetchFileContent(file.path, file.size),
            });
        }

        // Save file metadata to database (without content) in batches
        const dbFiles = filesToSave.map(f => ({
            commitId: f.commitId,
            path: f.path,
            content: null,
            size: f.size,
            language: f.language,
        }));

        if (dbFiles.length > 0) {
            const BATCH_SIZE = 10;
            for (let i = 0; i < dbFiles.length; i += BATCH_SIZE) {
                const batch = dbFiles.slice(i, i + BATCH_SIZE);
                await db.insert(files).values(batch);
            }
        }

        // Return file list with metadata only
        const fileList = filesToSave.map(f => ({
            path: f.path,
            size: f.size,
            language: f.language,
            hasContent: false,
            shouldFetchContent: f.shouldFetchContent,
        }));

        return NextResponse.json({
            commit: commit[0],
            files: fileList,
            cached: false,
        });
    } catch (error) {
        console.error('Error fetching files:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch files' },
            { status: 500 }
        );
    }
}
