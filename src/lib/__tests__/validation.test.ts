import { describe, test, expect } from 'bun:test';
import {
    githubUrlSchema,
    aiProviderConfigSchema,
    explainRequestSchema,
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
                'https://gitlab.com/owner/repo', // Not GitHub
                'not-a-url',
                'https://github.com/owner', // Missing repo
                '',
            ];

            for (const url of invalidUrls) {
                const result = githubUrlSchema.safeParse(url);
                expect(result.success).toBe(false);
            }
        });
    });

    describe('aiProviderConfigSchema', () => {
        test('validates cloud provider with API key', () => {
            const result = aiProviderConfigSchema.safeParse({
                type: 'openai',
                apiKey: 'sk-test123',
            });
            expect(result.success).toBe(true);
        });

        test('validates local provider without API key', () => {
            const result = aiProviderConfigSchema.safeParse({
                type: 'ollama',
                baseUrl: 'http://localhost:11434',
            });
            expect(result.success).toBe(true);
        });

        test('rejects cloud provider without API key', () => {
            const result = aiProviderConfigSchema.safeParse({
                type: 'openai',
            });
            expect(result.success).toBe(false);
        });

        test('rejects invalid provider type', () => {
            const result = aiProviderConfigSchema.safeParse({
                type: 'invalid-provider',
                apiKey: 'test',
            });
            expect(result.success).toBe(false);
        });
    });

    describe('explainRequestSchema', () => {
        test('validates commit explanation request', () => {
            const result = explainRequestSchema.safeParse({
                type: 'commit',
                repoId: 1,
                commitSha: 'abc123',
                provider: {
                    type: 'openai',
                    apiKey: 'sk-test',
                },
            });
            expect(result.success).toBe(true);
        });

        test('validates project explanation request', () => {
            const result = explainRequestSchema.safeParse({
                type: 'project',
                repoId: 1,
                provider: {
                    type: 'anthropic',
                    apiKey: 'sk-test',
                },
            });
            expect(result.success).toBe(true);
        });

        test('rejects commit request without sha', () => {
            const result = explainRequestSchema.safeParse({
                type: 'commit',
                repoId: 1,
                provider: {
                    type: 'openai',
                    apiKey: 'sk-test',
                },
            });
            expect(result.success).toBe(false);
        });

        test('rejects invalid repoId', () => {
            const result = explainRequestSchema.safeParse({
                type: 'project',
                repoId: -1,
                provider: {
                    type: 'openai',
                    apiKey: 'sk-test',
                },
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

        test('applies default branch', () => {
            const result = ingestRepoSchema.safeParse({
                url: 'https://github.com/facebook/react',
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.branch).toBe('main');
            }
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
