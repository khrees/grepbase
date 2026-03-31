/**
 * Canonical query key factory for TanStack Query.
 *
 * Staleness strategy:
 *  - SHA-scoped resource keys (files, content, diffs): staleTime: Infinity
 *    because content addressed by a git SHA is immutable.
 *  - List / status queries: finite stale windows (see QueryProvider defaults).
 *  - Job-status keys: excluded from session persistence (volatile).
 */

export const queryKeys = {
    /**
     * All keys prefixed with 'repos'
     */
    repos: {
        all: ['repos'] as const,

        /** Mutable list of ingested repositories */
        list: () => ['repos', 'list'] as const,

        /** Paginated commits for a repository (used by infinite query) */
        commits: (repoId: string | number) =>
            ['repos', String(repoId), 'commits'] as const,

        /** Files at a specific commit SHA – immutable */
        commitFiles: (repoId: string | number, sha: string) =>
            ['repos', String(repoId), 'commits', sha, 'files'] as const,

        /** Single file content at a specific commit SHA – immutable */
        fileContent: (repoId: string | number, sha: string, path: string) =>
            ['repos', String(repoId), 'commits', sha, 'content', path] as const,

        /** Per-file diffs for a commit SHA – immutable */
        commitDiff: (repoId: string | number, sha: string) =>
            ['repos', String(repoId), 'commits', sha, 'diff'] as const,

        /** File-level diff between two SHAs – immutable */
        compareDiff: (repoId: string | number, baseSha: string, headSha: string) =>
            ['repos', String(repoId), 'compare', baseSha, headSha] as const,
    },

    /**
     * All keys prefixed with 'jobs'.
     * These are EXCLUDED from session persistence because job status is volatile.
     */
    jobs: {
        all: ['jobs'] as const,
        status: (jobId: string) => ['jobs', 'status', jobId] as const,
    },
} as const;
