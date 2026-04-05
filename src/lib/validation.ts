/**
 * Zod validation schemas for API routes
 */
import { z } from 'zod';
import { COMMIT_SHA_REGEX } from '@/lib/constants';

// GitHub URL validation - normalizes and validates GitHub repo URLs
export const githubUrlSchema = z.string()
    .transform((input) => {
        let url = input.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = `https://${url}`;
        }
        return url;
    })
    .refine(
        (url) => {
            try {
                const parsed = new URL(url);
                return parsed.hostname === 'github.com' && parsed.pathname.split('/').filter(Boolean).length >= 2;
            } catch {
                return false;
            }
        },
        { message: 'Must be a valid GitHub repository URL' }
    );

// AI Provider Configuration (for internal use — includes apiKey for stored credentials)
export const aiProviderConfigSchema = z.object({
    type: z.enum(['gemini', 'openai', 'anthropic', 'ollama', 'lmstudio', 'glm', 'kimi']),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    model: z.string().max(100).optional(),
});

// AI Provider type enum for reuse
export const aiProviderTypeSchema = z.enum(['gemini', 'openai', 'anthropic', 'ollama', 'lmstudio', 'glm', 'kimi']);
export type AIProviderTypeFromSchema = z.infer<typeof aiProviderTypeSchema>;

// Provider schema for client-facing requests — apiKey is never accepted from the client
export const clientProviderSchema = z.object({
    type: aiProviderTypeSchema,
    baseUrl: z.string().url().optional(),
    model: z.string().max(100).optional(),
}).strict();

// Base fields shared by all explain requests
const explainBase = z.object({
    repoId: z.string().min(1),
    provider: clientProviderSchema,
});

export const explainCommitSchema = explainBase.extend({
    type: z.literal('commit'),
    commitSha: z.string().regex(COMMIT_SHA_REGEX, 'Invalid commit SHA format'),
    visibleFiles: z.array(z.string().max(1024)).max(200).optional(),
});

export const explainQuestionSchema = explainBase.extend({
    type: z.literal('question'),
    question: z.string().max(5000),
    commitSha: z.string().regex(COMMIT_SHA_REGEX, 'Invalid commit SHA format').optional(),
    visibleFiles: z.array(z.string().max(1024)).max(200).optional(),
});

export const explainProjectSchema = explainBase.extend({
    type: z.literal('project'),
});

export const explainDaySummarySchema = explainBase.extend({
    type: z.literal('day-summary'),
    commits: z.array(z.object({
        sha: z.string(),
        message: z.string(),
        authorName: z.string().nullable(),
        date: z.string(),
    })).min(1).max(200),
    projectName: z.string().max(200).optional(),
    projectOwner: z.string().max(200).optional(),
});

export const explainStorySchema = explainBase.extend({
    type: z.literal('story'),
    startSha: z.string().regex(COMMIT_SHA_REGEX, 'Invalid commit SHA format').optional(),
    endSha: z.string().regex(COMMIT_SHA_REGEX, 'Invalid commit SHA format').optional(),
    chapterSize: z.number().int().min(2).max(12).optional(),
});

// Repository ingest request
export const ingestRepoSchema = z.object({
    url: githubUrlSchema,
    branch: z.string().min(1).max(255).optional(),
    startSha: z.string().regex(COMMIT_SHA_REGEX, 'Invalid commit SHA format').optional(),
    clearExisting: z.boolean().optional(),
});

// Pagination params
export const paginationSchema = z.object({
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(100).default(50),
});

// Commit query params
export const commitQuerySchema = z.object({
    repoId: z.string().min(1),
    page: z.number().int().positive().optional().default(1),
    limit: z.number().int().positive().max(100).optional().default(50),
});
