import { describe, test, expect } from 'bun:test';
import {
    githubUrlSchema,
    aiProviderConfigSchema,
    explainCommitSchema,
    explainQuestionSchema,
    explainProjectSchema,
    explainDaySummarySchema,
    explainStorySchema,
    ingestRepoSchema,
} from '../validation';

describe('validation', () => {
    describe('githubUrlSchema', () => {
        test('validates correct GitHub URLs', () => {
            const validUrls = [
                'https://github.com/owner/repo',
                'https://github.com/facebook/react',
                'https://github.com/vercel/next.js',
            ];

            for (const url of validUrls) {
                const result = githubUrlSchema.safeParse(url);
                expect(result.success).toBe(true);
            }
        });

        test('rejects invalid GitHub URLs', () => {
            const invalidUrls = [
                'https://gitlab.com/owner/repo',
                'not-a-url',
                'https://github.com/owner',
                '',
            ];

            for (const url of invalidUrls) {
                const result = githubUrlSchema.safeParse(url);
                expect(result.success).toBe(false);
            }
        });
    });

    describe('aiProviderConfigSchema', () => {
        test('validates cloud provider without API key', () => {
            const result = aiProviderConfigSchema.safeParse({ type: 'openai' });
            expect(result.success).toBe(true);
        });

        test('validates local provider without API key', () => {
            const result = aiProviderConfigSchema.safeParse({
                type: 'ollama',
                baseUrl: 'http://localhost:11434',
            });
            expect(result.success).toBe(true);
        });

        test('rejects invalid provider type', () => {
            const result = aiProviderConfigSchema.safeParse({ type: 'invalid-provider' });
            expect(result.success).toBe(false);
        });
    });

    describe('explainCommitSchema', () => {
        test('validates commit explanation request', () => {
            const result = explainCommitSchema.safeParse({
                type: 'commit',
                repoId: 'repo-123',
                commitSha: 'abc1234',
                provider: { type: 'openai' },
            });
            expect(result.success).toBe(true);
        });

        test('rejects missing commitSha', () => {
            const result = explainCommitSchema.safeParse({
                type: 'commit',
                repoId: 'repo-123',
                provider: { type: 'openai' },
            });
            expect(result.success).toBe(false);
        });

        test('rejects client-sent apiKey in provider', () => {
            const result = explainCommitSchema.safeParse({
                type: 'commit',
                repoId: 'repo-123',
                commitSha: 'abc1234',
                provider: { type: 'openai', apiKey: 'sk-test' },
            });
            expect(result.success).toBe(false);
        });

        test('rejects empty repoId', () => {
            const result = explainCommitSchema.safeParse({
                type: 'commit',
                repoId: '',
                commitSha: 'abc1234',
                provider: { type: 'openai' },
            });
            expect(result.success).toBe(false);
        });
    });

    describe('explainProjectSchema', () => {
        test('validates project explanation request', () => {
            const result = explainProjectSchema.safeParse({
                type: 'project',
                repoId: 'repo-123',
                provider: { type: 'anthropic' },
            });
            expect(result.success).toBe(true);
        });

        test('rejects missing provider', () => {
            const result = explainProjectSchema.safeParse({
                type: 'project',
                repoId: 'repo-123',
            });
            expect(result.success).toBe(false);
        });
    });

    describe('explainStorySchema', () => {
        test('validates story mode request', () => {
            const result = explainStorySchema.safeParse({
                type: 'story',
                repoId: 'repo-123',
                startSha: 'abc1234',
                endSha: 'def5678',
                chapterSize: 4,
                provider: { type: 'openai' },
            });
            expect(result.success).toBe(true);
        });

        test('rejects invalid chapterSize', () => {
            const result = explainStorySchema.safeParse({
                type: 'story',
                repoId: 'repo-123',
                chapterSize: 1,
                provider: { type: 'openai' },
            });
            expect(result.success).toBe(false);
        });
    });

    describe('explainQuestionSchema', () => {
        test('validates question request', () => {
            const result = explainQuestionSchema.safeParse({
                type: 'question',
                repoId: 'repo-123',
                question: 'What does this code do?',
                provider: { type: 'openai' },
            });
            expect(result.success).toBe(true);
        });

        test('rejects missing question', () => {
            const result = explainQuestionSchema.safeParse({
                type: 'question',
                repoId: 'repo-123',
                provider: { type: 'openai' },
            });
            expect(result.success).toBe(false);
        });
    });

    describe('explainDaySummarySchema', () => {
        test('validates day-summary request', () => {
            const result = explainDaySummarySchema.safeParse({
                type: 'day-summary',
                repoId: 'repo-123',
                commits: [{ sha: 'abc1234', message: 'fix bug', authorName: 'Alice', date: '2024-01-01' }],
                provider: { type: 'openai' },
            });
            expect(result.success).toBe(true);
        });

        test('rejects empty commits array', () => {
            const result = explainDaySummarySchema.safeParse({
                type: 'day-summary',
                repoId: 'repo-123',
                commits: [],
                provider: { type: 'openai' },
            });
            expect(result.success).toBe(false);
        });
    });

    describe('ingestRepoSchema', () => {
        test('validates repository ingest request', () => {
            const result = ingestRepoSchema.safeParse({
                url: 'https://github.com/facebook/react',
            });
            expect(result.success).toBe(true);
        });

        test('accepts custom branch', () => {
            const result = ingestRepoSchema.safeParse({
                url: 'https://github.com/facebook/react',
                branch: 'develop',
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.branch).toBe('develop');
            }
        });
    });
});
