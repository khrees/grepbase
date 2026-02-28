import { describe, expect, test } from 'bun:test';
import { queryKeys } from '@/lib/query/keys';

describe('query keys', () => {
    test('builds stable repo commit keys for identical params', () => {
        const first = queryKeys.repoCommits('12', 1, 100);
        const second = queryKeys.repoCommits('12', 1, 100);
        expect(first).toEqual(second);
    });

    test('builds different compare keys when params change', () => {
        const first = queryKeys.compareDiff('1', 'aaa', 'bbb');
        const second = queryKeys.compareDiff('1', 'aaa', 'ccc');
        expect(first).not.toEqual(second);
    });

    test('keeps job-status root isolated', () => {
        const key = queryKeys.jobStatus('job-123');
        expect(key[0]).toBe('job-status');
    });
});
