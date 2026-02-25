/**
 * AI Provider service using Vercel AI SDK
 * Supports multiple providers with server-side secret resolution
 * Uses dynamic imports to reduce initial bundle size
 */

import type { LanguageModel } from 'ai';
import { createHash } from 'node:crypto';

export type AIProviderType = 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'lmstudio' | 'glm' | 'kimi';
type CloudAIProviderType = Exclude<AIProviderType, 'ollama' | 'lmstudio'>;

export interface AIProviderConfig {
    type: AIProviderType;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}

// Default models for each provider
const DEFAULT_MODELS: Record<AIProviderType, string> = {
    gemini: 'gemini-3.1-pro',
    openai: 'gpt-5.2',
    anthropic: 'claude-sonnet-4.6',
    ollama: 'llama-4-scout',
    lmstudio: 'deepseek-r1-distill-llama-8b',
    glm: 'glm-5',
    kimi: 'kimi-k2.5',
};

const GEMINI_LEGACY_MODEL_ALIASES: Record<string, string> = {
    'gemini-2.0-pro-exp-02-05': 'gemini-2.5-pro',
};

type GeminiModelEntry = {
    name?: string;
    supportedGenerationMethods?: string[];
};

const GEMINI_DISCOVERY_TTL_MS = 10 * 60 * 1000;
const geminiDiscoveryCache = new Map<string, { models: string[]; expiresAt: number }>();

const PROVIDER_API_KEY_ENV_CANDIDATES: Record<CloudAIProviderType, string[]> = {
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
    glm: ['GLM_API_KEY', 'ZHIPU_API_KEY', 'BIGMODEL_API_KEY'],
    kimi: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
};

export function isLocalProvider(type: AIProviderType): type is 'ollama' | 'lmstudio' {
    return type === 'ollama' || type === 'lmstudio';
}

function isCloudProvider(type: AIProviderType): type is CloudAIProviderType {
    return !isLocalProvider(type);
}

export function getProviderApiKeyEnvCandidates(type: AIProviderType): string[] {
    if (!isCloudProvider(type)) return [];
    return PROVIDER_API_KEY_ENV_CANDIDATES[type];
}

export function getMissingApiKeyError(type: AIProviderType): string | null {
    if (isLocalProvider(type)) return null;
    const candidates = getProviderApiKeyEnvCandidates(type);
    return `Missing server API key for ${PROVIDER_NAMES[type]}. Set one of: ${candidates.join(', ')}`;
}

export function resolveProviderApiKey(type: AIProviderType, explicitApiKey?: string): string | undefined {
    if (explicitApiKey) {
        const trimmed = explicitApiKey.trim();
        if (trimmed) return trimmed;
    }

    if (isLocalProvider(type)) return undefined;

    const candidates = getProviderApiKeyEnvCandidates(type);
    for (const envName of candidates) {
        const value = process.env[envName];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }

    return undefined;
}

