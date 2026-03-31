import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../keys';
import { fetchFileContent } from '../fetchers';

/**
 * Content of a single file at a commit SHA.
 * Uses staleTime: Infinity – immutable by SHA.
 * Pass `enabled: false` to lazy-load on demand.
 */
export function useFileContent(
    repoId: string | number | undefined,
    sha: string | undefined,
    path: string | undefined,
    enabled = true
) {
    return useQuery({
        queryKey: queryKeys.repos.fileContent(repoId ?? '', sha ?? '', path ?? ''),
        queryFn: () => fetchFileContent(String(repoId), sha!, path!),
        enabled: enabled && !!repoId && !!sha && !!path,
        staleTime: Infinity,
    });
}
