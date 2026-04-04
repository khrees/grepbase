import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { CommitDiffResponse, DiffFileData } from '@/types';

export function useCommitDiff(
  repoId: string | undefined,
  commitSha: string | undefined,
  filePath: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['commit-diff', repoId, commitSha, filePath],
    queryFn: async () => {
      const url = `/api/repos/${repoId}/commits/${commitSha}/diff?path=${encodeURIComponent(filePath!)}`;
      const data = await api.get<CommitDiffResponse>(url);
      return (data.files?.[0] ?? null) as DiffFileData | null;
    },
    enabled: !!repoId && !!commitSha && !!filePath && (options?.enabled !== false),
    staleTime: Infinity,  // Diff at a given commit is immutable
    gcTime: 10 * 60_000,
  });
}
