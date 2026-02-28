import { useQuery } from '@tanstack/react-query';
import { getFileContent } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/keys';

interface UseFileContentOptions {
    enabled?: boolean;
}

export function useFileContent(
    repoId: string | undefined,
    sha: string | undefined,
    filePath: string | undefined,
    options: UseFileContentOptions = {}
) {
    return useQuery({
        queryKey: queryKeys.fileContent(repoId || '', sha || '', filePath || ''),
        enabled: Boolean(repoId) && Boolean(sha) && Boolean(filePath) && (options.enabled ?? true),
        queryFn: () => {
            if (!repoId || !sha || !filePath) {
                throw new Error('Repository ID, SHA, and file path are required');
            }
            return getFileContent(repoId, sha, filePath);
        },
        staleTime: Infinity,
    });
}
