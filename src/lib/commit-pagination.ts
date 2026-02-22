import { api } from '@/lib/api-client';
import type { Commit, Repository } from '@/types';

interface PaginatedCommitsResponse {
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
const MAX_PAGES = 200;

export async function fetchAllCommitsForRepository(repoId: string): Promise<{
    repository: Repository;
    commits: Commit[];
}> {
    let page = 1;
    let repository: Repository | null = null;
    const allCommits: Commit[] = [];

    while (page <= MAX_PAGES) {
        const response = await api.get<PaginatedCommitsResponse>(
            `/api/repos/${repoId}/commits?page=${page}&limit=${MAX_PAGE_SIZE}`
        );

        if (!repository) {
            repository = response.repository;
        }

        if (response.commits.length === 0) {
            break;
        }

        allCommits.push(...response.commits);

        if (!response.pagination?.hasNext) {
            break;
        }

        page += 1;
    }

    if (!repository) {
        throw new Error('Repository not found');
    }

    return { repository, commits: allCommits };
}
