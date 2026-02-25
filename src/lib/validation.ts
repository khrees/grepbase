/**
 * Zod validation schemas for API routes
 */
import { z } from 'zod';

// GitHub URL validation - normalizes and validates GitHub repo URLs
export const githubUrlSchema = z.string()
    .transform((input) => {
        // Normalize: add https:// if missing
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

// AI Provider Configuration
export const aiProviderConfigSchema = z.object({
    type: z.enum(['gemini', 'openai', 'anthropic', 'ollama', 'lmstudio', 'glm', 'kimi']),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    model: z.string().max(100).optional(),
});

// AI Provider type enum for reuse
export const aiProviderTypeSchema = z.enum(['gemini', 'openai', 'anthropic', 'ollama', 'lmstudio', 'glm', 'kimi']);
export type AIProviderTypeFromSchema = z.infer<typeof aiProviderTypeSchema>;

// Explain API request
export const explainRequestSchema = z.object({
    type: z.enum(['commit', 'project', 'question', 'day-summary', 'story']),
    repoId: z.number().int().positive(),
    commitSha: z.string().regex(/^[0-9a-f]{7,64}$/i, 'Invalid commit SHA format').optional(),
    startSha: z.string().regex(/^[0-9a-f]{7,64}$/i, 'Invalid commit SHA format').optional(),
    endSha: z.string().regex(/^[0-9a-f]{7,64}$/i, 'Invalid commit SHA format').optional(),
    chapterSize: z.number().int().min(2).max(12).optional(),
    question: z.string().max(5000).optional(),
    visibleFiles: z.array(z.string().max(1024)).max(200).optional(),
    provider: aiProviderConfigSchema.optional(),
    // Flat params for backward compatibility
    providerType: aiProviderTypeSchema.optional(),
    commits: z.array(z.object({
        sha: z.string(),
        message: z.string(),
        authorName: z.string().nullable(),
        date: z.string(),
    })).max(200).optional(),
    projectName: z.string().max(200).optional(),
    projectOwner: z.string().max(200).optional(),
    apiKey: z.string().optional(),
    model: z.string().max(100).optional(),
    baseUrl: z.string().url().optional(),
}).refine(
    (data) => {
        if (data.type === 'commit') return !!data.commitSha;
        if (data.type === 'question') return !!data.question;
        if (data.type === 'day-summary') return !!data.commits && data.commits.length > 0;
        return true;
    },
    { message: 'Invalid request: missing required fields for type' }
).refine(
    (data) => {
        // Either nested provider OR flat providerType must be provided
        return !!(data.provider?.type || data.providerType);
    },
    { message: 'Either provider.type or providerType is required' }
).refine(
    (data) => {
        const nestedApiKey = data.provider?.apiKey;
        const flatApiKey = data.apiKey;
        const hasNestedApiKey = typeof nestedApiKey === 'string' && nestedApiKey.trim().length > 0;
        const hasFlatApiKey = typeof flatApiKey === 'string' && flatApiKey.trim().length > 0;
        return !hasNestedApiKey && !hasFlatApiKey;
    },
    { message: 'Client API keys are not accepted in explain payloads. Store keys via /api/ai/credentials first.' }
);

// Repository ingest request
export const ingestRepoSchema = z.object({
    url: githubUrlSchema,
    branch: z.string().optional().default('main'),
});

// Pagination params
export const paginationSchema = z.object({
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(100).default(50),
});

// Commit query params
export const commitQuerySchema = z.object({
    repoId: z.number().int().positive(),
    page: z.number().int().positive().optional().default(1),
    limit: z.number().int().positive().max(100).optional().default(50),
});