function normalizeGeminiModelName(name: string): string {
    const trimmed = name.trim();
    const withoutPrefix = trimmed.replace(/^models\//, '');
    return GEMINI_LEGACY_MODEL_ALIASES[withoutPrefix] || withoutPrefix;
}

function modelSupportsGenerateContent(model: GeminiModelEntry): boolean {
    const methods = model.supportedGenerationMethods;
    if (!Array.isArray(methods) || methods.length === 0) {
        return true;
    }
    return methods.includes('generateContent');
}

function getGeminiDiscoveryCacheKey(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('base64url');
}

async function fetchAvailableGeminiModels(apiKey: string): Promise<string[]> {
    const cacheKey = getGeminiDiscoveryCacheKey(apiKey);
    const cached = geminiDiscoveryCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
        return cached.models;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch Gemini models: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as { models?: GeminiModelEntry[] };
    const models = Array.from(
        new Set(
            (payload.models || [])
                .filter(modelSupportsGenerateContent)
                .map(model => model.name || '')
                .map(name => normalizeGeminiModelName(name))
                .filter(Boolean)
        )
    );

    geminiDiscoveryCache.set(cacheKey, { models, expiresAt: now + GEMINI_DISCOVERY_TTL_MS });
    return models;
}

function pickGeminiModel(requestedModel: string | undefined, discoveredModels: string[]): string {
    const normalizedRequested = requestedModel ? normalizeGeminiModelName(requestedModel) : undefined;
    if (normalizedRequested && discoveredModels.includes(normalizedRequested)) {
        return normalizedRequested;
    }

    const preferredOrder = [
        'gemini-3.1-pro',
        'gemini-3.1-flash',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
    ];

    const preferredAvailable = preferredOrder.find(model => discoveredModels.includes(model));
    if (preferredAvailable) return preferredAvailable;

    if (discoveredModels.length > 0) {
        return discoveredModels[0];
    }

    return normalizedRequested || DEFAULT_MODELS.gemini;
}

/**
 * Create an AI provider instance based on configuration
 * Uses dynamic imports to avoid bundling all providers
 */
export async function createAIProviderAsync(config: AIProviderConfig): Promise<LanguageModel> {
    const requestedModel = config.model || DEFAULT_MODELS[config.type];
    const resolvedApiKey = resolveProviderApiKey(config.type, config.apiKey);
    const missingApiKeyError = getMissingApiKeyError(config.type);

    switch (config.type) {
        case 'gemini': {
            if (!resolvedApiKey) throw new Error(missingApiKeyError || 'Gemini API key is required');
            const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
            const google = createGoogleGenerativeAI({ apiKey: resolvedApiKey });
            let discoveredModels: string[] = [];
            try {
                discoveredModels = await fetchAvailableGeminiModels(resolvedApiKey);
            } catch {
                // Discovery is best-effort. We still attempt with fallback/default model.
            }

            const resolvedModel = pickGeminiModel(requestedModel, discoveredModels);
            return google(resolvedModel);
        }

        case 'openai': {
            if (!resolvedApiKey) throw new Error(missingApiKeyError || 'OpenAI API key is required');
            const { createOpenAI } = await import('@ai-sdk/openai');
            const openai = createOpenAI({ apiKey: resolvedApiKey });
            return openai(requestedModel);
        }

        case 'anthropic': {
            if (!resolvedApiKey) throw new Error(missingApiKeyError || 'Anthropic API key is required');
            const { createAnthropic } = await import('@ai-sdk/anthropic');
            const anthropic = createAnthropic({ apiKey: resolvedApiKey });
            return anthropic(requestedModel);
        }

        case 'ollama': {
            const baseURL = config.baseUrl || 'http://localhost:11434/v1';
            const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
            const ollama = createOpenAICompatible({
                name: 'ollama',
                baseURL,
                apiKey: 'ollama',
            });
            return ollama(requestedModel);
        }

        case 'lmstudio': {
            const lmstudioURL = config.baseUrl || 'http://127.0.0.1:1234/v1';
            const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
            const lmstudio = createOpenAICompatible({
                name: 'lmstudio',
                baseURL: lmstudioURL,
                apiKey: 'lmstudio',
            });
            return lmstudio(requestedModel);
        }

        case 'glm': {
            if (!resolvedApiKey) throw new Error(missingApiKeyError || 'GLM API key is required');
            const baseURL = config.baseUrl || 'https://open.bigmodel.cn/api/paas/v4/';
            const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
            const glm = createOpenAICompatible({
                name: 'glm',
                baseURL,
                apiKey: resolvedApiKey,
            });
            return glm(requestedModel);
        }

        case 'kimi': {
            if (!resolvedApiKey) throw new Error(missingApiKeyError || 'Kimi API key is required');
            const baseURL = config.baseUrl || 'https://api.moonshot.cn/v1';
            const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
            const kimi = createOpenAICompatible({
                name: 'kimi',
                baseURL,
                apiKey: resolvedApiKey,
            });
            return kimi(requestedModel);
        }

        default:
            throw new Error(`Unknown provider type: ${config.type}`);
    }
}

/**
 * Get available models for a provider
 */
export function getAvailableModels(type: AIProviderType): string[] {
    switch (type) {
        case 'gemini':
            return [
                'gemini-3.1-pro',
                'gemini-3.1-flash',
                'gemini-2.5-pro',
                'gemini-2.5-flash',
                'gemini-2.0-flash',
                'gemini-1.5-pro',
                'gemini-1.5-flash',
            ];
        case 'openai':
            return [
                'gpt-5.3-codex',
                'gpt-5.2',
                'gpt-5.1',
                'o3-mini',
                'o1',
            ];
        case 'anthropic':
            return [
                'claude-sonnet-4.6',
                'claude-opus-4.6',
                'claude-3-5-sonnet-20241022',
                'claude-3-5-haiku-20241022',
            ];
        case 'ollama':
            return ['llama-4-scout', 'llama3.2', 'llama3.1', 'codellama', 'mistral', 'phi3', 'qwen2.5', 'qwen3:8b', 'meta-llama-3.1-8b-instruct', 'qwen2.5-7b-instruct'];
        case 'lmstudio':
            return ['deepseek-r1-distill-llama-8b', 'meta-llama-3.1-8b-instruct', 'qwen2.5-7b-instruct'];
        case 'glm':
            return ['glm-5', 'glm-4-plus', 'glm-4'];
        case 'kimi':
            return ['kimi-k2.5', 'kimi-v1'];
        default:
            return [];
    }
}

/**
 * Provider display names
 */
export const PROVIDER_NAMES: Record<AIProviderType, string> = {
    gemini: 'Google Gemini',
    openai: 'OpenAI GPT',
    anthropic: 'Anthropic Claude',
    ollama: 'Ollama (Local)',
    lmstudio: 'LMStudio (Local)',
    glm: 'GLM (Zhipu)',
    kimi: 'Kimi (Moonshot)',
};
