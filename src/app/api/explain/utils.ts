import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { files } from '@/db';
import { shouldFetchFileContent } from '@/lib/file-utils';
import { normalizeProviderBaseUrl } from '@/lib/network-security';
import type { Database } from '@/db';
import type { AIProviderConfig } from '@/services/ai-providers';
import { isLocalProvider } from '@/services/ai-providers';
import {
    AI_CREDENTIALS_SESSION_COOKIE,
    getStoredProviderApiKey,
    resolveCredentialSessionId,
} from '@/services/ai-credentials';

export function normalizePath(path: string): string {
    return path.trim().replace(/^\/+/, '').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

export function isOpenableFilePath(path: string, size: number, hasContent: boolean): boolean {
    if (hasContent) return true;
    return shouldFetchFileContent(path, size);
}

export async function resolveAvailableFilePathsForCommit(
    db: Database,
    commitId: number,
    visibleFiles?: string[]
): Promise<string[]> {
    if (visibleFiles && visibleFiles.length > 0) {
        return Array.from(
            new Set(
                visibleFiles
                    .map(normalizePath)
                    .filter(Boolean)
            )
        );
    }

    const commitFiles = await db.select({
        path: files.path,
        size: files.size,
        content: files.content,
    })
        .from(files)
        .where(eq(files.commitId, commitId));

    return commitFiles
        .filter((file: { path: string; size: number | null; content: string | null }) =>
            isOpenableFilePath(file.path, Number(file.size || 0), Boolean(file.content))
        )
        .map((file: { path: string }) => normalizePath(file.path));
}

export async function resolveProviderConfigFromRequest(
    request: NextRequest,
    provider: Pick<AIProviderConfig, 'type' | 'model' | 'baseUrl'>,
    resolvedSessionId?: string | null
): Promise<AIProviderConfig> {
    const normalizedBaseUrl = normalizeProviderBaseUrl(provider.type, provider.baseUrl);

    const config: AIProviderConfig = {
        type: provider.type,
        model: provider.model,
        baseUrl: normalizedBaseUrl,
    };

    if (isLocalProvider(provider.type)) {
        return config;
    }

    let sessionId = resolvedSessionId;
    if (sessionId == null) {
        const sessionToken = request.cookies.get(AI_CREDENTIALS_SESSION_COOKIE)?.value;
        sessionId = await resolveCredentialSessionId(sessionToken);
    }
    if (!sessionId) {
        return config;
    }

    const storedApiKey = await getStoredProviderApiKey(sessionId, provider.type);
    if (storedApiKey) {
        config.apiKey = storedApiKey;
    }

    return config;
}
