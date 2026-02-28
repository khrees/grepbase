import { useQuery } from '@tanstack/react-query';
import { getCompareDiff } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/keys';

interface UseCompareDiffOptions {
    enabled?: boolean;
}

export function useCompareDiff(
    repoId: string | undefined,
    baseSha: string | undefined,
    headSha: string | undefined,
    options: UseCompareDiffOptions = {}
) {
    return useQuery({
        queryKey: queryKeys.compareDiff(repoId || '', baseSha || '', headSha || ''),
        enabled: Boolean(repoId) && Boolean(baseSha) && Boolean(headSha) && (options.enabled ?? true),
        queryFn: () => {
            if (!repoId || !baseSha || !headSha) {
                throw new Error('Repository ID, base SHA, and head SHA are required');
            }
            return getCompareDiff(repoId, baseSha, headSha);
        },
        staleTime: Infinity,
    });
}
