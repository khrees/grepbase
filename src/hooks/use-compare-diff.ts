import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { CompareDiffResponse, DiffFileData } from '@/types';

export function useCompareDiff(
  repoId: string | undefined,
  baseSha: string | undefined,
  headSha: string | undefined,
  filePath: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['compare-diff', repoId, baseSha, headSha, filePath],
    queryFn: async () => {
      const url = `/api/repos/${repoId}/compare?base=${encodeURIComponent(baseSha!)}&head=${encodeURIComponent(headSha!)}&path=${encodeURIComponent(filePath!)}`;
      const data = await api.get<CompareDiffResponse>(url);
      return (data.files?.[0] ?? null) as DiffFileData | null;
    },
    enabled: !!repoId && !!baseSha && !!headSha && !!filePath && baseSha !== headSha && (options?.enabled !== false),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });
}
