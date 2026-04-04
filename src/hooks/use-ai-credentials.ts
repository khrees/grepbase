import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { AIProviderType } from '@/services/ai-providers';

interface CredentialsResponse {
  providers?: Partial<Record<AIProviderType, boolean>>;
}

export function useAICredentials() {
  return useQuery({
    queryKey: ['ai-credentials'],
    queryFn: async () => {
      const data = await api.get<CredentialsResponse>('/api/ai/credentials');
      return data.providers ?? {};
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}
