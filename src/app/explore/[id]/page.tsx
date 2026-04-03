'use client';

import { useState, use, useMemo, useCallback, useRef, useEffect } from 'react';
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
    GitBranch,
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
import { useCommits } from '@/hooks/use-commits';
import { useIngestJob } from '@/hooks/use-ingest-job';
import { useBranches } from '@/hooks/use-branches';
import { useCommitFiles } from '@/hooks/use-commit-files';
import { useFileContent } from '@/hooks/use-file-content';
import { useCommitDiff } from '@/hooks/use-commit-diff';
import { useCompareDiff } from '@/hooks/use-compare-diff';
import { useExploreStore } from '@/stores/explore-store';
import { fireToast } from '@/stores/toast-store';
import { getAISettings } from '@/stores/settings-store';
import Link from 'next/link';
import type { FileData } from '@/types';

// ──────────────────────────────────────────────────────────
// Tiny hooks to absorb DOM side-effects
// ──────────────────────────────────────────────────────────

/** Dismiss a ref-bound element when clicking outside */
function useClickOutside(
    ref: React.RefObject<HTMLElement | null>,
    active: boolean,
    onClose: () => void,
) {
    useEffect(() => {
        if (!active) return;
        function handler(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [active, onClose, ref]);
}

/** Global keyboard shortcuts */
function useKeyboardNav(
    commitsLength: number,
    goNext: (n: number) => void,
    goPrev: () => void,
    setCenterView: (v: 'code' | 'diff' | 'story') => void,
    blocked: boolean,
) {
    useEffect(() => {
        function handler(e: KeyboardEvent) {
            if (blocked) return;
            const tag = (e.target as HTMLElement).tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
                || (e.target as HTMLElement).isContentEditable) return;
            if (e.key === 'ArrowRight') goNext(commitsLength);
            else if (e.key === 'ArrowLeft') goPrev();
            else if (e.key === 'c') setCenterView('code');
            else if (e.key === 'd') setCenterView('diff');
            else if (e.key === 's') setCenterView('story');
        }
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [blocked, commitsLength, goNext, goPrev, setCenterView]);
}

/** Persist & restore commit selection to URL + storage */
function useCommitPersistence(
    commits: { sha: string }[],
    repoId: string,
    setCurrentIndex: (i: number) => void,
) {
    const commitSelectionKey = useMemo(() => `grepbase:last_commit:${repoId}`, [repoId]);
    const restoredRef = useRef(false);

    // Restore once when commits first arrive
    useEffect(() => {
        if (restoredRef.current || commits.length === 0 || typeof window === 'undefined') return;
        restoredRef.current = true;

        const urlSha = new URLSearchParams(window.location.search).get('sha');
        const storedSha =
            sessionStorage.getItem(commitSelectionKey) ||
            localStorage.getItem(commitSelectionKey);
        const targetSha = urlSha || storedSha;
        if (!targetSha) return;

        const idx = commits.findIndex(c => c.sha === targetSha);
        if (idx > 0) setCurrentIndex(idx);
    }, [commits, commitSelectionKey, setCurrentIndex]);

    // Persist current commit — called imperatively, not via effect
    const persist = useCallback((sha: string) => {
        if (typeof window === 'undefined') return;
        sessionStorage.setItem(commitSelectionKey, sha);
        localStorage.setItem(commitSelectionKey, sha);
        const url = new URL(window.location.href);
        if (url.searchParams.get('sha') !== sha) {
            url.searchParams.set('sha', sha);
            window.history.replaceState({}, '', url.toString());
        }
    }, [commitSelectionKey]);

    return { persist };
}

/** Auto-select a file when the file list changes */
function useAutoSelectFile(
    files: FileData[],
    setSelectedFile: (f: FileData | null) => void,
) {
    const lastSelectedPathRef = useRef<string | null>(null);

    const selectFile = useCallback((file: FileData) => {
        lastSelectedPathRef.current = file.path;
        setSelectedFile(file);
    }, [setSelectedFile]);

    // Auto-select best file when file list changes
    useEffect(() => {
        if (files.length === 0) return;
        const lastPath = lastSelectedPathRef.current;
        const preferred = lastPath ? files.find(f => f.path === lastPath) : null;
        const target = preferred ?? files.find(f => f.shouldFetchContent || f.hasContent) ?? null;
        if (target) {
            lastSelectedPathRef.current = target.path;
            setSelectedFile(target);
        } else {
            setSelectedFile(null);
        }
    }, [files, setSelectedFile]);

    return { selectFile };
}



export default function ExplorePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const searchParams = useSearchParams();
    const ingestJobId = searchParams.get('jobId');

    // Zustand store for UI state
    const {
        currentIndex, setCurrentIndex,
        selectedFile, setSelectedFile,
        centerView, setCenterView,
        sidebarTab, setSidebarTab,
        commitOrder, setCommitOrder,
        diffScope, setDiffScope,
        diffViewMode, setDiffViewMode,
        focusMode, toggleFocusMode,
        aiPanelExpanded, toggleAiPanel,
        showSettings, setShowSettings,
        showHistoryModal, setShowHistoryModal,
        showBranchMenu, setShowBranchMenu,
        goToCommit, goNext, goPrev,
    } = useExploreStore();

    // Local state (not shareable)
    const [switchingBranch, setSwitchingBranch] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const branchMenuRef = useRef<HTMLDivElement>(null);

    // ── React Query: Commits ─────────────────────────────────
    const commitsQuery = useCommits(id);
    const repository = commitsQuery.data?.repository ?? null;
    const commits = useMemo(() => commitsQuery.data?.commits ?? [], [commitsQuery.data?.commits]);

    // Auto-fetch remaining pages (absorbed from useEffect)
    if (commitsQuery.hasNextPage && !commitsQuery.isFetchingNextPage) {
        // Schedule on next microtask to avoid rendering-phase side effects
        Promise.resolve().then(() => commitsQuery.fetchNextPage());
    }

    // ── Ingest job polling ────────────────────────────────────
    const waitingForCommits = !!ingestJobId && commits.length === 0 && !commitsQuery.isLoading;
    const ingestJob = useIngestJob(ingestJobId, { enabled: waitingForCommits });

    // When ingest progresses, refetch commits (derived from query data, no effect needed)
    const ingestJobData = ingestJob.data;
    const ingestTriggeredRefetch = useRef(false);
    if (ingestJobData && !ingestTriggeredRefetch.current) {
        const hasProcessed = Number(ingestJobData.processedCommits || 0) > 0;
        const shouldRefetch = (ingestJobData.repository || ingestJobData.repoId) &&
            (ingestJobData.ready || hasProcessed || ingestJobData.status === 'completed');
        if (shouldRefetch) {
            ingestTriggeredRefetch.current = true;
            Promise.resolve().then(() => commitsQuery.refetch());
        }
    }
    // Reset trigger when job data changes
    if (!ingestJobData) ingestTriggeredRefetch.current = false;

    // ── Derived state ────────────────────────────────────────
    const currentCommit = commits[currentIndex];
    const currentCommitSha = currentCommit?.sha;

    const activeBranch = useMemo(() => {
        if (!repository) return null;
        const url = repository.url ?? '';
        const atIdx = url.lastIndexOf('@');
        if (atIdx !== -1) return url.slice(atIdx + 1);
        return repository.defaultBranch || 'main';
    }, [repository]);

    const baseRepoUrl = useMemo(() => {
        if (!repository) return '';
        const url = repository.url ?? '';
        const atIdx = url.lastIndexOf('@');
        return atIdx !== -1 ? url.slice(0, atIdx) : url;
    }, [repository]);

    const orderedCommits = useMemo(
        () => commitOrder === 'asc' ? commits : [...commits].reverse(),
        [commits, commitOrder]
    );

    // Compare SHAs — derived with useMemo, not synced via useEffect
    const defaultCompareBaseSha = useMemo(() => {
        if (commits.length === 0) return '';
        return commits[Math.max(0, currentIndex - 1)]?.sha || commits[0].sha;
    }, [commits, currentIndex]);

    const defaultCompareHeadSha = useMemo(() => {
        if (commits.length === 0) return '';
        return commits[currentIndex]?.sha || commits[commits.length - 1].sha;
    }, [commits, currentIndex]);

    // User can override; reset when currentIndex changes
    const [compareBaseShaOverride, setCompareBaseSha] = useState('');
    const [compareHeadShaOverride, setCompareHeadSha] = useState('');
    const compareBaseSha = compareBaseShaOverride || defaultCompareBaseSha;
    const compareHeadSha = compareHeadShaOverride || defaultCompareHeadSha;

    // Reset overrides when navigating commits
    const prevIndexRef = useRef(currentIndex);
    if (prevIndexRef.current !== currentIndex) {
        prevIndexRef.current = currentIndex;
        if (compareBaseShaOverride) setCompareBaseSha('');
        if (compareHeadShaOverride) setCompareHeadSha('');
    }

    // ── React Query: Branches ────────────────────────────────
    const branchesQuery = useBranches(baseRepoUrl || undefined, {
        enabled: showBranchMenu && !!baseRepoUrl,
    });
    const branchList = branchesQuery.data?.branches ?? null;

    // ── React Query: Files ───────────────────────────────────
    const filesQuery = useCommitFiles(id, currentCommitSha);
    const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);

    const visibleFilePaths = useMemo(
        () => files
            .filter(file => file.shouldFetchContent || file.hasContent)
            .map(file => file.path),
        [files]
    );

    const filePathMap = useMemo(() => {
        const map = new Map<string, FileData>();
        for (const file of files) {
            map.set(file.path, file);
            map.set(file.path.toLowerCase(), file);
        }
        return map;
    }, [files]);

    // ── Auto-select file (custom hook — 1 effect inside) ─────
    const { selectFile } = useAutoSelectFile(files, setSelectedFile);

    // ── React Query: File content ────────────────────────────
    const selectedFilePath = selectedFile?.path;
    const needsContent = !!selectedFile && !selectedFile.content;
    const fileContentQuery = useFileContent(
        id,
        currentCommitSha,
        needsContent ? selectedFilePath : undefined
    );

    // Derive file with content — no effect needed
    const resolvedSelectedFile = useMemo(() => {
        if (!selectedFile) return null;
        if (selectedFile.content) return selectedFile;
        if (fileContentQuery.data && needsContent) {
            return { ...selectedFile, content: fileContentQuery.data, hasContent: true };
        }
        return selectedFile;
    }, [selectedFile, fileContentQuery.data, needsContent]);

    // ── React Query: Commit diff ─────────────────────────────
    const commitDiffQuery = useCommitDiff(
        id,
        currentCommitSha,
        selectedFilePath,
        { enabled: centerView === 'diff' && diffScope === 'commit' && !!selectedFile }
    );

    // ── React Query: Compare diff ────────────────────────────
    const compareDiffQuery = useCompareDiff(
        id,
        compareBaseSha || undefined,
        compareHeadSha || undefined,
        selectedFilePath,
        { enabled: centerView === 'diff' && diffScope === 'compare' && !!selectedFile }
    );

    // ── Commit persistence (custom hook — 1 init effect) ─────
    const { persist: persistCommit } = useCommitPersistence(commits, id, setCurrentIndex);

    // Persist whenever currentCommit changes — imperative, not effect
    const lastPersistedSha = useRef<string | null>(null);
    if (currentCommitSha && currentCommitSha !== lastPersistedSha.current) {
        lastPersistedSha.current = currentCommitSha;
        persistCommit(currentCommitSha);
    }

    // ── AI settings hint (one-time, run in render) ───────────
    const hintShownRef = useRef(false);
    if (!hintShownRef.current && !commitsQuery.isLoading && typeof window !== 'undefined') {
        hintShownRef.current = true;
        const hintKey = 'grepbase:ai_hint_shown';
        if (!sessionStorage.getItem(hintKey) && !getAISettings()) {
            sessionStorage.setItem(hintKey, '1');
            // Schedule after render to avoid setState-in-render
            Promise.resolve().then(() =>
                fireToast('Set up an AI provider in Settings to unlock explanations', 'info', 6000)
            );
        }
    }

    // ── DOM hooks (2 legitimate effects) ─────────────────────
    useClickOutside(branchMenuRef, showBranchMenu, useCallback(() => setShowBranchMenu(false), [setShowBranchMenu]));
    useKeyboardNav(commits.length, goNext, goPrev, setCenterView, showSettings || showHistoryModal);

    // ── File opening from AI references ──────────────────────
    const openFileFromAIReference = useCallback(async (path: string) => {
        const normalized = path
            .trim()
            .replace(/^\/+/, '')
            .replace(/^a\//, '')
            .replace(/^b\//, '')
            .replace(/^\.\/+/, '')
            .replace(/\/+$/, '');

        if (!normalized) return;

        const exact = filePathMap.get(normalized) ?? filePathMap.get(normalized.toLowerCase());
        if (exact) { selectFile(exact); return; }

        const suffix =
            files.find(file => file.path.endsWith(`/${normalized}`)) ||
            files.find(file => file.path.endsWith(normalized));
        if (suffix) { selectFile(suffix); return; }

        const directoryPrefix = `${normalized}/`;
        const firstInDirectory = [...files]
            .filter(file => file.path.startsWith(directoryPrefix))
            .sort((a, b) => a.path.localeCompare(b.path))[0];
        if (firstInDirectory) { selectFile(firstInDirectory); }
    }, [filePathMap, files, selectFile]);

    // ── Branch switching ─────────────────────────────────────
    const switchBranch = useCallback(async (branch: string) => {
        if (!baseRepoUrl || branch === activeBranch || switchingBranch) return;
        setShowBranchMenu(false);
        setSwitchingBranch(true);

        try {
            const isDefault = branch === (repository?.defaultBranch || 'main');
            const body = isDefault ? { url: baseRepoUrl } : { url: baseRepoUrl, branch };

            const data = await api.post<{
                jobId?: string;
                repository?: { id: string };
                cached?: boolean;
            }>('/api/repos', body);

            const targetId = data.repository?.id;
            if (targetId) {
                router.push(data.jobId
                    ? `/explore/${targetId}?jobId=${data.jobId}`
                    : `/explore/${targetId}`
                );
            } else if (data.jobId) {
                let attempts = 0;
                const poll = async (): Promise<void> => {
                    attempts++;
                    const job = await api.get<{ status: string; repoId?: string; repository?: { id: string } }>(
                        `/api/jobs/${data.jobId}`
                    );
                    const resolvedId = job.repository?.id ?? job.repoId;
                    if (resolvedId) {
                        router.push(`/explore/${resolvedId}?jobId=${data.jobId}`);
                    } else if (job.status === 'failed') {
                        fireToast('Failed to load branch', 'error');
                        setSwitchingBranch(false);
                    } else if (attempts < 30) {
                        await new Promise(r => setTimeout(r, 2000));
                        return poll();
                    } else {
                        fireToast('Branch load timed out', 'error');
                        setSwitchingBranch(false);
                    }
                };
                await poll();
            }
        } catch (err) {
            fireToast(err instanceof Error ? err.message : 'Failed to switch branch', 'error');
            setSwitchingBranch(false);
        }
    }, [activeBranch, baseRepoUrl, repository?.defaultBranch, router, setShowBranchMenu, switchingBranch]);

    // ── Resync ───────────────────────────────────────────────
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
                            status: string; error?: string; ready?: boolean; processedCommits?: number;
                        }>(`/api/jobs/${data.jobId}`);

                        const hasProcessedCommits = Number(jobResponse.processedCommits || 0) > 0;
                        if (jobResponse.status === 'completed' || jobResponse.ready || hasProcessedCommits) {
                            await commitsQuery.refetch();
                            setSyncing(false);
                            fireToast('Repository synced', 'success');
                        } else if (jobResponse.status === 'failed') {
                            fireToast(jobResponse.error || 'Resync failed', 'error');
                            setSyncing(false);
                        } else if (attempts < maxAttempts) {
                            setTimeout(poll, 2000);
                        } else {
                            fireToast('Resync timed out. Try again.', 'error');
                            setSyncing(false);
                        }
                    } catch (pollError) {
                        console.error('Polling error:', pollError);
                        fireToast('Resync failed. Check your connection.', 'error');
                        setSyncing(false);
                    }
                };
                void poll();
            } else {
                await commitsQuery.refetch();
                setSyncing(false);
            }
        } catch (err) {
            fireToast(err instanceof Error ? err.message : 'Failed to resync repository', 'error');
            setSyncing(false);
        }
    }, [commitsQuery, repository, syncing]);

    // ──────────────────────────────────────────────────────────
    // Render
    // ──────────────────────────────────────────────────────────
    if (commitsQuery.isLoading) {
        return (
            <div className={styles.loadingState}>
                <Loader2 size={32} className={styles.spinner} />
                <p>Loading repository...</p>
            </div>
        );
    }

    if (commitsQuery.error) {
        return (
            <div className={styles.errorState}>
                <p>{commitsQuery.error instanceof Error ? commitsQuery.error.message : 'Something went wrong'}</p>
                <button className="btn btn-primary" onClick={() => router.push('/')}>
                    Go Home
                </button>
            </div>
        );
    }

    if (!repository || commits.length === 0) {
        if (waitingForCommits) {
            const ingestProgress = ingestJob.data?.progress ? Number(ingestJob.data.progress) : 0;
            const ingestStatus = ingestJob.data?.status;
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

    // Diff data from queries
    const commitDiffFile = commitDiffQuery.data ?? null;
    const commitDiffLoading = commitDiffQuery.isLoading;
    const commitDiffError = commitDiffQuery.error
        ? (commitDiffQuery.error instanceof Error ? commitDiffQuery.error.message : 'Failed to load commit diff')
        : null;

    const compareFile = compareDiffQuery.data ?? null;
    const compareLoading = compareDiffQuery.isLoading;
    const compareError = compareDiffQuery.error
        ? (compareDiffQuery.error instanceof Error ? compareDiffQuery.error.message : 'Failed to compare commits')
        : null;

    const loadingFiles = filesQuery.isLoading;
    const loadingContent = fileContentQuery.isLoading;

    return (
        <div className={styles.container}>
            {commitsQuery.isFetchingNextPage && <div className={styles.fetchingBar} aria-hidden="true" />}
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
                        <div className={styles.branchSwitcher} ref={branchMenuRef}>
                            <button
                                className={`${styles.branchBadge} ${showBranchMenu ? styles.branchBadgeOpen : ''}`}
                                onClick={() => setShowBranchMenu(!showBranchMenu)}
                                disabled={switchingBranch}
                                title="Switch branch"
                            >
                                {switchingBranch
                                    ? <Loader2 size={10} className={styles.branchSpinner} />
                                    : <GitBranch size={10} />
                                }
                                <span>{activeBranch}</span>
                                <ChevronDown size={9} className={styles.branchChevron} />
                            </button>

                            {showBranchMenu && (
                                <div className={styles.branchMenu}>
                                    {branchList === null ? (
                                        <div className={styles.branchMenuLoading}>
                                            <Loader2 size={12} className={styles.branchSpinner} />
                                            <span>Loading…</span>
                                        </div>
                                    ) : branchList.length === 0 ? (
                                        <div className={styles.branchMenuLoading}>
                                            <span>No branches found</span>
                                        </div>
                                    ) : branchList.map(branch => (
                                        <button
                                            key={branch}
                                            className={`${styles.branchMenuItem} ${branch === activeBranch ? styles.branchMenuItemActive : ''}`}
                                            onClick={() => switchBranch(branch)}
                                        >
                                            <GitBranch size={10} />
                                            <span>{branch}</span>
                                            {branch === (repository.defaultBranch || 'main') && (
                                                <span className={styles.branchMenuDefault}>default</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className={styles.headerCenter}>
                    <button
                        className={styles.navArrow}
                        onClick={() => goPrev()}
                        disabled={currentIndex === 0}
                        title="Previous commit (←)"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <button className={styles.chapterTrigger} onClick={() => setShowHistoryModal(true)}>
                        <span className={styles.chapterLabel}>
                            #{currentIndex + 1} of {commitsQuery.isFetchingNextPage ? `${commits.length}+` : commits.length}
                        </span>
                        <span className={styles.chapterTitle}>{currentCommit?.message?.split('\n')[0] ?? ''}</span>
                        <ChevronDown size={12} className={styles.chapterChevron} />
                    </button>
                    <button
                        className={styles.navArrow}
                        onClick={() => goNext(commits.length)}
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
                        onClick={toggleFocusMode}
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
                                        onSelect={(displayIdx) => goToCommit(commitOrder === 'asc' ? displayIdx : commits.length - 1 - displayIdx, commits.length)}
                                    />
                                ) : loadingFiles ? (
                                    <div className={styles.loadingFiles}>
                                        <Loader2 size={24} className={styles.spinner} />
                                    </div>
                                ) : (
                                    <FileTree
                                        files={files}
                                        selectedFile={resolvedSelectedFile}
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
                                    resolvedSelectedFile?.content ? (
                                        <div className={styles.codeViewerWrapper}>
                                            <CodeViewer
                                                code={resolvedSelectedFile.content}
                                                language={resolvedSelectedFile.language}
                                                filename={resolvedSelectedFile.path}
                                            />
                                            {(loadingContent || loadingFiles) && (
                                                <div className={styles.codeLoadingOverlay}>
                                                    <Loader2 size={20} className={styles.spinner} />
                                                </div>
                                            )}
                                        </div>
                                    ) : loadingContent || loadingFiles ? (
                                        <div className={styles.loadingFiles}>
                                            <Loader2 size={24} className={styles.spinner} />
                                            <p>Loading content...</p>
                                        </div>
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
                                                    <span className={styles.diffFileName}>
                                                        {resolvedSelectedFile
                                                            ? resolvedSelectedFile.path.split('/').pop()
                                                            : 'No file selected'}
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
                                                    <span className={styles.diffRange}>...</span>
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
                                            !resolvedSelectedFile ? (
                                                <div className={styles.noFile}>
                                                    <h3>No file selected</h3>
                                                    <p>Select a file from the tree to view its diff.</p>
                                                </div>
                                            ) : commitDiffLoading ? (
                                                <div className={styles.loadingFiles}>
                                                    <Loader2 size={24} className={styles.spinner} />
                                                    <p>Loading diff...</p>
                                                </div>
                                            ) : commitDiffError ? (
                                                <div className={styles.errorInline}>{commitDiffError}</div>
                                            ) : commitDiffFile ? (
                                                <>
                                                    <div className={styles.diffMeta}>
                                                        <span className={`${styles.diffStatusBadge} ${
                                                            commitDiffFile.status === 'added'   ? styles.diffStatusAdded   :
                                                            commitDiffFile.status === 'removed' ? styles.diffStatusRemoved :
                                                            commitDiffFile.status === 'renamed' ? styles.diffStatusRenamed :
                                                            styles.diffStatusModified
                                                        }`}>{commitDiffFile.status}</span>
                                                        <span className={`${styles.diffStatPill} ${styles.diffStatAdd}`}>+{commitDiffFile.additions}</span>
                                                        <span className={`${styles.diffStatPill} ${styles.diffStatDel}`}>-{commitDiffFile.deletions}</span>
                                                    </div>
                                                    <DiffViewer patch={commitDiffFile.patch} mode={diffViewMode} />
                                                </>
                                            ) : (
                                                <div className={styles.noFile}>
                                                    <h3>No changes in this commit</h3>
                                                    <p>This file was not modified in this commit.</p>
                                                </div>
                                            )
                                        ) : (
                                            !resolvedSelectedFile ? (
                                                <div className={styles.noFile}>
                                                    <h3>No file selected</h3>
                                                    <p>Select a file from the tree to compare.</p>
                                                </div>
                                            ) : compareLoading ? (
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
                                            ) : compareFile ? (
                                                <>
                                                    <div className={styles.diffMeta}>
                                                        <span>{compareFile.status}</span>
                                                        <span className={styles.diffAdd}>+{compareFile.additions}</span>
                                                        <span className={styles.diffDel}>-{compareFile.deletions}</span>
                                                    </div>
                                                    <DiffViewer
                                                        patch={compareFile.patch}
                                                        mode={diffViewMode}
                                                        emptyMessage="This file did not change textually between the selected commits."
                                                    />
                                                </>
                                            ) : (
                                                <div className={styles.noFile}>
                                                    <h3>No changes in this range</h3>
                                                    <p>This file was not modified between the selected commits.</p>
                                                </div>
                                            )
                                        )}
                                    </div>
                                )}

                                {centerView === 'story' && (
                                    <StoryModePanel
                                        repository={repository}
                                        commits={commits}
                                        currentIndex={currentIndex}
                                        onNavigateToCommit={(idx) => goToCommit(idx, commits.length)}
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
                                    onClick={toggleAiPanel}
                                    title={aiPanelExpanded ? 'Collapse AI' : 'Expand AI'}
                                >
                                    {aiPanelExpanded ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
                                </button>
                                {aiPanelExpanded ? (
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
                    onSelectCommit={(idx) => goToCommit(idx, commits.length)}
                />
            )}

            <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
        </div>
    );
}
