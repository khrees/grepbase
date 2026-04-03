import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './StoryModePanel.module.css';
import { getAISettings } from './SettingsModal';
import { api } from '@/lib/api-client';
import type { Commit, Repository } from '@/types';

const CHAPTER_SIZE = 10;

interface StoryModePanelProps {
    repository: Pick<Repository, 'id' | 'name' | 'owner'>;
    commits: Commit[];
    currentIndex: number;
    onNavigateToCommit: (index: number) => void;
}

/** Returns the chapter index (0-based) that contains a given commit index. */
function chapterForCommit(commitIndex: number): number {
    return Math.floor(commitIndex / CHAPTER_SIZE);
}

function chapterRange(chapterIndex: number, totalCommits: number): { start: number; end: number } {
    const start = chapterIndex * CHAPTER_SIZE;
    const end = Math.min(start + CHAPTER_SIZE - 1, totalCommits - 1);
    return { start, end };
}

export default function StoryModePanel({
    repository,
    commits,
    currentIndex,
    onNavigateToCommit,
}: StoryModePanelProps) {
    const totalChapters = Math.ceil(commits.length / CHAPTER_SIZE);

    // Start on the chapter containing the current commit
    const [chapterIndex, setChapterIndex] = useState(() => chapterForCommit(currentIndex));
    const [story, setStory] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Cache generated stories by chapter index
    const cacheRef = useRef<Map<number, string>>(new Map());
    const abortControllerRef = useRef<AbortController | null>(null);

    const { start, end } = chapterRange(chapterIndex, commits.length);
    const startCommit = commits[start];
    const endCommit = commits[end];

    const generateChapter = useCallback(async (idx: number) => {
        const cached = cacheRef.current.get(idx);
        if (cached) {
            setStory(cached);
            setError(null);
            return;
        }

        const settings = getAISettings();
        if (!settings) {
            setError('Configure AI settings before generating a story.');
            return;
        }

        const { start: s, end: e } = chapterRange(idx, commits.length);
        const startSha = commits[s]?.sha;
        const endSha = commits[e]?.sha;
        if (!startSha || !endSha) return;

        abortControllerRef.current?.abort();
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        setLoading(true);
        setStory('');
        setError(null);

        try {
            const response = await api.postStream('/api/explain/story', {
                type: 'story',
                repoId: repository.id,
                startSha,
                endSha,
                chapterSize: CHAPTER_SIZE,
                provider: {
                    type: settings.provider,
                    baseUrl: settings.config.baseUrl,
                    model: settings.config.model,
                },
            }, { signal: abortController.signal });

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response stream');

            const decoder = new TextDecoder();
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                fullText += decoder.decode(value, { stream: true });
                setStory(fullText);
            }
            const tail = decoder.decode();
            if (tail) {
                fullText += tail;
                setStory(fullText);
            }

            cacheRef.current.set(idx, fullText);
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : 'Failed to generate story.');
        } finally {
            if (abortControllerRef.current === abortController) {
                setLoading(false);
            }
        }
    }, [commits, repository.id]);

    // Auto-generate when chapter changes
    useEffect(() => {
        if (commits.length === 0) return;
        generateChapter(chapterIndex);
    }, [chapterIndex, commits.length, generateChapter]);

    // Cleanup on unmount
    useEffect(() => () => { abortControllerRef.current?.abort(); }, []);

    function goToPrevChapter() {
        if (chapterIndex <= 0) return;
        const next = chapterIndex - 1;
        setChapterIndex(next);
        // Navigate explorer to last commit of that chapter
        onNavigateToCommit(chapterRange(next, commits.length).end);
    }

    function goToNextChapter() {
        if (chapterIndex >= totalChapters - 1) return;
        const next = chapterIndex + 1;
        setChapterIndex(next);
        onNavigateToCommit(chapterRange(next, commits.length).start);
    }

    const shortSha = (sha: string) => sha.slice(0, 7);

    return (
        <div className={styles.container}>
            <div className={styles.chapterNav}>
                <button
                    className={styles.chapterArrow}
                    onClick={goToPrevChapter}
                    disabled={chapterIndex === 0 || loading}
                    title="Previous chapter"
                >
                    <ChevronLeft size={14} />
                </button>

                <div className={styles.chapterInfo}>
                    <span className={styles.chapterLabel}>
                        Chapter {chapterIndex + 1} of {totalChapters}
                    </span>
                    {startCommit && endCommit && (
                        <span className={styles.chapterRange}>
                            {shortSha(startCommit.sha)} → {shortSha(endCommit.sha)}
                            <span className={styles.commitCount}>
                                {end - start + 1} commits
                            </span>
                        </span>
                    )}
                </div>

                <button
                    className={styles.chapterArrow}
                    onClick={goToNextChapter}
                    disabled={chapterIndex >= totalChapters - 1 || loading}
                    title="Next chapter"
                >
                    <ChevronRight size={14} />
                </button>

                <button
                    className={styles.regenerate}
                    onClick={() => {
                        cacheRef.current.delete(chapterIndex);
                        generateChapter(chapterIndex);
                    }}
                    disabled={loading}
                    title="Regenerate this chapter"
                >
                    {loading
                        ? <Loader2 size={13} className={styles.spinner} />
                        : <Sparkles size={13} />
                    }
                </button>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            {!story && !loading && !error && (
                <div className={styles.emptyState}>
                    Configure AI settings to generate the story for this chapter.
                </div>
            )}

            {(story || loading) && (
                <div className={styles.storyContent}>
                    {loading && !story && (
                        <div className={styles.generating}>
                            <Loader2 size={16} className={styles.spinner} />
                            Generating chapter {chapterIndex + 1}...
                        </div>
                    )}
                    {story && (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{story}</ReactMarkdown>
                    )}
                </div>
            )}
        </div>
    );
}
