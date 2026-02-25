import { getPlatformEnv } from '@/lib/platform/context';
import { logger } from '@/lib/logger';
import type { PlatformCache } from '@/lib/platform/types';
import type { AIProviderType } from './ai-providers';

const credentialsLogger = logger.child({ service: 'ai-credentials' });

export const AI_CREDENTIALS_SESSION_COOKIE = 'grepbase_ai_session';
export const AI_CREDENTIALS_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const CACHE_KEY_PREFIX = 'ai:credentials:';
const SESSION_TOKEN_VERSION = 'v1';
const PROVIDERS: AIProviderType[] = ['gemini', 'openai', 'anthropic', 'ollama', 'lmstudio', 'glm', 'kimi'];
const ENCRYPTION_SECRET_ENV_KEYS = ['AI_CREDENTIALS_ENCRYPTION_KEY', 'AI_CREDENTIALS_SECRET', 'SESSION_SECRET'] as const;
const SIGNING_SECRET_ENV_KEYS = ['AI_CREDENTIALS_SIGNING_KEY', ...ENCRYPTION_SECRET_ENV_KEYS] as const;

type StoredCredentialMap = Partial<Record<AIProviderType, string>>;
type EncryptedCredentialBlob = {
    version: 1;
    iv: string;
    data: string;
};

let encryptionKeyPromise: Promise<CryptoKey> | null = null;
let signingKeyPromise: Promise<CryptoKey> | null = null;

function toBase64(data: ArrayBuffer | Uint8Array): string {
    return Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data)).toString('base64');
}

function fromBase64(data: string): Uint8Array {
    return Uint8Array.from(Buffer.from(data, 'base64'));
}

function toBase64Url(data: ArrayBuffer | Uint8Array): string {
    return Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data)).toString('base64url');
}

function fromBase64Url(data: string): Uint8Array {
    return Uint8Array.from(Buffer.from(data, 'base64url'));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isProvider(value: string): value is AIProviderType {
    return PROVIDERS.includes(value as AIProviderType);
}

function normalizeCredentialMap(raw: unknown): StoredCredentialMap {
    if (!raw || typeof raw !== 'object') return {};

    const normalized: StoredCredentialMap = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!isProvider(key)) continue;
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (!trimmed) continue;
        normalized[key] = trimmed;
    }

    return normalized;
}

function resolveSecret(
    envKeys: readonly string[],
    warningContext: string
): string {
    for (const envKey of envKeys) {
        const value = process.env[envKey];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }

    throw new Error(`Missing required secret for ${warningContext}. Set one of: ${envKeys.join(', ')}`);
}

function getEncryptionSecret(): string {
    return resolveSecret(ENCRYPTION_SECRET_ENV_KEYS, 'AI credentials encryption');
}

function getSigningSecret(): string {
    return resolveSecret(SIGNING_SECRET_ENV_KEYS, 'AI credentials session signing');
}

function getCredentialKVOrThrow(): PlatformCache {
    let kv: PlatformCache | null = null;

    try {
        kv = getPlatformEnv().getCache();
    } catch (error) {
        throw new Error(
            `AI credential storage requires platform KV configuration. ${error instanceof Error ? error.message : ''}`.trim()
        );
    }

    if (!kv) {
        throw new Error(
            'AI credential storage requires KV namespace configuration (e.g., CLOUDFLARE_KV_NAMESPACE_ID).'
        );
    }

    return kv;
}

async function getEncryptionKey(): Promise<CryptoKey> {
    if (!encryptionKeyPromise) {
        encryptionKeyPromise = (async () => {
            const secret = getEncryptionSecret();
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
            return crypto.subtle.importKey(
                'raw',
                digest,
                { name: 'AES-GCM' },
                false,
                ['encrypt', 'decrypt']
            );
        })();
    }

    return encryptionKeyPromise;
}

async function getSigningKey(): Promise<CryptoKey> {
    if (!signingKeyPromise) {
        signingKeyPromise = (async () => {
            const secret = getSigningSecret();
            return crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(secret),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign', 'verify']
            );
        })();
    }

    return signingKeyPromise;
}

