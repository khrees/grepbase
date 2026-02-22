/**
 * Shared type definitions used across the application
 */

export interface Repository {
    id: number;
    name: string;
    owner: string;
    description: string | null;
    readme: string | null;
}

export interface Commit {
    id: number;
    sha: string;
    message: string;
    authorName: string | null;
    date: string;
    order: number;
}

export interface FileData {
    path: string;
    content: string | null;
    language: string;
    size: number;
    hasContent?: boolean;
    shouldFetchContent?: boolean;
}

export interface RepoData {
    id: number;
    name: string;
    owner: string;
    description: string | null;
    stars: number;
}

export interface DiffFileData {
    path: string;
    previousPath: string | null;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch: string | null;
}

export interface CommitDiffResponse {
    commit: Commit;
    files: DiffFileData[];
    stats: {
        changedFiles: number;
        additions: number;
        deletions: number;
    };
}

export interface CompareDiffResponse {
    baseSha: string;
    headSha: string;
    status: string;
    aheadBy: number;
    behindBy: number;
    totalCommits: number;
    totalFiles: number;
    selectedPath: string | null;
    files: DiffFileData[];
}
