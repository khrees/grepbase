/**
 * Local-First GitHub Client
 * 
 * Returns cached data immediately to users, refreshes in background.
 * Prioritizes perceived speed over freshness.
 */

import { tieredCache, type CacheTier } from '@/lib/cache-tiered';
import { logger } from '@/lib/logger';
import * as github from './github';

const localFirstLogger = logger.child({ service: 'github-local-first' });

export interface LocalFirstRepoResult<T> {
    data: T;
    stale: boolean;
    source: 'cache' | 'shared' | 'fetch';
}

function buildRepoKey(owner: string, repo: string): string {
    return `repo:${owner.toLowerCase()}:${repo.toLowerCase()}`;
}

function buildCommitPageKey(owner: string, repo: string, page: number, perPage: number): string {
    return `commits-page:${owner.toLowerCase()}:${repo.toLowerCase()}:${page}:${perPage}`;
}

function buildFilesKey(owner: string, repo: string, sha: string): string {
    return `files:${owner.toLowerCase()}:${repo.toLowerCase()}:${sha}`;
}

function buildContentKey(owner: string, repo: string, sha: string, path: string): string {
    return `content:${owner.toLowerCase()}:${repo.toLowerCase()}:${sha}:${encodeURIComponent(path)}`;
}

function buildReadmeKey(owner: string, repo: string): string {
    return `readme:${owner.toLowerCase()}:${repo.toLowerCase()}`;
}

function buildDiffKey(owner: string, repo: string, sha: string): string {
    return `diff:${owner.toLowerCase()}:${repo.toLowerCase()}:${sha}`;
}

async function backgroundRefresh<T>(
    key: string,
    tier: CacheTier,
    fetcher: () => Promise<T>
): Promise<void> {
    try {
        const fresh = await fetcher();
        await tieredCache.set(key, fresh, tier);
        await tieredCache.setShared(key, fresh, tier);
        localFirstLogger.debug({ key }, 'Background refresh completed');
    } catch (error) {
        localFirstLogger.warn({ key, error }, 'Background refresh failed');
    }
}

export async function getRepo(owner: string, repo: string): Promise<LocalFirstRepoResult<github.GitHubRepo>> {
    const key = buildRepoKey(owner, repo);

    const cached = await tieredCache.get<github.GitHubRepo>(key, 'slow');
    if (cached) {
        return { data: cached, stale: false, source: 'cache' };
    }

    const shared = await tieredCache.getShared<github.GitHubRepo>(key);
    if (shared) {
        return { data: shared, stale: false, source: 'shared' };
    }

    try {
        const fresh = await github.fetchRepository(owner, repo);
        await tieredCache.set(key, fresh, 'slow');
        await tieredCache.setShared(key, fresh, 'slow');
        return { data: fresh, stale: false, source: 'fetch' };
    } catch (error) {
        localFirstLogger.warn({ owner, repo, error }, 'Failed to fetch repo');
        return { 
            data: { owner, name: repo, description: null, stars: 0, defaultBranch: 'main', url: `https://github.com/${owner}/${repo}`, size: 0 }, 
            stale: true, 
            source: 'fetch' 
        };
    }
}

export async function getCommitsPage(
    owner: string,
    repo: string,
    page: number,
    perPage: number
): Promise<LocalFirstRepoResult<github.GitHubCommit[]>> {
    const key = buildCommitPageKey(owner, repo, page, perPage);

    const cached = await tieredCache.get<github.GitHubCommit[]>(key, 'medium');
    if (cached) {
        return { data: cached, stale: false, source: 'cache' };
    }

    const shared = await tieredCache.getShared<github.GitHubCommit[]>(key);
    if (shared) {
        return { data: shared, stale: false, source: 'shared' };
    }

    try {
        const fresh = await github.fetchCommitHistoryPage(owner, repo, page, perPage);
        await tieredCache.set(key, fresh, 'medium');
        await tieredCache.setShared(key, fresh, 'medium');
        
        void backgroundRefresh(key, 'medium', () => github.fetchCommitHistoryPage(owner, repo, page, perPage));
        
        return { data: fresh, stale: false, source: 'fetch' };
    } catch (error) {
        localFirstLogger.warn({ owner, repo, page, perPage, error }, 'Failed to fetch commits');
        return { data: [], stale: true, source: 'fetch' };
    }
}

export async function getFilesAtCommit(
    owner: string,
    repo: string,
    sha: string
): Promise<LocalFirstRepoResult<github.GitHubFile[]>> {
    const key = buildFilesKey(owner, repo, sha);

    const cached = await tieredCache.get<github.GitHubFile[]>(key, 'medium');
    if (cached) {
        return { data: cached, stale: false, source: 'cache' };
    }

    const shared = await tieredCache.getShared<github.GitHubFile[]>(key);
    if (shared) {
        return { data: shared, stale: false, source: 'shared' };
    }

    try {
        const fresh = await github.fetchFilesAtCommit(owner, repo, sha);
        await tieredCache.set(key, fresh, 'medium');
        await tieredCache.setShared(key, fresh, 'medium');
        return { data: fresh, stale: false, source: 'fetch' };
    } catch (error) {
        localFirstLogger.warn({ owner, repo, sha, error }, 'Failed to fetch files');
        return { data: [], stale: true, source: 'fetch' };
    }
}

