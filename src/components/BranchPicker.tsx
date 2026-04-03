'use client';

import { useEffect, useState } from 'react';
import { GitBranch, Loader2, ArrowRight, Check } from 'lucide-react';
import styles from './BranchPicker.module.css';
import { api } from '@/lib/api-client';

interface InitialJobData {
    jobId?: string;
    repository?: { id: string | number };
    cached?: boolean;
}

interface BranchPickerProps {
    url: string;
    owner: string;
    repo: string;
    initialJobData: InitialJobData;
    onConfirm: (jobData: { jobId?: string; repository?: { id: string | number } }) => void;
}

export default function BranchPicker({ url, owner, repo, initialJobData, onConfirm }: BranchPickerProps) {
    const [branches, setBranches] = useState<string[] | null>(null);
    const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.get<{ branches: string[]; defaultBranch: string }>(
            `/api/repos/branches?url=${encodeURIComponent(url)}`
        ).then((data) => {
            setBranches(data.branches);
            setDefaultBranch(data.defaultBranch);
            setSelected(data.defaultBranch);
        }).catch(() => {
            // If branch fetch fails, let user continue with default
            setBranches([]);
            setDefaultBranch(null);
        });
    }, [url]);

    async function handleConfirm() {
        const isDefault = !selected || selected === defaultBranch;

        if (isDefault) {
            // Default branch job already running — pass through
            onConfirm(initialJobData);
            return;
        }

        // Non-default branch: start a new ingestion job
        setSubmitting(true);
        setError(null);

        try {
            const data = await api.post<{
                jobId?: string;
                repository?: { id: string | number };
                cached?: boolean;
                status?: string;
            }>('/api/repos', { url, branch: selected });

            onConfirm({ jobId: data.jobId, repository: data.repository });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch branch');
            setSubmitting(false);
        }
    }

    const isLoading = branches === null;
    const isDefault = !selected || selected === defaultBranch;

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <GitBranch size={13} className={styles.headerIcon} />
                <span className={styles.headerLabel}>Choose a branch</span>
                <span className={styles.repoSlug}>{owner}/{repo}</span>
            </div>

            <div className={styles.body}>
                {isLoading ? (
                    <div className={styles.loading}>
                        <Loader2 size={14} className={styles.spinner} />
                        <span>Fetching branches&hellip;</span>
                    </div>
                ) : branches && branches.length > 0 ? (
                    <div className={styles.branchList}>
                        {branches.map((branch) => {
                            const active = branch === selected;
                            return (
                                <button
                                    key={branch}
                                    className={`${styles.branchBtn} ${active ? styles.branchBtnActive : ''}`}
                                    onClick={() => setSelected(branch)}
                                    type="button"
                                >
                                    <span className={styles.branchCheck}>
                                        {active && <Check size={11} />}
                                    </span>
                                    <GitBranch size={11} className={styles.branchIcon} />
                                    <span className={styles.branchName}>{branch}</span>
                                    {branch === defaultBranch && (
                                        <span className={styles.defaultBadge}>default</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                ) : null}

                {error && <p className={styles.error}>{error}</p>}
            </div>

            <div className={styles.footer}>
                <span className={styles.hint}>
                    {isDefault
                        ? 'Fetching default branch in the background'
                        : `Will fetch ${selected}`}
                </span>
                <button
                    className={`btn btn-primary ${styles.confirmBtn}`}
                    onClick={handleConfirm}
                    disabled={isLoading || submitting}
                    type="button"
                >
                    {submitting ? (
                        <Loader2 size={14} className={styles.spinner} />
                    ) : (
                        <ArrowRight size={14} />
                    )}
                    Continue
                </button>
            </div>
        </div>
    );
}
