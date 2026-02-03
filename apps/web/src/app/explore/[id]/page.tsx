'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import {
    BookOpen, ChevronLeft, ChevronRight, Home, Settings,
    Loader2, MessageSquare, GitCommit, User, Calendar, Maximize2, Minimize2, ChevronDown
} from 'lucide-react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import styles from './page.module.css';
import SettingsModal from '@/components/SettingsModal';
import CodeViewer from '@/components/CodeViewer';
import AIPanel from '@/components/AIPanel';
import FileTree from '@/components/FileTree';
import CommitHistoryModal from '@/components/CommitHistoryModal';
import { api } from '@/lib/api-client';

interface Repository {
    id: number;
    name: string;
    owner: string;
    description: string | null;
    readme: string | null;
}

interface Commit {
    id: number;
    sha: string;
    message: string;
    authorName: string | null;
    date: string;
    order: number;
}

interface FileData {
    path: string;
    content: string | null;
    language: string;
    size: number;
    hasContent?: boolean;
    shouldFetchContent?: boolean;
}

export default function ExplorePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();

    const [repository, setRepository] = useState<Repository | null>(null);
    const [commits, setCommits] = useState<Commit[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [files, setFiles] = useState<FileData[]>([]);
    const [selectedFile, setSelectedFile] = useState<FileData | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [loadingContent, setLoadingContent] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showAIPanel, setShowAIPanel] = useState(true);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [focusMode, setFocusMode] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const currentCommit = commits[currentIndex];

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

    // Fetch files when commit changes
    useEffect(() => {
        if (!currentCommit || !repository) return;

        async function fetchFiles() {
            setLoadingFiles(true);
            setSelectedFile(null);
            try {
                const data = await api.get<{ files?: FileData[] }>(
                    `/api/repos/${id}/commits/${currentCommit.sha}`
                );

                setFiles(data.files || []);
                // Auto-select first file that can have content loaded
                const firstLoadable = data.files?.find((f: FileData) =>
                    f.shouldFetchContent || f.hasContent
                );
                if (firstLoadable) {
                    selectFile(firstLoadable);
                }
            } catch (err) {
                console.error('Failed to fetch files:', err);
            } finally {
                setLoadingFiles(false);
            }
        }

        fetchFiles();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentCommit?.sha, repository?.id, id]);

    // Select file and load content lazily
    async function selectFile(file: FileData) {
        // If we already have content, just select it
        if (file.content) {
            setSelectedFile(file);
            return;
        }

        // Fetch content lazily
        setLoadingContent(true);
        setSelectedFile({ ...file, content: null }); // Show file as selected while loading

        try {
            const data = await api.get<{ content?: string }>(
                `/api/repos/${id}/commits/${currentCommit?.sha}/content?path=${encodeURIComponent(file.path)}`
            );

            if (data.content) {
                // Update file in files array with content
                const updatedFile = { ...file, content: data.content, hasContent: true };
                setFiles(prev => prev.map(f =>
                    f.path === file.path ? updatedFile : f
                ));
                setSelectedFile(updatedFile);
            }
        } catch (err) {
            console.error('Failed to fetch file content:', err);
        } finally {
            setLoadingContent(false);
        }
    }

    // Navigation
    function goToCommit(index: number) {
        if (index >= 0 && index < commits.length) {
            setCurrentIndex(index);
            setSelectedFile(null);
        }
    }

    function goNext() {
        goToCommit(currentIndex + 1);
    }

    function goPrev() {
        goToCommit(currentIndex - 1);
    }

    // Keyboard navigation
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (showSettings || showHistoryModal) return;

            if (e.key === 'ArrowRight' && e.metaKey) { // Cmd+Right for next commit
                goNext();
            } else if (e.key === 'ArrowLeft' && e.metaKey) { // Cmd+Left for prev commit
                goPrev();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    });

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
            <header className={`${styles.header} ${focusMode ? styles.headerCompact : ''}`}>
                <div className={styles.headerLeft}>
                    <button className="btn btn-ghost" onClick={() => router.push('/')}>
                        <Home size={18} />
                    </button>
                    <div className={styles.repoInfo}>
                        <BookOpen size={18} />
                        <span className={styles.repoName}>{repository.owner}/{repository.name}</span>
                    </div>
                </div>

                <div className={styles.headerCenter}>
                    {/* Chapter / Commit Selector */}
                    <button
                        className={styles.chapterTrigger}
                        onClick={() => setShowHistoryModal(true)}
                    >
                        <div className={styles.chapterInfo}>
                            <span className={styles.chapterLabel}>
                                Chapter {currentIndex + 1} of {commits.length}
                            </span>
                            <span className={styles.chapterTitle}>
                                {currentCommit.message.split('\n')[0]}
                            </span>
                        </div>
                        <ChevronDown size={16} className={styles.chapterChevron} />
                    </button>
                </div>

                <div className={styles.headerRight}>
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

            {/* Main Content (Resizable Panels) */}
            <div className={styles.main}>
                <Group orientation="horizontal" className={styles.group}>
                    {/* Left Panel: Files */}
                    {/* Left Panel: Files */}
                    {!focusMode && (
                        <Panel defaultSize="20" minSize="15" maxSize="30" className={styles.panel} id="files">
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
                    {!focusMode && <Separator className={styles.resizeHandle} />}

                    {/* Center Panel: Code */}
                    <Panel defaultSize="60" minSize="30" className={styles.panel} id="code">
                        {/* Commit Info (Compact) */}
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

                        <div className={styles.codeArea}>
                            <div className={styles.codeDisplay}>
                                {loadingContent ? (
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
                                )}
                            </div>
                        </div>

                        {/* Bottom Navigation */}
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

                    {/* Right Panel: AI */}
                    {!focusMode && showAIPanel && <Separator className={styles.resizeHandle} />}
                    {!focusMode && showAIPanel && (
                        <Panel defaultSize="20" minSize="20" maxSize="40" className={styles.panel} id="ai">
                            <div className={styles.panelHeader}>
                                <h3 className={styles.panelTitle}>AI Analysis</h3>
                            </div>
                            <div className={styles.aiPanelWrapper}>
                                <AIPanel
                                    repository={repository}
                                    commit={currentCommit}
                                    totalCommits={commits.length}
                                    currentIndex={currentIndex}
                                />
                            </div>
                        </Panel>
                    )}
                </Group>
            </div>

            {/* History Modal */}
            {showHistoryModal && (
                <CommitHistoryModal
                    isOpen={showHistoryModal}
                    onClose={() => setShowHistoryModal(false)}
                    commits={commits}
                    currentIndex={currentIndex}
                    onSelectCommit={goToCommit}
                />
            )}

            {/* Settings Modal */}
            <SettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
            />
        </div>
    );
}
