import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { files } from '@/db';
import { shouldFetchFileContent } from '@/lib/constants';
import type { Database } from '@/db';

export function getClientIdFromHeaders(req: NextRequest): string {
    const cfConnectingIp = req.headers.get('cf-connecting-ip');
    if (cfConnectingIp) return cfConnectingIp;

    const xForwardedFor = req.headers.get('x-forwarded-for');
    if (xForwardedFor) return xForwardedFor.split(',')[0].trim();

    const xRealIp = req.headers.get('x-real-ip');
    if (xRealIp) return xRealIp;

    return 'unknown';
}

export function normalizePath(path: string): string {
    return path.trim().replace(/^\/+/, '').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

export function isOpenableFilePath(path: string, size: number, hasContent: boolean): boolean {
    if (hasContent) return true;
    return shouldFetchFileContent(path, size);
}

export async function resolveAvailableFilePathsForCommit(
    db: Database,
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

    const commitFiles = await db.select({
        path: files.path,
        size: files.size,
        content: files.content,
    })
        .from(files)
        .where(eq(files.commitId, commitId));

    return commitFiles
        .filter((file: { path: string; size: number | null; content: string | null }) =>
            isOpenableFilePath(file.path, Number(file.size || 0), Boolean(file.content))
        )
        .map((file: { path: string }) => normalizePath(file.path));
}
