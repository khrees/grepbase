

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Sparkles, Send, Loader2, AlertCircle, RefreshCw, X, Clock, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import styles from './AIPanel.module.css';
import { getAISettings, getAutoExplainEnabled } from '@/stores/settings-store';
import { api } from '@/lib/api-client';

import Mermaid from './Mermaid';
import type { Repository, Commit } from '@/types';

interface AIPanelProps {
    repository: Pick<Repository, 'id' | 'name' | 'owner' | 'description'>;
    commit: Pick<Commit, 'sha' | 'message' | 'authorName' | 'date'>;
    totalCommits: number;
    currentIndex: number;
    onOpenFile?: (path: string) => void;
    visibleFilePaths?: string[];
    onOpenSettings?: () => void;
}

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

const CHAT_STORAGE_PREFIX = 'grepbase:ai_chat:';

function getChatStorageKey(repoId: string, commitSha: string): string {
    return `${CHAT_STORAGE_PREFIX}${repoId}:${commitSha}`;
}

function restoreMessagesFromStorage(storageKey: string): Message[] {
    if (typeof window === 'undefined') return [];

    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed.filter((item: unknown): item is Message => {
            if (!item || typeof item !== 'object') return false;
            const role = (item as { role?: unknown }).role;
            const content = (item as { content?: unknown }).content;
            return (role === 'user' || role === 'assistant') && typeof content === 'string';
        });
    } catch {
        return [];
    }
}

// Common LaTeX symbols → Unicode replacements
const LATEX_TO_UNICODE: [RegExp, string][] = [
    // Arrows
    [/\\leftarrow/gi, '←'],
    [/\\rightarrow/gi, '→'],
    [/\\leftrightarrow/gi, '↔'],
    [/\\Leftarrow/g, '⇐'],
    [/\\Rightarrow/g, '⇒'],
    [/\\Leftrightarrow/g, '⇔'],
    [/\\uparrow/gi, '↑'],
    [/\\downarrow/gi, '↓'],
    [/\\longrightarrow/gi, '→'],
    [/\\longleftarrow/gi, '←'],
    [/\\mapsto/gi, '↦'],
    // Math operators
    [/\\times/gi, '×'],
    [/\\div/gi, '÷'],
    [/\\pm/gi, '±'],
    [/\\mp/gi, '∓'],
    [/\\cdot/gi, '·'],
    [/\\star/gi, '⋆'],
    [/\\circ/gi, '∘'],
    // Comparisons
    [/\\neq/gi, '≠'],
    [/\\leq/gi, '≤'],
    [/\\geq/gi, '≥'],
    [/\\approx/gi, '≈'],
    [/\\equiv/gi, '≡'],
    [/\\sim/gi, '∼'],
    // Sets & logic
    [/\\infty/gi, '∞'],
    [/\\sum/gi, 'Σ'],
    [/\\prod/gi, 'Π'],
    [/\\forall/gi, '∀'],
    [/\\exists/gi, '∃'],
    [/\\in(?![a-z])/gi, '∈'],
    [/\\notin/gi, '∉'],
    [/\\subset/gi, '⊂'],
    [/\\supset/gi, '⊃'],
    [/\\cup/gi, '∪'],
    [/\\cap/gi, '∩'],
    [/\\emptyset/gi, '∅'],
    [/\\land/gi, '∧'],
    [/\\lor/gi, '∨'],
    [/\\neg/gi, '¬'],
    // Greek letters (common ones in code docs)
    [/\\alpha/gi, 'α'],
    [/\\beta/gi, 'β'],
    [/\\gamma/gi, 'γ'],
    [/\\delta/gi, 'δ'],
    [/\\epsilon/gi, 'ε'],
    [/\\lambda/gi, 'λ'],
    [/\\mu/gi, 'μ'],
    [/\\pi/gi, 'π'],
    [/\\sigma/gi, 'σ'],
    [/\\theta/gi, 'θ'],
    [/\\omega/gi, 'ω'],
    // Misc
    [/\\ldots/gi, '…'],
    [/\\cdots/gi, '⋯'],
    [/\\checkmark/gi, '✓'],
    [/\\dagger/gi, '†'],
];

