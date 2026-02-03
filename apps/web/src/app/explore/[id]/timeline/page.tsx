'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import {
    BookOpen, Home, Settings, ArrowLeft, Loader2, GitCommit,
    User, Calendar as CalendarIcon, Sparkles, X
} from 'lucide-react';
import styles from './page.module.css';
import SettingsModal from '@/components/SettingsModal';
import { getAISettings } from '@/components/SettingsModal';
import CalendarTimeline from '@/components/CalendarTimeline';
import { api } from '@/lib/api-client';

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
                const data = await api.get<{
                    repository: Repository;
                    commits: Commit[];
                }>(`/api/repos/${id}/commits`);

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

    async function handleDayClick(date: Date, dayCommits: Commit[]) {
        setSelectedDate(date);
        setSelectedCommits(dayCommits);
        setShowDayPanel(true);
        setDaySummary('');

        // Generate AI summary for the day's commits
        const aiSettings = getAISettings();
        if (!aiSettings) {
            setDaySummary('Configure AI settings to generate commit summaries.');
            return;
        }

        setSummaryLoading(true);

        try {
            // Generate summary for all commits on this day
            const response = await api.postStream('/api/explain', {
                provider: aiSettings.provider,
                apiKey: aiSettings.config.apiKey,
                model: aiSettings.config.model,
                baseUrl: aiSettings.config.baseUrl,
                type: 'day-summary',
                commits: dayCommits.map(c => ({
                    sha: c.sha,
                    message: c.message,
                    authorName: c.authorName,
                    date: c.date,
                })),
                projectName: repository?.name,
                projectOwner: repository?.owner,
            });

            // Handle streaming response
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const text = decoder.decode(value, { stream: true });
                    setDaySummary(prev => prev + text);
                }
            }
        } catch (err) {
            console.error('Failed to generate day summary:', err);
            setDaySummary('Failed to generate AI summary. Please try again.');
        } finally {
            setSummaryLoading(false);
        }
    }

    function closeDayPanel() {
        setShowDayPanel(false);
        setSelectedDate(null);
        setSelectedCommits([]);
        setDaySummary('');
    }

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
                <button className="btn btn-primary" onClick={() => router.push('/')}>
                    Go Home
                </button>
            </div>
        );
    }

    if (!repository || commits.length === 0) {
        return (
            <div className={styles.errorState}>
                <p>No commits found for this repository.</p>
                <button className="btn btn-primary" onClick={() => router.push('/')}>
                    Go Home
                </button>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Header */}
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <button className="btn btn-ghost" onClick={() => router.push('/')}>
                        <Home size={18} />
                    </button>
                    <button
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
                    <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>
                        <Settings size={18} />
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className={styles.main}>
                <div className={styles.calendarContainer}>
                    <CalendarTimeline
                        commits={commits}
                        onDayClick={handleDayClick}
                        selectedDate={selectedDate}
                        loading={summaryLoading}
                    />
                </div>

                {/* Day Summary Panel */}
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
                                className={styles.dayPanelClose}
                                onClick={closeDayPanel}
                                aria-label="Close panel"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Commit list */}
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
                                </div>
                            ))}
                        </div>

                        {/* AI Summary */}
                        <div className={styles.aiSummarySection}>
                            <div className={styles.aiSummaryHeader}>
                                <Sparkles size={16} />
                                <span>AI Summary</span>
                            </div>
                            <div className={styles.aiSummaryContent}>
                                {summaryLoading ? (
                                    <div className={styles.summaryLoading}>
                                        <Loader2 size={20} className={styles.spinner} />
                                        <span>Generating summary...</span>
                                    </div>
                                ) : daySummary ? (
                                    <div className={styles.summaryText}>
                                        {daySummary.split('\n').map((line, i) => (
                                            line.trim() ? <p key={i}>{line}</p> : <br key={i} />
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

            {/* Settings Modal */}
            <SettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
            />
        </div>
    );
}
