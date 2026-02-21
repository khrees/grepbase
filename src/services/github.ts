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
}

export interface GitHubCommit {
    sha: string;
    message: string;
    authorName: string | null;
    authorEmail: string | null;
    date: Date;
}

export interface GitHubFile {
    path: string;
    type: 'file' | 'dir';
    size: number;
    sha: string;
}

// Helper to get headers with auth if available
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
            // Not in request context
        }
    }

    if (token) {
        headers['Authorization'] = `token ${token}`;
    }

    return headers;
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

    const response = await fetch(`${GITHUB.API_BASE}/repos/${owner}/${repo}`, {
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
    };

    const result = {
        owner: data.owner.login,
        name: data.name,
        description: data.description,
        stars: data.stargazers_count,
        defaultBranch: data.default_branch,
        url: data.html_url,
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
        const response = await fetch(`${GITHUB.API_BASE}/repos/${owner}/${repo}/readme`, {
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
    maxCommits: number = 100
): Promise<GitHubCommit[]> {
    const cacheKey = `commits:${owner}:${repo}:${maxCommits}`;
    const cached = await cache.get<GitHubCommit[]>(cacheKey);
    if (cached) return cached;

    const allCommits: GitHubCommit[] = [];
    let page = 1;
    const perPage = Math.min(100, maxCommits);

    while (allCommits.length < maxCommits) {
        const response = await fetch(
            `${GITHUB.API_BASE}/repos/${owner}/${repo}/commits?per_page=${perPage}&page=${page}`,
            {
                headers: getGitHubHeaders(),
            }
        );

        if (!response.ok) {
            githubLogger.error({ owner, repo, status: response.status, page }, 'Failed to fetch commits');
            throw new Error(`Failed to fetch commits: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as Array<{
            sha: string;
            commit: {
                message: string;
                author?: { name?: string; email?: string; date?: string };
                committer?: { date?: string };
            };
        }>;
        if (data.length === 0) break;

        for (const commit of data) {
            allCommits.push({
                sha: commit.sha,
                message: commit.commit.message,
                authorName: commit.commit.author?.name || null,
                authorEmail: commit.commit.author?.email || null,
                date: new Date(commit.commit.author?.date || commit.commit.committer?.date || new Date()),
            });
        }

        if (data.length < perPage) break;
        page++;
    }

    // Reverse to get oldest first (chronological order)
    const result = allCommits.reverse().slice(0, maxCommits);
    await cache.set(cacheKey, result, CACHE_TTL.MINUTE * 5);
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

    const response = await fetch(
        `${GITHUB.API_BASE}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
        {
            headers: getGitHubHeaders(),
        }
    );

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
        const response = await fetch(
            `${GITHUB.API_BASE}/repos/${owner}/${repo}/contents/${path}?ref=${sha}`,
            {
                headers: getGitHubHeaders('application/vnd.github.v3.raw'),
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
            `${GITHUB.API_BASE}/repos/${owner}/${repo}/commits/${sha}`,
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
