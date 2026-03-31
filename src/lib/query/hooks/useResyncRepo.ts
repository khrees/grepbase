import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '../keys';
import type { IngestResponse } from '../fetchers';

interface ResyncOptions {
    repoId: string | number;
    owner: string;
    name: string;
}

/**
 * Mutation for re-syncing a repository (triggering a fresh ingest).
 * On success it invalidates all commit-related queries for that repo
 * so the explore page refreshes automatically.
 */
export function useResyncRepo() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ owner, name }: ResyncOptions) =>
            api.post<IngestResponse>('/api/repos', {
                url: `github.com/${owner}/${name}`,
            }),
        onSuccess: (_data, variables) => {
            const { repoId } = variables;
            // Invalidate commits list so Explore refetches after resync
            void queryClient.invalidateQueries({
                queryKey: queryKeys.repos.commits(repoId),
            });
            void queryClient.invalidateQueries({
                queryKey: queryKeys.repos.list(),
            });
        },
    });
}
