'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Github, ArrowRight, Loader2 } from 'lucide-react';
import { useStartIngest, useJobStatus } from '@/lib/query/hooks';

export default function ClientHero({ styles }: { styles: Record<string, string> }) {
    const [url, setUrl] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isValid, setIsValid] = useState(false);
    const router = useRouter();

    const ingestMutation = useStartIngest();

    // Once we have started an ingest job, poll for its status
    const [pendingJobId, setPendingJobId] = useState<string | null>(null);
    const jobQuery = useJobStatus(pendingJobId, { enabled: !!pendingJobId });

    // Navigate when job is ready or completed
    useEffect(() => {
        const job = jobQuery.data;
        if (!job) return;

        const repoId = job.repository?.id ?? job.repoId;
        if (!repoId) return;

        const basePath = `/explore/${repoId}`;
        if (job.status === 'completed') {
            router.push(basePath);
        } else if (job.ready || Number(job.processedCommits ?? 0) > 0) {
            router.push(`${basePath}?jobId=${pendingJobId}`);
        }
        // Note: failed status is handled below as derived state, not inside this effect
    }, [jobQuery.data, pendingJobId, router]);

    // Derive failure: if the polled job failed, clear the pending ID (derived from data, no setState in effect)
    const jobFailed = jobQuery.data?.status === 'failed';
    useEffect(() => {
        if (!jobFailed) return;
        // Use a timeout so this isn't synchronous within the render that set jobFailed
        const t = setTimeout(() => {
            setPendingJobId(null);
            ingestMutation.reset();
        }, 0);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobFailed]);


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
        if (ingestMutation.isError) ingestMutation.reset();
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!isValid) return;

        const data = await ingestMutation.mutateAsync(url);

        if (data.cached && data.repository) {
            if (data.jobId) {
                router.push(`/explore/${data.repository.id}?jobId=${data.jobId}`);
            } else {
                router.push(`/explore/${data.repository.id}`);
            }
            return;
        }

        if (data.repository && !data.jobId) {
            router.push(`/explore/${data.repository.id}`);
            return;
        }

        if (data.jobId) {
            // Start polling via useJobStatus by setting the pending job ID
            setPendingJobId(data.jobId);
        }
    }

    const loading = ingestMutation.isPending || !!pendingJobId;
    const error = ingestMutation.isError
        ? (ingestMutation.error as Error)?.message || 'Failed to fetch repository'
        : jobQuery.data?.status === 'failed'
            ? jobQuery.data.error || 'Failed to fetch repository'
            : null;

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
