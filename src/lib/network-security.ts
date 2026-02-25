import type { AIProviderType } from '@/services/ai-providers';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function normalizeHost(hostname: string): string {
    return hostname.trim().toLowerCase();
}

function isAllowedLoopbackHost(hostname: string): boolean {
    return LOOPBACK_HOSTS.has(normalizeHost(hostname));
}

export function normalizeProviderBaseUrl(
    provider: AIProviderType,
    baseUrl?: string
): string | undefined {
    if (!baseUrl) return undefined;

    const parsed = new URL(baseUrl.trim());
    if (parsed.username || parsed.password) {
        throw new Error('Base URL credentials are not allowed');
    }

    const protocol = parsed.protocol.toLowerCase();
    const host = normalizeHost(parsed.hostname);

    switch (provider) {
        case 'ollama':
        case 'lmstudio': {
            if (protocol !== 'http:' && protocol !== 'https:') {
                throw new Error('Local provider base URL must use HTTP/HTTPS');
            }
            if (!isAllowedLoopbackHost(host)) {
                throw new Error('Local provider base URL must target localhost or loopback');
            }
            break;
        }
        case 'glm': {
            if (protocol !== 'https:') {
                throw new Error('GLM base URL must use HTTPS');
            }
            if (host !== 'open.bigmodel.cn') {
                throw new Error('GLM base URL host is not allowed');
            }
            break;
        }
        case 'kimi': {
            if (protocol !== 'https:') {
                throw new Error('Kimi base URL must use HTTPS');
            }
            if (host !== 'api.moonshot.cn') {
                throw new Error('Kimi base URL host is not allowed');
            }
            break;
        }
        case 'openai':
        case 'anthropic':
        case 'gemini': {
            throw new Error(`Custom base URL is not allowed for ${provider}`);
        }
        default:
            throw new Error('Unsupported provider');
    }

    return parsed.toString().replace(/\/+$/, '');
}

