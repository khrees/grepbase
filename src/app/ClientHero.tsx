'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Github, ArrowRight, Loader2, BookOpen } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Logo } from '@/components/Logo';
import BranchPicker from '@/components/BranchPicker';

const RECENT_KEY = 'grepbase:recent_repos';

interface RecentRepo {
    id: string;
    owner: string;
    name: string;
    visitedAt: number;
}

interface JobData {
    jobId?: string;
    repository?: { id: string | number };
    cached?: boolean;
}

export default function ClientHero({ styles }: { styles: Record<string, string> }) {
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isValid, setIsValid] = useState(false);
    const [recentRepos, setRecentRepos] = useState<RecentRepo[]>([]);

    // Branch-picker state
    const [pickingBranch, setPickingBranch] = useState(false);
    const [pendingJobData, setPendingJobData] = useState<JobData | null>(null);
    const [repoMeta, setRepoMeta] = useState<{ owner: string; repo: string } | null>(null);

    const router = useRouter();

    useEffect(() => {
        try {
            const stored: RecentRepo[] = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
            if (!Array.isArray(stored)) return;
            // Deduplicate by owner/name, keeping the most recent entry
            const seen = new Set<string>();
            const deduped = stored.filter(r => {
                const key = `${r.owner}/${r.name}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            if (deduped.length !== stored.length) {
                localStorage.setItem(RECENT_KEY, JSON.stringify(deduped));
            }
            setRecentRepos(deduped);
        } catch { /* ignore */ }
    }, []);

    function saveRecentRepo(id: string, owner: string, name: string) {
        try {
            const existing: RecentRepo[] = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
            const filtered = existing.filter(r => r.id !== id && !(r.owner === owner && r.name === name));
            const updated = [{ id, owner, name, visitedAt: Date.now() }, ...filtered].slice(0, 6);
            localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
            setRecentRepos(updated);
        } catch { /* ignore */ }
    }

    function parseOwnerRepo(rawUrl: string): { owner: string; repo: string } | null {
        try {
            const parts = rawUrl.trim()
                .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
                .replace(/\.git\/?$/, '')
                .split('/')
                .filter(Boolean);
            if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
        } catch { /* ignore */ }
        return null;
    }

    function validateRepoUrl(input: string): { valid: boolean; error: string | null } {
        const trimmed = input.trim();

        if (!trimmed) return { valid: false, error: null };

        let normalized = trimmed
            .replace(/^(https?:\/\/)?(www\.)?/i, '')
            .replace(/\.git\/?$/, '')
            .replace(/\/+$/, '');

        if (normalized.toLowerCase().startsWith('github.com/')) {
            normalized = normalized.substring('github.com/'.length);
        }

        const parts = normalized.split('/').filter(Boolean);

        if (parts.length === 1) {
            if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(parts[0])) {
                return { valid: false, error: 'Please enter a repository, not just a username (e.g., owner/repo)' };
            }
            return { valid: false, error: 'Invalid format. Try: github.com/owner/repo or owner/repo' };
        }

        if (parts.length === 2) {
            const [owner, repo] = parts;
            if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(owner)) {
                return { valid: false, error: 'Invalid repository owner name' };
            }
            if (!/^[a-zA-Z0-9._-]+$/.test(repo)) {
                return { valid: false, error: 'Invalid repository name' };
            }
            return { valid: true, error: null };
        }

        if (parts.length > 2) {
            return { valid: false, error: 'Please enter just the repository URL, not a file path' };
        }

        return { valid: false, error: 'Invalid GitHub repository URL' };
    }

    function handleUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
        const newUrl = e.target.value;
        setUrl(newUrl);
        const result = validateRepoUrl(newUrl);
        setIsValid(result.valid);
        setValidationError(result.error);
        if (error) setError(null);
        // Reset picker if URL changes
        if (pickingBranch) setPickingBranch(false);
    }

    /** Poll a job until a repoId resolves, then navigate. */
    const navigateWithJobData = useCallback(async (data: JobData, owner: string, repo: string) => {
        if (data.repository?.id) {
            saveRecentRepo(String(data.repository.id), owner, repo);
            router.push(`/explore/${data.repository.id}`);
            return;
        }

        if (!data.jobId) return;

        let attempts = 0;
        const maxAttempts = 60;

        const poll = async (): Promise<void> => {
            attempts++;
            const jobResponse = await api.get<{
                status: string;
                error?: string;
                ready?: boolean;
                processedCommits?: number;
                repoId?: number | null;
                repository?: { id: number };
            }>(`/api/jobs/${data.jobId}`);

            const resolvedRepoId = jobResponse.repository?.id ?? jobResponse.repoId ?? null;
            if (resolvedRepoId) {
                saveRecentRepo(String(resolvedRepoId), owner, repo);
                router.push(`/explore/${resolvedRepoId}`);
            } else if (jobResponse.status === 'failed') {
                throw new Error(jobResponse.error || 'Failed to fetch repository');
            } else if (attempts < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                return poll();
            } else {
                throw new Error('Repository fetch timed out');
            }
        };

        await poll();
    }, [router]);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!isValid) return;

        setError(null);
        setLoading(true);
        setPickingBranch(false);

        try {
            const data = await api.post<JobData>('/api/repos', { url });
            const meta = parseOwnerRepo(url);

            // Show branch picker while default-branch ingestion runs in background
            setPendingJobData(data);
            setRepoMeta(meta);
            setPickingBranch(true);
            setLoading(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch repository');
            setLoading(false);
        }
    }

    async function handleBranchConfirm(jobData: JobData) {
        setPickingBranch(false);
        setLoading(true);

        const owner = repoMeta?.owner ?? '';
        const repo = repoMeta?.repo ?? '';

        try {
            await navigateWithJobData(jobData, owner, repo);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch repository');
            setLoading(false);
        }
    }

    return (
        <section className={styles.hero}>
            <div className={styles.heroContent}>
                <div className={styles.logoWrapper}>
                    <Logo size={80} className={styles.heroLogo} />
                </div>
                <p className={styles.eyebrow}>AI-powered git history explorer</p>

                <h1 className={styles.title}>
                    Grepbase
                </h1>

                <p className={styles.subtitle}>
                    Paste a GitHub repo. Walk every commit. Understand what changed and why — with AI.
                </p>

                <form onSubmit={handleSubmit} className={styles.searchForm}>
                    <div className={styles.inputWrapper}>
                        <Github size={20} className={styles.inputIcon} />
                        <input
                            type="text"
                            className={`${styles.searchInput} ${validationError ? styles.searchInputError : ''}`}
                            placeholder="Paste a GitHub URL (e.g., sindresorhus/is)"
                            value={url}
                            onChange={handleUrlChange}
                            disabled={loading}
                            aria-invalid={!!validationError}
                            aria-describedby={validationError ? 'url-error' : undefined}
                        />
                        {validationError && (
                            <div id="url-error" className={styles.validationError} role="alert">
                                {validationError}
                            </div>
                        )}
                    </div>
                    <button
                        type="submit"
                        className={`btn btn-primary ${styles.submitBtn}`}
                        disabled={loading || !isValid || pickingBranch}
                    >
                        {loading ? (
                            <>
                                <Loader2 size={18} className={styles.spinner} />
                                Loading...
                            </>
                        ) : (
                            <>
                                Explore
                                <ArrowRight size={18} />
                            </>
                        )}
                    </button>
                </form>

                {pickingBranch && pendingJobData && repoMeta && (
                    <BranchPicker
                        url={url}
                        owner={repoMeta.owner}
                        repo={repoMeta.repo}
                        initialJobData={pendingJobData}
                        onConfirm={handleBranchConfirm}
                    />
                )}

                {error && <div className={styles.error}>{error}</div>}

                {!pickingBranch && recentRepos.length > 0 && (
                    <div className={styles.recentSection}>
                        <p className={styles.recentLabel}>Recent</p>
                        <div className={styles.recentGrid}>
                            {recentRepos.map(repo => (
                                <a key={repo.id} href={`/explore/${repo.id}`} className={styles.recentCard}>
                                    <BookOpen size={12} />
                                    <span>{repo.owner}/{repo.name}</span>
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
