import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../keys';
import { fetchCompareDiff } from '../fetchers';

/**
 * File-level diff between two commit SHAs.
 * Uses staleTime: Infinity – immutable by SHA pair.
 */
export function useCompareDiff(
    repoId: string | number | undefined,
    baseSha: string | undefined,
    headSha: string | undefined,
    enabled = true
) {
    const sameCommit = !!baseSha && !!headSha && baseSha === headSha;

    return useQuery({
        queryKey: queryKeys.repos.compareDiff(repoId ?? '', baseSha ?? '', headSha ?? ''),
        queryFn: () => fetchCompareDiff(String(repoId), baseSha!, headSha!),
        enabled: enabled && !!repoId && !!baseSha && !!headSha && !sameCommit,
        staleTime: Infinity,
    });
}
