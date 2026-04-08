import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './StoryModePanel.module.css';
import { getAISettings } from '@/stores/settings-store';
import { api } from '@/lib/api-client';
import type { Commit, Repository } from '@/types';

const CHAPTER_SIZE = 10;

interface StoryModePanelProps {
    repository: Pick<Repository, 'id' | 'name' | 'owner'>;
    commits: Commit[];
    currentIndex: number;
    onNavigateToCommit: (index: number) => void;
    onOpenSettings?: () => void;
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

function buildTextSummary(chapterCommits: Commit[], chapterIdx: number): string {
    const lines: string[] = [];

    lines.push(`## Chapter ${chapterIdx + 1}\n`);

    if (chapterCommits.length > 0) {
        const first = chapterCommits[0];
        const last = chapterCommits[chapterCommits.length - 1];
        const fmtDate = (d: string) =>
            new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const dateRange =
            first.date !== last.date
                ? `${fmtDate(first.date)} → ${fmtDate(last.date)}`
                : fmtDate(first.date);
        lines.push(`**${dateRange}** · ${chapterCommits.length} commit${chapterCommits.length !== 1 ? 's' : ''}\n`);
    }

    const authorCounts = new Map<string, number>();
    for (const c of chapterCommits) {
        const name = c.authorName || 'Unknown';
        authorCounts.set(name, (authorCounts.get(name) || 0) + 1);
    }
    const authors = [...authorCounts.entries()].sort((a, b) => b[1] - a[1]);
    if (authors.length > 0) {
        const authorList = authors
            .map(([name, count]) => (count > 1 ? `${name} (${count})` : name))
            .join(', ');
        lines.push(`**Contributors:** ${authorList}\n`);
    }

    lines.push('---\n');

    for (const commit of chapterCommits) {
        const firstLine = commit.message.split('\n')[0].trim();
        const date = new Date(commit.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        lines.push(`- \`${commit.sha.slice(0, 7)}\` **${date}** — ${firstLine}`);
    }

    return lines.join('\n');
}

export default function StoryModePanel({
    repository,
    commits,
    currentIndex,
    onNavigateToCommit,
    onOpenSettings,
}: StoryModePanelProps) {
    const totalChapters = Math.ceil(commits.length / CHAPTER_SIZE);

    // Start on the chapter containing the current commit
    const [chapterIndex, setChapterIndex] = useState(() => chapterForCommit(currentIndex));
    const [story, setStory] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // aiGenerated tracks whether the current story content was AI-generated
    const [aiGenerated, setAiGenerated] = useState(false);
    // Cache AI-generated stories by chapter index only
    const cacheRef = useRef<Map<number, string>>(new Map());
    const abortControllerRef = useRef<AbortController | null>(null);

    const { start, end } = chapterRange(chapterIndex, commits.length);
    const startCommit = commits[start];
    const endCommit = commits[end];

    const generateChapter = useCallback(async (idx: number) => {
        const cached = cacheRef.current.get(idx);
        if (cached) {
            setStory(cached);
            setAiGenerated(true);
            setError(null);
            return;
        }

        const settings = getAISettings();
        if (!settings) {
            onOpenSettings?.();
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
            setAiGenerated(true);
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : 'Failed to generate story.');
        } finally {
            if (abortControllerRef.current === abortController) {
                setLoading(false);
            }
        }
    }, [commits, repository.id, onOpenSettings]);

    // Show text summary immediately when chapter changes; abort any in-flight AI generation
    useEffect(() => {
        if (commits.length === 0) return;
        abortControllerRef.current?.abort();
        // If we have a cached AI story for this chapter, show it
        const cached = cacheRef.current.get(chapterIndex);
        if (cached) {
            setStory(cached);
            setAiGenerated(true);
            setError(null);
            return;
        }
        // Otherwise show the instant text summary
        const { start: s, end: e } = chapterRange(chapterIndex, commits.length);
        setStory(buildTextSummary(commits.slice(s, e + 1), chapterIndex));
        setAiGenerated(false);
        setError(null);
        return () => { abortControllerRef.current?.abort(); };
    }, [chapterIndex, commits]);

    function goToPrevChapter() {
        if (chapterIndex <= 0) return;
        const next = chapterIndex - 1;
        setChapterIndex(next);
        onNavigateToCommit(chapterRange(next, commits.length).end);
    }

    function goToNextChapter() {
        if (chapterIndex >= totalChapters - 1) return;
        const next = chapterIndex + 1;
        setChapterIndex(next);
        onNavigateToCommit(chapterRange(next, commits.length).start);
    }

    function handleGenerateWithAI() {
        generateChapter(chapterIndex);
    }

    function handleRegenerate() {
        cacheRef.current.delete(chapterIndex);
        generateChapter(chapterIndex);
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

                {aiGenerated ? (
                    <button
                        className={styles.regenerate}
                        onClick={handleRegenerate}
                        disabled={loading}
                        title="Regenerate this chapter"
                    >
                        {loading
                            ? <Loader2 size={13} className={styles.spinner} />
                            : <Sparkles size={13} />
                        }
                    </button>
                ) : (
                    <button
                        className={styles.generateAiBtn}
                        onClick={handleGenerateWithAI}
                        disabled={loading}
                        title="Generate AI narrative for this chapter"
                    >
                        {loading
                            ? <Loader2 size={13} className={styles.spinner} />
                            : <Sparkles size={13} />
                        }
                        {loading ? 'Generating...' : 'Generate with AI'}
                    </button>
                )}
            </div>

            {error && <div className={styles.error}>{error}</div>}

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
                    {!aiGenerated && !loading && story && (
                        <div className={styles.aiUpgrade}>
                            <Sparkles size={14} />
                            <span>
                                Want a narrative summary?{' '}
                                <button className={styles.settingsLink} onClick={handleGenerateWithAI}>
                                    Generate with AI
                                </button>
                                {!getAISettings() && onOpenSettings && (
                                    <> — <button className={styles.settingsLink} onClick={onOpenSettings}>configure a provider first</button></>
                                )}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
