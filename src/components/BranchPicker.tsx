'use client';

import { useState } from 'react';
import { GitBranch, Loader2, ArrowRight, Check } from 'lucide-react';
import styles from './BranchPicker.module.css';
import { api } from '@/lib/api-client';
import { useBranches } from '@/hooks/use-branches';

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
    const { data: branchData, isLoading: isLoadingBranches } = useBranches(url);
    const branches = branchData?.branches ?? null;
    const defaultBranch = branchData?.defaultBranch ?? null;

    const [selected, setSelected] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Auto-select default branch when data arrives
    const effectiveSelected = selected ?? defaultBranch;

    async function handleConfirm() {
        const isDefault = !effectiveSelected || effectiveSelected === defaultBranch;

        if (isDefault) {
            onConfirm(initialJobData);
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const data = await api.post<{
                jobId?: string;
                repository?: { id: string | number };
                cached?: boolean;
                status?: string;
            }>('/api/repos', { url, branch: effectiveSelected });

            onConfirm({ jobId: data.jobId, repository: data.repository });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch branch');
            setSubmitting(false);
        }
    }

    const isDefault = !effectiveSelected || effectiveSelected === defaultBranch;

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <GitBranch size={13} className={styles.headerIcon} />
                <span className={styles.headerLabel}>Choose a branch</span>
                <span className={styles.repoSlug}>{owner}/{repo}</span>
            </div>

            <div className={styles.body}>
                {isLoadingBranches ? (
                    <div className={styles.loading}>
                        <Loader2 size={14} className={styles.spinner} />
                        <span>Fetching branches&hellip;</span>
                    </div>
                ) : branches && branches.length > 0 ? (
                    <div className={styles.branchList}>
                        {branches.map((branch) => {
                            const active = branch === effectiveSelected;
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
                        : `Will fetch ${effectiveSelected}`}
                </span>
                <button
                    className={`btn btn-primary ${styles.confirmBtn}`}
                    onClick={handleConfirm}
                    disabled={isLoadingBranches || submitting}
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
