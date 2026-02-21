/**
 * AI Provider service using Vercel AI SDK
 * Supports multiple providers with BYOK (Bring Your Own Key)
 * Uses dynamic imports to reduce initial bundle size
 */

import type { LanguageModel } from 'ai';

export type AIProviderType = 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'lmstudio' | 'glm' | 'kimi';

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

/**
 * Create an AI provider instance based on configuration
 * Uses dynamic imports to avoid bundling all providers
 */
export async function createAIProviderAsync(config: AIProviderConfig): Promise<LanguageModel> {
    const model = config.model || DEFAULT_MODELS[config.type];

    switch (config.type) {
        case 'gemini': {
            if (!config.apiKey) throw new Error('Gemini API key is required');
            const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
            const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
            return google(model);
        }

        case 'openai': {
            if (!config.apiKey) throw new Error('OpenAI API key is required');
            const { createOpenAI } = await import('@ai-sdk/openai');
            const openai = createOpenAI({ apiKey: config.apiKey });
            return openai(model);
        }

        case 'anthropic': {
            if (!config.apiKey) throw new Error('Anthropic API key is required');
            const { createAnthropic } = await import('@ai-sdk/anthropic');
            const anthropic = createAnthropic({ apiKey: config.apiKey });
            return anthropic(model);
        }

        case 'ollama': {
            const baseURL = config.baseUrl || 'http://localhost:11434/v1';
            const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
            const ollama = createOpenAICompatible({
                name: 'ollama',
                baseURL,
                apiKey: 'ollama',
            });
            return ollama(model);
        }

        case 'lmstudio': {
            const lmstudioURL = config.baseUrl || 'http://127.0.0.1:1234/v1';
            const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
            const lmstudio = createOpenAICompatible({
                name: 'lmstudio',
                baseURL: lmstudioURL,
                apiKey: 'lmstudio',
            });
            return lmstudio(model);
        }

        case 'glm': {
            const baseURL = config.baseUrl || 'https://open.bigmodel.cn/api/paas/v4/';
            const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
            const glm = createOpenAICompatible({
                name: 'glm',
                baseURL,
                apiKey: config.apiKey,
            });
            return glm(model);
        }

        case 'kimi': {
            const baseURL = config.baseUrl || 'https://api.moonshot.cn/v1';
            const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
            const kimi = createOpenAICompatible({
                name: 'kimi',
                baseURL,
                apiKey: config.apiKey,
            });
            return kimi(model);
        }

        default:
            throw new Error(`Unknown provider type: ${config.type}`);
    }
}

// Synchronous version for backward compatibility (re-exports dynamic version)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createAIProvider(_config: AIProviderConfig): LanguageModel {
    // This is a workaround - we need to make callers await the result
    throw new Error('Use createAIProviderAsync instead for edge runtime compatibility');
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
                'gemini-2.0-flash',
                'gemini-2.0-pro-exp-02-05',
                'gemini-1.5-pro',
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
            return ['llama-4-scout', 'llama3.2', 'llama3.1', 'codellama', 'mistral', 'phi3', 'qwen2.5', 'meta-llama-3.1-8b-instruct', 'qwen2.5-7b-instruct'];
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
