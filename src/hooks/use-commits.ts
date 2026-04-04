import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { Repository, Commit } from '@/types';

const MAX_PAGE_SIZE = 100;

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

export function useCommits(repoId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['commits', repoId],
    queryFn: async ({ pageParam }) => {
      return api.get<PaginatedCommitsResponse>(
        `/api/repos/${repoId}/commits?page=${pageParam}&limit=${MAX_PAGE_SIZE}`
      );
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (!lastPage.pagination?.hasNext) return undefined;
      return (lastPage.pagination.page || 1) + 1;
    },
    select: (data) => ({
      repository: data.pages[0]?.repository ?? null,
      commits: data.pages.flatMap(page => page.commits),
      hasNextPage: data.pages[data.pages.length - 1]?.pagination?.hasNext ?? false,
    }),
    enabled: !!repoId,
    staleTime: 2 * 60_000,
  });
}

export type { PaginatedCommitsResponse };
