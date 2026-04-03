import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

interface BranchesResponse {
  branches: string[];
  defaultBranch: string;
}

export function useBranches(repoUrl: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['branches', repoUrl],
    queryFn: async () => {
      return api.get<BranchesResponse>(
        `/api/repos/branches?url=${encodeURIComponent(repoUrl!)}`
      );
    },
    enabled: !!repoUrl && (options?.enabled !== false),
    staleTime: Infinity,  // Branches rarely change mid-session
    gcTime: 10 * 60_000,
  });
}
