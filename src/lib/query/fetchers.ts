import { api } from '@/lib/api-client';
import type {
    Commit,
    CommitDiffResponse,
    CompareDiffResponse,
    FileData,
    RepoData,
    Repository,
} from '@/types';

export interface RepoSummary {
    id: number;
    owner: string;
    name: string;
    description: string | null;
}

export interface PaginatedCommitsResponse {
    repository: Repository;
    commits: Commit[];
    pagination?: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    };
}

export interface RepositoriesListResponse {
    repositories: RepoData[];
    pagination?: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    };
}

export interface StartIngestResponse {
    error?: string;
    repository?: RepoSummary | null;
    jobId?: string;
    cached?: boolean;
    status?: string;
    message?: string;
}

export interface JobStatusResponse {
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | string;
    progress: number;
    totalCommits?: number | null;
    processedCommits?: number | null;
    repoId?: number | null;
    repository?: RepoSummary | null;
    ready?: boolean;
    error?: string | null;
    updatedAt?: string | null;
}

export async function getRepositoriesList(
    page: number = 1,
    limit: number = 50
): Promise<RepositoriesListResponse> {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;

    return api.get<RepositoriesListResponse>(
        `/api/repos?page=${safePage}&limit=${safeLimit}`
    );
}

export async function startRepositoryIngest(url: string): Promise<StartIngestResponse> {
    return api.post<StartIngestResponse>('/api/repos', { url });
}

export async function getRepoCommitsPage(
    repoId: string,
    page: number,
    limit: number = 100
): Promise<PaginatedCommitsResponse> {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0
        ? Math.min(100, Math.floor(limit))
        : 100;

    const response = await api.get<PaginatedCommitsResponse>(
        `/api/repos/${repoId}/commits?page=${safePage}&limit=${safeLimit}`
    );

    return {
        ...response,
        commits: (response.commits || []).map(commit => ({
            ...commit,
            message: normalizeLegacyCommitMessage(commit.message),
        })),
    };
}

function normalizeLegacyCommitMessage(message: string): string {
    if (typeof message !== 'string') return '';

    const trimmed = message.trim();
    if (!trimmed) return '';

    const [firstLine] = trimmed.split(/\r?\n/, 1);
    const csvWithSha = firstLine.match(/,[0-9a-f]{7,64},(.+)$/i);
    const looksLikeLegacyCsv =
        /^([^,\n]+,){3,}/.test(firstLine) &&
        /,[0-9a-f]{7,64},/i.test(firstLine);

    if (looksLikeLegacyCsv && csvWithSha?.[1]) {
        return csvWithSha[1].trim();
    }

    return message;
}

export async function getCommitFiles(repoId: string, sha: string): Promise<{ files: FileData[] }> {
    return api.get<{ files: FileData[] }>(`/api/repos/${repoId}/commits/${sha}`);
}

export async function getFileContent(
    repoId: string,
    sha: string,
    path: string
): Promise<{ content?: string; language?: string; path?: string; cached?: boolean }> {
    return api.get<{ content?: string; language?: string; path?: string; cached?: boolean }>(
        `/api/repos/${repoId}/commits/${sha}/content?path=${encodeURIComponent(path)}`
    );
}

export async function getCommitDiff(repoId: string, sha: string): Promise<CommitDiffResponse> {
    return api.get<CommitDiffResponse>(`/api/repos/${repoId}/commits/${sha}/diff`);
}

export async function getCompareDiff(
    repoId: string,
    baseSha: string,
    headSha: string
): Promise<CompareDiffResponse> {
    return api.get<CompareDiffResponse>(
        `/api/repos/${repoId}/compare?base=${encodeURIComponent(baseSha)}&head=${encodeURIComponent(headSha)}`
    );
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
    return api.get<JobStatusResponse>(`/api/jobs/${jobId}`);
}
