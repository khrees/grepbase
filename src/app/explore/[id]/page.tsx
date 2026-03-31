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
    MessageSquare,
    GitCommit,
    User,
    Calendar,
    Maximize2,
    Minimize2,
    ChevronDown,
    RefreshCw,
} from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import styles from './explore.module.css';
import SettingsModal from '@/components/SettingsModal';
import CodeViewer from '@/components/CodeViewer';
import AIPanel from '@/components/AIPanel';
import FileTree from '@/components/FileTree';
import CommitHistoryModal from '@/components/CommitHistoryModal';
import DiffViewer from '@/components/DiffViewer';
import StoryModePanel from '@/components/StoryModePanel';
import { useQueryClient } from '@tanstack/react-query';
import {
    useRepoCommitsInfinite,
    useCommitFiles,
    useFileContent,
    useCommitDiff,
    useCompareDiff,
    useJobStatus,
    useResyncRepo,
} from '@/lib/query/hooks';
import { queryKeys } from '@/lib/query/keys';
import Link from 'next/link';
import type { Repository, Commit, FileData } from '@/types';

type CenterView = 'code' | 'commit-diff' | 'file-diff' | 'story';

export default function ExplorePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const searchParams = useSearchParams();
    const ingestJobId = searchParams.get('jobId');
    const queryClient = useQueryClient();

    // ─── Immutable UI state ────────────────────────────────────────────────────
    const [currentIndex, setCurrentIndex] = useState(0);
    // selectedFilePath is the user's explicit choice; null means "auto-select"
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [showAIPanel, setShowAIPanel] = useState(true);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [focusMode, setFocusMode] = useState(false);
    const [centerView, setCenterView] = useState<CenterView>('code');
    const [diffViewMode, setDiffViewMode] = useState<'unified' | 'split'>('unified');
    // User-override state for diff selectors (null = auto-derive)
    const [commitDiffPathOverride, setCommitDiffPathOverride] = useState<string | null>(null);
    const [comparePathOverride, setComparePathOverride] = useState<string | null>(null);
    const [compareBaseOverride, setCompareBaseOverride] = useState<string | null>(null);
    const [compareHeadOverride, setCompareHeadOverride] = useState<string | null>(null);
    const [resyncJobId, setResyncJobId] = useState<string | null>(null);

    const currentIndexRef = useRef(currentIndex);
    const commitSelectionKey = useMemo(() => `grepbase:last_commit:${id}`, [id]);

    // ─── Data queries ─────────────────────────────────────────────────────────
    const commitsQuery = useRepoCommitsInfinite(id);

    const commits = useMemo(
        () => commitsQuery.data?.pages.flatMap((p) => p.commits) ?? [],
        [commitsQuery.data]
    );
    const repository: Repository | undefined = commitsQuery.data?.pages[0]?.repository;

    // Auto-fetch remaining commit pages in the background
    useEffect(() => {
        if (commitsQuery.hasNextPage && !commitsQuery.isFetchingNextPage) {
            void commitsQuery.fetchNextPage();
        }
    }, [commitsQuery]);

    // Restore last selected commit on first load (URL param → sessionStorage → 0)
    const initialised = useRef(false);
    useEffect(() => {
        if (commits.length === 0 || initialised.current) return;
        initialised.current = true;
        const urlSha = searchParams.get('sha');
        const storedSha =
            (typeof window !== 'undefined' && sessionStorage.getItem(commitSelectionKey)) ||
            (typeof window !== 'undefined' && localStorage.getItem(commitSelectionKey));
        const targetSha = urlSha || storedSha || null;
        if (targetSha) {
            const idx = commits.findIndex((c) => c.sha === targetSha);
            if (idx >= 0) setCurrentIndex(idx);
        }
    }, [commits, commitSelectionKey, searchParams]);

    const currentCommit: Commit | undefined = commits[currentIndex];
    const currentCommitSha = currentCommit?.sha;

    // Keep ref in sync for callbacks
    useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

    // Persist selected commit to URL + storage
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

    // ─── Job polling (ingest from home page) ─────────────────────────────────
    // Fire the job poller any time we have a jobId and no commits yet — even if
    // the commits query errored (e.g. 403 before access is written to KV).
    const waitingForInitialCommits =
        !commitsQuery.isLoading && commits.length === 0 && !!ingestJobId;

    const jobQuery = useJobStatus(ingestJobId, { enabled: waitingForInitialCommits });
    const jobData = jobQuery.data;

    const prevJobReadyRef = useRef(false);
    useEffect(() => {
        if (!jobData) return;
        const isReady =
            jobData.status === 'completed' ||
            jobData.ready ||
            Number(jobData.processedCommits ?? 0) > 0;
        if (isReady && !prevJobReadyRef.current) {
            prevJobReadyRef.current = true;
            void queryClient.invalidateQueries({ queryKey: queryKeys.repos.commits(id) });
        }
    }, [jobData, id, queryClient]);

    // ─── Files for current commit ─────────────────────────────────────────────
    const filesQuery = useCommitFiles(id, currentCommitSha);
    const files = useMemo(() => filesQuery.data?.files ?? [], [filesQuery.data]);

    // Track the last sha for which we auto-selected a file so we only reset once per sha change
    const lastAutoShaRef = useRef<string | undefined>(undefined);

    // Effective file path: user's choice, or auto-pick first loadable file when sha changes
    const effectiveFilePath = useMemo(() => {
        if (currentCommitSha !== lastAutoShaRef.current) {
            // SHA changed — auto-pick first file (don't persist old selection)
            lastAutoShaRef.current = currentCommitSha;
            const first = files.find((f) => f.shouldFetchContent || f.hasContent);
            return first?.path ?? null;
        }
        // Same SHA — honour user's explicit selection; fall back to auto-pick if null
        if (selectedFilePath) return selectedFilePath;
        const first = files.find((f) => f.shouldFetchContent || f.hasContent);
        return first?.path ?? null;
        // We intentionally omit selectedFilePath from deps so the auto-pick logic only fires on SHA change
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentCommitSha, files]);

    // ─── File content ─────────────────────────────────────────────────────────
    const fileContentQuery = useFileContent(
        id,
        currentCommitSha,
        effectiveFilePath ?? undefined,
        !!effectiveFilePath
    );

    // Build selectedFile as pure derived data — no setState in an effect
    const selectedFile = useMemo<FileData | null>(() => {
        if (!effectiveFilePath) return null;
        const meta = files.find((f) => f.path === effectiveFilePath);
        if (!meta) return null;
        if (fileContentQuery.data?.content) {
            return { ...meta, content: fileContentQuery.data.content, hasContent: true };
        }
        return { ...meta };
    }, [effectiveFilePath, files, fileContentQuery.data]);

    // ─── Commit diff ──────────────────────────────────────────────────────────
    const commitDiffQuery = useCommitDiff(id, currentCommitSha, centerView === 'commit-diff');
    const commitDiffFiles = useMemo(
        () => commitDiffQuery.data?.files ?? [],
        [commitDiffQuery.data]
    );

    // Derive selected diff path (user override wins if still valid)
    const selectedCommitDiffPath = useMemo(() => {
        if (commitDiffPathOverride && commitDiffFiles.some((f) => f.path === commitDiffPathOverride)) {
            return commitDiffPathOverride;
        }
        return commitDiffFiles[0]?.path || '';
    }, [commitDiffFiles, commitDiffPathOverride]);

    // ─── Compare diff ─────────────────────────────────────────────────────────
    const compareHeadSha = useMemo(() => {
        if (compareHeadOverride && commits.some((c) => c.sha === compareHeadOverride)) {
            return compareHeadOverride;
        }
        return commits[currentIndex]?.sha || commits[commits.length - 1]?.sha || '';
    }, [compareHeadOverride, commits, currentIndex]);

    const compareBaseSha = useMemo(() => {
        if (compareBaseOverride && commits.some((c) => c.sha === compareBaseOverride)) {
            return compareBaseOverride;
        }
        return commits[Math.max(0, currentIndex - 1)]?.sha || compareHeadSha;
    }, [compareBaseOverride, commits, currentIndex, compareHeadSha]);

    const compareDiffQuery = useCompareDiff(id, compareBaseSha, compareHeadSha, centerView === 'file-diff');
    const compareFiles = useMemo(
        () => compareDiffQuery.data?.files ?? [],
        [compareDiffQuery.data]
    );

    const selectedComparePath = useMemo(() => {
        if (comparePathOverride && compareFiles.some((f) => f.path === comparePathOverride)) {
            return comparePathOverride;
        }
        return compareFiles[0]?.path || '';
    }, [compareFiles, comparePathOverride]);

    // ─── Resync ───────────────────────────────────────────────────────────────
    const resyncMutation = useResyncRepo();
    const resyncJobQuery = useJobStatus(resyncJobId, { enabled: !!resyncJobId });

    useEffect(() => {
        if (!resyncJobQuery.data) return;
        const d = resyncJobQuery.data;
        const done =
            d.status === 'completed' ||
            d.status === 'failed' ||
            d.ready ||
            Number(d.processedCommits ?? 0) > 0;
        if (done) {
            setResyncJobId(null);
            void queryClient.invalidateQueries({ queryKey: queryKeys.repos.commits(id) });
        }
    }, [resyncJobQuery.data, id, queryClient]);

    const handleResync = useCallback(async () => {
        if (!repository || resyncMutation.isPending || !!resyncJobId) return;
        const result = await resyncMutation.mutateAsync({
            repoId: id,
            owner: repository.owner,
            name: repository.name,
        });
        if (result.jobId) {
            setResyncJobId(result.jobId);
        } else {
            void queryClient.invalidateQueries({ queryKey: queryKeys.repos.commits(id) });
        }
    }, [repository, resyncMutation, resyncJobId, id, queryClient]);

    const syncing = resyncMutation.isPending || !!resyncJobId;

    // ─── Navigation helpers ───────────────────────────────────────────────────
    const selectFile = useCallback((file: FileData) => {
        setSelectedFilePath(file.path);
    }, []);

    const goToCommit = useCallback((index: number) => {
        if (index < 0 || index >= commits.length) return;
        setCurrentIndex(index);
        setSelectedFilePath(null);
    }, [commits.length]);

    const goNext = useCallback(() => {
        setCurrentIndex((prev) => {
            const next = Math.min(prev + 1, commits.length - 1);
            if (next !== prev) setSelectedFilePath(null);
            return next;
        });
    }, [commits.length]);

    const goPrev = useCallback(() => {
        setCurrentIndex((prev) => {
            const next = Math.max(prev - 1, 0);
            if (next !== prev) setSelectedFilePath(null);
            return next;
        });
    }, []);

    // Keyboard navigation
    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (showSettings || showHistoryModal) return;
            if (event.key === 'ArrowRight' && event.metaKey) goNext();
            else if (event.key === 'ArrowLeft' && event.metaKey) goPrev();
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [goNext, goPrev, showHistoryModal, showSettings]);

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
            files.find((f) => f.path === normalized) ||
            files.find((f) => f.path.toLowerCase() === normalized.toLowerCase());
        if (exact) { selectFile(exact); return; }

        const suffix =
            files.find((f) => f.path.endsWith(`/${normalized}`)) ||
            files.find((f) => f.path.endsWith(normalized));
        if (suffix) { selectFile(suffix); return; }

        const directoryPrefix = `${normalized}/`;
        const firstInDirectory = [...files]
            .filter((f) => f.path.startsWith(directoryPrefix))
            .sort((a, b) => a.path.localeCompare(b.path))[0];
        if (firstInDirectory) selectFile(firstInDirectory);
    }, [files, selectFile]);

    // ─── Derived memos ────────────────────────────────────────────────────────
    const visibleFilePaths = useMemo(
        () => files.filter((f) => f.shouldFetchContent || f.hasContent).map((f) => f.path),
        [files]
    );

    const selectedCommitDiffFile = useMemo(
        () => commitDiffFiles.find((f) => f.path === selectedCommitDiffPath) || commitDiffFiles[0] || null,
        [commitDiffFiles, selectedCommitDiffPath]
    );

    const selectedCompareFile = useMemo(
        () => compareFiles.find((f) => f.path === selectedComparePath) || compareFiles[0] || null,
        [compareFiles, selectedComparePath]
    );

    const loadingMoreCommits = commitsQuery.isFetchingNextPage;

    // ─── Render states ────────────────────────────────────────────────────────
    if (commitsQuery.isLoading) {
        return (
            <div className={styles.loadingState}>
                <Loader2 size={32} className={styles.spinner} />
                <p>Loading repository...</p>
            </div>
        );
    }

    // Show error only if we're NOT actively waiting for ingest to complete
    if (commitsQuery.isError && !waitingForInitialCommits) {
        return (
            <div className={styles.errorState}>
                <p>{(commitsQuery.error as Error)?.message || 'Something went wrong'}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn btn-secondary" onClick={() => commitsQuery.refetch()}>
                        Retry
                    </button>
                    <button className="btn btn-primary" onClick={() => router.push('/')}>
                        Go Home
                    </button>
                </div>
            </div>
        );
    }

    if (!repository || commits.length === 0) {
        if (waitingForInitialCommits) {
            return (
                <div className={styles.loadingState}>
                    <Loader2 size={32} className={styles.spinner} />
                    <p>
                        {jobData?.status === 'processing'
                            ? `Indexing commits... ${jobData.progress ?? 0}%`
                            : 'Preparing repository...'}
                    </p>
                </div>
            );
        }
        return (
            <div className={styles.errorState}>
                <p>No commits found for this repository.</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn btn-secondary" onClick={() => commitsQuery.refetch()}>
                        Retry
                    </button>
                    <button className="btn btn-primary" onClick={() => router.push('/')}>
                        Go Home
                    </button>
                </div>
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
                            <span className={styles.chapterTitle}>{currentCommit?.message.split('\n')[0]}</span>
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
                                {filesQuery.isLoading ? (
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
                                    <code>{currentCommit?.sha.substring(0, 7)}</code>
                                </div>
                                <span className={styles.commitAuthor}>
                                    <User size={14} />
                                    {currentCommit?.authorName || 'Unknown'}
                                </span>
                                <span className={styles.commitDate}>
                                    <Calendar size={14} />
                                    {currentCommit ? new Date(currentCommit.date).toLocaleDateString() : ''}
                                </span>
                            </div>
                        </div>

                        <div className={styles.viewTabs}>
                            {(['code', 'commit-diff', 'file-diff', 'story'] as CenterView[]).map((view) => (
                                <button
                                    key={view}
                                    className={`${styles.viewTab} ${centerView === view ? styles.viewTabActive : ''}`}
                                    onClick={() => setCenterView(view)}
                                >
                                    {view === 'code' ? 'Code'
                                        : view === 'commit-diff' ? 'Commit Diff'
                                            : view === 'file-diff' ? 'File Diff'
                                                : 'Story Mode'}
                                </button>
                            ))}
                        </div>

                        <div className={styles.codeArea}>
                            <div className={styles.codeDisplay}>
                                {centerView === 'code' && (
                                    fileContentQuery.isFetching ? (
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

                                {centerView === 'commit-diff' && (
                                    <div className={styles.diffContainer}>
                                        <div className={styles.diffToolbar}>
                                            <div className={styles.diffStats}>
                                                <span>
                                                    {commitDiffFiles.length} changed file
                                                    {commitDiffFiles.length === 1 ? '' : 's'}
                                                </span>
                                            </div>
                                            <div className={styles.diffToolbarControls}>
                                                <select
                                                    value={selectedCommitDiffPath}
                                                    onChange={(e) => setCommitDiffPathOverride(e.target.value)}
                                                    disabled={commitDiffFiles.length === 0}
                                                >
                                                    {commitDiffFiles.length === 0 && (
                                                        <option value="">No changed files</option>
                                                    )}
                                                    {commitDiffFiles.map((file) => (
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

                                        {commitDiffQuery.isFetching ? (
                                            <div className={styles.loadingFiles}>
                                                <Loader2 size={24} className={styles.spinner} />
                                                <p>Loading commit diff...</p>
                                            </div>
                                        ) : commitDiffQuery.isError ? (
                                            <div className={styles.errorInline}>
                                                {(commitDiffQuery.error as Error)?.message || 'Failed to load commit diff'}
                                            </div>
                                        ) : selectedCommitDiffFile ? (
                                            <>
                                                <div className={styles.diffMeta}>
                                                    <span>{selectedCommitDiffFile.status}</span>
                                                    <span>+{selectedCommitDiffFile.additions}</span>
                                                    <span>-{selectedCommitDiffFile.deletions}</span>
                                                </div>
                                                <DiffViewer patch={selectedCommitDiffFile.patch} mode={diffViewMode} />
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
                                                        onChange={(e) => setCompareBaseOverride(e.target.value)}
                                                    >
                                                        {commits.map((commit, index) => (
                                                            <option key={`base-${commit.sha}`} value={commit.sha}>
                                                                {index + 1}. {commit.sha.slice(0, 7)} – {commit.message.split('\n')[0]}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label>
                                                    Head
                                                    <select
                                                        value={compareHeadSha}
                                                        onChange={(e) => setCompareHeadOverride(e.target.value)}
                                                    >
                                                        {commits.map((commit, index) => (
                                                            <option key={`head-${commit.sha}`} value={commit.sha}>
                                                                {index + 1}. {commit.sha.slice(0, 7)} – {commit.message.split('\n')[0]}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label>
                                                    File
                                                    <select
                                                        value={selectedComparePath}
                                                        onChange={(e) => setComparePathOverride(e.target.value)}
                                                        disabled={compareFiles.length === 0}
                                                    >
                                                        {compareFiles.length === 0 && (
                                                            <option value="">No changed files</option>
                                                        )}
                                                        {compareFiles.map((file) => (
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
                                            <span>Status: {compareDiffQuery.data?.status || 'unknown'}</span>
                                            <span>Files changed: {compareDiffQuery.data?.totalFiles ?? compareFiles.length}</span>
                                            <span>Ahead: {compareDiffQuery.data?.aheadBy ?? 0}</span>
                                            <span>Behind: {compareDiffQuery.data?.behindBy ?? 0}</span>
                                        </div>

                                        {compareDiffQuery.isFetching ? (
                                            <div className={styles.loadingFiles}>
                                                <Loader2 size={24} className={styles.spinner} />
                                                <p>Comparing commits...</p>
                                            </div>
                                        ) : compareDiffQuery.isError ? (
                                            <div className={styles.errorInline}>
                                                {(compareDiffQuery.error as Error)?.message || 'Failed to compare commits'}
                                            </div>
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
