import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postIngest } from '../fetchers';
import { queryKeys } from '../keys';

/**
 * Mutation hook for starting a repository ingest from a GitHub URL.
 * On success it invalidates the repos list so it refreshes.
 */
export function useStartIngest() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (url: string) => postIngest(url),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.repos.list() });
        },
    });
}
