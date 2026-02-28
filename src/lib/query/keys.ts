export const queryKeys = {
    reposRoot: ['repos'] as const,
    reposList: (page: number, limit: number) => ['repos', 'list', page, limit] as const,
    repoCommitsRoot: (repoId: string) => ['repo-commits', repoId] as const,
    repoCommits: (repoId: string, page: number, limit: number) =>
        ['repo-commits', repoId, page, limit] as const,
    commitFiles: (repoId: string, sha: string) => ['commit-files', repoId, sha] as const,
    fileContent: (repoId: string, sha: string, path: string) =>
        ['file-content', repoId, sha, path] as const,
    commitDiff: (repoId: string, sha: string) => ['commit-diff', repoId, sha] as const,
    compareDiff: (repoId: string, baseSha: string, headSha: string) =>
        ['compare-diff', repoId, baseSha, headSha] as const,
    jobStatus: (jobId: string) => ['job-status', jobId] as const,
    aiCredentials: ['ai-credentials'] as const,
} as const;

export const JOB_STATUS_QUERY_ROOT = 'job-status';
