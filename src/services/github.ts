/**
 * GitHub API service for fetching repository data
 * Uses the public GitHub API (no auth required for public repos)
 */

import { cache } from './cache';
import { CACHE_TIER, GITHUB, TIMEOUTS } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { getPlatformEnv } from '@/lib/platform/context';

const githubLogger = logger.child({ service: 'github' });

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = TIMEOUTS.GITHUB_API): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        return response;
    } finally {
        clearTimeout(timeoutId);
    }
}

export interface GitHubRepo {
    owner: string;
    name: string;
    description: string | null;
    stars: number;
    defaultBranch: string;
    url: string;
    size: number;
}

export interface GitHubCommit {
    sha: string;
    message: string;
    authorName: string | null;
    authorEmail: string | null;
    date: Date;
}

interface GitHubCommitApiItem {
    sha: string;
    commit: {
        message: string;
        author?: { name?: string; email?: string; date?: string };
        committer?: { date?: string };
    };
}

export interface GitHubFile {
    path: string;
    type: 'file' | 'dir';
    size: number;
    sha: string;
}

export interface GitHubCommitFileDiff {
    path: string;
    previousPath: string | null;
    status: 'added' | 'removed' | 'modified' | 'renamed' | string;
    additions: number;
    deletions: number;
    changes: number;
    patch: string | null;
}

export interface GitHubCompareDiff {
    status: string;
    aheadBy: number;
    behindBy: number;
    totalCommits: number;
    files: GitHubCommitFileDiff[];
}

// Helper to get headers. Includes GITHUB_TOKEN if available to raise rate limits
// from 60/hr (unauthenticated) to 5000/hr. All repos fetched here are public.
function getGitHubHeaders(accept = 'application/vnd.github.v3+json') {
    const headers: Record<string, string> = {
        'Accept': accept,
        'User-Agent': 'Grepbase',
    };

    // Try process.env first (local dev / build time)
    let token = process.env.GITHUB_TOKEN;

    // Try platform env (runtime)
    if (!token) {
        try {
            const platform = getPlatformEnv();
            token = platform.getSecret('GITHUB_TOKEN');
        } catch {
            githubLogger.debug('Not in request context, cannot get GITHUB_TOKEN from platform');
        }
    }

    if (token) {
        headers['Authorization'] = `token ${token}`;
    }

    return headers;
}

function encodeRepoComponent(value: string): string {
    return encodeURIComponent(value);
}

/**
 * Throw a human-readable error for non-OK GitHub API responses.
 * Surfaces rate-limit resets and distinguishes 404 vs auth vs server errors.
 */
function throwGitHubError(response: Response, context: string): never {
    if (response.status === 429 || response.status === 403) {
        const resetAt = response.headers.get('x-ratelimit-reset');
        const remaining = response.headers.get('x-ratelimit-remaining');
        if (remaining === '0' || response.status === 429) {
            const resetMsg = resetAt
                ? ` Resets at ${new Date(Number(resetAt) * 1000).toISOString()}.`
                : '';
            throw new Error(`GitHub API rate limit exceeded.${resetMsg} Consider providing a GITHUB_TOKEN.`);
        }
    }
    if (response.status === 404) {
        throw new Error(`${context}: not found or not publicly accessible`);
    }
    throw new Error(`${context}: ${response.status} ${response.statusText}`);
}

function buildRepoApiBase(owner: string, repo: string): string {
    return `${GITHUB.API_BASE}/repos/${encodeRepoComponent(owner)}/${encodeRepoComponent(repo)}`;
}

function encodeGitHubPath(path: string): string {
    return path
        .replace(/^\/+/, '')
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .map((segment) => segment.replace(/\./g, '%2E'))
        .join('/');
}

export async function ensureRepositoryIsPublic(owner: string, repo: string): Promise<void> {
    const response = await fetchWithTimeout(buildRepoApiBase(owner, repo), {
        headers: getGitHubHeaders(),
    });

    if (!response.ok) {
        throwGitHubError(response, 'Repository not found or not publicly accessible');
    }

    const data = await response.json() as { private?: boolean };
    if (data.private) {
        throw new Error('Private repositories are not supported through public ingestion');
    }
}

