import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './StoryModePanel.module.css';
import { getAISettings } from './SettingsModal';
import { api } from '@/lib/api-client';
import type { Commit, Repository } from '@/types';

interface StoryModePanelProps {
    repository: Pick<Repository, 'id' | 'name' | 'owner'>;
    commits: Commit[];
    currentIndex: number;
}

function commitLabel(commit: Commit, index: number): string {
    const title = commit.message.split('\n')[0] || 'No message';
    const shortTitle = title.length > 56 ? `${title.slice(0, 56)}...` : title;
    return `${index + 1}. ${commit.sha.slice(0, 7)} - ${shortTitle}`;
}

export default function StoryModePanel({ repository, commits, currentIndex }: StoryModePanelProps) {
    const [startSha, setStartSha] = useState('');
    const [endSha, setEndSha] = useState('');
    const [chapterSize, setChapterSize] = useState(5);
    const [loading, setLoading] = useState(false);
    const [story, setStory] = useState('');
    const [error, setError] = useState<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const commitIndexBySha = useMemo(
        () => new Map(commits.map((commit, index) => [commit.sha, index])),
        [commits]
    );

    useEffect(() => {
        if (commits.length === 0) return;

        const defaultEnd = commits[currentIndex]?.sha || commits[commits.length - 1].sha;
        const defaultStart = commits[Math.max(0, currentIndex - 14)]?.sha || commits[0].sha;

        setStartSha(prev => prev || defaultStart);
        setEndSha(prev => prev || defaultEnd);
    }, [commits, currentIndex]);

    useEffect(() => {
        return () => {
            abortControllerRef.current?.abort();
        };
    }, []);

    const normalizedRange = useMemo(() => {
        const startIndex = commitIndexBySha.get(startSha) ?? 0;
        const endIndex = commitIndexBySha.get(endSha) ?? (commits.length - 1);

        if (startIndex <= endIndex) {
            return {
                startSha,
                endSha,
                count: endIndex - startIndex + 1,
            };
        }

        return {
            startSha: endSha,
            endSha: startSha,
            count: startIndex - endIndex + 1,
        };
    }, [commitIndexBySha, commits.length, endSha, startSha]);

    async function generateStory() {
        const settings = getAISettings();
        if (!settings) {
            setError('Please configure AI settings before generating story mode.');
            return;
        }

        if (!normalizedRange.startSha || !normalizedRange.endSha) {
            setError('Select a valid commit range.');
            return;
        }

        setLoading(true);
        setError(null);
        setStory('');
        abortControllerRef.current?.abort();
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
            const response = await api.postStream('/api/explain/story', {
                type: 'story',
                repoId: repository.id,
                startSha: normalizedRange.startSha,
                endSha: normalizedRange.endSha,
                chapterSize,
                provider: {
                    type: settings.provider,
                    apiKey: settings.config.apiKey,
                    baseUrl: settings.config.baseUrl,
                    model: settings.config.model,
                },
            }, {
                signal: abortController.signal,
            });

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response stream from story endpoint');
            }

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
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                return;
            }
            setError(err instanceof Error ? err.message : 'Failed to generate story mode.');
        } finally {
            if (abortControllerRef.current === abortController) {
                setLoading(false);
            }
        }
    }

    return (
        <div className={styles.container}>
            <div className={styles.controls}>
                <div className={styles.field}>
                    <label htmlFor="story-start-commit">Start commit</label>
                    <select
                        id="story-start-commit"
                        value={startSha}
                        onChange={event => setStartSha(event.target.value)}
                    >
                        {commits.map((commit, index) => (
                            <option key={`start-${commit.sha}`} value={commit.sha}>
                                {commitLabel(commit, index)}
                            </option>
                        ))}
                    </select>
                </div>

                <div className={styles.field}>
                    <label htmlFor="story-end-commit">End commit</label>
                    <select
                        id="story-end-commit"
                        value={endSha}
                        onChange={event => setEndSha(event.target.value)}
                    >
                        {commits.map((commit, index) => (
                            <option key={`end-${commit.sha}`} value={commit.sha}>
                                {commitLabel(commit, index)}
                            </option>
                        ))}
                    </select>
                </div>

                <div className={styles.fieldSmall}>
                    <label htmlFor="story-chapter-size">Chapter size</label>
                    <input
                        id="story-chapter-size"
                        type="number"
                        min={2}
                        max={12}
                        value={chapterSize}
                        onChange={event => {
                            const value = Number.parseInt(event.target.value, 10);
                            if (!Number.isNaN(value)) {
                                setChapterSize(Math.max(2, Math.min(12, value)));
                            }
                        }}
                    />
                </div>

                <button
                    type="button"
                    className="btn btn-primary"
                    onClick={generateStory}
                    disabled={loading || commits.length === 0}
                >
                    {loading ? <Loader2 size={16} className={styles.spinner} /> : <Sparkles size={16} />}
                    {loading ? 'Generating Story...' : 'Generate Story'}
                </button>
            </div>

            <div className={styles.meta}>
                <span>
                    {repository.owner}/{repository.name}
                </span>
                <span>{normalizedRange.count} commit{normalizedRange.count === 1 ? '' : 's'} selected</span>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            {!story && !loading && !error && (
                <div className={styles.emptyState}>
                    Story Mode creates a narrated walkthrough across a commit range.
                </div>
            )}

            {story && (
                <div className={styles.storyContent}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{story}</ReactMarkdown>
                </div>
            )}
        </div>
    );
}
