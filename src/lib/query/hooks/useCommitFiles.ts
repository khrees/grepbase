import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../keys';
import { fetchCommitFiles } from '../fetchers';

/**
 * Files present at a specific commit SHA.
 * Uses staleTime: Infinity because content addressed by
 * a git SHA is immutable.
 */
export function useCommitFiles(
    repoId: string | number | undefined,
    sha: string | undefined
) {
    return useQuery({
        queryKey: queryKeys.repos.commitFiles(repoId ?? '', sha ?? ''),
        queryFn: () => fetchCommitFiles(String(repoId), sha!),
        enabled: !!repoId && !!sha,
        staleTime: Infinity,
    });
}
