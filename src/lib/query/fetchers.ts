/**
 * Typed fetcher functions for use with TanStack Query.
 * These are thin wrappers around the api client that match the shape
 * expected by each query key.
 */

import { api } from '@/lib/api-client';
import type {
    Repository,
    Commit,
    FileData,
    CommitDiffResponse,
    CompareDiffResponse,
} from '@/types';

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

export interface JobStatusResponse {
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | string;
    progress?: number;
    totalCommits?: number;
    processedCommits?: number;
    repoId?: number | null;
    repository?: { id: number; name: string; owner: string } | null;
    ready?: boolean;
    error?: string | null;
    updatedAt?: string;
}

export interface IngestResponse {
    repository?: { id: number };
    jobId?: string;
    cached?: boolean;
    error?: string;
}

const MAX_PAGE_SIZE = 100;

export async function fetchCommitsPage(
    repoId: string,
    page: number,
    limit: number = MAX_PAGE_SIZE
): Promise<PaginatedCommitsResponse> {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0
        ? Math.min(MAX_PAGE_SIZE, Math.floor(limit))
        : MAX_PAGE_SIZE;
    return api.get<PaginatedCommitsResponse>(
        `/api/repos/${repoId}/commits?page=${safePage}&limit=${safeLimit}`
    );
}

export async function fetchCommitFiles(
    repoId: string,
    sha: string
): Promise<{ files: FileData[] }> {
    return api.get<{ files?: FileData[] }>(`/api/repos/${repoId}/commits/${sha}`).then(
        (data) => ({ files: data.files || [] })
    );
}

export async function fetchFileContent(
    repoId: string,
    sha: string,
    path: string
): Promise<{ content: string | null }> {
    const data = await api.get<{ content?: string }>(
        `/api/repos/${repoId}/commits/${sha}/content?path=${encodeURIComponent(path)}`
    );
    return { content: data.content ?? null };
}

export async function fetchCommitDiff(
    repoId: string,
    sha: string
): Promise<CommitDiffResponse> {
    return api.get<CommitDiffResponse>(`/api/repos/${repoId}/commits/${sha}/diff`);
}

export async function fetchCompareDiff(
    repoId: string,
    baseSha: string,
    headSha: string
): Promise<CompareDiffResponse> {
    return api.get<CompareDiffResponse>(
        `/api/repos/${repoId}/compare?base=${encodeURIComponent(baseSha)}&head=${encodeURIComponent(headSha)}`
    );
}

export async function fetchJobStatus(jobId: string): Promise<JobStatusResponse> {
    return api.get<JobStatusResponse>(`/api/jobs/${jobId}`);
}

export async function postIngest(url: string): Promise<IngestResponse> {
    return api.post<IngestResponse>('/api/repos', { url });
}
