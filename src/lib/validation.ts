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
    type: z.enum(['gemini', 'openai', 'anthropic', 'ollama', 'lmstudio']),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    model: z.string().optional(),
}).refine(
    (config) => {
        const localProviders = ['ollama', 'lmstudio'];
        if (localProviders.includes(config.type)) {
            return true;
        }
        return !!config.apiKey;
    },
    { message: 'API key is required for cloud providers' }
);

// AI Provider type enum for reuse
export const aiProviderTypeSchema = z.enum(['gemini', 'openai', 'anthropic', 'ollama', 'lmstudio']);
export type AIProviderTypeFromSchema = z.infer<typeof aiProviderTypeSchema>;

// Explain API request
export const explainRequestSchema = z.object({
    type: z.enum(['commit', 'project', 'question', 'day-summary']),
    repoId: z.number().int().positive(),
    commitSha: z.string().optional(),
    question: z.string().optional(),
    provider: aiProviderConfigSchema.optional(),
    // Flat params for backward compatibility
    providerType: aiProviderTypeSchema.optional(),
    commits: z.array(z.object({
        sha: z.string(),
        message: z.string(),
        authorName: z.string().nullable(),
        date: z.string(),
    })).optional(),
    projectName: z.string().optional(),
    projectOwner: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
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
