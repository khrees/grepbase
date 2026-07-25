'use client';

import { use, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
    BookOpen, Home, ArrowLeft, Settings, Loader2,
} from 'lucide-react';
import { useCommits } from '@/hooks/use-commits';
import { useRepoByName } from '@/hooks/use-repo-by-name';
import SettingsModal from '@/components/SettingsModal';
import StoryModePanel from '@/components/StoryModePanel';
import styles from './story.module.css';
import { useState } from 'react';

export default function StoryPage({ params }: { params: Promise<{ id: string; repo: string }> }) {
    const { id: owner, repo } = use(params);
    const repoQuery = useRepoByName(owner, repo);
    const id = repoQuery.data?.id;
    const router = useRouter();
    const [showSettings, setShowSettings] = useState(false);

    const commitsQuery = useCommits(id);
    const repository = commitsQuery.data?.repository ?? null;
    const commits = useMemo(() => commitsQuery.data?.commits ?? [], [commitsQuery.data?.commits]);

    if (repoQuery.isLoading || commitsQuery.isLoading) {
        return (
            <div className={styles.loadingState}>
                <Loader2 size={32} className={styles.spinner} />
                <p>Loading repository...</p>
            </div>
        );
    }

    if (repoQuery.error || commitsQuery.error) {
        const error = repoQuery.error || commitsQuery.error;
        return (
            <div className={styles.errorState}>
                <p>{error instanceof Error ? error.message : 'Something went wrong'}</p>
                <button type="button" className="btn btn-primary" onClick={() => router.push('/')}>
                    Go Home
                </button>
            </div>
        );
    }

    if (!repoQuery.data) {
        return (
            <div className={styles.errorState}>
                <p>Repository not found in database. Please index it first.</p>
                <button type="button" className="btn btn-primary" onClick={() => router.push('/')}>
                    Go Home
                </button>
            </div>
        );
    }

    if (!repository || commits.length === 0) {
        return (
            <div className={styles.errorState}>
                <p>No commits found for this repository.</p>
                <button type="button" className="btn btn-primary" onClick={() => router.push('/')}>
                    Go Home
                </button>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => router.push('/')}
                        aria-label="Go to home page"
                    >
                        <Home size={18} />
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => router.push(`/explore/${owner}/${repo}`)}
                    >
                        <ArrowLeft size={18} />
                        Back to Code
                    </button>
                </div>

                <div className={styles.headerCenter}>
                    <div className={styles.repoInfo}>
                        <BookOpen size={18} />
                        <span className={styles.repoName}>
                            {repository.owner}/{repository.name}
                        </span>
                    </div>
                    <span className={styles.headerBadge}>Story View</span>
                </div>

                <div className={styles.headerRight}>
                    <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setShowSettings(true)}
                        aria-label="Open AI settings"
                    >
                        <Settings size={18} />
                    </button>
                </div>
            </header>

            <main className={styles.main}>
                <StoryModePanel
                    repository={repository}
                    commits={commits}
                    currentIndex={0}
                    onNavigateToCommit={(idx) => {
                        router.push(`/explore/${owner}/${repo}?sha=${commits[idx]?.sha ?? ''}`);
                    }}
                    onOpenFile={(path) => {
                        router.push(`/explore/${owner}/${repo}?file=${encodeURIComponent(path)}`);
                    }}
                    onOpenSettings={() => setShowSettings(true)}
                />
            </main>

            <SettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
            />
        </div>
    );
}
