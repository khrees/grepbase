import { useInfiniteQuery } from '@tanstack/react-query';
import { queryKeys } from '../keys';
import { fetchCommitsPage } from '../fetchers';

const PAGE_SIZE = 100;

/**
 * Infinite query for a repository's commit history.
 * Fetches page 1 on mount, then progressively loads more pages.
 * staleTime is 30s (mutable list).
 */
export function useRepoCommitsInfinite(repoId: string | number | undefined) {
    return useInfiniteQuery({
        queryKey: queryKeys.repos.commits(repoId ?? ''),
        queryFn: ({ pageParam }) =>
            fetchCommitsPage(String(repoId), pageParam as number, PAGE_SIZE),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            if (lastPage.pagination?.hasNext) {
                return (lastPage.pagination.page ?? 1) + 1;
            }
            return undefined;
        },
        enabled: !!repoId,
        staleTime: 30_000,
    });
}
