import { useQuery } from '@tanstack/react-query';
import { getCommitFiles } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/keys';

export function useCommitFiles(repoId: string | undefined, sha: string | undefined) {
    return useQuery({
        queryKey: queryKeys.commitFiles(repoId || '', sha || ''),
        enabled: Boolean(repoId) && Boolean(sha),
        queryFn: () => {
            if (!repoId || !sha) {
                throw new Error('Repository ID and SHA are required');
            }
            return getCommitFiles(repoId, sha);
        },
        staleTime: Infinity,
    });
}
