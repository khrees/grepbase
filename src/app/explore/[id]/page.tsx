'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, use, useMemo, useCallback, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
    BookOpen,
    ChevronLeft,
    ChevronRight,
    Home,
    Settings,
    Loader2,
    MessageSquare,
    GitCommit,
    User,
    Calendar,
    Maximize2,
    Minimize2,
    ChevronDown,
    RefreshCw,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import styles from './explore.module.css';
import SettingsModal from '@/components/SettingsModal';
import CodeViewer from '@/components/CodeViewer';
import AIPanel from '@/components/AIPanel';
import FileTree from '@/components/FileTree';
import CommitHistoryModal from '@/components/CommitHistoryModal';
import DiffViewer from '@/components/DiffViewer';
import StoryModePanel from '@/components/StoryModePanel';
import {
    useCommitDiff,
    useCommitFiles,
    useCompareDiff,
    useFileContent,
    useJobStatus,
    useRepoCommitsInfinite,
    useResyncRepo,
} from '@/lib/query/hooks';
import { getCommitDiff, getCommitFiles } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/keys';
import Link from 'next/link';
import type {
    Commit,
    FileData,
} from '@/types';

type CenterView = 'code' | 'commit-diff' | 'file-diff' | 'story';
const INITIAL_JOB_POLL_INTERVAL_MS = 500;
const FAST_POLL_COUNT = 5;
const BASE_JOB_POLL_INTERVAL_MS = 2000;
const MAX_JOB_POLL_INTERVAL_MS = 15000;
const MAX_JOB_POLL_ERRORS = 5;

