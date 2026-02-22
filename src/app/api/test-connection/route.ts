import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { aiProviderTypeSchema } from '@/lib/validation';
import type { AIProviderType } from '@/services/ai-providers';

const testConnectionSchema = z
    .object({
        provider: aiProviderTypeSchema.optional(),
        type: aiProviderTypeSchema.optional(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
    })
    .superRefine((data, ctx) => {
        const providerType = data.provider ?? data.type;
        if (!providerType) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'provider or type is required',
            });
            return;
        }

        const isLocal = providerType === 'ollama' || providerType === 'lmstudio';
        if (!isLocal && !data.apiKey) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'API key is required for cloud providers',
            });
        }

        if (data.baseUrl) {
            try {
                new URL(data.baseUrl);
            } catch {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'baseUrl must be a valid URL',
                });
            }
        }
    });

type ModelEntry = { id?: string; name?: string };

function normalizeModels(models: unknown): string[] {
    if (!Array.isArray(models)) return [];
    return (models as ModelEntry[])
        .map((model) => model.id || model.name)
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.replace(/^models\//, ''));
}

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetch(url, init);
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (!response.ok) {
        const error = data?.error;
        const message =
            (typeof error === 'string' && error) ||
            (typeof error === 'object' && error !== null && 'message' in error && typeof (error as Record<string, unknown>).message === 'string' && (error as Record<string, unknown>).message) ||
            (typeof data?.message === 'string' && data.message) ||
            `${response.status} ${response.statusText}`;
        throw new Error(message as string);
    }

    return data ?? {};
}

async function fetchModels(provider: AIProviderType, apiKey?: string, baseUrl?: string): Promise<string[]> {
    switch (provider) {
        case 'openai': {
            const data = await fetchJson('https://api.openai.com/v1/models', {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
            });
            return normalizeModels(data.data);
        }

        case 'anthropic': {
            const data = await fetchJson('https://api.anthropic.com/v1/models', {
                headers: {
                    'x-api-key': String(apiKey || ''),
                    'anthropic-version': '2023-06-01',
                },
            });
            return normalizeModels(data.data);
        }

        case 'gemini': {
            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
                String(apiKey || '')
            )}`;
            const data = await fetchJson(url);
            return normalizeModels(data.models);
        }

        case 'ollama':
        case 'lmstudio': {
            const defaultBase =
                provider === 'ollama' ? 'http://localhost:11434/v1' : 'http://127.0.0.1:1234/v1';
            const rawBase = (baseUrl || defaultBase).trim().replace(/\/+$/, '');
            const baseWithV1 = rawBase.endsWith('/v1') ? rawBase : `${rawBase}/v1`;

            const headers: Record<string, string> = {};
            if (apiKey) {
                headers.Authorization = `Bearer ${apiKey}`;
            }

            const endpoints = [`${baseWithV1}/models`];
            if (provider === 'ollama') {
                const root = rawBase.replace(/\/v1$/, '');
                endpoints.push(`${root}/api/tags`);
            }

            let lastError: Error | null = null;
            for (const endpoint of endpoints) {
                try {
                    const data = await fetchJson(endpoint, { headers });
                    const models = normalizeModels(data.data || data.models);
                    if (models.length) return models;
                    return [];
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error('Connection failed');
                }
            }

            throw lastError || new Error('Connection failed');
        }

        default:
            throw new Error('Unsupported provider');
    }
}

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: '/api/test-connection' });

    try {
        const rawBody = await request.json().catch(() => null);
        if (!rawBody) {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const parseResult = testConnectionSchema.safeParse(rawBody);
        if (!parseResult.success) {
            return NextResponse.json(
                {
                    error: 'Validation failed',
                    details: parseResult.error.issues,
                },
                { status: 400 }
            );
        }

        const { provider, type, apiKey, baseUrl } = parseResult.data;
        const providerType = (provider || type) as AIProviderType;

        const models = await fetchModels(providerType, apiKey, baseUrl);

        return NextResponse.json({ models });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Connection failed';
        requestLogger.error({ error, message }, 'Test connection failed');
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
