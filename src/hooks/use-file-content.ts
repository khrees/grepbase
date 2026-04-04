import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function useFileContent(
  repoId: string | undefined,
  commitSha: string | undefined,
  filePath: string | undefined
) {
  return useQuery({
    queryKey: ['file-content', repoId, commitSha, filePath],
    queryFn: async () => {
      const data = await api.get<{ content?: string }>(
        `/api/repos/${repoId}/commits/${commitSha}/content?path=${encodeURIComponent(filePath!)}`
      );
      return data.content ?? null;
    },
    enabled: !!repoId && !!commitSha && !!filePath,
    staleTime: Infinity,  // File content at a specific commit never changes
    gcTime: 10 * 60_000,
  });
}
