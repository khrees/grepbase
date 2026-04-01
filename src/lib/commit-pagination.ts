import { api } from '@/lib/api-client';
import type { Commit, Repository } from '@/types';

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

const MAX_PAGE_SIZE = 100;

export async function fetchCommitsPageForRepository(
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

export async function fetchInitialCommitsForRepository(
    repoId: string
): Promise<PaginatedCommitsResponse> {
    return fetchCommitsPageForRepository(repoId, 1, MAX_PAGE_SIZE);
}


