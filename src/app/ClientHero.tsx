'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Github, ArrowRight, Loader2 } from 'lucide-react';
import { useJobStatus, useStartIngest } from '@/lib/query/hooks';

export default function ClientHero({ styles }: { styles: Record<string, string> }) {
    const [url, setUrl] = useState('');
    const [jobId, setJobId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isValid, setIsValid] = useState(false);
    const router = useRouter();
    const startIngest = useStartIngest();
    const jobStatus = useJobStatus(jobId, { enabled: Boolean(jobId) });
    const loading = startIngest.isPending || (Boolean(jobId) && !jobStatus.isTerminal);

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
        setJobId(null);

        try {
            const data = await startIngest.mutateAsync(url);

            if (data.repository) {
                // Route immediately to repository page and let explore page handle any background ingest polling.
                const basePath = `/explore/${data.repository.id}`;
                if (data.jobId) {
                    router.push(`${basePath}?jobId=${data.jobId}`);
                } else {
                    router.push(basePath);
                }
                return;
            }

            if (data.jobId) {
                setJobId(data.jobId);
                return;
            }
            setError(data.error || 'Failed to fetch repository');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch repository');
        }
    }

    useEffect(() => {
        if (!jobId) return;

        const jobData = jobStatus.data;
        if (!jobData) {
            if (jobStatus.error) {
                setError(jobStatus.error instanceof Error ? jobStatus.error.message : 'Failed to fetch repository');
            }
            return;
        }

        const resolvedRepoId = jobData.repository?.id ?? jobData.repoId ?? null;
        if (resolvedRepoId) {
            const basePath = `/explore/${resolvedRepoId}`;
            if (jobData.status === 'completed') {
                router.push(basePath);
            } else {
                router.push(`${basePath}?jobId=${jobId}`);
            }
            return;
        }

        if (jobData.status === 'failed') {
            setError(jobData.error || 'Failed to fetch repository');
            setJobId(null);
        }
    }, [jobId, jobStatus.data, jobStatus.error, router]);

    return (
        <section className={styles.hero}>
            <div className={styles.heroContent}>
                <h1 className={styles.title}>
                    Grepbase
                </h1>

                <p className={styles.subtitle}>
                    Understand code history with AI-powered explanations.
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
            </div>
        </section>
    );
}
