import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { Repository } from '@/types';

export function useRepoByName(owner: string | undefined, repoName: string | undefined) {
  return useQuery<{ repository: Repository }, Error, Repository | null>({
    queryKey: ['repo-by-name', owner, repoName],
    queryFn: async () => {
      return api.get<{ repository: Repository }>(
        `/api/repos/lookup?owner=${encodeURIComponent(owner!)}&repo=${encodeURIComponent(repoName!)}`
      );
    },
    select: (data) => data.repository,
    enabled: !!owner && !!repoName,
    staleTime: 10 * 60_000,
  });
}
