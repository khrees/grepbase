import { useQuery } from '@tanstack/react-query';
import { getRepositoriesList } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/keys';

interface UseReposListOptions {
    page?: number;
    limit?: number;
    enabled?: boolean;
}

export function useReposList(options: UseReposListOptions = {}) {
    const page = options.page ?? 1;
    const limit = options.limit ?? 50;

    return useQuery({
        queryKey: queryKeys.reposList(page, limit),
        queryFn: () => getRepositoriesList(page, limit),
        enabled: options.enabled ?? true,
        staleTime: 30_000,
    });
}
