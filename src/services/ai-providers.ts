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
    gemini: 'gemini-2.5-pro',
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    ollama: 'llama4:scout',
    lmstudio: 'llama4-scout',
    glm: 'glm-4.7',
    kimi: 'kimi-k3',
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
    return name.trim().replace(/^models\//, '');
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

    const url = 'https://generativelanguage.googleapis.com/v1beta/models';
    const response = await fetch(url, {
        headers: { 'x-goog-api-key': apiKey },
    });
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
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
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
                'gemini-2.5-pro',
                'gemini-2.5-flash',
                'gemini-2.5-flash-lite',
                'gemini-2.0-flash',
            ];
        case 'openai':
            return [
                'gpt-4o',
                'gpt-4o-mini',
                'gpt-5.6-sol',
                'gpt-5.6-terra',
                'gpt-5.6-luna',
                'o3',
                'o3-pro',
                'o4-mini',
                'o1',
                'o1-mini',
            ];
        case 'anthropic':
            return [
                'claude-opus-4-8',
                'claude-opus-4-7',
                'claude-opus-4-6',
                'claude-sonnet-4-6',
                'claude-sonnet-4-5',
                'claude-haiku-4-5',
            ];
        case 'ollama':
            return [
                'llama4:scout',
                'llama4:maverick',
                'qwen3.6:27b',
                'qwen3:8b',
                'qwen3:30b',
                'qwen3:235b',
                'gemma3:9b',
                'deepseek-r1:14b',
                'deepseek-r1:32b',
                'phi4:14b',
            ];
        case 'lmstudio':
            return [
                'llama4-scout',
                'llama4-maverick',
                'qwen3-30b-a3b',
                'qwen3-8b',
                'gemma3-9b-it',
                'deepseek-r1-distill-qwen-14b',
                'deepseek-r1-distill-llama-8b',
            ];
        case 'glm':
            return [
                'glm-4.7',
                'glm-4.7-flash',
                'glm-4.7-flashx',
                'glm-4.6',
                'glm-4.5',
            ];
        case 'kimi':
            return [
                'kimi-k3',
                'kimi-k2.7-code',
                'kimi-k2.7-code-highspeed',
                'kimi-k2.6',
                'moonshot-v1-128k',
                'moonshot-v1-32k',
                'moonshot-v1-8k',
            ];
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

/**
 * Short descriptions for models shown in the selection UI
 */
export const MODEL_DESCRIPTIONS: Record<string, string> = {
    // Gemini
    'gemini-2.5-pro': 'Most capable, adaptive thinking',
    'gemini-2.5-flash': 'Fast, price-performance optimized',
    'gemini-2.5-flash-lite': 'Fastest, most cost-efficient',
    'gemini-2.0-flash': 'Previous-gen, still capable',
    // OpenAI
    'gpt-4o': 'Versatile, high-intelligence flagship',
    'gpt-4o-mini': 'Fast, affordable small model',
    'gpt-5.6-sol': 'Flagship for complex reasoning & coding',
    'gpt-5.6-terra': 'Balanced intelligence and cost',
    'gpt-5.6-luna': 'Cost-sensitive, high-volume workloads',
    'o3': 'Powerful reasoning model',
    'o3-pro': 'Extra compute for better responses',
    'o4-mini': 'Fast, cost-efficient reasoning',
    'o1': 'Strong reasoning capabilities',
    'o1-mini': 'Affordable reasoning model',
    // Anthropic
    'claude-opus-4-8': 'Most capable, agentic coding & enterprise',
    'claude-opus-4-7': 'Advanced reasoning, 1M context',
    'claude-opus-4-6': 'Excellent code review & debugging',
    'claude-sonnet-4-6': 'Best speed + intelligence balance',
    'claude-sonnet-4-5': 'Strong all-around performance',
    'claude-haiku-4-5': 'Fastest, near-frontier intelligence',
    // Ollama
    'llama4:scout': 'Meta Llama 4, 10M context, MoE',
    'llama4:maverick': 'Higher quality, 400B MoE',
    'qwen3.6:27b': 'Best local coding model (SWE-bench 77%)',
    'qwen3:8b': 'Efficient all-rounder',
    'qwen3:30b': 'Strong MoE, 256K context',
    'qwen3:235b': 'Frontier-level, 235B MoE',
    'gemma3:9b': 'Google, vision support',
    'deepseek-r1:14b': 'Reasoning & math specialist',
    'deepseek-r1:32b': 'Advanced reasoning, 32B',
    'phi4:14b': 'Microsoft, strong for its size',
    // LMStudio
    'llama4-scout': 'Meta Llama 4, general-purpose',
    'llama4-maverick': 'Higher quality, 400B MoE',
    'qwen3-30b-a3b': 'Strong MoE coding model',
    'qwen3-8b': 'Efficient all-rounder',
    'gemma3-9b-it': 'Google, vision support',
    'deepseek-r1-distill-qwen-14b': 'Distilled reasoning, 14B',
    'deepseek-r1-distill-llama-8b': 'Distilled reasoning, 8B',
    // GLM
    'glm-4.7': 'Latest flagship, coding & reasoning',
    'glm-4.7-flash': 'Free-tier, fast & efficient',
    'glm-4.7-flashx': 'Enhanced flash variant',
    'glm-4.6': 'Strong coding capabilities',
    'glm-4.5': 'Native agentic LLM',
    // Kimi
    'kimi-k3': 'Most capable, 2.8T params, 1M context',
    'kimi-k2.7-code': 'Dedicated coding model',
    'kimi-k2.7-code-highspeed': 'Fast coding, ~180 tok/s',
    'kimi-k2.6': 'Visual + text, thinking modes',
    'moonshot-v1-128k': 'Very long context (128K)',
    'moonshot-v1-32k': 'Long context (32K)',
    'moonshot-v1-8k': 'Short context (8K)',
};
