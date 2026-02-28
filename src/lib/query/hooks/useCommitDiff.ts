import { useQuery } from '@tanstack/react-query';
import { getCommitDiff } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/keys';

interface UseCommitDiffOptions {
    enabled?: boolean;
}

export function useCommitDiff(
    repoId: string | undefined,
    sha: string | undefined,
    options: UseCommitDiffOptions = {}
) {
    return useQuery({
        queryKey: queryKeys.commitDiff(repoId || '', sha || ''),
        enabled: Boolean(repoId) && Boolean(sha) && (options.enabled ?? true),
        queryFn: () => {
            if (!repoId || !sha) {
                throw new Error('Repository ID and SHA are required');
            }
            return getCommitDiff(repoId, sha);
        },
        staleTime: Infinity,
    });
}
