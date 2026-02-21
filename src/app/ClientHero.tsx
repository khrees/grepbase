'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Github, Sparkles, ArrowRight, Clock, BookOpen, Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';

interface Repository {
    id: number;
}

export default function ClientHero({ styles }: { styles: any }) {
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isValid, setIsValid] = useState(false);
    const router = useRouter();

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
                        repository?: any;
                    }>(`/api/jobs/${data.jobId}`);

                    if (jobResponse.status === 'completed' && jobResponse.repository) {
                        router.push(`/explore/${jobResponse.repository.id}`);
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
                <div className={styles.badge}>
                    <Sparkles size={14} />
                    <span>AI-Powered Code Learning</span>
                </div>

                <h1 className={styles.title}>
                    Understand Code <br />
                    <span className="text-gradient">Through Time</span>
                </h1>

                <p className={styles.subtitle}>
                    Walk through any open source project&apos;s git history like a book. Let AI explain each chapter of the
                    codebase evolution.
                </p>

                <form onSubmit={handleSubmit} className={styles.searchForm}>
                    <div className={styles.inputWrapper}>
                        <Github size={20} className={styles.inputIcon} />
                        <input
                            type="text"
                            className={`${styles.searchInput} ${validationError ? styles.searchInputError : ''}`}
                            placeholder="Enter GitHub URL (e.g., github.com/sindresorhus/is)"
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

                <div className={styles.features}>
                    <div className={styles.feature}>
                        <Clock size={18} />
                        <span>Time-travel through commits</span>
                    </div>
                    <div className={styles.feature}>
                        <Sparkles size={18} />
                        <span>AI explanations at each step</span>
                    </div>
                    <div className={styles.feature}>
                        <BookOpen size={18} />
                        <span>Learn like reading a book</span>
                    </div>
                </div>
            </div>
        </section>
    );
}