export async function getFileContent(
    owner: string,
    repo: string,
    sha: string,
    path: string
): Promise<LocalFirstRepoResult<string | null>> {
    const key = buildContentKey(owner, repo, sha, path);

    const cached = await tieredCache.get<string | null>(key, 'immutable');
    if (cached !== null) {
        return { data: cached, stale: false, source: 'cache' };
    }

    try {
        const fresh = await github.fetchFileContent(owner, repo, sha, path);
        if (fresh !== null) {
            await tieredCache.set(key, fresh, 'immutable');
            await tieredCache.setShared(key, fresh, 'immutable');
        }
        return { data: fresh, stale: false, source: 'fetch' };
    } catch (error) {
        localFirstLogger.warn({ owner, repo, sha, path, error }, 'Failed to fetch file content');
        return { data: null, stale: true, source: 'fetch' };
    }
}

export async function getReadme(owner: string, repo: string): Promise<LocalFirstRepoResult<string | null>> {
    const key = buildReadmeKey(owner, repo);

    const cached = await tieredCache.get<string | null>(key, 'fast');
    if (cached !== null) {
        return { data: cached, stale: false, source: 'cache' };
    }

    const shared = await tieredCache.getShared<string | null>(key);
    if (shared !== null) {
        return { data: shared, stale: false, source: 'shared' };
    }

    try {
        const fresh = await github.fetchReadme(owner, repo);
        await tieredCache.set(key, fresh, 'fast');
        await tieredCache.setShared(key, fresh, 'fast');
        
        void backgroundRefresh(key, 'fast', () => github.fetchReadme(owner, repo));
        
        return { data: fresh, stale: false, source: 'fetch' };
    } catch (error) {
        localFirstLogger.warn({ owner, repo, error }, 'Failed to fetch readme');
        return { data: null, stale: true, source: 'fetch' };
    }
}

export async function getCommitDiff(
    owner: string,
    repo: string,
    sha: string
): Promise<LocalFirstRepoResult<string | null>> {
    const key = buildDiffKey(owner, repo, sha);

    const cached = await tieredCache.get<string | null>(key, 'immutable');
    if (cached !== null) {
        return { data: cached, stale: false, source: 'cache' };
    }

    try {
        const fresh = await github.fetchCommitDiff(owner, repo, sha);
        if (fresh !== null) {
            await tieredCache.set(key, fresh, 'immutable');
            await tieredCache.setShared(key, fresh, 'immutable');
        }
        return { data: fresh, stale: false, source: 'fetch' };
    } catch (error) {
        localFirstLogger.warn({ owner, repo, sha, error }, 'Failed to fetch commit diff');
        return { data: null, stale: true, source: 'fetch' };
    }
}

export async function getCompareDiff(
    owner: string,
    repo: string,
    baseSha: string,
    headSha: string
): Promise<LocalFirstRepoResult<github.GitHubCompareDiff>> {
    const key = `compare:${owner.toLowerCase()}:${repo.toLowerCase()}:${baseSha}:${headSha}`;

    const cached = await tieredCache.get<github.GitHubCompareDiff>(key, 'medium');
    if (cached) {
        return { data: cached, stale: false, source: 'cache' };
    }

    const shared = await tieredCache.getShared<github.GitHubCompareDiff>(key);
    if (shared) {
        return { data: shared, stale: false, source: 'shared' };
    }

    try {
        const fresh = await github.fetchCompareDiff(owner, repo, baseSha, headSha);
        await tieredCache.set(key, fresh, 'medium');
        await tieredCache.setShared(key, fresh, 'medium');
        return { data: fresh, stale: false, source: 'fetch' };
    } catch (error) {
        localFirstLogger.warn({ owner, repo, baseSha, headSha, error }, 'Failed to fetch compare diff');
        return { 
            data: { status: 'unknown', aheadBy: 0, behindBy: 0, totalCommits: 0, files: [] }, 
            stale: true, 
            source: 'fetch' 
        };
    }
}

export async function getCommitFileDiffs(
    owner: string,
    repo: string,
    sha: string
): Promise<LocalFirstRepoResult<github.GitHubCommitFileDiff[]>> {
    const key = `commit-files-diff:${owner.toLowerCase()}:${repo.toLowerCase()}:${sha}`;

    const cached = await tieredCache.get<github.GitHubCommitFileDiff[]>(key, 'medium');
    if (cached) {
        return { data: cached, stale: false, source: 'cache' };
    }

    const shared = await tieredCache.getShared<github.GitHubCommitFileDiff[]>(key);
    if (shared) {
        return { data: shared, stale: false, source: 'shared' };
    }

    try {
        const fresh = await github.fetchCommitFileDiffs(owner, repo, sha);
        await tieredCache.set(key, fresh, 'medium');
        await tieredCache.setShared(key, fresh, 'medium');
        return { data: fresh, stale: false, source: 'fetch' };
    } catch (error) {
        localFirstLogger.warn({ owner, repo, sha, error }, 'Failed to fetch commit file diffs');
        return { data: [], stale: true, source: 'fetch' };
    }
}