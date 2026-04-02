'use client';

import { useState, useEffect, use, useMemo, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    BookOpen,
    ChevronLeft,
    ChevronRight,
    Home,
    Settings,
    Loader2,
    GitCommit,
    User,
    Calendar,
    Maximize2,
    Minimize2,
    ChevronDown,
    RefreshCw,
    Sparkles,
} from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import styles from './explore.module.css';
import SettingsModal from '@/components/SettingsModal';
import CodeViewer from '@/components/CodeViewer';
import AIPanel from '@/components/AIPanel';
import FileTree from '@/components/FileTree';
import CommitHistoryModal from '@/components/CommitHistoryModal';
import CommitTimeline from '@/components/CommitTimeline';
import DiffViewer from '@/components/DiffViewer';
import StoryModePanel from '@/components/StoryModePanel';
import { api } from '@/lib/api-client';
import {
    fetchCommitsPageForRepository,
    fetchInitialCommitsForRepository,
} from '@/lib/commit-pagination';
import Link from 'next/link';
import type {
    Repository,
    Commit,
    FileData,
    CommitDiffResponse,
    CompareDiffResponse,
    DiffFileData,
} from '@/types';

type CenterView = 'code' | 'diff' | 'story';
type DiffScope = 'commit' | 'compare';

export default function ExplorePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const searchParams = useSearchParams();
    const ingestJobId = searchParams.get('jobId');

    const [repository, setRepository] = useState<Repository | null>(null);
    const [commits, setCommits] = useState<Commit[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [files, setFiles] = useState<FileData[]>([]);
    const [selectedFile, setSelectedFile] = useState<FileData | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [loadingContent, setLoadingContent] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [aiPanelExpanded, setAiPanelExpanded] = useState(true);
    const [sidebarTab, setSidebarTab] = useState<'commits' | 'files'>('files');
    const [commitOrder, setCommitOrder] = useState<'asc' | 'desc'>('asc');
    const [diffScope, setDiffScope] = useState<DiffScope>('commit');
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [focusMode, setFocusMode] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [centerView, setCenterView] = useState<CenterView>('code');
    const [diffViewMode, setDiffViewMode] = useState<'unified' | 'split'>('unified');

    const [commitDiffFiles, setCommitDiffFiles] = useState<DiffFileData[]>([]);
    const [commitDiffLoading, setCommitDiffLoading] = useState(false);
    const [commitDiffError, setCommitDiffError] = useState<string | null>(null);
    const [selectedCommitDiffPath, setSelectedCommitDiffPath] = useState('');

    const [compareBaseSha, setCompareBaseSha] = useState('');
    const [compareHeadSha, setCompareHeadSha] = useState('');
    const [compareFiles, setCompareFiles] = useState<DiffFileData[]>([]);
    const [compareStatus, setCompareStatus] = useState('unknown');
    const [compareTotalFiles, setCompareTotalFiles] = useState(0);
    const [compareAheadBy, setCompareAheadBy] = useState(0);
    const [compareBehindBy, setCompareBehindBy] = useState(0);
    const [compareLoading, setCompareLoading] = useState(false);
    const [compareError, setCompareError] = useState<string | null>(null);
    const [selectedComparePath, setSelectedComparePath] = useState('');
    const [pendingCommitSha, setPendingCommitSha] = useState<string | null>(null);
    const [loadingMoreCommits, setLoadingMoreCommits] = useState(false);
    const [waitingForInitialCommits, setWaitingForInitialCommits] = useState(false);
    const [ingestProgress, setIngestProgress] = useState(0);
    const [ingestStatus, setIngestStatus] = useState<string | null>(null);

    const commitPrefetchRequestRef = useRef(0);
    const currentIndexRef = useRef(0);

    const currentCommit = commits[currentIndex];
    const currentCommitSha = currentCommit?.sha;
    const repositoryId = repository?.id;
    const commitSelectionKey = useMemo(() => `grepbase:last_commit:${id}`, [id]);

    const visibleFilePaths = useMemo(
        () => files
            .filter(file => file.shouldFetchContent || file.hasContent)
            .map(file => file.path),
        [files]
    );

    const selectedCommitDiffFile = useMemo(() => {
        if (commitDiffFiles.length === 0) return null;
        return commitDiffFiles.find(file => file.path === selectedCommitDiffPath) || commitDiffFiles[0];
    }, [commitDiffFiles, selectedCommitDiffPath]);

    const orderedCommits = useMemo(
        () => commitOrder === 'asc' ? commits : [...commits].reverse(),
        [commits, commitOrder]
    );

    const selectedCompareFile = useMemo(() => {
        if (compareFiles.length === 0) return null;
        return compareFiles.find(file => file.path === selectedComparePath) || compareFiles[0];
    }, [compareFiles, selectedComparePath]);

    const appendUniqueCommits = useCallback((incoming: Commit[]) => {
        if (incoming.length === 0) return;
        setCommits(prev => {
            const seenShas = new Set(prev.map(commit => commit.sha));
            const additions = incoming.filter(commit => !seenShas.has(commit.sha));
            if (additions.length === 0) return prev;
            return [...prev, ...additions];
        });
    }, []);

    const prefetchRemainingCommits = useCallback((startPage: number) => {
        const requestId = commitPrefetchRequestRef.current + 1;
        commitPrefetchRequestRef.current = requestId;

        if (startPage <= 1) {
            setLoadingMoreCommits(false);
            return;
        }

        setLoadingMoreCommits(true);

        const load = async () => {
            let page = startPage;
            let hasNext = true;

            while (hasNext && commitPrefetchRequestRef.current === requestId) {
                const pageData = await fetchCommitsPageForRepository(id, page);
                if (commitPrefetchRequestRef.current !== requestId) {
                    return;
                }

                appendUniqueCommits(pageData.commits);

                hasNext = Boolean(pageData.pagination?.hasNext);
                page += 1;
            }
        };

        void load()
            .catch((prefetchError) => {
                if (commitPrefetchRequestRef.current !== requestId) return;
                console.warn('Background commit prefetch stopped:', prefetchError);
            })
            .finally(() => {
                if (commitPrefetchRequestRef.current === requestId) {
                    setLoadingMoreCommits(false);
                }
            });
    }, [appendUniqueCommits, id]);

    const fetchRepositoryData = useCallback(async (preserveSha?: string, showLoading = false) => {
        commitPrefetchRequestRef.current += 1;
        setLoadingMoreCommits(false);

        if (showLoading) {
            setLoading(true);
        }

        try {
            const data = await fetchInitialCommitsForRepository(id);

            let targetSha = preserveSha;
            if (!targetSha && typeof window !== 'undefined') {
                const urlSha = new URLSearchParams(window.location.search).get('sha');
                const storedSha =
                    sessionStorage.getItem(commitSelectionKey) ||
                    localStorage.getItem(commitSelectionKey);
                targetSha = urlSha || storedSha || undefined;
            }

            setRepository(data.repository);
            setCommits(data.commits);
            let nextIndex = data.commits.length === 0
                ? 0
                : Math.min(currentIndexRef.current, data.commits.length - 1);
            let unresolvedTargetSha: string | null = null;

            if (targetSha) {
                const idx = data.commits.findIndex(commit => commit.sha === targetSha);
                if (idx >= 0) {
                    nextIndex = idx;
                } else {
                    unresolvedTargetSha = targetSha;
                }
            }

            setCurrentIndex(nextIndex);
            setPendingCommitSha(unresolvedTargetSha);

            if (data.pagination?.hasNext) {
                prefetchRemainingCommits((data.pagination.page || 1) + 1);
            } else {
                setLoadingMoreCommits(false);
                setPendingCommitSha(null);
            }

            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            if (showLoading) {
                setLoading(false);
            }
        }
    }, [commitSelectionKey, id, prefetchRemainingCommits]);

    useEffect(() => {
        fetchRepositoryData(undefined, true);
    }, [fetchRepositoryData]);

    useEffect(() => {
        if (loading) return;

        if (ingestJobId && commits.length === 0) {
            setWaitingForInitialCommits(true);
            return;
        }

        setWaitingForInitialCommits(false);
        setIngestStatus(null);
        setIngestProgress(0);
    }, [commits.length, ingestJobId, loading]);

    useEffect(() => {
        if (!waitingForInitialCommits || !ingestJobId) return;

        let cancelled = false;
        let inFlight = false;

        const poll = async () => {
            if (cancelled || inFlight) return;
            inFlight = true;

            try {
                const jobResponse = await api.get<{
                    status: string;
                    progress?: number;
                    error?: string;
                    ready?: boolean;
                    processedCommits?: number;
                    repoId?: number | null;
                    repository?: { id: number };
                }>(`/api/jobs/${ingestJobId}`);

                if (cancelled) return;

                setIngestStatus(jobResponse.status);
                setIngestProgress(Number(jobResponse.progress || 0));

                const hasProcessedCommits = Number(jobResponse.processedCommits || 0) > 0;

                if (jobResponse.status === 'failed') {
                    setError(jobResponse.error || 'Failed to ingest repository');
                    setWaitingForInitialCommits(false);
                    return;
                }

                if (
                    (jobResponse.repository || jobResponse.repoId) &&
                    (jobResponse.ready || hasProcessedCommits || jobResponse.status === 'completed')
                ) {
                    await fetchRepositoryData(undefined, false);
                }

                if (jobResponse.status === 'completed' && !hasProcessedCommits) {
                    setWaitingForInitialCommits(false);
                }
            } catch (pollError) {
                if (!cancelled) {
                    console.error('Failed to poll ingest job:', pollError);
                }
            } finally {
                inFlight = false;
            }
        };

        void poll();
        const interval = setInterval(() => {
            void poll();
        }, 2000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [fetchRepositoryData, ingestJobId, waitingForInitialCommits]);

    useEffect(() => {
        currentIndexRef.current = currentIndex;
    }, [currentIndex]);

    useEffect(() => {
        if (!pendingCommitSha) return;
        const idx = commits.findIndex(commit => commit.sha === pendingCommitSha);
        if (idx < 0) return;
        setCurrentIndex(idx);
        setPendingCommitSha(null);
    }, [commits, pendingCommitSha]);

    useEffect(() => {
        return () => {
            commitPrefetchRequestRef.current += 1;
        };
    }, []);

    useEffect(() => {
        if (!currentCommit?.sha || typeof window === 'undefined') return;

        sessionStorage.setItem(commitSelectionKey, currentCommit.sha);
        localStorage.setItem(commitSelectionKey, currentCommit.sha);

        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.get('sha') !== currentCommit.sha) {
            currentUrl.searchParams.set('sha', currentCommit.sha);
            window.history.replaceState({}, '', currentUrl.toString());
        }
    }, [commitSelectionKey, currentCommit?.sha]);

    const selectFile = useCallback(async (file: FileData) => {
        if (file.content) {
            setSelectedFile(file);
            return;
        }

        if (!currentCommitSha) return;

        setLoadingContent(true);
        setSelectedFile({ ...file, content: null });

        try {
            const data = await api.get<{ content?: string }>(
                `/api/repos/${id}/commits/${currentCommitSha}/content?path=${encodeURIComponent(file.path)}`
            );

            if (data.content) {
                const updatedFile = { ...file, content: data.content, hasContent: true };
                setFiles(prev => prev.map(existing => (existing.path === file.path ? updatedFile : existing)));
                setSelectedFile(updatedFile);
            }
        } catch (err) {
            console.error('Failed to fetch file content:', err);
        } finally {
            setLoadingContent(false);
        }
    }, [currentCommitSha, id]);

    useEffect(() => {
        if (!currentCommitSha || !repositoryId) return;

        let cancelled = false;

        async function fetchFilesForCommit() {
            setLoadingFiles(true);
            setSelectedFile(null);
            try {
                const data = await api.get<{ files?: FileData[] }>(`/api/repos/${id}/commits/${currentCommitSha}`);
                if (cancelled) return;

                const nextFiles = data.files || [];
                setFiles(nextFiles);

                const firstLoadable = nextFiles.find(file => file.shouldFetchContent || file.hasContent);
                if (firstLoadable) {
                    void selectFile(firstLoadable);
                }
            } catch (err) {
                if (!cancelled) {
                    console.error('Failed to fetch files:', err);
                }
            } finally {
                if (!cancelled) {
                    setLoadingFiles(false);
                }
            }
        }

        void fetchFilesForCommit();

        return () => {
            cancelled = true;
        };
    }, [currentCommitSha, id, repositoryId, selectFile]);

    const openFileFromAIReference = useCallback(async (path: string) => {
        const normalized = path
            .trim()
            .replace(/^\/+/, '')
            .replace(/^a\//, '')
            .replace(/^b\//, '')
            .replace(/^\.\/+/, '')
            .replace(/\/+$/, '');

        if (!normalized) return;

        const exact =
            files.find(file => file.path === normalized) ||
            files.find(file => file.path.toLowerCase() === normalized.toLowerCase());

        if (exact) {
            await selectFile(exact);
            return;
        }

        const suffix =
            files.find(file => file.path.endsWith(`/${normalized}`)) ||
            files.find(file => file.path.endsWith(normalized));

        if (suffix) {
            await selectFile(suffix);
            return;
        }

        const directoryPrefix = `${normalized}/`;
        const firstInDirectory = [...files]
            .filter(file => file.path.startsWith(directoryPrefix))
            .sort((a, b) => a.path.localeCompare(b.path))[0];

        if (firstInDirectory) {
            await selectFile(firstInDirectory);
        }
    }, [files, selectFile]);

    const handleResync = useCallback(async () => {
        if (!repository || syncing) return;
        setSyncing(true);

        try {
            const data = await api.post<{ jobId?: string; cached?: boolean }>('/api/repos', {
                url: `github.com/${repository.owner}/${repository.name}`,
            });

            if (data.jobId) {
                let attempts = 0;
                const maxAttempts = 60;

                const poll = async (): Promise<void> => {
                    attempts += 1;
                    try {
                        const jobResponse = await api.get<{
                            status: string;
                            error?: string;
                            ready?: boolean;
                            processedCommits?: number;
                        }>(`/api/jobs/${data.jobId}`);

                        const hasProcessedCommits = Number(jobResponse.processedCommits || 0) > 0;
                        if (jobResponse.status === 'completed' || jobResponse.ready || hasProcessedCommits) {
                            await fetchRepositoryData(currentCommit?.sha, false);
                            setSyncing(false);
                        } else if (jobResponse.status === 'failed') {
                            console.error('Sync failed:', jobResponse.error);
                            setSyncing(false);
                        } else if (attempts < maxAttempts) {
                            setTimeout(poll, 2000);
                        } else {
                            console.error('Sync timed out');
                            setSyncing(false);
                        }
                    } catch (pollError) {
                        console.error('Polling error:', pollError);
                        setSyncing(false);
                    }
                };

                void poll();
            } else {
                await fetchRepositoryData(currentCommit?.sha, false);
                setSyncing(false);
            }
        } catch (err) {
            console.error('Failed to trigger resync:', err);
            setSyncing(false);
        }
    }, [currentCommit?.sha, fetchRepositoryData, repository, syncing]);

    const goToCommit = useCallback((index: number) => {
        if (index < 0 || index >= commits.length) return;
        setCurrentIndex(index);
        setSelectedFile(null);
    }, [commits.length]);

    const goNext = useCallback(() => {
        setCurrentIndex(prev => {
            if (commits.length === 0) return 0;
            const nextIndex = Math.min(prev + 1, commits.length - 1);
            if (nextIndex !== prev) {
                setSelectedFile(null);
            }
            return nextIndex;
        });
    }, [commits.length]);

    const goPrev = useCallback(() => {
        setCurrentIndex(prev => {
            const nextIndex = Math.max(prev - 1, 0);
            if (nextIndex !== prev) {
                setSelectedFile(null);
            }
            return nextIndex;
        });
    }, []);

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (showSettings || showHistoryModal) return;
            const tag = (event.target as HTMLElement).tagName;
            const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
                || (event.target as HTMLElement).isContentEditable;
            if (isEditable) return;

            if (event.key === 'ArrowRight') {
                goNext();
            } else if (event.key === 'ArrowLeft') {
                goPrev();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [goNext, goPrev, showHistoryModal, showSettings]);

    useEffect(() => {
        if (!currentCommit?.sha) return;
        if (centerView !== 'diff' || diffScope !== 'commit') return;

        let cancelled = false;

        async function fetchCommitDiffData() {
            setCommitDiffLoading(true);
            setCommitDiffError(null);

            try {
                const data = await api.get<CommitDiffResponse>(`/api/repos/${id}/commits/${currentCommit.sha}/diff`);
                if (cancelled) return;

                const filesChanged = data.files || [];
                setCommitDiffFiles(filesChanged);
                setSelectedCommitDiffPath(prev => {
                    if (prev && filesChanged.some(file => file.path === prev)) {
                        return prev;
                    }
                    return filesChanged[0]?.path || '';
                });
            } catch (err) {
                if (!cancelled) {
                    setCommitDiffFiles([]);
                    setCommitDiffError(err instanceof Error ? err.message : 'Failed to load commit diff');
                }
            } finally {
                if (!cancelled) {
                    setCommitDiffLoading(false);
                }
            }
        }

        void fetchCommitDiffData();

        return () => {
            cancelled = true;
        };
    }, [centerView, currentCommit?.sha, id]);

    useEffect(() => {
        if (commits.length === 0) return;

        const head = commits[currentIndex]?.sha || commits[commits.length - 1].sha;
        const base = commits[Math.max(0, currentIndex - 1)]?.sha || head;

        setCompareHeadSha(head);
        setCompareBaseSha(base);
    }, [commits, currentIndex]);

    useEffect(() => {
        if (centerView !== 'diff' || diffScope !== 'compare') return;
        if (!compareBaseSha || !compareHeadSha) return;

        let cancelled = false;

        async function fetchCompareData() {
            setCompareLoading(true);
            setCompareError(null);

            try {
                const data = await api.get<CompareDiffResponse>(
                    `/api/repos/${id}/compare?base=${encodeURIComponent(compareBaseSha)}&head=${encodeURIComponent(compareHeadSha)}`
                );

                if (cancelled) return;

                setCompareFiles(data.files || []);
                setCompareStatus(data.status || 'unknown');
                setCompareTotalFiles(data.totalFiles || data.files.length || 0);
                setCompareAheadBy(data.aheadBy || 0);
                setCompareBehindBy(data.behindBy || 0);
                setSelectedComparePath(prev => {
                    if (prev && data.files.some(file => file.path === prev)) {
                        return prev;
                    }
                    return data.files[0]?.path || '';
                });
            } catch (err) {
                if (!cancelled) {
                    setCompareFiles([]);
                    setCompareError(err instanceof Error ? err.message : 'Failed to compare commits');
                }
            } finally {
                if (!cancelled) {
                    setCompareLoading(false);
                }
            }
        }

        void fetchCompareData();

        return () => {
            cancelled = true;
        };
    }, [centerView, compareBaseSha, compareHeadSha, id]);

    if (loading) {
        return (
            <div className={styles.loadingState}>
                <Loader2 size={32} className={styles.spinner} />
                <p>Loading repository...</p>
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
        if (waitingForInitialCommits) {
            return (
                <div className={styles.loadingState}>
                    <Loader2 size={32} className={styles.spinner} />
                    <p>
                        {ingestStatus === 'processing'
                            ? `Indexing commits... ${ingestProgress}%`
                            : 'Preparing repository...'}
                    </p>
                </div>
            );
        }

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
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <Link href="/" className={`btn btn-ghost ${styles.headerHomeBtn}`}>
                        <Home size={16} />
                    </Link>
                    <div className={styles.repoInfo}>
                        <BookOpen size={14} className={styles.repoIcon} />
                        <span className={styles.repoName}>
                            {repository.owner}<span className={styles.repoSlash}>/</span>{repository.name}
                        </span>
                    </div>
                </div>

                <div className={styles.headerCenter}>
                    <button
                        className={styles.navArrow}
                        onClick={goPrev}
                        disabled={currentIndex === 0}
                        title="Previous commit (←)"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <button className={styles.chapterTrigger} onClick={() => setShowHistoryModal(true)}>
                        <span className={styles.chapterLabel}>
                            #{currentIndex + 1}{loadingMoreCommits ? '' : ` of ${commits.length}`}
                        </span>
                        <span className={styles.chapterTitle}>{currentCommit.message.split('\n')[0]}</span>
                        <ChevronDown size={12} className={styles.chapterChevron} />
                    </button>
                    <button
                        className={styles.navArrow}
                        onClick={goNext}
                        disabled={currentIndex === commits.length - 1}
                        title="Next commit (→)"
                    >
                        <ChevronRight size={14} />
                    </button>
                </div>

                <div className={styles.headerRight}>
                    <button
                        className={`btn btn-ghost ${styles.headerBtn} ${syncing ? styles.active : ''}`}
                        onClick={handleResync}
                        disabled={syncing}
                        title="Resync Repository"
                    >
                        {syncing ? <Loader2 size={15} className={styles.spinner} /> : <RefreshCw size={15} />}
                    </button>

                    <button
                        className={`btn btn-ghost ${styles.headerBtn} ${focusMode ? styles.active : ''}`}
                        onClick={() => setFocusMode(!focusMode)}
                        title="Focus Mode"
                    >
                        {focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    </button>

                    <button className={`btn btn-ghost ${styles.headerBtn}`} onClick={() => setShowSettings(true)} title="Settings">
                        <Settings size={15} />
                    </button>
                </div>
            </header>

            <div className={styles.main}>
                <PanelGroup direction="horizontal" className={styles.group}>
                    {!focusMode && (
                        <Panel defaultSize={18} minSize={14} maxSize={28} className={styles.panel} id="left">
                            <div className={styles.sidebarTabStrip}>
                                <button
                                    className={`${styles.sidebarTabBtn} ${sidebarTab === 'commits' ? styles.sidebarTabActive : ''}`}
                                    onClick={() => setSidebarTab('commits')}
                                >
                                    Commits
                                </button>
                                <button
                                    className={`${styles.sidebarTabBtn} ${sidebarTab === 'files' ? styles.sidebarTabActive : ''}`}
                                    onClick={() => setSidebarTab('files')}
                                >
                                    Files
                                </button>
                            </div>
                            {sidebarTab === 'commits' && (
                                <div className={styles.commitSortBar}>
                                    <button
                                        className={`${styles.commitSortBtn} ${commitOrder === 'asc' ? styles.commitSortActive : ''}`}
                                        onClick={() => { setCommitOrder('asc'); setCurrentIndex(0); }}
                                    >
                                        ↑ Oldest
                                    </button>
                                    <button
                                        className={`${styles.commitSortBtn} ${commitOrder === 'desc' ? styles.commitSortActive : ''}`}
                                        onClick={() => { setCommitOrder('desc'); setCurrentIndex(commits.length - 1); }}
                                    >
                                        ↓ Newest
                                    </button>
                                </div>
                            )}
                            <div className={styles.sidebarContent}>
                                {sidebarTab === 'commits' ? (
                                    <CommitTimeline
                                        commits={orderedCommits}
                                        currentIndex={commitOrder === 'asc' ? currentIndex : commits.length - 1 - currentIndex}
                                        onSelect={(displayIdx) => goToCommit(commitOrder === 'asc' ? displayIdx : commits.length - 1 - displayIdx)}
                                    />
                                ) : loadingFiles ? (
                                    <div className={styles.loadingFiles}>
                                        <Loader2 size={24} className={styles.spinner} />
                                    </div>
                                ) : (
                                    <FileTree
                                        files={files}
                                        selectedFile={selectedFile}
                                        onSelectFile={selectFile}
                                    />
                                )}
                            </div>
                            <div className={styles.sidebarFooter}>
                                <button
                                    className={styles.sidebarFooterBtn}
                                    onClick={() => setShowHistoryModal(true)}
                                >
                                    <Calendar size={13} />
                                    Calendar
                                </button>
                            </div>
                        </Panel>
                    )}

                    {!focusMode && <PanelResizeHandle className={styles.resizeHandle} />}

                    <Panel defaultSize={60} minSize={30} className={styles.panel} id="code">
                        <div className={styles.commitStrip}>
                            <div className={styles.commitSha}>
                                <GitCommit size={12} />
                                <code>{currentCommit.sha.substring(0, 7)}</code>
                            </div>
                            <span className={styles.commitAuthor}>
                                <User size={12} />
                                {currentCommit.authorName || 'Unknown'}
                            </span>
                            <span className={styles.commitDate}>
                                <Calendar size={12} />
                                {new Date(currentCommit.date).toLocaleDateString()}
                            </span>
                        </div>

                        <div className={styles.viewTabs}>
                            <button
                                className={`${styles.viewTab} ${centerView === 'code' ? styles.viewTabActive : ''}`}
                                onClick={() => setCenterView('code')}
                            >
                                Code
                            </button>
                            <button
                                className={`${styles.viewTab} ${centerView === 'diff' ? styles.viewTabActive : ''}`}
                                onClick={() => setCenterView('diff')}
                            >
                                Diff
                            </button>
                            <button
                                className={`${styles.viewTab} ${centerView === 'story' ? styles.viewTabActive : ''}`}
                                onClick={() => setCenterView('story')}
                            >
                                Story
                            </button>
                        </div>

                        <div className={styles.codeArea}>
                            <div className={styles.codeDisplay}>
                                {centerView === 'code' && (
                                    loadingContent ? (
                                        <div className={styles.loadingFiles}>
                                            <Loader2 size={24} className={styles.spinner} />
                                            <p>Loading content...</p>
                                        </div>
                                    ) : selectedFile?.content ? (
                                        <CodeViewer
                                            code={selectedFile.content}
                                            language={selectedFile.language}
                                            filename={selectedFile.path}
                                        />
                                    ) : (
                                        <div className={styles.noFile}>
                                            <div className={styles.emptyStateIcon}>
                                                <BookOpen size={48} />
                                            </div>
                                            <h3>Select a file to start reading</h3>
                                            <p>Browse the file tree on the left to view code.</p>
                                        </div>
                                    )
                                )}

                                {centerView === 'diff' && (
                                    <div className={styles.diffContainer}>
                                        <div className={styles.diffToolbar}>
                                            <div className={styles.diffScopeToggle}>
                                                <button
                                                    className={`${styles.diffScopeBtn} ${diffScope === 'commit' ? styles.diffScopeBtnActive : ''}`}
                                                    onClick={() => setDiffScope('commit')}
                                                >
                                                    This commit
                                                </button>
                                                <button
                                                    className={`${styles.diffScopeBtn} ${diffScope === 'compare' ? styles.diffScopeBtnActive : ''}`}
                                                    onClick={() => setDiffScope('compare')}
                                                >
                                                    Compare
                                                </button>
                                            </div>

                                            {diffScope === 'commit' ? (
                                                <div className={styles.diffToolbarControls}>
                                                    <select
                                                        value={selectedCommitDiffPath}
                                                        onChange={event => setSelectedCommitDiffPath(event.target.value)}
                                                        disabled={commitDiffFiles.length === 0}
                                                    >
                                                        {commitDiffFiles.length === 0 && <option value="">No changed files</option>}
                                                        {commitDiffFiles.map(file => (
                                                            <option key={file.path} value={file.path}>
                                                                {file.path}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <span className={styles.diffStats}>
                                                        {commitDiffFiles.length} file{commitDiffFiles.length === 1 ? '' : 's'}
                                                    </span>
                                                </div>
                                            ) : (
                                                <div className={styles.diffToolbarControls}>
                                                    <label className={styles.diffSelectLabel}>
                                                        Base
                                                        <select value={compareBaseSha} onChange={event => setCompareBaseSha(event.target.value)}>
                                                            {commits.map((commit, index) => (
                                                                <option key={`base-${commit.sha}`} value={commit.sha}>
                                                                    {index + 1}. {commit.sha.slice(0, 7)} — {commit.message.split('\n')[0].slice(0, 40)}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <label className={styles.diffSelectLabel}>
                                                        Head
                                                        <select value={compareHeadSha} onChange={event => setCompareHeadSha(event.target.value)}>
                                                            {commits.map((commit, index) => (
                                                                <option key={`head-${commit.sha}`} value={commit.sha}>
                                                                    {index + 1}. {commit.sha.slice(0, 7)} — {commit.message.split('\n')[0].slice(0, 40)}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <label className={styles.diffSelectLabel}>
                                                        File
                                                        <select
                                                            value={selectedComparePath}
                                                            onChange={event => setSelectedComparePath(event.target.value)}
                                                            disabled={compareFiles.length === 0}
                                                        >
                                                            {compareFiles.length === 0 && <option value="">No changed files</option>}
                                                            {compareFiles.map(file => (
                                                                <option key={file.path} value={file.path}>{file.path}</option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                </div>
                                            )}

                                            <div className={styles.diffModeToggle}>
                                                <button
                                                    className={diffViewMode === 'unified' ? styles.diffModeActive : ''}
                                                    onClick={() => setDiffViewMode('unified')}
                                                >
                                                    Unified
                                                </button>
                                                <button
                                                    className={diffViewMode === 'split' ? styles.diffModeActive : ''}
                                                    onClick={() => setDiffViewMode('split')}
                                                >
                                                    Split
                                                </button>
                                            </div>
                                        </div>

                                        {diffScope === 'commit' ? (
                                            commitDiffLoading ? (
                                                <div className={styles.loadingFiles}>
                                                    <Loader2 size={24} className={styles.spinner} />
                                                    <p>Loading diff...</p>
                                                </div>
                                            ) : commitDiffError ? (
                                                <div className={styles.errorInline}>{commitDiffError}</div>
                                            ) : selectedCommitDiffFile ? (
                                                <>
                                                    <div className={styles.diffMeta}>
                                                        <span>{selectedCommitDiffFile.status}</span>
                                                        <span className={styles.diffAdd}>+{selectedCommitDiffFile.additions}</span>
                                                        <span className={styles.diffDel}>-{selectedCommitDiffFile.deletions}</span>
                                                    </div>
                                                    <DiffViewer patch={selectedCommitDiffFile.patch} mode={diffViewMode} />
                                                </>
                                            ) : (
                                                <div className={styles.noFile}>
                                                    <h3>No diff available</h3>
                                                    <p>This commit has no textual file changes.</p>
                                                </div>
                                            )
                                        ) : (
                                            <>
                                                {compareStatus !== 'unknown' && (
                                                    <div className={styles.compareSummary}>
                                                        <span>{compareStatus}</span>
                                                        <span>{compareTotalFiles} files</span>
                                                        <span>+{compareAheadBy}</span>
                                                        <span>-{compareBehindBy}</span>
                                                    </div>
                                                )}
                                                {compareLoading ? (
                                                    <div className={styles.loadingFiles}>
                                                        <Loader2 size={24} className={styles.spinner} />
                                                        <p>Comparing commits...</p>
                                                    </div>
                                                ) : compareError ? (
                                                    <div className={styles.errorInline}>{compareError}</div>
                                                ) : compareBaseSha === compareHeadSha ? (
                                                    <div className={styles.noFile}>
                                                        <h3>Same commit selected</h3>
                                                        <p>Select two different commits to compare.</p>
                                                    </div>
                                                ) : selectedCompareFile ? (
                                                    <>
                                                        <div className={styles.diffMeta}>
                                                            <span>{selectedCompareFile.status}</span>
                                                            <span className={styles.diffAdd}>+{selectedCompareFile.additions}</span>
                                                            <span className={styles.diffDel}>-{selectedCompareFile.deletions}</span>
                                                        </div>
                                                        <DiffViewer
                                                            patch={selectedCompareFile.patch}
                                                            mode={diffViewMode}
                                                            emptyMessage="This file did not change textually between the selected commits."
                                                        />
                                                    </>
                                                ) : (
                                                    <div className={styles.noFile}>
                                                        <h3>No changed files in this range</h3>
                                                        <p>Try a different commit pair.</p>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}

                                {centerView === 'story' && (
                                    <StoryModePanel
                                        repository={repository}
                                        commits={commits}
                                        currentIndex={currentIndex}
                                    />
                                )}
                            </div>
                        </div>

                    </Panel>

                    {!focusMode && <PanelResizeHandle className={styles.resizeHandle} />}
                    {!focusMode && (
                        <Panel
                            defaultSize={aiPanelExpanded ? 22 : 2}
                            minSize={aiPanelExpanded ? 16 : 2}
                            maxSize={aiPanelExpanded ? 40 : 2}
                            className={styles.panel}
                            id="ai"
                        >
                            <div className={`${styles.aiPanelInner} ${!aiPanelExpanded ? styles.aiPanelCollapsed : ''}`}>
                                <button
                                    className={styles.aiCollapseBtn}
                                    onClick={() => setAiPanelExpanded(v => !v)}
                                    title={aiPanelExpanded ? 'Collapse AI' : 'Expand AI'}
                                >
                                    {aiPanelExpanded ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
                                </button>
                                {aiPanelExpanded ? (
                                    <>
                                        <div className={styles.panelHeader}>
                                            <h3 className={styles.panelTitle}>AI Analysis</h3>
                                        </div>
                                        <div className={styles.aiPanelWrapper}>
                                            <AIPanel
                                                repository={repository}
                                                commit={currentCommit}
                                                totalCommits={commits.length}
                                                currentIndex={currentIndex}
                                                onOpenFile={openFileFromAIReference}
                                                visibleFilePaths={visibleFilePaths}
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <div className={styles.aiCollapsedLabel}>AI</div>
                                )}
                            </div>
                        </Panel>
                    )}
                </PanelGroup>
            </div>

            {showHistoryModal && (
                <CommitHistoryModal
                    isOpen={showHistoryModal}
                    onClose={() => setShowHistoryModal(false)}
                    commits={commits}
                    currentIndex={currentIndex}
                    onSelectCommit={goToCommit}
                />
            )}

            <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
        </div>
    );
}
