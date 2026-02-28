import { describe, expect, test } from 'bun:test';
import { getNextJobPollInterval } from '@/lib/query/hooks/useJobStatus';

const baseInput = {
    hasJobId: true,
    status: 'processing',
    ready: false,
    processedCommits: 0,
    pollCount: 1,
    consecutiveErrors: 0,
    initialIntervalMs: 500,
    fastPollCount: 5,
    baseIntervalMs: 2000,
    maxIntervalMs: 15000,
    maxErrors: 5,
} as const;

describe('useJobStatus polling interval', () => {
    test('uses fast interval for early polls', () => {
        expect(getNextJobPollInterval(baseInput)).toBe(500);
    });

    test('backs off after fast polls', () => {
        expect(getNextJobPollInterval({
            ...baseInput,
            pollCount: 10,
            consecutiveErrors: 2,
        })).toBe(8000);
    });

    test('stops polling on terminal job state', () => {
        expect(getNextJobPollInterval({
            ...baseInput,
            status: 'completed',
        })).toBe(false);
    });

    test('stops polling when processed commits are available', () => {
        expect(getNextJobPollInterval({
            ...baseInput,
            processedCommits: 1,
        })).toBe(false);
    });

    test('stops polling after max consecutive errors', () => {
        expect(getNextJobPollInterval({
            ...baseInput,
            pollCount: 10,
            consecutiveErrors: 5,
        })).toBe(false);
    });
});
