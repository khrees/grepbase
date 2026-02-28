import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJobStatus } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/keys';

const DEFAULT_INITIAL_INTERVAL_MS = 500;
const DEFAULT_FAST_POLL_COUNT = 5;
const DEFAULT_BASE_INTERVAL_MS = 2000;
const DEFAULT_MAX_INTERVAL_MS = 15000;
const DEFAULT_MAX_ERRORS = 5;

export interface UseJobStatusOptions {
    enabled?: boolean;
    initialIntervalMs?: number;
    fastPollCount?: number;
    baseIntervalMs?: number;
    maxIntervalMs?: number;
    maxErrors?: number;
}

function isTerminalStatus(status: string | undefined): boolean {
    return status === 'completed' || status === 'failed';
}

interface GetNextJobPollIntervalInput {
    hasJobId: boolean;
    status?: string;
    ready?: boolean;
    processedCommits?: number | null;
    pollCount: number;
    consecutiveErrors: number;
    initialIntervalMs: number;
    fastPollCount: number;
    baseIntervalMs: number;
    maxIntervalMs: number;
    maxErrors: number;
}

export function getNextJobPollInterval(input: GetNextJobPollIntervalInput): number | false {
    if (!input.hasJobId) {
        return false;
    }

    const hasProcessedCommits = Number(input.processedCommits || 0) > 0;
    const terminal = isTerminalStatus(input.status) || Boolean(input.ready) || hasProcessedCommits;
    if (terminal) {
        return false;
    }

    if (input.consecutiveErrors >= input.maxErrors) {
        return false;
    }

    if (input.pollCount < input.fastPollCount) {
        return input.initialIntervalMs;
    }

    const backoffFactor = 2 ** Math.min(input.consecutiveErrors, 3);
    return Math.min(input.maxIntervalMs, input.baseIntervalMs * backoffFactor);
}

export function useJobStatus(jobId: string | null | undefined, options: UseJobStatusOptions = {}) {
    const pollCountRef = useRef(0);
    const consecutiveErrorsRef = useRef(0);

    const initialIntervalMs = options.initialIntervalMs ?? DEFAULT_INITIAL_INTERVAL_MS;
    const fastPollCount = options.fastPollCount ?? DEFAULT_FAST_POLL_COUNT;
    const baseIntervalMs = options.baseIntervalMs ?? DEFAULT_BASE_INTERVAL_MS;
    const maxIntervalMs = options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
    const maxErrors = options.maxErrors ?? DEFAULT_MAX_ERRORS;

    useEffect(() => {
        pollCountRef.current = 0;
        consecutiveErrorsRef.current = 0;
    }, [jobId]);

    const query = useQuery({
        queryKey: queryKeys.jobStatus(jobId || ''),
        enabled: Boolean(jobId) && (options.enabled ?? true),
        retry: false,
        queryFn: async () => {
            if (!jobId) {
                throw new Error('Job ID is required');
            }

            pollCountRef.current += 1;

            try {
                const status = await getJobStatus(jobId);
                consecutiveErrorsRef.current = 0;
                return status;
            } catch (error) {
                consecutiveErrorsRef.current += 1;
                throw error;
            }
        },
        refetchInterval: (queryState) => {
            const data = queryState.state.data;
            return getNextJobPollInterval({
                hasJobId: Boolean(jobId),
                status: data?.status,
                ready: data?.ready,
                processedCommits: data?.processedCommits,
                pollCount: pollCountRef.current,
                consecutiveErrors: consecutiveErrorsRef.current,
                initialIntervalMs,
                fastPollCount,
                baseIntervalMs,
                maxIntervalMs,
                maxErrors,
            });
        },
        refetchOnWindowFocus: false,
    });

    const hasProcessedCommits = Number(query.data?.processedCommits || 0) > 0;
    const isTerminal = useMemo(() => {
        if (!query.data) {
            return false;
        }

        return isTerminalStatus(query.data.status) || Boolean(query.data.ready) || hasProcessedCommits;
    }, [hasProcessedCommits, query.data]);

    return {
        ...query,
        hasProcessedCommits,
        isTerminal,
    };
}
