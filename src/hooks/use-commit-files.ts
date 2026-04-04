import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { FileData } from '@/types';

interface CommitFilesResponse {
  files?: FileData[];
}

export function useCommitFiles(
  repoId: string | undefined,
  commitSha: string | undefined
) {
  return useQuery({
    queryKey: ['commit-files', repoId, commitSha],
    queryFn: async () => {
      const data = await api.get<CommitFilesResponse>(
        `/api/repos/${repoId}/commits/${commitSha}`
      );
      return data.files || [];
    },
    enabled: !!repoId && !!commitSha,
    staleTime: 5 * 60_000,
  });
}
