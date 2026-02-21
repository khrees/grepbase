

import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, Send, Loader2, AlertCircle, RefreshCw, X, Clock, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import styles from './AIPanel.module.css';
import { getAISettings, getAutoExplainEnabled } from './SettingsModal';
import { api } from '@/lib/api-client';

interface AIPanelProps {
    repository: {
        id: number;
        name: string;
        owner: string;
        description: string | null;
    };
    commit: {
        sha: string;
        message: string;
        authorName: string | null;
        date: string;
    };
    totalCommits: number;
    currentIndex: number;
}

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

export default function AIPanel({ repository, commit }: AIPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [streaming, setStreaming] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const explainCommit = useCallback(async () => {
        const settings = getAISettings();
        if (!settings) {
            setError('Please configure your AI settings first (click the Settings button)');
            return;
        }

        // Cancel previous request if any
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        setLoading(true);
        setError(null);
        setMessages([]);
        setElapsedTime(0);

        // Start timer
        const startTime = Date.now();
        timerRef.current = setInterval(() => {
            setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);

        try {
            const response = await api.postStream('/api/explain', {
                type: 'commit',
                repoId: repository.id,
                commitSha: commit.sha,
                provider: {
                    type: settings.provider,
                    apiKey: settings.config.apiKey,
                    baseUrl: settings.config.baseUrl,
                    model: settings.config.model,
                },
            });

            // Handle streaming response
            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            setStreaming(true);
            setMessages([{ role: 'assistant', content: '' }]);

            const decoder = new TextDecoder();
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                fullText += chunk;

                setMessages([{ role: 'assistant', content: fullText }]);
            }

            setStreaming(false);
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                // Request was cancelled, don't show error
                return;
            }
            const message = err instanceof Error ? err.message : 'Something went wrong';
            // Provide helpful hints for common errors
            if (message.includes('fetch')) {
                setError('Connection failed. Is your AI provider running?');
            } else if (message.includes('API key')) {
                setError('Invalid API key. Check your settings.');
            } else {
                setError(message);
            }
        } finally {
            setLoading(false);
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        }
    }, [commit.sha, repository.id]);

    // Reset messages when commit changes
    useEffect(() => {
        // Cancel any in-flight request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        setMessages([]);
        setError(null);
        setElapsedTime(0);

        // Auto-explain if enabled
        if (getAutoExplainEnabled()) {
            explainCommit();
        }
    }, [commit.sha, explainCommit]);

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    async function askQuestion(e: React.FormEvent) {
        e.preventDefault();
        if (!input.trim() || loading) return;

        const settings = getAISettings();
        if (!settings) {
            setError('Please configure your AI settings first');
            return;
        }

        const question = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: question }]);
        setLoading(true);
        setError(null);

        // Cancel previous request if any
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        try {
            const response = await api.postStream('/api/explain', {
                type: 'question',
                repoId: repository.id,
                commitSha: commit.sha,
                question,
                provider: {
                    type: settings.provider,
                    apiKey: settings.config.apiKey,
                    baseUrl: settings.config.baseUrl,
                    model: settings.config.model,
                },
            });

            // Handle streaming response
            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            setStreaming(true);
            setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

            const decoder = new TextDecoder();
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                fullText += chunk;

                setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = { role: 'assistant', content: fullText };
                    return newMessages;
                });
            }

            setStreaming(false);
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                // Request was cancelled
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
                <span>AI Assistant</span>
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
                                            <ReactMarkdown>{message.content}</ReactMarkdown>
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
                        <span>Generating...</span>
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
                    <input
                        ref={inputRef}
                        type="text"
                        className={styles.input}
                        placeholder="Ask a question..."
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        disabled={loading}
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
