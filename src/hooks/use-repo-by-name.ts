import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api-client';
import type { Repository } from '@/types';

interface RepoByNameResult {
  data: Repository | null | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  /** If the repo wasn't found and ingestion was auto-triggered, this is the job ID */
  ingestJobId: string | null;
  /** True while auto-ingestion is in progress */
  isAutoIngesting: boolean;
}

export function useRepoByName(owner: string | undefined, repoName: string | undefined, branch?: string | null): RepoByNameResult {
  const queryClient = useQueryClient();
  const [ingestJobId, setIngestJobId] = useState<string | null>(null);
  const [isAutoIngesting, setIsAutoIngesting] = useState(false);
  const ingestingRef = useRef(false);

  const triggerIngestion = useCallback(async () => {
    if (!owner || !repoName || ingestingRef.current) return;
    ingestingRef.current = true;
    setIsAutoIngesting(true);

    try {
      const body: { url: string; branch?: string } = {
        url: `https://github.com/${owner}/${repoName}`,
      };
      if (branch) body.branch = branch;

      const data = await api.post<{ jobId?: string; repository?: { id: string }; cached?: boolean }>(
        '/api/repos',
        body
      );
      if (data.jobId) {
        setIngestJobId(data.jobId);
      } else if (data.repository) {
        // Repo already existed, refetch
        queryClient.invalidateQueries({ queryKey: ['repo-by-name', owner, repoName, branch || null] });
      }
    } catch {
      // Ingestion trigger failed — will show error state
      setIsAutoIngesting(false);
      ingestingRef.current = false;
    }
  }, [owner, repoName, branch, queryClient]);

  const branchParam = branch ? `&branch=${encodeURIComponent(branch)}` : '';

  const query = useQuery<{ repository: Repository }, Error, Repository | null>({
    queryKey: ['repo-by-name', owner, repoName, branch || null],
    queryFn: async () => {
      return api.get<{ repository: Repository }>(
        `/api/repos/lookup?owner=${encodeURIComponent(owner!)}&repo=${encodeURIComponent(repoName!)}${branchParam}`
      );
    },
    select: (data) => data.repository,
    enabled: !!owner && !!repoName,
    staleTime: 10 * 60_000,
    retry: false,
  });

  // Auto-trigger ingestion on 404
  if (query.error && !ingestJobId && !isAutoIngesting && !ingestingRef.current) {
    const msg = query.error.message;
    if (msg === 'Repository not found' || msg.includes('404')) {
      triggerIngestion();
    }
  }

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: isAutoIngesting ? null : query.error,
    ingestJobId,
    isAutoIngesting,
  };
}

