import { getPlatformEnv } from '@/lib/platform/context';
import { logger } from '@/lib/logger';
import type { PlatformCache } from '@/lib/platform/types';
import { RESOURCE_ACCESS, shouldFailOpen } from '@/lib/constants';

const accessLogger = logger.child({ service: 'resource-access' });

const REPO_ACCESS_PREFIX = 'access:repo:';
const SESSION_REPOS_PREFIX = 'access:session:repos:';
const JOB_ACCESS_PREFIX = 'access:job:';
const REPO_SESSION_ACCESS_PREFIX = 'access:repo-session:';
const JOB_SESSION_ACCESS_PREFIX = 'access:job-session:';

interface RepoAccessBlob {
    version: 1;
    sessions: string[];
}

interface SessionReposBlob {
    version: 1;
    repoIds: string[];
}

interface JobAccessBlob {
    version: 1;
    sessions: string[];
}

function getAccessStoreOrFailOpen(): PlatformCache | null {
    try {
        const platform = getPlatformEnv();
        return platform.getCache();
    } catch {
        return null;
    }
}

function getRepoAccessKey(repoId: string): string {
    return `${REPO_ACCESS_PREFIX}${repoId}`;
}

function getSessionReposKey(sessionId: string): string {
    return `${SESSION_REPOS_PREFIX}${sessionId}`;
}

function getJobAccessKey(jobId: string): string {
    return `${JOB_ACCESS_PREFIX}${jobId}`;
}

function getRepoSessionAccessKey(repoId: string, sessionId: string): string {
    return `${REPO_SESSION_ACCESS_PREFIX}${repoId}:${sessionId}`;
}

function getJobSessionAccessKey(jobId: string, sessionId: string): string {
    return `${JOB_SESSION_ACCESS_PREFIX}${jobId}:${sessionId}`;
}

function normalizeRepoAccess(blob: unknown): RepoAccessBlob {
    if (!blob || typeof blob !== 'object') {
        return { version: 1, sessions: [] };
    }
    const sessions = Array.isArray((blob as { sessions?: unknown }).sessions)
        ? (blob as { sessions: unknown[] }).sessions
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [];
    return { version: 1, sessions };
}

function normalizeSessionRepos(blob: unknown): SessionReposBlob {
    if (!blob || typeof blob !== 'object') {
        return { version: 1, repoIds: [] };
    }
    const repoIds = Array.isArray((blob as { repoIds?: unknown }).repoIds)
        ? (blob as { repoIds: unknown[] }).repoIds
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [];
    return { version: 1, repoIds };
}

function normalizeJobAccess(blob: unknown): JobAccessBlob {
    if (!blob || typeof blob !== 'object') return { version: 1, sessions: [] };

    const legacySessionId = (blob as { sessionId?: unknown }).sessionId;
    if (typeof legacySessionId === 'string' && legacySessionId.length > 0) {
        return { version: 1, sessions: [legacySessionId] };
    }

    const sessions = Array.isArray((blob as { sessions?: unknown }).sessions)
        ? (blob as { sessions: unknown[] }).sessions
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [];

    return { version: 1, sessions };
}

export async function grantRepoAccess(repoId: string, sessionId: string): Promise<void> {
    const kv = getAccessStoreOrFailOpen();
    if (!kv) {
        if (shouldFailOpen(process.env.RESOURCE_ACCESS_FAIL_OPEN)) return;
        throw new Error('Resource access control requires KV namespace configuration.');
    }

    const repoAccessKey = getRepoAccessKey(repoId);
    const sessionReposKey = getSessionReposKey(sessionId);
    const repoSessionAccessKey = getRepoSessionAccessKey(repoId, sessionId);

    const [repoBlobRaw, sessionBlobRaw] = await Promise.all([
        kv.get<RepoAccessBlob>(repoAccessKey),
        kv.get<SessionReposBlob>(sessionReposKey),
    ]);

    const repoBlob = normalizeRepoAccess(repoBlobRaw);
    const sessionBlob = normalizeSessionRepos(sessionBlobRaw);

    if (!repoBlob.sessions.includes(sessionId)) {
        repoBlob.sessions.push(sessionId);
    }
    if (repoBlob.sessions.length > RESOURCE_ACCESS.MAX_SESSIONS_PER_REPO) {
        repoBlob.sessions = repoBlob.sessions.slice(repoBlob.sessions.length - RESOURCE_ACCESS.MAX_SESSIONS_PER_REPO);
    }

    if (!sessionBlob.repoIds.includes(repoId)) {
        sessionBlob.repoIds.push(repoId);
    }
    if (sessionBlob.repoIds.length > RESOURCE_ACCESS.MAX_REPO_IDS_PER_SESSION) {
        sessionBlob.repoIds = sessionBlob.repoIds.slice(sessionBlob.repoIds.length - RESOURCE_ACCESS.MAX_REPO_IDS_PER_SESSION);
    }

    await Promise.all([
        kv.set(repoSessionAccessKey, 1, RESOURCE_ACCESS.TTL_SECONDS),
        kv.set(repoAccessKey, repoBlob, RESOURCE_ACCESS.TTL_SECONDS),
        kv.set(sessionReposKey, sessionBlob, RESOURCE_ACCESS.TTL_SECONDS),
    ]);
}

