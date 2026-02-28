import { useMutation, useQueryClient } from '@tanstack/react-query';
import { startRepositoryIngest } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/keys';

export function useStartIngest() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (url: string) => startRepositoryIngest(url),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.reposRoot });

            if (data.repository?.id) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.repoCommitsRoot(String(data.repository.id)),
                });
            }
        },
    });
}
