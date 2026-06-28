import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { Repository, Commit } from '@/types';

const MAX_PAGE_SIZE = 100;

export interface PaginatedCommitsResponse {
  repository: Repository;
  commits: Commit[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

interface CommitsQueryResult {
  repository: Repository | null;
  commits: Commit[];
  hasNextPage: boolean;
}

export function useCommits(repoId: string | undefined) {
  return useQuery<PaginatedCommitsResponse, Error, CommitsQueryResult>({
    queryKey: ['commits', repoId],
    queryFn: async () => {
      return api.get<PaginatedCommitsResponse>(
        `/api/repos/${repoId}/commits?page=1&limit=${MAX_PAGE_SIZE}`
      );
    },
    select: (data) => ({
      repository: data.repository,
      commits: data.commits,
      hasNextPage: data.pagination?.hasNext ?? false,
    }),
    enabled: !!repoId,
    staleTime: 2 * 60_000,
  });
}
