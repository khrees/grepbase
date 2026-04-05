'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Search, GitCommit, X, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import styles from './CommitSearchPalette.module.css';
import { api } from '@/lib/api-client';
import { getAISettings } from '@/stores/settings-store';
import type { Commit } from '@/types';

interface CommitSearchPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    commits: Commit[];
    repoId: string;
    currentIndex: number;
    onSelectCommit: (index: number) => void;
}

type ResultSource = 'ai' | 'text';

interface SearchResult {
    commit: Commit;
    globalIndex: number;
    source: ResultSource;
}

function textMatch(commits: Commit[], query: string): SearchResult[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return commits
        .map((commit, i) => ({ commit, globalIndex: i }))
        .filter(({ commit }) =>
            commit.message.toLowerCase().includes(q) ||
            commit.sha.startsWith(q) ||
            (commit.authorName ?? '').toLowerCase().includes(q)
        )
        .slice(0, 30)
        .map(r => ({ ...r, source: 'text' as ResultSource }));
}

export default function CommitSearchPalette({
    isOpen,
    onClose,
    commits,
    repoId,
    currentIndex,
    onSelectCommit,
}: CommitSearchPaletteProps) {
    const [query, setQuery] = useState('');
    const [activeIdx, setActiveIdx] = useState(0);
    // null = not yet run, [] = ran but empty, [...] = results
    const [aiResults, setAiResults] = useState<SearchResult[] | null>(null);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    // Reset and focus on open
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setAiResults(null);
            setAiLoading(false);
            setAiError(null);
            setActiveIdx(0);
            setTimeout(() => inputRef.current?.focus(), 0);
        } else {
            abortRef.current?.abort();
        }
    }, [isOpen]);

    // Reset AI results when query changes so text results show immediately
    useEffect(() => {
        setAiResults(null);
        setAiLoading(false);
        setAiError(null);
        abortRef.current?.abort();
    }, [query]);

    const textResults = useMemo(() => textMatch(commits, query), [commits, query]);

    // While AI is running, show text results underneath. Once AI returns, show those.
    const results: SearchResult[] = aiResults ?? textResults;
    const isAiMode = aiResults !== null && !aiLoading;

    const runAISearch = useCallback(async (q: string) => {
        const settings = getAISettings();
        if (!settings || !q.trim()) return;

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setAiLoading(true);
        setAiError(null);
        setAiResults(null);

        try {
            const data = await api.post<{ shas: string[] }>('/api/search/commits', {
                repoId,
                query: q.trim(),
                provider: {
                    type: settings.provider,
                    baseUrl: settings.config.baseUrl,
                    model: settings.config.model,
                },
            });

            if (controller.signal.aborted) return;

            const shaSet = new Map(commits.map((c, i) => [c.sha.slice(0, 7), i]));
            const matched: SearchResult[] = [];
            for (const sha of data.shas) {
                const idx = shaSet.get(sha.slice(0, 7));
                if (idx !== undefined) {
                    matched.push({ commit: commits[idx], globalIndex: idx, source: 'ai' });
                }
            }
            setAiResults(matched);
            setActiveIdx(0);
        } catch (err) {
            if (controller.signal.aborted) return;
            setAiError(err instanceof Error ? err.message : 'AI search failed');
        } finally {
            if (!controller.signal.aborted) setAiLoading(false);
        }
    }, [commits, repoId]);

    // Keep active item in view
    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const item = list.children[activeIdx] as HTMLElement | undefined;
        item?.scrollIntoView({ block: 'nearest' });
    }, [activeIdx]);

    const handleSelect = useCallback((result: SearchResult) => {
        onSelectCommit(result.globalIndex);
        onClose();
    }, [onSelectCommit, onClose]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { onClose(); return; }

        // ⌘↵ / Ctrl+↵ → trigger AI search explicitly
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (query.trim().length >= 2) runAISearch(query);
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx(i => Math.min(i + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            if (results[activeIdx]) handleSelect(results[activeIdx]);
        }
    }, [activeIdx, query, results, handleSelect, runAISearch, onClose]);

    const hasAIConfigured = !!getAISettings();

    if (!isOpen) return null;

    const isEmpty = query.trim().length > 0 && !aiLoading && results.length === 0;

    return (
        <div
            className={styles.overlay}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className={styles.palette} role="dialog" aria-modal="true" aria-label="Search commits">

                {/* Input row */}
                <div className={styles.inputRow}>
                    {aiLoading
                        ? <Loader2 size={15} className={`${styles.searchIcon} ${styles.spinning}`} />
                        : isAiMode
                            ? <Sparkles size={15} className={`${styles.searchIcon} ${styles.aiActive}`} />
                            : <Search size={15} className={styles.searchIcon} />
                    }
                    <input
                        ref={inputRef}
                        className={styles.input}
                        placeholder={hasAIConfigured
                            ? 'Search commits… press ⌘↵ to search with AI'
                            : 'Search commits by message, SHA, or author…'}
                        value={query}
                        onChange={e => {
                            setQuery(e.target.value);
                            setActiveIdx(0);
                        }}
                        onKeyDown={handleKeyDown}
                        spellCheck={false}
                        autoComplete="off"
                    />
                    {aiLoading && (
                        <span className={styles.statusHint}>Searching…</span>
                    )}
                    {!aiLoading && isAiMode && (
                        <span className={`${styles.statusHint} ${styles.statusHintAI}`}>
                            <Sparkles size={10} /> AI
                        </span>
                    )}
                    {hasAIConfigured && !aiLoading && !isAiMode && query.trim().length >= 2 && (
                        <button
                            className={styles.aiSearchBtn}
                            onMouseDown={(e) => { e.preventDefault(); runAISearch(query); }}
                            title="Search with AI (⌘↵)"
                        >
                            <Sparkles size={11} />
                            <span>⌘↵</span>
                        </button>
                    )}
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close search">
                        <X size={14} />
                    </button>
                </div>

                {/* AI running — text results still visible below with a banner */}
                {aiLoading && textResults.length > 0 && (
                    <div className={styles.aiBanner}>
                        <Loader2 size={11} className={styles.spinning} />
                        Searching with AI — showing text matches while you wait
                    </div>
                )}
                {aiLoading && textResults.length === 0 && (
                    <div className={styles.aiBanner}>
                        <Loader2 size={11} className={styles.spinning} />
                        Searching with AI…
                    </div>
                )}

                {/* Error banner */}
                {aiError && (
                    <div className={styles.errorBanner}>
                        <AlertCircle size={13} />
                        <span>{aiError} — showing text results</span>
                    </div>
                )}

                {/* Results */}
                {query.trim().length === 0 ? (
                    <div className={styles.emptyState}>
                        <Sparkles size={20} className={styles.emptyIcon} />
                        <p>Search commits by message, SHA, or author</p>
                        {hasAIConfigured && (
                            <p className={styles.emptyHint}>Press <kbd>⌘↵</kbd> to search with AI in plain English</p>
                        )}
                    </div>
                ) : isEmpty ? (
                    <div className={styles.empty}>No commits match &ldquo;{query}&rdquo;</div>
                ) : (
                    <ul ref={listRef} className={styles.list} role="listbox">
                        {results.map((result, i) => {
                            const { commit, globalIndex, source } = result;
                            const isActive = i === activeIdx;
                            const isCurrent = globalIndex === currentIndex;
                            return (
                                <li
                                    key={commit.id}
                                    className={`${styles.item} ${isActive ? styles.itemActive : ''} ${isCurrent ? styles.itemCurrent : ''}`}
                                    role="option"
                                    aria-selected={isActive}
                                    onMouseEnter={() => setActiveIdx(i)}
                                    onMouseDown={() => handleSelect(result)}
                                >
                                    <span className={styles.itemOrder}>#{globalIndex + 1}</span>
                                    {source === 'ai'
                                        ? <Sparkles size={12} className={styles.aiIcon} />
                                        : <GitCommit size={12} className={styles.itemIcon} />
                                    }
                                    <span className={styles.itemMessage}>
                                        {commit.message.split('\n')[0]}
                                    </span>
                                    <span className={styles.itemMeta}>
                                        <code className={styles.itemSha}>{commit.sha.slice(0, 7)}</code>
                                        {commit.authorName && (
                                            <span className={styles.itemAuthor}>{commit.authorName}</span>
                                        )}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {/* Footer */}
                <div className={styles.footer}>
                    <span><kbd>↑↓</kbd> navigate</span>
                    <span><kbd>↵</kbd> jump</span>
                    {hasAIConfigured
                        ? <span><kbd>⌘↵</kbd> search with AI</span>
                        : <span className={styles.footerNoAI}>Configure AI in settings for semantic search</span>
                    }
                    <span><kbd>esc</kbd> close</span>
                </div>
            </div>
        </div>
    );
}
