import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

interface IngestJobResponse {
  status: string;
  progress?: number;
  error?: string;
  ready?: boolean;
  processedCommits?: number;
  repoId?: number | null;
  repository?: { id: number | string };
}

export function useIngestJob(
  jobId: string | null | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['ingest-job', jobId],
    queryFn: async () => {
      const response = await api.get<IngestJobResponse | { job: IngestJobResponse }>(
        `/api/jobs/${jobId}`
      );
      // Normalize: some endpoints wrap in { job: ... }
      const data = 'job' in response && response.job ? response.job : response as IngestJobResponse;
      return data;
    },
    enabled: !!jobId && (options?.enabled !== false),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      if (data.status === 'completed' || data.status === 'failed') return false;
      return 2000;
    },
    staleTime: 0,
    gcTime: 30_000,
  });
}

export type { IngestJobResponse };
