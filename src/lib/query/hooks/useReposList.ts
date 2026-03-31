import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../keys';
import { api } from '@/lib/api-client';
import type { Repository } from '@/types';

/**
 * Fetches the list of ingested repositories for the current session.
 * staleTime: 30s (mutable).
 */
export function useReposList() {
    return useQuery({
        queryKey: queryKeys.repos.list(),
        queryFn: () => api.get<{ repositories: Repository[] }>('/api/repos'),
        staleTime: 30_000,
    });
}