/**
 * Fetch repository metadata
 */
export async function fetchRepository(owner: string, repo: string): Promise<GitHubRepo> {
    const cacheKey = `repo:${owner}:${repo}`;
    const cached = await cache.get<GitHubRepo>(cacheKey);
    if (cached) {
        githubLogger.debug({ owner, repo }, 'Repository fetched from cache');
        return cached;
    }

    githubLogger.info({ owner, repo }, 'Fetching repository from GitHub API');

    const response = await fetchWithTimeout(buildRepoApiBase(owner, repo), {
        headers: getGitHubHeaders(),
    });

    if (!response.ok) {
        githubLogger.error({ owner, repo, status: response.status }, 'Failed to fetch repository');
        throwGitHubError(response, 'Failed to fetch repository');
    }

    const data = await response.json() as {
        owner: { login: string };
        name: string;
        description: string | null;
        stargazers_count: number;
        default_branch: string;
        html_url: string;
        size: number;
    };

    const result = {
        owner: data.owner.login,
        name: data.name,
        description: data.description,
        stars: data.stargazers_count,
        defaultBranch: data.default_branch,
        url: data.html_url,
        size: data.size,
    };

    await cache.set(cacheKey, result, CACHE_TIER.MEDIUM);
    githubLogger.debug({ owner, repo }, 'Repository cached');
    return result;
}

/**
 * Fetch README content
 */
export async function fetchReadme(owner: string, repo: string): Promise<string | null> {
    try {
        const response = await fetchWithTimeout(`${buildRepoApiBase(owner, repo)}/readme`, {
            headers: getGitHubHeaders('application/vnd.github.v3.raw'),
        });

        if (!response.ok) {
            githubLogger.debug({ owner, repo }, 'README not found');
            return null;
        }
        return await response.text();
    } catch (error) {
        githubLogger.warn({ owner, repo, error }, 'Error fetching README');
        return null;
    }
}

/**
 * Fetch a single page of commits for a repository (newest first)
 */
export async function fetchCommitHistoryPage(
    owner: string,
    repo: string,
    page: number,
    perPage: number = GITHUB.MAX_COMMITS_PER_REQUEST,
    branch?: string
): Promise<GitHubCommit[]> {
    const safePage = Math.max(1, page);
    const safePerPage = Math.min(
        GITHUB.MAX_COMMITS_PER_REQUEST,
        Math.max(1, perPage)
    );
    const cacheKey = `commits-page:${owner}:${repo}:${safePage}:${safePerPage}${branch ? `:${branch}` : ''}`;
    const cached = await cache.get<GitHubCommit[]>(cacheKey);
    if (cached) return cached;

    const commitsUrl = new URL(`${buildRepoApiBase(owner, repo)}/commits`);
    commitsUrl.searchParams.set('per_page', String(safePerPage));
    commitsUrl.searchParams.set('page', String(safePage));
    if (branch) {
        commitsUrl.searchParams.set('sha', branch);
    }

    const response = await fetchWithTimeout(commitsUrl.toString(), {
        headers: getGitHubHeaders(),
    });

    if (!response.ok) {
        githubLogger.error({ owner, repo, status: response.status, page: safePage }, 'Failed to fetch commits');
        throwGitHubError(response, 'Failed to fetch commits');
    }

    const data = await response.json() as GitHubCommitApiItem[];
    const commits = data.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message,
        authorName: commit.commit.author?.name || null,
        authorEmail: commit.commit.author?.email || null,
        date: new Date(commit.commit.author?.date || commit.commit.committer?.date || new Date()),
    }));

    await cache.set(cacheKey, commits, CACHE_TIER.FAST);
    return commits;
}

/**
 * Fetch the list of branches for a repository, along with the default branch name.
 */
