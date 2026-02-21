/**
 * Input sanitization utilities
 */

/**
 * Sanitize GitHub URL to prevent injection attacks
 */
export function sanitizeGitHubUrl(url: string): string {
    try {
        const parsed = new URL(url);

        // Only allow github.com
        if (parsed.hostname !== 'github.com') {
            throw new Error('Only GitHub URLs are allowed');
        }

        // Only allow HTTPS
        if (parsed.protocol !== 'https:') {
            parsed.protocol = 'https:';
        }

        // Remove any query params or fragments
        parsed.search = '';
        parsed.hash = '';

        return parsed.toString();
    } catch {
        throw new Error('Invalid GitHub URL');
    }
}

/**
 * Extract owner and repo from GitHub URL
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } {
    const sanitizedUrl = sanitizeGitHubUrl(url);
    const parsed = new URL(sanitizedUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);

    if (parts.length < 2) {
        throw new Error('Invalid GitHub repository URL');
    }

    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, '');

    // Validate owner and repo names (GitHub username/repo rules)
    // Allow dots in repo names (e.g., next.js)
    const validNameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

    if (!validNameRegex.test(owner)) {
        throw new Error('Invalid repository owner name');
    }

    if (!validNameRegex.test(repo)) {
        throw new Error('Invalid repository name');
    }

    return { owner, repo };
}

/**
 * Sanitize commit SHA to prevent injection
 */
export function sanitizeCommitSha(sha: string): string {
    // Git SHAs are 40 character hexadecimal strings
    const shaRegex = /^[a-f0-9]{7,40}$/i;

    if (!shaRegex.test(sha)) {
        throw new Error('Invalid commit SHA format');
    }

    return sha.toLowerCase();
}

/**
 * Sanitize branch name
 */
export function sanitizeBranchName(branch: string): string {
    // Git branch naming rules
    const branchRegex = /^[a-zA-Z0-9._/-]+$/;

    if (!branchRegex.test(branch)) {
        throw new Error('Invalid branch name');
    }

    // Additional checks
    if (branch.startsWith('.') || branch.endsWith('.') || branch.includes('..')) {
        throw new Error('Invalid branch name format');
    }

    return branch;
}

/**
 * Sanitize file path to prevent directory traversal
 */
export function sanitizeFilePath(path: string): string {
    // Remove any directory traversal attempts
    if (path.includes('..') || path.startsWith('/')) {
        throw new Error('Invalid file path');
    }

    // Only allow alphanumeric, dash, underscore, dot, and forward slash
    const pathRegex = /^[a-zA-Z0-9._/-]+$/;

    if (!pathRegex.test(path)) {
        throw new Error('Invalid file path format');
    }

    return path;
}
