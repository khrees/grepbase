import { useInfiniteQuery } from '@tanstack/react-query';
import { getRepoCommitsPage } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/keys';

interface UseRepoCommitsInfiniteOptions {
    pageSize?: number;
    enabled?: boolean;
}

export function useRepoCommitsInfinite(
    repoId: string | undefined,
    options: UseRepoCommitsInfiniteOptions = {}
) {
    const pageSize = options.pageSize ?? 100;

    return useInfiniteQuery({
        queryKey: queryKeys.repoCommitsRoot(repoId || ''),
        enabled: Boolean(repoId) && (options.enabled ?? true),
        initialPageParam: 1,
        queryFn: ({ pageParam }) => {
            if (!repoId) {
                throw new Error('Repository ID is required');
            }
            return getRepoCommitsPage(repoId, Number(pageParam), pageSize);
        },
        getNextPageParam: (lastPage) => {
            if (!lastPage.pagination?.hasNext) {
                return undefined;
            }
            return (lastPage.pagination.page || 1) + 1;
        },
        staleTime: 30_000,
    });
}