export async function fetchRepoBranches(
    owner: string,
    repo: string
): Promise<{ branches: string[]; defaultBranch: string }> {
    const cacheKey = `branches:${owner}:${repo}`;
    const cached = await cache.get<{ branches: string[]; defaultBranch: string }>(cacheKey);
    if (cached) return cached;

    const [repoDetails, branchData] = await Promise.all([
        fetchRepository(owner, repo),
        (async () => {
            const allBranches: Array<{ name: string }> = [];
            let page = 1;
            
            // Loop up to 10 pages (1000 branches) to prevent infinite loops
            while (page <= 10) {
                const url = new URL(`${buildRepoApiBase(owner, repo)}/branches`);
                url.searchParams.set('per_page', '100');
                url.searchParams.set('page', String(page));
                
                const response = await fetchWithTimeout(url.toString(), { headers: getGitHubHeaders() });
                if (!response.ok) throwGitHubError(response, 'Failed to fetch branches');
                
                const data = await response.json() as Array<{ name: string }>;
                allBranches.push(...data);
                
                if (data.length < 100) break;
                
                // We also check the Link header to be sure there's another page
                const linkHeader = response.headers.get('link');
                if (!linkHeader || !linkHeader.includes('rel="next"')) break;
                
                page++;
            }
            return allBranches;
        })(),
    ]);

    const result = {
        branches: branchData.map((b) => b.name),
        defaultBranch: repoDetails.defaultBranch,
    };

    await cache.set(cacheKey, result, CACHE_TIER.FAST);
    return result;
}

/**
 * Fetch file tree at a specific commit
 */
export async function fetchFilesAtCommit(
    owner: string,
    repo: string,
    sha: string
): Promise<GitHubFile[]> {
    const cacheKey = `files:${owner}:${repo}:${sha}`;
    const cached = await cache.get<GitHubFile[]>(cacheKey);
    if (cached) return cached;

    const treeUrl = new URL(`${buildRepoApiBase(owner, repo)}/git/trees/${encodeURIComponent(sha)}`);
    treeUrl.searchParams.set('recursive', '1');

    const response = await fetchWithTimeout(treeUrl.toString(), {
        headers: getGitHubHeaders(),
    });

    if (!response.ok) {
        throwGitHubError(response, 'Failed to fetch files');
    }

    const data = await response.json() as {
        tree: Array<{ path: string; type: string; size?: number; sha: string }>;
    };

    const result = data.tree
        .filter((item) => item.type === 'blob')
        .map((item) => ({
            path: item.path,
            type: 'file' as const,
            size: item.size || 0,
            sha: item.sha,
        }));

    await cache.set(cacheKey, result, CACHE_TIER.IMMUTABLE); // Immutable by SHA
    return result;
}

/**
 * Fetch content of a specific file at a commit
 */
export async function fetchFileContent(
    owner: string,
    repo: string,
    sha: string,
    path: string
): Promise<string | null> {
    const cacheKey = `content:${owner}:${repo}:${sha}:${path}`;
    const cached = await cache.get<string>(cacheKey);
    if (cached) return cached;

    try {
        const encodedPath = encodeGitHubPath(path);
        const contentUrl = new URL(`${buildRepoApiBase(owner, repo)}/contents/${encodedPath}`);
        contentUrl.searchParams.set('ref', sha);

        const response = await fetchWithTimeout(contentUrl.toString(), {
            headers: getGitHubHeaders('application/vnd.github.v3.raw'),
        });

        if (!response.ok) return null;
        const text = await response.text();
        await cache.set(cacheKey, text, CACHE_TIER.IMMUTABLE);
        return text;
    } catch (error) {
        githubLogger.warn({ owner, repo, sha, path, error }, 'Failed to fetch file content');
        return null;
    }
}

/**
 * Fetch diff between two commits
 */
export async function fetchCommitDiff(
    owner: string,
    repo: string,
    sha: string
): Promise<string | null> {
    const cacheKey = `diff:${owner}:${repo}:${sha}`;
    const cached = await cache.get<string>(cacheKey);
    if (cached) return cached;

    try {
        const response = await fetchWithTimeout(
            `${buildRepoApiBase(owner, repo)}/commits/${encodeURIComponent(sha)}`,
            {
                headers: getGitHubHeaders('application/vnd.github.v3.diff'),
            }
        );

        if (!response.ok) return null;
        const text = await response.text();
        await cache.set(cacheKey, text, CACHE_TIER.IMMUTABLE);
        return text;
    } catch (error) {
        githubLogger.warn({ owner, repo, sha, error }, 'Failed to fetch commit diff');
        return null;
    }
}

