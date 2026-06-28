import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

interface GithubTokenStatus {
  hasToken: boolean;
}

export function useGithubToken() {
  return useQuery({
    queryKey: ['github-token-status'],
    queryFn: async () => {
      const data = await api.get<GithubTokenStatus>('/api/github/token');
      return data.hasToken;
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}
