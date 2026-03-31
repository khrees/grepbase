import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../keys';
import { fetchCommitDiff } from '../fetchers';

/**
 * Per-file diffs for a single commit SHA.
 * Uses staleTime: Infinity – immutable by SHA.
 */
export function useCommitDiff(
    repoId: string | number | undefined,
    sha: string | undefined,
    enabled = true
) {
    return useQuery({
        queryKey: queryKeys.repos.commitDiff(repoId ?? '', sha ?? ''),
        queryFn: () => fetchCommitDiff(String(repoId), sha!),
        enabled: enabled && !!repoId && !!sha,
        staleTime: Infinity,
    });
}
