import { describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';

describe('GET /api/jobs/[jobId]', () => {
    test('returns normalized shape with private no-store headers', async () => {
        const bunTest = await import('bun:test') as unknown as {
            mock: { module: (path: string, loader: () => unknown) => void };
        };
        const mockModule = bunTest.mock.module;

        const ingestJobsTable = { jobId: Symbol('job_id') };
        const repositoriesTable = { id: Symbol('id') };

        const db = {
            select: () => ({
                from: (table: unknown) => ({
                    where: () => ({
                        limit: async () => {
                            if (table === ingestJobsTable) {
                                return [{
                                    jobId: 'job-123',
                                    status: 'processing',
                                    progress: 40,
                                    totalCommits: 100,
                                    processedCommits: 20,
                                    repoId: 77,
                                    error: null,
                                    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
                                }];
                            }

                            return [{
                                id: 77,
                                owner: 'acme',
                                name: 'repo',
                                description: 'demo',
                            }];
                        },
                    }),
                }),
            }),
        };

        mockModule('drizzle-orm', () => ({
            eq: () => ({ op: 'eq' }),
        }));

        mockModule('@/db', () => ({
            ingestJobs: ingestJobsTable,
            repositories: repositoriesTable,
            getDb: () => db,
        }));

        mockModule('@/lib/api-security', () => ({
            resolveSession: async () => ({ sessionId: 'session-1' }),
            applyPrivateNoStoreHeaders: <T extends Response>(response: T) => {
                response.headers.set('Cache-Control', 'private, no-store, max-age=0');
                response.headers.set('Pragma', 'no-cache');
                response.headers.set('Vary', 'Cookie');
                return response;
            },
        }));

        mockModule('@/services/resource-access', () => ({
            hasJobAccess: async () => true,
            hasRepoAccess: async () => false,
        }));

        const { GET } = await import('../[jobId]/route');
        const request = new NextRequest('http://localhost/api/jobs/job-123');

        const response = await GET(request, {
            params: Promise.resolve({ jobId: 'job-123' }),
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
        expect(response.headers.get('Pragma')).toBe('no-cache');
        expect(response.headers.get('Vary')).toBe('Cookie');

        const body = await response.json() as Record<string, unknown>;
        expect(body.jobId).toBe('job-123');
        expect(body.status).toBe('processing');
        expect(body.progress).toBe(40);
        expect(body.totalCommits).toBe(100);
        expect(body.processedCommits).toBe(20);
        expect(body.repoId).toBe(77);
        expect(body.ready).toBe(true);
        expect(body.error).toBe(null);

        const repository = body.repository as Record<string, unknown>;
        expect(repository.id).toBe(77);
        expect(repository.owner).toBe('acme');
        expect(repository.name).toBe('repo');
        expect(repository.description).toBe('demo');
    });
});