export async function hasRepoAccess(repoId: string, sessionId: string): Promise<boolean> {
    try {
        const kv = getAccessStoreOrFailOpen();
        if (!kv) {
            if (shouldFailOpen(process.env.RESOURCE_ACCESS_FAIL_OPEN)) return true;
            throw new Error('Resource access control requires KV namespace configuration.');
        }
        const repoSessionFlag = await kv.get<number | string>(getRepoSessionAccessKey(repoId, sessionId));

        if (repoSessionFlag !== null && repoSessionFlag !== undefined) {
            return true;
        }

        const [repoBlobRaw, sessionBlobRaw] = await Promise.all([
            kv.get<RepoAccessBlob>(getRepoAccessKey(repoId)),
            kv.get<SessionReposBlob>(getSessionReposKey(sessionId)),
        ]);

        const repoBlob = normalizeRepoAccess(repoBlobRaw);
        if (repoBlob.sessions.includes(sessionId)) {
            return true;
        }

        const sessionBlob = normalizeSessionRepos(sessionBlobRaw);
        return sessionBlob.repoIds.includes(repoId);
    } catch (error) {
        accessLogger.error({ error, repoId, sessionId }, 'Failed to verify repository access');
        if (shouldFailOpen(process.env.RESOURCE_ACCESS_FAIL_OPEN)) {
            accessLogger.warn({ repoId, sessionId }, 'Failing open for repository access check');
            return true;
        }
        throw error;
    }
}

export async function listRepoIdsForSession(sessionId: string): Promise<string[]> {
    try {
        const kv = getAccessStoreOrFailOpen();
        if (!kv) {
            if (shouldFailOpen(process.env.RESOURCE_ACCESS_FAIL_OPEN)) return [];
            throw new Error('Resource access control requires KV namespace configuration.');
        }
        const sessionBlobRaw = await kv.get<SessionReposBlob>(getSessionReposKey(sessionId));
        const sessionBlob = normalizeSessionRepos(sessionBlobRaw);
        return sessionBlob.repoIds;
    } catch (error) {
        accessLogger.error({ error, sessionId }, 'Failed to list repositories for session');
        if (shouldFailOpen(process.env.RESOURCE_ACCESS_FAIL_OPEN)) {
            return [];
        }
        throw error;
    }
}

export async function grantJobAccess(jobId: string, sessionId: string): Promise<void> {
    const kv = getAccessStoreOrFailOpen();
    if (!kv) {
        if (shouldFailOpen(process.env.RESOURCE_ACCESS_FAIL_OPEN)) return;
        throw new Error('Resource access control requires KV namespace configuration.');
    }
    const jobSessionAccessKey = getJobSessionAccessKey(jobId, sessionId);
    await kv.set(jobSessionAccessKey, 1, RESOURCE_ACCESS.TTL_SECONDS);
}

export async function hasJobAccess(jobId: string, sessionId: string): Promise<boolean> {
    try {
        const kv = getAccessStoreOrFailOpen();
        if (!kv) {
            if (shouldFailOpen(process.env.RESOURCE_ACCESS_FAIL_OPEN)) return true;
            throw new Error('Resource access control requires KV namespace configuration.');
        }
        const jobSessionFlag = await kv.get<number | string>(getJobSessionAccessKey(jobId, sessionId));

        if (jobSessionFlag !== null && jobSessionFlag !== undefined) {
            return true;
        }

        const blobRaw = await kv.get<JobAccessBlob>(getJobAccessKey(jobId));

        const blob = normalizeJobAccess(blobRaw);
        return blob.sessions.includes(sessionId);
    } catch (error) {
        accessLogger.error({ error, jobId, sessionId }, 'Failed to verify job access');
        if (shouldFailOpen(process.env.RESOURCE_ACCESS_FAIL_OPEN)) {
            accessLogger.warn({ jobId, sessionId }, 'Failing open for job access check');
            return true;
        }
        throw error;
    }
}

export async function safeGrantRepoAccess(repoId: string, sessionId: string): Promise<void> {
    try {
        await grantRepoAccess(repoId, sessionId);
    } catch (error) {
        accessLogger.error({ error, repoId }, 'Failed to grant repository access');
        if (!shouldFailOpen(process.env.RESOURCE_ACCESS_FAIL_OPEN)) {
            throw error;
        }
    }
}

export async function safeGrantJobAccess(jobId: string, sessionId: string): Promise<void> {
    try {
        await grantJobAccess(jobId, sessionId);
    } catch (error) {
        accessLogger.error({ error, jobId }, 'Failed to grant job access');
        if (!shouldFailOpen(process.env.RESOURCE_ACCESS_FAIL_OPEN)) {
            throw error;
        }
    }
}