export default function ExplorePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const pathname = usePathname();
    const queryClient = useQueryClient();
    const searchParams = useSearchParams();
    const ingestJobId = searchParams.get('jobId');

    const commitsQuery = useRepoCommitsInfinite(id);

    const [currentIndex, setCurrentIndex] = useState(0);
    const [selectedFilePath, setSelectedFilePath] = useState('');
    const [hasUserSelectedFile, setHasUserSelectedFile] = useState(false);
    const [loadedFileContent, setLoadedFileContent] = useState<Record<string, string>>({});
    const [showSettings, setShowSettings] = useState(false);
    const [showAIPanel, setShowAIPanel] = useState(true);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [focusMode, setFocusMode] = useState(false);
    const [pageError, setPageError] = useState<string | null>(null);

    const [centerView, setCenterView] = useState<CenterView>('code');
    const [diffViewMode, setDiffViewMode] = useState<'unified' | 'split'>('unified');

    const [selectedCommitDiffPath, setSelectedCommitDiffPath] = useState('');

    const [compareBaseSha, setCompareBaseSha] = useState('');
    const [compareHeadSha, setCompareHeadSha] = useState('');
    const [selectedComparePath, setSelectedComparePath] = useState('');

    const [pendingCommitSha, setPendingCommitSha] = useState<string | null>(null);
    const [syncJobId, setSyncJobId] = useState<string | null>(null);

    const hasHydratedSelectionRef = useRef(false);
    const lastPathRef = useRef<string | null>(null);

    const commitSelectionKey = useMemo(() => `grepbase:last_commit:${id}`, [id]);

    const commits = useMemo(() => {
        const pages = commitsQuery.data?.pages || [];
        const seenShas = new Set<string>();
        const allCommits: Commit[] = [];

        for (const page of pages) {
            for (const commit of page.commits) {
                if (seenShas.has(commit.sha)) continue;
                seenShas.add(commit.sha);
                allCommits.push(commit);
            }
        }

        return allCommits;
    }, [commitsQuery.data?.pages]);

    const repository = commitsQuery.data?.pages[0]?.repository ?? null;
    const currentCommit = commits[currentIndex];
    const currentCommitSha = currentCommit?.sha;

    const loading = commitsQuery.isPending;
    const loadingMoreCommits = Boolean(commitsQuery.hasNextPage) || commitsQuery.isFetchingNextPage;
    const error = pageError || (commitsQuery.error instanceof Error ? commitsQuery.error.message : null);

    useEffect(() => {
        if (!commitsQuery.hasNextPage || commitsQuery.isFetchingNextPage) {
            return;
        }

        void commitsQuery.fetchNextPage();
    }, [commitsQuery.fetchNextPage, commitsQuery.hasNextPage, commitsQuery.isFetchingNextPage]);

    useEffect(() => {
        if (commits.length === 0) {
            return;
        }

        if (!hasHydratedSelectionRef.current) {
            let targetSha: string | undefined;
            if (typeof window !== 'undefined') {
                const urlSha = new URLSearchParams(window.location.search).get('sha') || undefined;
                const storedSha =
                    sessionStorage.getItem(commitSelectionKey) ||
                    localStorage.getItem(commitSelectionKey) ||
                    undefined;
                targetSha = urlSha || storedSha;
            }

            if (targetSha) {
                const idx = commits.findIndex(commit => commit.sha === targetSha);
                if (idx >= 0) {
                    setCurrentIndex(idx);
                } else {
                    setPendingCommitSha(targetSha);
                    setCurrentIndex(prev => Math.min(prev, commits.length - 1));
                }
            } else {
                setCurrentIndex(prev => Math.min(prev, commits.length - 1));
            }

            hasHydratedSelectionRef.current = true;
            return;
        }

        setCurrentIndex(prev => Math.min(prev, commits.length - 1));
    }, [commitSelectionKey, commits]);

    useEffect(() => {
        if (!pendingCommitSha) return;

        const idx = commits.findIndex(commit => commit.sha === pendingCommitSha);
        if (idx < 0) return;

        setCurrentIndex(idx);
        setPendingCommitSha(null);
    }, [commits, pendingCommitSha]);

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

    const clearIngestJobParamFromUrl = useCallback(() => {
        if (typeof window === 'undefined') return;

        const currentUrl = new URL(window.location.href);
        if (!currentUrl.searchParams.has('jobId')) return;

        currentUrl.searchParams.delete('jobId');
        window.history.replaceState({}, '', currentUrl.toString());
    }, []);

    const waitingForInitialCommits = !loading && Boolean(ingestJobId) && commits.length === 0 && !error;

    const resetTransientViewState = useCallback(() => {
        // Always reset volatile view state when entering/re-entering this route.
        setCenterView('code');
        setCurrentIndex(0);
        setSelectedFilePath('');
        setHasUserSelectedFile(false);
        setLoadedFileContent({});
        setSelectedCommitDiffPath('');
        setCompareBaseSha('');
        setCompareHeadSha('');
        setSelectedComparePath('');
        setPendingCommitSha(null);
        hasHydratedSelectionRef.current = false;
    }, []);

    useEffect(() => {
        resetTransientViewState();
    }, [id, resetTransientViewState]);

    useEffect(() => {
        const expectedPath = `/explore/${id}`;
        const previousPath = lastPathRef.current;
        const enteredExploreRoute = pathname === expectedPath && previousPath !== expectedPath;

        if (enteredExploreRoute) {
            resetTransientViewState();
        }

        lastPathRef.current = pathname;
    }, [id, pathname, resetTransientViewState]);

    const ingestJobStatus = useJobStatus(ingestJobId, {
        enabled: waitingForInitialCommits,
        initialIntervalMs: INITIAL_JOB_POLL_INTERVAL_MS,
        fastPollCount: FAST_POLL_COUNT,
        baseIntervalMs: BASE_JOB_POLL_INTERVAL_MS,
        maxIntervalMs: MAX_JOB_POLL_INTERVAL_MS,
        maxErrors: MAX_JOB_POLL_ERRORS,
    });

    const ingestStatus = ingestJobStatus.data?.status || null;
    const ingestProgress = Number(ingestJobStatus.data?.progress || 0);

    useEffect(() => {
        if (!waitingForInitialCommits || !ingestJobId) {
            return;
        }

        if (ingestJobStatus.error && !ingestJobStatus.data) {
            setPageError(
                ingestJobStatus.error instanceof Error
                    ? ingestJobStatus.error.message
                    : 'Failed to fetch ingest status'
            );
            clearIngestJobParamFromUrl();
            return;
        }

        const data = ingestJobStatus.data;
        if (!data) {
            return;
        }

        if (data.status === 'failed') {
            setPageError(data.error || 'Failed to ingest repository');
            clearIngestJobParamFromUrl();
            return;
        }

        if (ingestJobStatus.isTerminal) {
            clearIngestJobParamFromUrl();
            void commitsQuery.refetch();
        }
    }, [
        clearIngestJobParamFromUrl,
        commitsQuery,
        ingestJobId,
        ingestJobStatus.data,
        ingestJobStatus.error,
        ingestJobStatus.isTerminal,
        waitingForInitialCommits,
    ]);

    useEffect(() => {
        if (ingestJobId && commits.length > 0) {
            clearIngestJobParamFromUrl();
        }
    }, [clearIngestJobParamFromUrl, commits.length, ingestJobId]);

    const commitFilesQuery = useCommitFiles(id, currentCommitSha);
    const rawFiles = commitFilesQuery.data?.files || [];

    const files = useMemo(() => {
        if (!currentCommitSha) {
            return rawFiles;
        }

        return rawFiles.map((file) => {
            const contentKey = `${currentCommitSha}:${file.path}`;
            const localContent = loadedFileContent[contentKey];
            if (!localContent) {
                return file;
            }

            return {
                ...file,
                content: localContent,
                hasContent: true,
            };
        });
    }, [currentCommitSha, loadedFileContent, rawFiles]);

    const selectedFile = useMemo(() => {
        if (!selectedFilePath) return null;
        return files.find(file => file.path === selectedFilePath) || null;
    }, [files, selectedFilePath]);

    const shouldLoadSelectedFileContent = Boolean(
        currentCommitSha &&
        selectedFilePath &&
        selectedFile &&
        !selectedFile.content &&
        (selectedFile.shouldFetchContent || selectedFile.hasContent)
    );

    const selectedFileContentQuery = useFileContent(
        id,
        currentCommitSha,
        selectedFilePath || undefined,
        { enabled: shouldLoadSelectedFileContent }
    );

    useEffect(() => {
        const content = selectedFileContentQuery.data?.content;
        if (!content || !currentCommitSha || !selectedFilePath) {
            return;
        }

        const contentKey = `${currentCommitSha}:${selectedFilePath}`;
        setLoadedFileContent(prev => {
            if (prev[contentKey] === content) {
                return prev;
            }

            return {
                ...prev,
                [contentKey]: content,
            };
        });
    }, [currentCommitSha, selectedFileContentQuery.data?.content, selectedFilePath]);

    useEffect(() => {
        setSelectedFilePath('');
        setHasUserSelectedFile(false);
    }, [currentCommitSha]);

    useEffect(() => {
        if (!selectedFilePath) return;
        if (files.some(file => file.path === selectedFilePath)) return;

        // Clear selection when current selection no longer exists in the file list.
        setSelectedFilePath('');
        setHasUserSelectedFile(false);
    }, [files, selectedFilePath]);

    const selectFile = useCallback((file: FileData) => {
        setSelectedFilePath(file.path);
        setHasUserSelectedFile(true);
    }, []);

    const loadingFiles = commitFilesQuery.isFetching && !commitFilesQuery.data;
    const loadingContent = shouldLoadSelectedFileContent && selectedFileContentQuery.isFetching;

    const visibleFilePaths = useMemo(
        () => files
            .filter(file => file.shouldFetchContent || file.hasContent)
            .map(file => file.path),
        [files]
    );

    const openFileFromAIReference = useCallback((path: string) => {
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
            selectFile(exact);
            return;
        }

        const suffix =
            files.find(file => file.path.endsWith(`/${normalized}`)) ||
            files.find(file => file.path.endsWith(normalized));

        if (suffix) {
            selectFile(suffix);
            return;
        }

        const directoryPrefix = `${normalized}/`;
        const firstInDirectory = [...files]
            .filter(file => file.path.startsWith(directoryPrefix))
            .sort((a, b) => a.path.localeCompare(b.path))[0];

        if (firstInDirectory) {
            selectFile(firstInDirectory);
        }
    }, [files, selectFile]);

    const resyncMutation = useResyncRepo();
    const syncJobStatus = useJobStatus(syncJobId, {
        enabled: Boolean(syncJobId),
        initialIntervalMs: INITIAL_JOB_POLL_INTERVAL_MS,
        fastPollCount: FAST_POLL_COUNT,
        baseIntervalMs: BASE_JOB_POLL_INTERVAL_MS,
        maxIntervalMs: MAX_JOB_POLL_INTERVAL_MS,
        maxErrors: MAX_JOB_POLL_ERRORS,
    });

    const syncing = resyncMutation.isPending || (Boolean(syncJobId) && !syncJobStatus.isTerminal);

    const handleResync = useCallback(async () => {
        if (!repository || syncing) return;

        setPendingCommitSha(currentCommit?.sha || null);

        try {
            const data = await resyncMutation.mutateAsync({
                owner: repository.owner,
                repo: repository.name,
            });

            if (data.jobId) {
                setSyncJobId(data.jobId);
                return;
            }

            await queryClient.invalidateQueries({ queryKey: queryKeys.repoCommitsRoot(id) });
            await commitsQuery.refetch();
        } catch (resyncError) {
            console.error('Failed to trigger resync:', resyncError);
        }
    }, [commitsQuery, currentCommit?.sha, id, queryClient, repository, resyncMutation, syncing]);

    useEffect(() => {
        if (!syncJobId) return;

        if (syncJobStatus.error && !syncJobStatus.data) {
            console.error('Sync polling failed:', syncJobStatus.error);
            setSyncJobId(null);
            return;
        }

        const data = syncJobStatus.data;
        if (!data) {
            return;
        }

        if (data.status === 'failed') {
            console.error('Sync failed:', data.error);
            setSyncJobId(null);
            return;
        }

        if (!syncJobStatus.isTerminal) {
            return;
        }

        void (async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.repoCommitsRoot(id) });
            await commitsQuery.refetch();
            setSyncJobId(null);
        })();
    }, [
        commitsQuery,
        id,
        queryClient,
        syncJobId,
        syncJobStatus.data,
        syncJobStatus.error,
        syncJobStatus.isTerminal,
    ]);

    const commitDiffQuery = useCommitDiff(id, currentCommit?.sha, {
        enabled: centerView === 'commit-diff' && Boolean(currentCommit?.sha),
    });
    const commitDiffFiles = commitDiffQuery.data?.files || [];
    const commitDiffLoading = centerView === 'commit-diff' && (commitDiffQuery.isPending || commitDiffQuery.isFetching);
    const commitDiffError = commitDiffQuery.error instanceof Error
        ? commitDiffQuery.error.message
        : null;

    useEffect(() => {
        if (commitDiffFiles.length === 0) {
            setSelectedCommitDiffPath('');
            return;
        }

        setSelectedCommitDiffPath(prev => {
            if (prev && commitDiffFiles.some(file => file.path === prev)) {
                return prev;
            }

            return commitDiffFiles[0]?.path || '';
        });
    }, [commitDiffFiles]);

    const selectedCommitDiffFile = useMemo(() => {
        if (commitDiffFiles.length === 0) return null;
        return commitDiffFiles.find(file => file.path === selectedCommitDiffPath) || commitDiffFiles[0];
    }, [commitDiffFiles, selectedCommitDiffPath]);

    useEffect(() => {
        if (commits.length === 0) return;

        const head = commits[currentIndex]?.sha || commits[commits.length - 1].sha;
        const base = commits[Math.max(0, currentIndex - 1)]?.sha || head;

        setCompareHeadSha(head);
        setCompareBaseSha(base);
    }, [commits, currentIndex]);

    const compareQuery = useCompareDiff(id, compareBaseSha, compareHeadSha, {
        enabled: centerView === 'file-diff' && Boolean(compareBaseSha) && Boolean(compareHeadSha),
    });

    const compareFiles = compareQuery.data?.files || [];
    const compareStatus = compareQuery.data?.status || 'unknown';
    const compareTotalFiles = compareQuery.data?.totalFiles || compareFiles.length || 0;
    const compareAheadBy = compareQuery.data?.aheadBy || 0;
    const compareBehindBy = compareQuery.data?.behindBy || 0;
    const compareLoading = centerView === 'file-diff' && (compareQuery.isPending || compareQuery.isFetching);
    const compareError = compareQuery.error instanceof Error
        ? compareQuery.error.message
        : null;

    useEffect(() => {
        if (compareFiles.length === 0) {
            setSelectedComparePath('');
            return;
        }

        setSelectedComparePath(prev => {
            if (prev && compareFiles.some(file => file.path === prev)) {
                return prev;
            }

            return compareFiles[0]?.path || '';
        });
    }, [compareFiles]);

    const selectedCompareFile = useMemo(() => {
        if (compareFiles.length === 0) return null;
        return compareFiles.find(file => file.path === selectedComparePath) || compareFiles[0];
    }, [compareFiles, selectedComparePath]);

    useEffect(() => {
        if (!currentCommitSha) {
            return;
        }

        const index = commits.findIndex(commit => commit.sha === currentCommitSha);
        if (index < 0) {
            return;
        }

        const neighborShas = [commits[index - 1]?.sha, commits[index + 1]?.sha]
            .filter((sha): sha is string => Boolean(sha));

        for (const sha of neighborShas) {
            void queryClient.prefetchQuery({
                queryKey: queryKeys.commitFiles(id, sha),
                queryFn: () => getCommitFiles(id, sha),
                staleTime: Infinity,
            });

            void queryClient.prefetchQuery({
                queryKey: queryKeys.commitDiff(id, sha),
                queryFn: () => getCommitDiff(id, sha),
                staleTime: Infinity,
            });
        }
    }, [commits, currentCommitSha, id, queryClient]);

    const goToCommit = useCallback((index: number) => {
        if (index < 0 || index >= commits.length) return;
        setCurrentIndex(index);
        setSelectedFilePath('');
        setHasUserSelectedFile(false);
    }, [commits.length]);

    const goNext = useCallback(() => {
        setCurrentIndex(prev => {
            if (commits.length === 0) return 0;
            const nextIndex = Math.min(prev + 1, commits.length - 1);
            if (nextIndex !== prev) {
                setSelectedFilePath('');
                setHasUserSelectedFile(false);
            }
            return nextIndex;
        });
    }, [commits.length]);

    const goPrev = useCallback(() => {
        setCurrentIndex(prev => {
            const nextIndex = Math.max(prev - 1, 0);
            if (nextIndex !== prev) {
                setSelectedFilePath('');
                setHasUserSelectedFile(false);
            }
            return nextIndex;
        });
    }, []);

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (showSettings || showHistoryModal) return;

            if (event.key === 'ArrowRight' && event.metaKey) {
                goNext();
            } else if (event.key === 'ArrowLeft' && event.metaKey) {
                goPrev();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [goNext, goPrev, showHistoryModal, showSettings]);
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
            <header className={`${styles.header} ${focusMode ? styles.headerCompact : ''}`}>
                <div className={styles.headerLeft}>
                    <Link href="/" className="btn btn-ghost">
                        <Home size={18} />
                    </Link>
                    <div className={styles.repoInfo}>
                        <BookOpen size={18} />
                        <span className={styles.repoName}>
                            {repository.owner}/{repository.name}
                        </span>
                    </div>
                </div>

                <div className={styles.headerCenter}>
                    <button className={styles.chapterTrigger} onClick={() => setShowHistoryModal(true)}>
                        <div className={styles.chapterInfo}>
                            <span className={styles.chapterLabel}>
                                Chapter {currentIndex + 1} of {commits.length}
                                {loadingMoreCommits ? ' (loading more...)' : ''}
                            </span>
                            <span className={styles.chapterTitle}>{currentCommit.message.split('\n')[0]}</span>
                        </div>
                        <ChevronDown size={16} className={styles.chapterChevron} />
                    </button>
                </div>

                <div className={styles.headerRight}>
                    <button
                        className={`btn btn-ghost ${syncing ? styles.active : ''}`}
                        onClick={handleResync}
                        disabled={syncing}
                        title="Resync Repository"
                    >
                        {syncing ? <Loader2 size={18} className={styles.spinner} /> : <RefreshCw size={18} />}
                    </button>

                    <button
                        className={`btn btn-ghost ${focusMode ? styles.active : ''}`}
                        onClick={() => setFocusMode(!focusMode)}
                        title="Focus Mode"
                    >
                        {focusMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                    </button>

                    {!focusMode && (
                        <button
                            className={`btn btn-ghost ${showAIPanel ? styles.active : ''}`}
                            onClick={() => setShowAIPanel(!showAIPanel)}
                        >
                            <MessageSquare size={18} />
                            AI
                        </button>
                    )}

                    <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>
                        <Settings size={18} />
                    </button>
                </div>
            </header>

            <div className={styles.main}>
                <PanelGroup direction="horizontal" className={styles.group}>
                    {!focusMode && (
                        <Panel defaultSize={20} minSize={15} maxSize={30} className={styles.panel} id="files">
                            <div className={styles.panelHeader}>
                                <h3 className={styles.panelTitle}>Files</h3>
                            </div>
                            <div className={styles.fileList}>
                                {loadingFiles ? (
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
                        </Panel>
                    )}

                    {!focusMode && <PanelResizeHandle className={styles.resizeHandle} />}

                    <Panel defaultSize={60} minSize={30} className={styles.panel} id="code">
                        <div className={styles.commitInfo}>
                            <div className={styles.commitMeta}>
                                <div className={styles.commitSha}>
                                    <GitCommit size={14} />
                                    <code>{currentCommit.sha.substring(0, 7)}</code>
                                </div>
                                <span className={styles.commitAuthor}>
                                    <User size={14} />
                                    {currentCommit.authorName || 'Unknown'}
                                </span>
                                <span className={styles.commitDate}>
                                    <Calendar size={14} />
                                    {new Date(currentCommit.date).toLocaleDateString()}
                                </span>
                            </div>
                        </div>

                        <div className={styles.viewTabs}>
                            <button
                                className={`${styles.viewTab} ${centerView === 'code' ? styles.viewTabActive : ''}`}
                                onClick={() => setCenterView('code')}
                            >
                                Code
                            </button>
                            <button
                                className={`${styles.viewTab} ${centerView === 'commit-diff' ? styles.viewTabActive : ''}`}
                                onClick={() => setCenterView('commit-diff')}
                            >
                                Commit Diff
                            </button>
                            <button
                                className={`${styles.viewTab} ${centerView === 'file-diff' ? styles.viewTabActive : ''}`}
                                onClick={() => setCenterView('file-diff')}
                            >
                                File Diff
                            </button>
                            <button
                                className={`${styles.viewTab} ${centerView === 'story' ? styles.viewTabActive : ''}`}
                                onClick={() => setCenterView('story')}
                            >
                                Story Mode
                            </button>
                        </div>

                        <div className={styles.codeArea}>
                            <div className={styles.codeDisplay}>
                                {centerView === 'code' && (
                                    hasUserSelectedFile && loadingContent ? (
                                        <div className={styles.loadingFiles}>
                                            <Loader2 size={24} className={styles.spinner} />
                                            <p>Loading content...</p>
                                        </div>
                                    ) : hasUserSelectedFile && selectedFile?.content ? (
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

                                {centerView === 'commit-diff' && (
                                    <div className={styles.diffContainer}>
                                        <div className={styles.diffToolbar}>
                                            <div className={styles.diffStats}>
                                                <span>{commitDiffFiles.length} changed file{commitDiffFiles.length === 1 ? '' : 's'}</span>
                                            </div>
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
                                        </div>

                                        {commitDiffLoading ? (
                                            <div className={styles.loadingFiles}>
                                                <Loader2 size={24} className={styles.spinner} />
                                                <p>Loading commit diff...</p>
                                            </div>
                                        ) : commitDiffError ? (
                                            <div className={styles.errorInline}>{commitDiffError}</div>
                                        ) : selectedCommitDiffFile ? (
                                            <>
                                                <div className={styles.diffMeta}>
                                                    <span>{selectedCommitDiffFile.status}</span>
                                                    <span>+{selectedCommitDiffFile.additions}</span>
                                                    <span>-{selectedCommitDiffFile.deletions}</span>
                                                </div>
                                                <DiffViewer
                                                    patch={selectedCommitDiffFile.patch}
                                                    mode={diffViewMode}
                                                />
                                            </>
                                        ) : (
                                            <div className={styles.noFile}>
                                                <h3>No diff available</h3>
                                                <p>This commit has no textual file changes.</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {centerView === 'file-diff' && (
                                    <div className={styles.diffContainer}>
                                        <div className={styles.diffToolbar}>
                                            <div className={styles.diffToolbarControlsWide}>
                                                <label>
                                                    Base
                                                    <select
                                                        value={compareBaseSha}
                                                        onChange={event => setCompareBaseSha(event.target.value)}
                                                    >
                                                        {commits.map((commit, index) => (
                                                            <option key={`base-${commit.sha}`} value={commit.sha}>
                                                                {index + 1}. {commit.sha.slice(0, 7)} - {commit.message.split('\n')[0]}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label>
                                                    Head
                                                    <select
                                                        value={compareHeadSha}
                                                        onChange={event => setCompareHeadSha(event.target.value)}
                                                    >
                                                        {commits.map((commit, index) => (
                                                            <option key={`head-${commit.sha}`} value={commit.sha}>
                                                                {index + 1}. {commit.sha.slice(0, 7)} - {commit.message.split('\n')[0]}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label>
                                                    File
                                                    <select
                                                        value={selectedComparePath}
                                                        onChange={event => setSelectedComparePath(event.target.value)}
                                                        disabled={compareFiles.length === 0}
                                                    >
                                                        {compareFiles.length === 0 && <option value="">No changed files</option>}
                                                        {compareFiles.map(file => (
                                                            <option key={file.path} value={file.path}>
                                                                {file.path}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
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
                                        </div>

                                        <div className={styles.compareSummary}>
                                            <span>Status: {compareStatus}</span>
                                            <span>Files changed: {compareTotalFiles}</span>
                                            <span>Ahead: {compareAheadBy}</span>
                                            <span>Behind: {compareBehindBy}</span>
                                        </div>

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
                                                <p>Select two different commits to compare file history.</p>
                                            </div>
                                        ) : selectedCompareFile ? (
                                            <>
                                                <div className={styles.diffMeta}>
                                                    <span>{selectedCompareFile.status}</span>
                                                    <span>+{selectedCompareFile.additions}</span>
                                                    <span>-{selectedCompareFile.deletions}</span>
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
                                                <p>Try a different commit pair to inspect file changes.</p>
                                            </div>
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

                        <div className={styles.navigation}>
                            <button
                                className="btn btn-secondary"
                                onClick={goPrev}
                                disabled={currentIndex === 0}
                            >
                                <ChevronLeft size={18} />
                                Previous
                            </button>
                            <span className={styles.navInfo}>
                                {currentIndex + 1} / {commits.length}
                            </span>
                            <button
                                className="btn btn-primary"
                                onClick={goNext}
                                disabled={currentIndex === commits.length - 1}
                            >
                                Next
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    </Panel>

                    {!focusMode && showAIPanel && <PanelResizeHandle className={styles.resizeHandle} />}
                    {!focusMode && showAIPanel && (
                        <Panel defaultSize={20} minSize={20} maxSize={40} className={styles.panel} id="ai">
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