/**
 * Fetch per-file diffs for a single commit
 */
export async function fetchCommitFileDiffs(
    owner: string,
    repo: string,
    sha: string
): Promise<GitHubCommitFileDiff[]> {
    const cacheKey = `commit-files-diff:${owner}:${repo}:${sha}`;
    const cached = await cache.get<GitHubCommitFileDiff[]>(cacheKey);
    if (cached) return cached;

    const response = await fetchWithTimeout(
        `${buildRepoApiBase(owner, repo)}/commits/${encodeURIComponent(sha)}`,
        { headers: getGitHubHeaders() }
    );

    if (!response.ok) {
        githubLogger.error({ owner, repo, sha, status: response.status }, 'Failed to fetch commit file diffs');
        throwGitHubError(response, 'Failed to fetch commit file diffs');
    }

    const data = await response.json() as {
        files?: Array<{
            filename: string;
            previous_filename?: string;
            status: string;
            additions: number;
            deletions: number;
            changes: number;
            patch?: string;
        }>;
    };

    const files = (data.files || []).map(file => ({
        path: file.filename,
        previousPath: file.previous_filename || null,
        status: file.status,
        additions: file.additions || 0,
        deletions: file.deletions || 0,
        changes: file.changes || 0,
        patch: file.patch || null,
    }));

    await cache.set(cacheKey, files, CACHE_TIER.IMMUTABLE);
    return files;
}

/**
 * Fetch file-level compare data between two commits
 */
export async function fetchCompareDiff(
    owner: string,
    repo: string,
    baseSha: string,
    headSha: string
): Promise<GitHubCompareDiff> {
    const cacheKey = `compare:${owner}:${repo}:${baseSha}:${headSha}`;
    const cached = await cache.get<GitHubCompareDiff>(cacheKey);
    if (cached) return cached;

    const response = await fetchWithTimeout(
        `${buildRepoApiBase(owner, repo)}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
        { headers: getGitHubHeaders() }
    );

    if (!response.ok) {
        githubLogger.error(
            { owner, repo, baseSha, headSha, status: response.status },
            'Failed to fetch compare diff'
        );
        throwGitHubError(response, 'Failed to fetch compare diff');
    }

    const data = await response.json() as {
        status?: string;
        ahead_by?: number;
        behind_by?: number;
        total_commits?: number;
        files?: Array<{
            filename: string;
            previous_filename?: string;
            status: string;
            additions: number;
            deletions: number;
            changes: number;
            patch?: string;
        }>;
    };

    const result: GitHubCompareDiff = {
        status: data.status || 'unknown',
        aheadBy: data.ahead_by || 0,
        behindBy: data.behind_by || 0,
        totalCommits: data.total_commits || 0,
        files: (data.files || []).map(file => ({
            path: file.filename,
            previousPath: file.previous_filename || null,
            status: file.status,
            additions: file.additions || 0,
            deletions: file.deletions || 0,
            changes: file.changes || 0,
            patch: file.patch || null,
        })),
    };

    await cache.set(cacheKey, result, CACHE_TIER.IMMUTABLE);
    return result;
}

/**
 * Get language for a file based on extension
 */
export function getLanguageFromPath(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
        'js': 'javascript',
        'jsx': 'jsx',
        'ts': 'typescript',
        'tsx': 'tsx',
        'py': 'python',
        'rs': 'rust',
        'go': 'go',
        'java': 'java',
        'cpp': 'cpp',
        'c': 'c',
        'h': 'c',
        'hpp': 'cpp',
        'rb': 'ruby',
        'php': 'php',
        'swift': 'swift',
        'kt': 'kotlin',
        'md': 'markdown',
        'json': 'json',
        'yaml': 'yaml',
        'yml': 'yaml',
        'toml': 'toml',
        'css': 'css',
        'scss': 'scss',
        'html': 'html',
        'xml': 'xml',
        'sql': 'sql',
        'sh': 'bash',
        'bash': 'bash',
        'zsh': 'bash',
    };
    return langMap[ext] || 'plaintext';
}
