/**
 * GitHub API service for fetching repository data
 * Uses the public GitHub API (no auth required for public repos)
 */

import { cache } from './cache';
import { CACHE_TTL, GITHUB } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { getPlatformEnv } from '@/lib/platform/context';

const githubLogger = logger.child({ service: 'github' });

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

// Helper to get headers. Auth headers are opt-in and should never be enabled for
// unauthenticated user-provided repository fetches.
function getGitHubHeaders(accept = 'application/vnd.github.v3+json', includeServerToken = false) {
    const headers: Record<string, string> = {
        'Accept': accept,
        'User-Agent': 'Grepbase',
    };

    if (!includeServerToken) {
        return headers;
    }

    // Try process.env first (local dev / build time)
    let token = process.env.GITHUB_TOKEN;

    // Try platform env (runtime)
    if (!token) {
        try {
            const platform = getPlatformEnv();
            token = platform.getSecret('GITHUB_TOKEN');
        } catch {
            // Not in request context
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
    const response = await fetch(buildRepoApiBase(owner, repo), {
        headers: getGitHubHeaders(),
    });

    if (response.status === 404) {
        throw new Error('Repository not found or not publicly accessible');
    }

    if (!response.ok) {
        throw new Error(`Failed to validate repository visibility: ${response.status} ${response.statusText}`);
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

    const response = await fetch(buildRepoApiBase(owner, repo), {
        headers: getGitHubHeaders(),
    });

    if (!response.ok) {
        githubLogger.error({ owner, repo, status: response.status }, 'Failed to fetch repository');
        throw new Error(`Failed to fetch repository: ${response.status} ${response.statusText}`);
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

    await cache.set(cacheKey, result, CACHE_TTL.HOUR);
    githubLogger.debug({ owner, repo }, 'Repository cached');
    return result;
}

/**
 * Fetch README content
 */
export async function fetchReadme(owner: string, repo: string): Promise<string | null> {
    try {
        const response = await fetch(`${buildRepoApiBase(owner, repo)}/readme`, {
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
 * Fetch all commits for a repository (paginated, oldest first)
 */
export async function fetchCommitHistory(
    owner: string,
    repo: string,
    maxCommits: number = GITHUB.MAX_COMMITS_PER_REPO
): Promise<GitHubCommit[]> {
    const cacheKey = `commits:${owner}:${repo}:${maxCommits}`;
    const cached = await cache.get<GitHubCommit[]>(cacheKey);
    if (cached) return cached;

    const allCommits: GitHubCommit[] = [];
    let page = 1;
    const cappedMax = Math.max(1, maxCommits);
    const perPage = GITHUB.MAX_COMMITS_PER_REQUEST;

    while (allCommits.length < cappedMax) {
        const remaining = cappedMax - allCommits.length;
        const pageSize = Math.min(perPage, remaining);
        const data = await fetchCommitHistoryPage(owner, repo, page, pageSize);
        if (data.length === 0) break;

        allCommits.push(...data);

        if (data.length < pageSize) break;
        page++;
    }

    // Reverse to get oldest first (chronological order)
    const result = allCommits.reverse().slice(0, cappedMax);
    await cache.set(cacheKey, result, CACHE_TTL.MINUTE * 5);
    return result;
}

/**
 * Fetch a single page of commits for a repository (newest first)
 */
export async function fetchCommitHistoryPage(
    owner: string,
    repo: string,
    page: number,
    perPage: number = GITHUB.MAX_COMMITS_PER_REQUEST
): Promise<GitHubCommit[]> {
    const safePage = Math.max(1, page);
    const safePerPage = Math.min(
        GITHUB.MAX_COMMITS_PER_REQUEST,
        Math.max(1, perPage)
    );
    const cacheKey = `commits-page:${owner}:${repo}:${safePage}:${safePerPage}`;
    const cached = await cache.get<GitHubCommit[]>(cacheKey);
    if (cached) return cached;

    const commitsUrl = new URL(`${buildRepoApiBase(owner, repo)}/commits`);
    commitsUrl.searchParams.set('per_page', String(safePerPage));
    commitsUrl.searchParams.set('page', String(safePage));

    const response = await fetch(commitsUrl.toString(), {
        headers: getGitHubHeaders(),
    });

    if (!response.ok) {
        githubLogger.error({ owner, repo, status: response.status, page: safePage }, 'Failed to fetch commits');
        throw new Error(`Failed to fetch commits: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as GitHubCommitApiItem[];
    const commits = data.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message,
        authorName: commit.commit.author?.name || null,
        authorEmail: commit.commit.author?.email || null,
        date: new Date(commit.commit.author?.date || commit.commit.committer?.date || new Date()),
    }));

    await cache.set(cacheKey, commits, CACHE_TTL.MINUTE * 5);
    return commits;
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

    const response = await fetch(treeUrl.toString(), {
        headers: getGitHubHeaders(),
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch files: ${response.status} ${response.statusText}`);
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

    await cache.set(cacheKey, result, CACHE_TTL.WEEK); // Immutable by SHA
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

        const response = await fetch(contentUrl.toString(), {
            headers: getGitHubHeaders('application/vnd.github.v3.raw'),
        });

        if (!response.ok) return null;
        const text = await response.text();
        await cache.set(cacheKey, text, CACHE_TTL.WEEK);
        return text;
    } catch {
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
        const response = await fetch(
            `${buildRepoApiBase(owner, repo)}/commits/${encodeURIComponent(sha)}`,
            {
                headers: getGitHubHeaders('application/vnd.github.v3.diff'),
            }
        );

        if (!response.ok) return null;
        const text = await response.text();
        await cache.set(cacheKey, text, CACHE_TTL.WEEK);
        return text;
    } catch {
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

    const response = await fetch(
        `${buildRepoApiBase(owner, repo)}/commits/${encodeURIComponent(sha)}`,
        { headers: getGitHubHeaders() }
    );

    if (!response.ok) {
        githubLogger.error({ owner, repo, sha, status: response.status }, 'Failed to fetch commit file diffs');
        throw new Error(`Failed to fetch commit file diffs: ${response.status} ${response.statusText}`);
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

    await cache.set(cacheKey, files, CACHE_TTL.WEEK);
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

    const response = await fetch(
        `${buildRepoApiBase(owner, repo)}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
        { headers: getGitHubHeaders() }
    );

    if (!response.ok) {
        githubLogger.error(
            { owner, repo, baseSha, headSha, status: response.status },
            'Failed to fetch compare diff'
        );
        throw new Error(`Failed to fetch compare diff: ${response.status} ${response.statusText}`);
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

    await cache.set(cacheKey, result, CACHE_TTL.WEEK);
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
