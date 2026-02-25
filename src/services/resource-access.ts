import { getPlatformEnv } from '@/lib/platform/context';
import { logger } from '@/lib/logger';
import type { PlatformCache } from '@/lib/platform/types';

const accessLogger = logger.child({ service: 'resource-access' });

const ACCESS_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days
const REPO_ACCESS_PREFIX = 'access:repo:';
const SESSION_REPOS_PREFIX = 'access:session:repos:';
const JOB_ACCESS_PREFIX = 'access:job:';
const REPO_SESSION_ACCESS_PREFIX = 'access:repo-session:';
const JOB_SESSION_ACCESS_PREFIX = 'access:job-session:';
const MAX_REPO_IDS_PER_SESSION = 500;
const MAX_SESSIONS_PER_REPO = 500;

interface RepoAccessBlob {
    version: 1;
    sessions: string[];
}

interface SessionReposBlob {
    version: 1;
    repoIds: number[];
}

interface JobAccessBlob {
    version: 1;
    sessions: string[];
}

function getAccessStoreOrThrow(): PlatformCache {
    const platform = getPlatformEnv();
    const kv = platform.getCache();
    if (!kv) {
        throw new Error('Resource access control requires KV namespace configuration.');
    }
    return kv;
}

function getRepoAccessKey(repoId: number): string {
    return `${REPO_ACCESS_PREFIX}${repoId}`;
}

function getSessionReposKey(sessionId: string): string {
    return `${SESSION_REPOS_PREFIX}${sessionId}`;
}

function getJobAccessKey(jobId: string): string {
    return `${JOB_ACCESS_PREFIX}${jobId}`;
}

function getRepoSessionAccessKey(repoId: number, sessionId: string): string {
    return `${REPO_SESSION_ACCESS_PREFIX}${repoId}:${sessionId}`;
}

function getJobSessionAccessKey(jobId: string, sessionId: string): string {
    return `${JOB_SESSION_ACCESS_PREFIX}${jobId}:${sessionId}`;
}

function shouldFailOpenAccess(): boolean {
    if (process.env.RESOURCE_ACCESS_FAIL_OPEN === 'true') {
        return true;
    }
    return process.env.NODE_ENV !== 'production';
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
            .map(value => (typeof value === 'number' ? value : Number.parseInt(String(value), 10)))
            .filter(value => Number.isInteger(value) && value > 0)
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

export async function grantRepoAccess(repoId: number, sessionId: string): Promise<void> {
    const kv = getAccessStoreOrThrow();

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
    if (repoBlob.sessions.length > MAX_SESSIONS_PER_REPO) {
        repoBlob.sessions = repoBlob.sessions.slice(repoBlob.sessions.length - MAX_SESSIONS_PER_REPO);
    }

    if (!sessionBlob.repoIds.includes(repoId)) {
        sessionBlob.repoIds.push(repoId);
    }
    if (sessionBlob.repoIds.length > MAX_REPO_IDS_PER_SESSION) {
        sessionBlob.repoIds = sessionBlob.repoIds.slice(sessionBlob.repoIds.length - MAX_REPO_IDS_PER_SESSION);
    }

    await Promise.all([
        kv.set(repoSessionAccessKey, 1, ACCESS_TTL_SECONDS),
        kv.set(repoAccessKey, repoBlob, ACCESS_TTL_SECONDS),
        kv.set(sessionReposKey, sessionBlob, ACCESS_TTL_SECONDS),
    ]);
}

export async function hasRepoAccess(repoId: number, sessionId: string): Promise<boolean> {
    try {
        const kv = getAccessStoreOrThrow();
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
        if (shouldFailOpenAccess()) {
            accessLogger.warn({ repoId, sessionId }, 'Failing open for repository access check');
            return true;
        }
        throw error;
    }
}

export async function listRepoIdsForSession(sessionId: string): Promise<number[]> {
    try {
        const kv = getAccessStoreOrThrow();
        const sessionBlobRaw = await kv.get<SessionReposBlob>(getSessionReposKey(sessionId));
        const sessionBlob = normalizeSessionRepos(sessionBlobRaw);
        return sessionBlob.repoIds;
    } catch (error) {
        accessLogger.error({ error, sessionId }, 'Failed to list repositories for session');
        if (shouldFailOpenAccess()) {
            return [];
        }
        throw error;
    }
}

export async function grantJobAccess(jobId: string, sessionId: string): Promise<void> {
    const kv = getAccessStoreOrThrow();
    const jobSessionAccessKey = getJobSessionAccessKey(jobId, sessionId);
    await kv.set(jobSessionAccessKey, 1, ACCESS_TTL_SECONDS);
}

export async function hasJobAccess(jobId: string, sessionId: string): Promise<boolean> {
    try {
        const kv = getAccessStoreOrThrow();
        const jobSessionFlag = await kv.get<number | string>(getJobSessionAccessKey(jobId, sessionId));

        if (jobSessionFlag !== null && jobSessionFlag !== undefined) {
            return true;
        }

        const blobRaw = await kv.get<JobAccessBlob>(getJobAccessKey(jobId));

        const blob = normalizeJobAccess(blobRaw);
        return blob.sessions.includes(sessionId);
    } catch (error) {
        accessLogger.error({ error, jobId, sessionId }, 'Failed to verify job access');
        if (shouldFailOpenAccess()) {
            accessLogger.warn({ jobId, sessionId }, 'Failing open for job access check');
            return true;
        }
        throw error;
    }
}

export async function safeGrantRepoAccess(repoId: number, sessionId: string): Promise<void> {
    try {
        await grantRepoAccess(repoId, sessionId);
    } catch (error) {
        accessLogger.error({ error, repoId }, 'Failed to grant repository access');
        if (!shouldFailOpenAccess()) {
            throw error;
        }
    }
}

export async function safeGrantJobAccess(jobId: string, sessionId: string): Promise<void> {
    try {
        await grantJobAccess(jobId, sessionId);
    } catch (error) {
        accessLogger.error({ error, jobId }, 'Failed to grant job access');
        if (!shouldFailOpenAccess()) {
            throw error;
        }
    }
}
