import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../keys';
import { fetchJobStatus } from '../fetchers';
import type { JobStatusResponse } from '../fetchers';

export type { JobStatusResponse };

/** Terminal states – polling stops when any of these is reached. */
function isTerminalState(data: JobStatusResponse | undefined): boolean {
    if (!data) return false;
    if (data.status === 'failed' || data.status === 'completed') return true;
    if (data.ready) return true;
    if (Number(data.processedCommits ?? 0) > 0) return true;
    return false;
}

interface UseJobStatusOptions {
    /**
     * Whether to start polling at all.
     * Defaults to true.
     */
    enabled?: boolean;
    /**
     * Override the refetch interval in ms.
     * Defaults to 2 000 ms.  Pass false to disable.
     */
    refetchInterval?: number | false;
}

/**
 * Poll a job-status endpoint until a terminal condition is reached.
 *
 * Terminal conditions (polling stops automatically):
 *  - status === 'completed'
 *  - status === 'failed'
 *  - ready === true
 *  - processedCommits > 0
 *
 * These keys are NOT persisted to sessionStorage (see QueryProvider).
 */
export function useJobStatus(
    jobId: string | null | undefined,
    options: UseJobStatusOptions = {}
) {
    const { enabled = true, refetchInterval = 2_000 } = options;

    return useQuery({
        queryKey: queryKeys.jobs.status(jobId ?? ''),
        queryFn: () => fetchJobStatus(jobId!),
        enabled: enabled && !!jobId,
        staleTime: 0,
        gcTime: 60_000,
        refetchInterval: (query) => {
            // Stop polling once we reach a terminal state
            if (isTerminalState(query.state.data)) return false;
            return refetchInterval;
        },
    });
}
