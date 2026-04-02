'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Github, ArrowRight, Loader2, BookOpen } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Logo } from '@/components/Logo';

const RECENT_KEY = 'grepbase:recent_repos';

interface RecentRepo {
    id: string;
    owner: string;
    name: string;
    visitedAt: number;
}

interface Repository {
    id: string;
}

export default function ClientHero({ styles }: { styles: Record<string, string> }) {
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isValid, setIsValid] = useState(false);
    const [recentRepos, setRecentRepos] = useState<RecentRepo[]>([]);
    const router = useRouter();

    useEffect(() => {
        try {
            const stored = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
            setRecentRepos(Array.isArray(stored) ? stored : []);
        } catch { /* ignore */ }
    }, []);

    function saveRecentRepo(id: string, owner: string, name: string) {
        try {
            const existing: RecentRepo[] = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
            const filtered = existing.filter(r => r.id !== id);
            const updated = [{ id, owner, name, visitedAt: Date.now() }, ...filtered].slice(0, 6);
            localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
            setRecentRepos(updated);
        } catch { /* ignore */ }
    }

    function validateRepoUrl(input: string): { valid: boolean; error: string | null } {
        const trimmed = input.trim();

        if (!trimmed) {
            return { valid: false, error: null };
        }

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
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!isValid) return;

        setError(null);
        setLoading(true);

        try {
            const data = await api.post<{
                error?: string;
                repository?: Repository;
                jobId?: string;
                cached?: boolean;
            }>('/api/repos', { url });

            if (data.cached && data.repository) {
                const parts = url.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/\.git\/?$/, '').split('/').filter(Boolean);
                if (parts.length >= 2) saveRecentRepo(data.repository.id, parts[0], parts[1]);
                router.push(`/explore/${data.repository.id}`);
                return;
            }

            if (data.jobId) {
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
                        const parts = url.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/\.git\/?$/, '').split('/').filter(Boolean);
                        if (parts.length >= 2) saveRecentRepo(String(resolvedRepoId), parts[0], parts[1]);
                        router.push(`/explore/${resolvedRepoId}`);
                        return;
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
                return;
            }

            if (data.repository) {
                router.push(`/explore/${data.repository.id}`);
            }
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
                        disabled={loading || !isValid}
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

                {error && <div className={styles.error}>{error}</div>}

                {recentRepos.length > 0 && (
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