/**
 * Strip LaTeX math delimiters ($...$, $$...$$) and convert LaTeX
 * symbol commands to their Unicode equivalents.
 */
function stripLatex(content: string): string {
    // Replace $$...$$ (display math) and $...$ (inline math) blocks,
    // converting any LaTeX commands inside them to Unicode.
    return content.replace(/\$\$([^$]+?)\$\$|\$([^$]+?)\$/g, (_match, display, inline) => {
        let inner: string = (display ?? inline).trim();
        for (const [pattern, replacement] of LATEX_TO_UNICODE) {
            inner = inner.replace(pattern, replacement);
        }
        // Remove remaining backslash-commands that we didn't map (e.g. \text{...})
        inner = inner.replace(/\\text\{([^}]*)}/g, '$1');
        inner = inner.replace(/\\mathrm\{([^}]*)}/g, '$1');
        inner = inner.replace(/\\mathbf\{([^}]*)}/g, '**$1**');
        inner = inner.replace(/\\textbf\{([^}]*)}/g, '**$1**');
        inner = inner.replace(/\{([^}]*)}/g, '$1'); // strip remaining braces
        return inner;
    });
}

function normalizeAssistantMarkdown(content: string): string {
    let text = content.trim();

    const fencedMarkdown = text.match(/^```[ \t]*(markdown|md|mdx)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
    if (fencedMarkdown) {
        const language = fencedMarkdown[1]?.toLowerCase();
        const inner = fencedMarkdown[2].trim();
        const looksLikeMarkdown = /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>)/.test(inner);

        if (language || looksLikeMarkdown) {
            text = inner;
        }
    }

    // Convert any LaTeX notation to Unicode
    text = stripLatex(text);

    return text;
}

function looksLikeRepositoryFilePath(value: string): boolean {
    if (!value || /\s/.test(value)) return false;
    if (/^@[^/]+\/[^/]+$/.test(value)) return false;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;

    const hasSeparator = value.includes('/');
    const hasExtension = /\.[A-Za-z0-9_-]+$/.test(value);
    const hasDotfile = /^\.{1,2}[A-Za-z0-9._-]/.test(value);
    const isKnownRootFile = /^(README(\.md)?|LICENSE|Dockerfile|Makefile|package\.json|tsconfig(\..+)?\.json|bunfig\.toml)$/i.test(value);
    const startsWithCommonCodeDir = /^(src|app|pages|components|lib|server|api|scripts|drizzle|public|tests?|docs)\//.test(value);
    const isShortDirectoryPath = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){1,4}\/?$/.test(value);

    if (startsWithCommonCodeDir) return true;
    if (hasExtension || hasDotfile || isKnownRootFile) return true;
    if (hasSeparator && isShortDirectoryPath) return true;

    return false;
}

function normalizeFileReference(raw: string): string | null {
    let value = raw.trim();
    if (!value) return null;

    value = value
        .replace(/^[`"'([{<]+/, '')
        .replace(/[`"')\]}>.,;:!?]+$/, '')
        .replace(/^[./]+/, match => (match === './' ? '' : match))
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');

    if (!value || !looksLikeRepositoryFilePath(value)) return null;
    return value;
}

function extractFileReferenceFromHref(href?: string): string | null {
    if (!href) return null;

    let candidate = href.trim();
    if (!candidate || candidate.startsWith('#')) return null;

    try {
        candidate = decodeURIComponent(candidate);
    } catch {
        // Keep original candidate if URL decoding fails.
    }

    if (candidate.startsWith('file://')) {
        return normalizeFileReference(candidate.slice('file://'.length));
    }

    if (candidate.startsWith('file:')) {
        return normalizeFileReference(candidate.slice('file:'.length));
    }

    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate)) {
        return null;
    }

    return normalizeFileReference(candidate);
}

async function streamResponseText(response: Response, onChunk: (chunk: string) => void): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onChunk(decoder.decode(value, { stream: true }));
    }

    const tail = decoder.decode();
    if (tail) {
        onChunk(tail);
    }
}

const THINKING_VERBS = [
    'Ideating...',
    'Tinkering...',
    'Analyzing diffs...',
    'Connecting dots...',
    'Examining structure...',
    'Synthesizing overview...',
    'Exploring codebase...',
    'Formulating explanation...',
    'Mapping relationships...',
    'Unraveling commits...',
];

function getRandomThinkingVerb(currentVerb?: string): string {
    const choices = THINKING_VERBS.filter(v => v !== currentVerb);
    return choices[Math.floor(Math.random() * choices.length)];
}

export default function AIPanel({ repository, commit, onOpenFile, visibleFilePaths, onOpenSettings }: AIPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingVerb, setLoadingVerb] = useState('Ideating...');
    const [error, setError] = useState<string | null>(null);
    const [streaming, setStreaming] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const visibleFilePathsRef = useRef<string[] | undefined>(visibleFilePaths);
    const normalizedVisiblePaths = useMemo(
        () => (visibleFilePaths || [])
            .map(path => normalizeFileReference(path) || '')
            .filter(Boolean),
        [visibleFilePaths]
    );
    const normalizedVisiblePathSet = useMemo(
        () => new Set(normalizedVisiblePaths),
        [normalizedVisiblePaths]
    );

    const canOpenFileReference = useCallback((path: string) => {
        if (normalizedVisiblePaths.length === 0) return true;
        if (normalizedVisiblePathSet.has(path)) return true;
        if (normalizedVisiblePaths.some(visiblePath => visiblePath.startsWith(`${path}/`))) return true;
        return false;
    }, [normalizedVisiblePathSet, normalizedVisiblePaths]);
    const chatStorageKey = useMemo(
        () => getChatStorageKey(repository.id, commit.sha),
        [repository.id, commit.sha]
    );

    visibleFilePathsRef.current = visibleFilePaths;


    const explainCommit = useCallback(async () => {
        const settings = getAISettings();
        if (!settings) {
            setError('AI provider not configured.');
            return;
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        setLoading(true);
        setLoadingVerb(getRandomThinkingVerb());
        setError(null);
        setMessages([]);
        setElapsedTime(0);

        const startTime = Date.now();
        timerRef.current = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            setElapsedTime(elapsed);
            if (elapsed > 0 && elapsed % 3 === 0) {
                setLoadingVerb(prev => getRandomThinkingVerb(prev));
            }
        }, 1000);

        try {
            const response = await api.postStream('/api/explain/commit', {
                type: 'commit',
                repoId: repository.id,
                commitSha: commit.sha,
                visibleFiles: visibleFilePathsRef.current,
                provider: {
                    type: settings.provider,
                    baseUrl: settings.config.baseUrl,
                    model: settings.config.model,
                },
            }, {
                signal: abortController.signal,
            });

            setStreaming(true);
            setMessages([{ role: 'assistant', content: '' }]);

            let fullText = '';

            await streamResponseText(response, chunk => {
                fullText += chunk;
                setMessages([{ role: 'assistant', content: fullText }]);
            });

            setStreaming(false);
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                return;
            }
            const message = err instanceof Error ? err.message : 'Something went wrong';
            if (message.includes('fetch')) {
                setError('Connection failed. Is your AI provider running?');
            } else if (message.includes('API key')) {
                setError('Invalid API key. Check your settings.');
            } else {
                setError(message);
            }
        } finally {
            setLoading(false);
            setStreaming(false);
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        }
    }, [commit.sha, repository.id]);

    // Reset messages when commit changes
    useEffect(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        setError(null);
        setElapsedTime(0);

        const restoredMessages = restoreMessagesFromStorage(chatStorageKey);
        if (restoredMessages.length > 0) {
            setMessages(restoredMessages);
            return;
        }

        setMessages([]);

        if (getAutoExplainEnabled()) {
            explainCommit();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatStorageKey, commit.sha]);

    // Persist chat by commit — persist to sessionStorage on changes
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (messages.length === 0) {
            sessionStorage.removeItem(chatStorageKey);
        } else {
            sessionStorage.setItem(chatStorageKey, JSON.stringify(messages.slice(-30)));
        }
    }, [chatStorageKey, messages]);


    // Scroll to bottom on new messages
    useEffect(() => {
        const container = messagesEndRef.current?.parentElement;
        if (container) {
            const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
            if (isNearBottom) {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }
        } else {
            // Fallback if parent not found
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
        };
    }, []);

    // Auto-resize textarea height to fit content
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            const scrollHeight = inputRef.current.scrollHeight;
            const maxHeight = 150;
            inputRef.current.style.height = `${Math.min(maxHeight, scrollHeight)}px`;
            inputRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
        }
    }, [input]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            askQuestion(e as unknown as React.FormEvent);
        }
    };

    async function askQuestion(e: React.FormEvent) {
        e.preventDefault();
        if (!input.trim() || loading) return;

        const settings = getAISettings();
        if (!settings) {
            setError('AI provider not configured.');
            return;
        }

        const question = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: question }]);
        setLoading(true);
        setLoadingVerb(getRandomThinkingVerb());
        setError(null);
        setElapsedTime(0);

        const startTime = Date.now();
        timerRef.current = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            setElapsedTime(elapsed);
            if (elapsed > 0 && elapsed % 3 === 0) {
                setLoadingVerb(prev => getRandomThinkingVerb(prev));
            }
        }, 1000);

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
            const response = await api.postStream('/api/explain/question', {
                type: 'question',
                repoId: repository.id,
                commitSha: commit.sha,
                question,
                visibleFiles: visibleFilePathsRef.current,
                provider: {
                    type: settings.provider,
                    baseUrl: settings.config.baseUrl,
                    model: settings.config.model,
                },
            }, {
                signal: abortController.signal,
            });

            setStreaming(true);
            setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

            let fullText = '';

            await streamResponseText(response, chunk => {
                fullText += chunk;
                setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = { role: 'assistant', content: fullText };
                    return newMessages;
                });
            });

            setStreaming(false);
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                return;
            }
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setLoading(false);
            setStreaming(false);
            inputRef.current?.focus();
        }
    }

    function stopGeneration() {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setLoading(false);
        setStreaming(false);
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }

    const hasMessages = messages.length > 0;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Sparkles size={18} />
                <span>AI Chat</span>
            </div>

            <div className={styles.content}>
                {/* Empty State */}
                {!hasMessages && !loading && !error && (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>
                            <Sparkles size={32} />
                        </div>
                        <h3>Understand This Commit</h3>
                        <p>
                            Let AI explain what this commit does and why it matters in the context of
                            this project&apos;s evolution.
                        </p>
                        <button
                            className="btn btn-primary"
                            onClick={explainCommit}
                            disabled={loading}
                        >
                            <Sparkles size={16} />
                            Explain This Commit
                        </button>
                    </div>
                )}

                {/* Error State */}
                {error && (
                    <div className={styles.error}>
                        <AlertCircle size={16} />
                        <span>{error}</span>
                        {error === 'AI provider not configured.' && onOpenSettings && (
                            <button className={styles.configureBtn} onClick={onOpenSettings}>
                                Open Settings
                            </button>
                        )}
                        <button
                            className={styles.dismissBtn}
                            onClick={() => setError(null)}
                            title="Dismiss"
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}

                {/* Messages */}
                {hasMessages && (
                    <div className={styles.messages}>
                        {messages.map((message, index) => (
                            <div
                                key={index}
                                className={`${styles.message} ${message.role === 'user' ? styles.userMessage : styles.assistantMessage
                                    }`}
                            >
                                <div className={`${styles.messageContent} ${message.role === 'assistant' ? styles.markdown : ''}`}>
                                    {message.role === 'assistant' ? (
                                        message.content ? (
                                            <ReactMarkdown
                                                remarkPlugins={[remarkGfm]}
                                                rehypePlugins={[rehypeRaw]}
                                                components={{
                                                    a: ({ href, children, ...props }) => {
                                                        const fileReference = extractFileReferenceFromHref(href);

                                                        if (fileReference && onOpenFile && canOpenFileReference(fileReference)) {
                                                            return (
                                                                <button
                                                                    type="button"
                                                                    className={styles.fileLink}
                                                                    onClick={event => {
                                                                        event.preventDefault();
                                                                        event.stopPropagation();
                                                                        onOpenFile(fileReference);
                                                                    }}
                                                                    title={`Open ${fileReference}`}
                                                                >
                                                                    {children}
                                                                </button>
                                                            );
                                                        }

                                                        const isExternal =
                                                            typeof href === 'string' &&
                                                            /^(https?:)?\/\//i.test(href);

                                                        return (
                                                            <a
                                                                {...props}
                                                                href={href}
                                                                target={isExternal ? '_blank' : undefined}
                                                                rel={isExternal ? 'noreferrer noopener' : undefined}
                                                                onClick={event => {
                                                                    if (!isExternal) {
                                                                        event.preventDefault();
                                                                    }
                                                                }}
                                                            >
                                                                {children}
                                                            </a>
                                                        );
                                                    },
                                                    code: ({ className, children, ...props }) => {
                                                        const text = Array.isArray(children)
                                                            ? children.map(child => String(child)).join('')
                                                            : String(children ?? '');
                                                        const cleanText = text.trim();
                                                        const match = /language-(\w+)/.exec(className || '');
                                                        const language = match ? match[1] : '';

                                                        if (language === 'mermaid') {
                                                            return <Mermaid chart={cleanText} />;
                                                        }

                                                        const isCodeBlock = Boolean(className) || cleanText.includes('\n');
                                                        const fileReference = !isCodeBlock
                                                            ? normalizeFileReference(cleanText)
                                                            : null;

                                                        if (fileReference && onOpenFile && canOpenFileReference(fileReference)) {
                                                            return (
                                                                <button
                                                                    type="button"
                                                                    className={styles.inlineFileLink}
                                                                    onClick={() => onOpenFile(fileReference)}
                                                                    title={`Open ${fileReference}`}
                                                                >
                                                                    <code>{cleanText}</code>
                                                                </button>
                                                            );
                                                        }

                                                        return (
                                                            <code className={className} {...props}>
                                                                {children}
                                                            </code>
                                                        );
                                                    },
                                                }}
                                            >
                                                {normalizeAssistantMarkdown(message.content)}
                                            </ReactMarkdown>
                                        ) : streaming && index === messages.length - 1 ? (
                                            <span className={styles.cursor}>▊</span>
                                        ) : null
                                    ) : (
                                        message.content
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                )}

                {/* Loading */}
                {loading && !streaming && (
                    <div className={styles.loading}>
                        <Loader2 size={20} className={styles.spinner} />
                        <span>{loadingVerb}</span>
                        {elapsedTime > 0 && (
                            <span className={styles.timer}>
                                <Clock size={12} />
                                {elapsedTime}s
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Actions */}
            <div className={styles.footer}>
                {hasMessages && (
                    <button
                        className={`btn btn-ghost ${styles.refreshBtn}`}
                        onClick={explainCommit}
                        disabled={loading}
                        title="Re-explain this commit"
                    >
                        <RefreshCw size={16} />
                    </button>
                )}

                <form onSubmit={askQuestion} className={styles.inputForm}>
                    <textarea
                        ref={inputRef}
                        className={styles.input}
                        placeholder="Ask a question..."
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={loading}
                        rows={1}
                    />
                    {loading ? (
                        <button
                            type="button"
                            className={`btn btn-error ${styles.stopBtn}`}
                            onClick={stopGeneration}
                            title="Stop generation"
                        >
                            <Square size={16} fill="currentColor" />
                        </button>
                    ) : (
                        <button
                            type="submit"
                            className={`btn btn-primary ${styles.sendBtn}`}
                            disabled={!input.trim()}
                        >
                            <Send size={16} />
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
}