async function getStorageKey(sessionId: string): Promise<string> {
    const secret = getSigningSecret();
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${secret}:${sessionId}`)
    );
    return `${CACHE_KEY_PREFIX}${toBase64Url(digest)}`;
}

async function signSessionId(sessionId: string): Promise<string> {
    const key = await getSigningKey();
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sessionId));
    return toBase64Url(signature);
}

export async function issueCredentialSessionToken(
    existingSessionId?: string
): Promise<{ sessionId: string; token: string }> {
    const sessionId = existingSessionId || crypto.randomUUID();
    const signature = await signSessionId(sessionId);
    return {
        sessionId,
        token: `${SESSION_TOKEN_VERSION}.${sessionId}.${signature}`,
    };
}

export async function resolveCredentialSessionId(token?: string | null): Promise<string | null> {
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [version, sessionId, signatureBase64] = parts;
    if (version !== SESSION_TOKEN_VERSION || !sessionId || !signatureBase64) {
        return null;
    }

    try {
        const key = await getSigningKey();
        const valid = await crypto.subtle.verify(
            'HMAC',
            key,
            toArrayBuffer(fromBase64Url(signatureBase64)),
            new TextEncoder().encode(sessionId)
        );
        return valid ? sessionId : null;
    } catch {
        return null;
    }
}

async function encryptCredentialMap(value: StoredCredentialMap): Promise<EncryptedCredentialBlob> {
    const key = await getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = new TextEncoder().encode(JSON.stringify(value));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);

    return {
        version: 1,
        iv: toBase64(iv),
        data: toBase64(encrypted),
    };
}

async function decryptCredentialMap(blob: EncryptedCredentialBlob): Promise<StoredCredentialMap> {
    if (!blob || blob.version !== 1) return {};
    if (typeof blob.iv !== 'string' || typeof blob.data !== 'string') return {};

    const key = await getEncryptionKey();
    const iv = toArrayBuffer(fromBase64(blob.iv));
    const encrypted = toArrayBuffer(fromBase64(blob.data));
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
    return normalizeCredentialMap(JSON.parse(new TextDecoder().decode(decrypted)) as unknown);
}

async function readBlob(sessionId: string): Promise<EncryptedCredentialBlob | null> {
    const kv = getCredentialKVOrThrow();
    const key = await getStorageKey(sessionId);
    const blob = await kv.get<EncryptedCredentialBlob>(key);
    return blob && typeof blob === 'object' ? blob : null;
}

async function writeBlob(sessionId: string, blob: EncryptedCredentialBlob): Promise<void> {
    const kv = getCredentialKVOrThrow();
    const key = await getStorageKey(sessionId);
    await kv.set(key, blob, AI_CREDENTIALS_TTL_SECONDS);
}

async function deleteBlob(sessionId: string): Promise<void> {
    const kv = getCredentialKVOrThrow();
    const key = await getStorageKey(sessionId);
    await kv.delete(key);
}

async function getStoredCredentialMap(sessionId: string): Promise<StoredCredentialMap> {
    const blob = await readBlob(sessionId);
    if (!blob) return {};

    try {
        return await decryptCredentialMap(blob);
    } catch (error) {
        credentialsLogger.warn({ sessionId, error }, 'Failed to decrypt credential map; clearing stored credentials');
        await deleteBlob(sessionId);
        return {};
    }
}

export async function upsertStoredProviderApiKey(
    sessionId: string,
    provider: AIProviderType,
    apiKey: string
): Promise<void> {
    const nextApiKey = apiKey.trim();
    const credentials = await getStoredCredentialMap(sessionId);

    if (nextApiKey.length === 0) {
        delete credentials[provider];
    } else {
        credentials[provider] = nextApiKey;
    }

    if (Object.keys(credentials).length === 0) {
        await deleteBlob(sessionId);
        return;
    }

    await writeBlob(sessionId, await encryptCredentialMap(credentials));
}

export async function getStoredProviderApiKey(
    sessionId: string,
    provider: AIProviderType
): Promise<string | null> {
    const credentials = await getStoredCredentialMap(sessionId);
    const value = credentials[provider];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function getStoredProviderStatus(
    sessionId: string
): Promise<Record<AIProviderType, boolean>> {
    const credentials = await getStoredCredentialMap(sessionId);
    return {
        gemini: Boolean(credentials.gemini),
        openai: Boolean(credentials.openai),
        anthropic: Boolean(credentials.anthropic),
        ollama: Boolean(credentials.ollama),
        lmstudio: Boolean(credentials.lmstudio),
        glm: Boolean(credentials.glm),
        kimi: Boolean(credentials.kimi),
    };
}
