'use client';

import { useState, useEffect, use, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    BookOpen, Home, Settings, ArrowLeft, Loader2, GitCommit,
    User, Calendar as CalendarIcon, Sparkles, X
} from 'lucide-react';
import styles from './timeline.module.css';
import SettingsModal from '@/components/SettingsModal';
import { getAISettings } from '@/components/SettingsModal';
import CalendarTimeline from '@/components/CalendarTimeline';
import { api } from '@/lib/api-client';
import { fetchAllCommitsForRepository } from '@/lib/commit-pagination';

interface Repository {
    id: number;
    name: string;
    owner: string;
    description: string | null;
}

interface Commit {
    id: number;
    sha: string;
    message: string;
    authorName: string | null;
    date: string;
    order: number;
}

export default function TimelinePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const summaryRequestIdRef = useRef(0);
    const summaryAbortControllerRef = useRef<AbortController | null>(null);

    const [repository, setRepository] = useState<Repository | null>(null);
    const [commits, setCommits] = useState<Commit[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(false);

    // Day summary state
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedCommits, setSelectedCommits] = useState<Commit[]>([]);
    const [showDayPanel, setShowDayPanel] = useState(false);
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [daySummary, setDaySummary] = useState('');

    // Fetch repository and commits on mount
    useEffect(() => {
        async function fetchData() {
            try {
                const data = await fetchAllCommitsForRepository(id);

                setRepository(data.repository);
                setCommits(data.commits);
                setLoading(false);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Something went wrong');
                setLoading(false);
            }
        }

        fetchData();
    }, [id]);

    const totalCommits = commits.length;
    const activeDays = useMemo(() => {
        const dateSet = new Set<string>();
        commits.forEach(commit => {
            const date = new Date(commit.date);
            if (!Number.isNaN(date.getTime())) {
                dateSet.add(
                    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
                );
            }
        });
        return dateSet.size;
    }, [commits]);
    const uniqueAuthors = useMemo(
        () => new Set(commits.map(commit => commit.authorName || 'Unknown')).size,
        [commits]
    );
    const latestCommitDate = useMemo(() => {
        if (commits.length === 0) return null;

        const timestamps = commits
            .map(commit => new Date(commit.date).getTime())
            .filter(timestamp => !Number.isNaN(timestamp));

        if (timestamps.length === 0) return null;
        return new Date(Math.max(...timestamps));
    }, [commits]);

    const cancelSummaryRequest = useCallback(() => {
        summaryAbortControllerRef.current?.abort();
        summaryAbortControllerRef.current = null;
        summaryRequestIdRef.current += 1;
        setSummaryLoading(false);
    }, []);

    useEffect(() => {
        return () => {
            summaryAbortControllerRef.current?.abort();
        };
    }, []);

    const handleDayClick = useCallback(async (date: Date, dayCommits: Commit[]) => {
        cancelSummaryRequest();

        const requestId = summaryRequestIdRef.current + 1;
        summaryRequestIdRef.current = requestId;
        const abortController = new AbortController();
        summaryAbortControllerRef.current = abortController;

        setSelectedDate(date);
        setSelectedCommits(dayCommits);
        setShowDayPanel(true);
        setDaySummary('');

        const aiSettings = getAISettings();
        if (!aiSettings) {
            setDaySummary('Configure AI settings to generate commit summaries.');
            setSummaryLoading(false);
            return;
        }

        setSummaryLoading(true);

        try {
            const response = await api.postStream('/api/explain/day-summary', {
                repoId: Number(id),
                provider: {
                    type: aiSettings.provider,
                    apiKey: aiSettings.config.apiKey,
                    model: aiSettings.config.model,
                    baseUrl: aiSettings.config.baseUrl,
                },
                type: 'day-summary',
                commits: dayCommits.map(c => ({
                    sha: c.sha,
                    message: c.message,
                    authorName: c.authorName,
                    date: c.date,
                })),
                projectName: repository?.name,
                projectOwner: repository?.owner,
            }, {
                signal: abortController.signal,
            });

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response stream from day summary endpoint');
            }

            const decoder = new TextDecoder();
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                fullText += decoder.decode(value, { stream: true });
                if (summaryRequestIdRef.current !== requestId) {
                    return;
                }
                setDaySummary(fullText);
            }

            const tail = decoder.decode();
            if (tail) {
                fullText += tail;
            }

            if (summaryRequestIdRef.current === requestId) {
                setDaySummary(fullText);
            }
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                return;
            }

            console.error('Failed to generate day summary:', err);
            if (summaryRequestIdRef.current === requestId) {
                setDaySummary('Failed to generate AI summary. Please try again.');
            }
        } finally {
            if (summaryRequestIdRef.current === requestId) {
                setSummaryLoading(false);
            }
        }
    }, [cancelSummaryRequest, id, repository?.name, repository?.owner]);

    const closeDayPanel = useCallback(() => {
        cancelSummaryRequest();
        setShowDayPanel(false);
        setSelectedDate(null);
        setSelectedCommits([]);
        setDaySummary('');
    }, [cancelSummaryRequest]);

    if (loading) {
        return (
            <div className={styles.loadingState}>
                <Loader2 size={32} className={styles.spinner} />
                <p>Loading timeline...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.errorState}>
                <p>{error}</p>
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
                        onClick={() => router.push(`/explore/${id}`)}
                    >
                        <ArrowLeft size={18} />
                        Back to Code
                    </button>
                </div>

                <div className={styles.headerCenter}>
                    <div className={styles.repoInfo}>
                        <BookOpen size={18} />
                        <span className={styles.repoName}>{repository.owner}/{repository.name}</span>
                    </div>
                    <span className={styles.headerBadge}>
                        <CalendarIcon size={14} />
                        Timeline View
                    </span>
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
                <section className={styles.calendarWorkspace}>
                    <div className={styles.overviewGrid}>
                        <article className={styles.overviewCard}>
                            <span className={styles.overviewLabel}>Total commits</span>
                            <strong className={styles.overviewValue}>{totalCommits}</strong>
                        </article>
                        <article className={styles.overviewCard}>
                            <span className={styles.overviewLabel}>Active days</span>
                            <strong className={styles.overviewValue}>{activeDays}</strong>
                        </article>
                        <article className={styles.overviewCard}>
                            <span className={styles.overviewLabel}>Authors</span>
                            <strong className={styles.overviewValue}>{uniqueAuthors}</strong>
                        </article>
                        <article className={styles.overviewCard}>
                            <span className={styles.overviewLabel}>Latest commit</span>
                            <strong className={styles.overviewValueSmall}>
                                {latestCommitDate
                                    ? latestCommitDate.toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        year: 'numeric',
                                    })
                                    : 'Unknown'}
                            </strong>
                        </article>
                    </div>

                    <div className={styles.calendarContainer}>
                        <CalendarTimeline
                            commits={commits}
                            onDayClick={handleDayClick}
                            selectedDate={selectedDate}
                            loading={summaryLoading}
                        />
                    </div>
                </section>

                {showDayPanel && (
                    <aside className={styles.dayPanel}>
                        <div className={styles.dayPanelHeader}>
                            <div>
                                <h3 className={styles.dayPanelTitle}>
                                    {selectedDate?.toLocaleDateString('en-US', {
                                        weekday: 'long',
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric'
                                    })}
                                </h3>
                                <span className={styles.dayPanelSub}>
                                    {selectedCommits.length} commit{selectedCommits.length !== 1 ? 's' : ''}
                                </span>
                            </div>
                            <button
                                type="button"
                                className={styles.dayPanelClose}
                                onClick={closeDayPanel}
                                aria-label="Close panel"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className={styles.commitList}>
                            {selectedCommits.map(commit => (
                                <div key={commit.id} className={styles.commitItem}>
                                    <div className={styles.commitItemHeader}>
                                        <GitCommit size={14} />
                                        <code className={styles.commitSha}>
                                            {commit.sha.substring(0, 7)}
                                        </code>
                                    </div>
                                    <p className={styles.commitMessage}>
                                        {commit.message.split('\n')[0]}
                                    </p>
                                    <span className={styles.commitAuthor}>
                                        <User size={12} />
                                        {commit.authorName || 'Unknown'}
                                    </span>
                                    <span className={styles.commitTime}>
                                        {new Date(commit.date).toLocaleTimeString('en-US', {
                                            hour: 'numeric',
                                            minute: '2-digit',
                                        })}
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div className={styles.aiSummarySection}>
                            <div className={styles.aiSummaryHeader}>
                                <Sparkles size={16} />
                                <span>AI Summary</span>
                            </div>
                            <div className={styles.aiSummaryContent} aria-live="polite">
                                {summaryLoading ? (
                                    <div className={styles.summaryLoading}>
                                        <Loader2 size={20} className={styles.spinner} />
                                        <span>Generating summary...</span>
                                    </div>
                                ) : daySummary ? (
                                    <div className={styles.summaryText}>
                                        {daySummary.split('\n').map((line, i) => (
                                            <p key={`summary-line-${i}`} className={styles.summaryLine}>
                                                {line.trim() ? line : '\u00A0'}
                                            </p>
                                        ))}
                                    </div>
                                ) : (
                                    <p className={styles.summaryPlaceholder}>
                                        Click a day with commits to see the AI summary.
                                    </p>
                                )}
                            </div>
                        </div>
                    </aside>
                )}
            </main>

            <SettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
            />
        </div>
    );
}
