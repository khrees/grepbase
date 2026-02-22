

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Key, Check, AlertCircle, Loader2, Sparkles, ArrowRight, RefreshCw } from 'lucide-react';
import styles from './SetupFlow.module.css';
import { type AIProviderType, PROVIDER_NAMES, getAvailableModels } from '@/services/ai-providers';
import { secureStorage } from '@/lib/.client/secure-storage';
import { api } from '@/lib/api-client';

interface SetupFlowProps {
    repoUrl: string;
    onCancel: () => void;
}

interface ProviderSettings {
    apiKey: string;
    model: string;
    baseUrl?: string;
}

interface StoredSettings extends Record<AIProviderType, ProviderSettings> {
    activeProvider?: AIProviderType;
}

type SetupStep = 'config' | 'loading' | 'summary';

import type { RepoData } from '@/types';

const STORAGE_KEY = 'ai_settings';

export default function SetupFlow({ repoUrl, onCancel }: SetupFlowProps) {
    const router = useRouter();
    const [step, setStep] = useState<SetupStep>('config');
    const [activeProvider, setActiveProvider] = useState<AIProviderType>('gemini');
    const [settings, setSettings] = useState<Record<AIProviderType, ProviderSettings>>({
        gemini: { apiKey: '', model: 'gemini-3.1-pro' },
        openai: { apiKey: '', model: 'gpt-5.2' },
        anthropic: { apiKey: '', model: 'claude-sonnet-4.6' },
        ollama: { apiKey: '', model: 'llama-4-scout', baseUrl: 'http://localhost:11434/v1' },
        lmstudio: { apiKey: '', model: 'deepseek-r1-distill-llama-8b', baseUrl: 'http://127.0.0.1:1234/v1' },
        glm: { apiKey: '', model: 'glm-5', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/' },
        kimi: { apiKey: '', model: 'kimi-k2.5', baseUrl: 'https://api.moonshot.cn/v1' },
    });
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
    const [testError, setTestError] = useState<string | null>(null);

    // Background fetch state
    const [repoData, setRepoData] = useState<RepoData | null>(null);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [fetchingRepo, setFetchingRepo] = useState(true);
    const [jobId, setJobId] = useState<string | null>(null);
    const [jobProgress, setJobProgress] = useState(0);
    const fetchStarted = useRef(false);

    // AI Summary state
    const [summary, setSummary] = useState('');
    const [generatingSummary, setGeneratingSummary] = useState(false);
    const summaryAbortRef = useRef<AbortController | null>(null);

    // Load settings from secure storage and start fetching repo
    useEffect(() => {
        const sessionData = secureStorage.getSessionItem<StoredSettings>(STORAGE_KEY);
        if (sessionData) {
            setSettings(prev => ({ ...prev, ...sessionData }));
            if (sessionData.activeProvider) setActiveProvider(sessionData.activeProvider);
            return;
        }
        // Load from encrypted storage (async)
        secureStorage.getSecureItem<StoredSettings>(STORAGE_KEY).then(saved => {
            if (saved) {
                setSettings(prev => ({ ...prev, ...saved }));
                if (saved.activeProvider) setActiveProvider(saved.activeProvider);
                secureStorage.setSessionItem(STORAGE_KEY, saved);
            }
        });
    }, []);

    useEffect(() => {
        return () => {
            summaryAbortRef.current?.abort();
        };
    }, []);

    // Start background repo fetch immediately
    useEffect(() => {
        if (fetchStarted.current) return;
        fetchStarted.current = true;

        async function fetchRepo() {
            try {
                const data = await api.post<{
                    repository?: RepoData;
                    jobId?: string;
                    status?: string;
                    cached?: boolean;
                }>('/api/repos', { url: repoUrl });

                // If cached, we have the data immediately
                if (data.cached && data.repository) {
                    setRepoData(data.repository);
                    setFetchingRepo(false);
                    return;
                }

                // If queued, start polling for status
                if (data.jobId) {
                    setJobId(data.jobId);
                    // Polling will be handled by separate effect
                    return;
                }

                // Fallback: direct response (shouldn't happen with new queue system)
                if (data.repository) {
                    setRepoData(data.repository);
                    setFetchingRepo(false);
                }
            } catch (err) {
                setFetchError(err instanceof Error ? err.message : 'Failed to fetch repository');
                setFetchingRepo(false);
            }
        }

        fetchRepo();
    }, [repoUrl]);

    // Poll for job status
    useEffect(() => {
        if (!jobId) return;

        const pollInterval = setInterval(async () => {
            try {
                const response = await api.get<{
                    job: {
                        status: string;
                        progress: number;
                        error?: string;
                        repository?: RepoData;
                    };
                }>(`/api/jobs/${jobId}`);
                const data = response.job;

                setJobProgress(data.progress);

                if (data.status === 'completed' && data.repository) {
                    setRepoData(data.repository);
                    setFetchingRepo(false);
                    clearInterval(pollInterval);
                } else if (data.status === 'failed') {
                    setFetchError(data.error || 'Failed to ingest repository');
                    setFetchingRepo(false);
                    clearInterval(pollInterval);
                }
            } catch (err) {
                console.error('Failed to poll job status:', err);
            }
        }, 2000); // Poll every 2 seconds

        return () => clearInterval(pollInterval);
    }, [jobId]);

    function updateSetting(provider: AIProviderType, key: keyof ProviderSettings, value: string) {
        setSettings(prev => ({
            ...prev,
            [provider]: {
                ...prev[provider],
                [key]: value,
            },
        }));
        setTestResult(null);
    }

    async function testConnection() {
        setTesting(true);
        setTestResult(null);
        setTestError(null);

        try {
            const currentSettings = settings[activeProvider];
            const isLocalProvider = activeProvider === 'ollama' || activeProvider === 'lmstudio';

            if (!isLocalProvider && !currentSettings.apiKey) {
                throw new Error('API key is required');
            }

            await api.post('/api/test-connection', {
                provider: activeProvider,
                baseUrl: currentSettings.baseUrl,
                apiKey: currentSettings.apiKey,
            });

            setTestResult('success');
        } catch (err) {
            setTestResult('error');
            setTestError(err instanceof Error ? err.message : 'Connection failed');
        } finally {
            setTesting(false);
        }
    }

    function saveAndContinue() {
        // Save settings to secure storage
        const data = {
            ...settings,
            activeProvider,
        };

        secureStorage.setSessionItem(STORAGE_KEY, data);
        secureStorage.setSecureItem(STORAGE_KEY, data);

        // Move to loading/summary step
        setStep('loading');
        generateSummary();
    }

    async function generateSummary() {
        if (!repoData) {
            // Wait for repo data
            return;
        }

        setGeneratingSummary(true);
        summaryAbortRef.current?.abort();
        const abortController = new AbortController();
        summaryAbortRef.current = abortController;

        try {
            const currentSettings = settings[activeProvider];
            const response = await api.postStream(`/api/repos/${repoData.id}/summarize`, {
                provider: activeProvider,
                apiKey: currentSettings.apiKey,
                model: currentSettings.model,
                baseUrl: currentSettings.baseUrl,
            }, {
                signal: abortController.signal,
            });

            // Handle streaming response
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const text = decoder.decode(value, { stream: true });
                    setSummary(prev => prev + text);
                }
            }

            setStep('summary');
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                return;
            }
            console.error('Summary generation failed:', err);
            // Fall back to a basic summary
            setSummary(`**${repoData.name}** is a project by ${repoData.owner}.\n\n${repoData.description || 'No description available.'}\n\n*AI summary generation failed. Click "View Timeline" to explore the commit history.*`);
            setStep('summary');
        } finally {
            if (summaryAbortRef.current === abortController) {
                setGeneratingSummary(false);
            }
        }
    }

    // Wait for repo if in loading step and repo data arrives
    useEffect(() => {
        if (step === 'loading' && repoData && !generatingSummary && !summary) {
            generateSummary();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, repoData, generatingSummary, summary]);

    function viewTimeline() {
        if (repoData) {
            router.push(`/explore/${repoData.id}/timeline`);
        }
    }

    const providers: AIProviderType[] = ['gemini', 'openai', 'anthropic', 'ollama', 'lmstudio', 'glm', 'kimi'];
    const currentSettings = settings[activeProvider];
    const models = getAvailableModels(activeProvider);
    const isLocalProvider = activeProvider === 'ollama' || activeProvider === 'lmstudio';
    const canContinue = isLocalProvider || (currentSettings.apiKey && currentSettings.apiKey.length > 10);

    // Show error state if fetch failed
    if (fetchError && step === 'config') {
        return (
            <div className={styles.overlay}>
                <div className={styles.modal}>
                    <div className={styles.errorState}>
                        <AlertCircle size={48} />
                        <h2>Failed to fetch repository</h2>
                        <p>{fetchError}</p>
                        <div className={styles.errorActions}>
                            <button className="btn btn-secondary" onClick={onCancel}>
                                Go Back
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Config step
    if (step === 'config') {
        return (
            <div className={styles.overlay}>
                <div className={styles.modal}>
                    <div className={styles.header}>
                        <div className={styles.headerContent}>
                            <Sparkles size={24} className={styles.headerIcon} />
                            <div>
                                <h2>Configure AI Provider</h2>
                                <p className={styles.headerSub}>
                                    {fetchingRepo
                                        ? jobId
                                            ? `Processing repository... ${jobProgress}%`
                                            : 'Fetching repository...'
                                        : `Ready to analyze ${repoData?.owner}/${repoData?.name}`}
                                </p>
                            </div>
                        </div>
                        {fetchingRepo && <Loader2 size={20} className={styles.fetchingSpinner} />}
                    </div>

                    <div className={styles.content}>
                        {/* Provider Tabs */}
                        <div className={styles.tabs}>
                            {providers.map(provider => (
                                <button
                                    key={provider}
                                    className={`${styles.tab} ${activeProvider === provider ? styles.tabActive : ''}`}
                                    onClick={() => {
                                        setActiveProvider(provider);
                                        setTestResult(null);
                                    }}
                                >
                                    {PROVIDER_NAMES[provider]}
                                </button>
                            ))}
                        </div>

                        {/* Settings Form */}
                        <div className={styles.form}>
                            {!isLocalProvider ? (
                                <div className={styles.field}>
                                    <label className={styles.label}>
                                        <Key size={14} />
                                        API Key
                                    </label>
                                    <input
                                        type="password"
                                        className="input"
                                        placeholder={`Enter your ${PROVIDER_NAMES[activeProvider]} API key`}
                                        value={currentSettings.apiKey}
                                        onChange={e => updateSetting(activeProvider, 'apiKey', e.target.value)}
                                    />
                                </div>
                            ) : (
                                <div className={styles.field}>
                                    <label className={styles.label}>Base URL</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder={activeProvider === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : 'http://localhost:11434/v1'}
                                        value={currentSettings.baseUrl || ''}
                                        onChange={e => updateSetting(activeProvider, 'baseUrl', e.target.value)}
                                    />
                                </div>
                            )}

                            <div className={styles.field}>
                                <label className={styles.label}>Model</label>
                                <select
                                    className="input"
                                    value={currentSettings.model}
                                    onChange={e => updateSetting(activeProvider, 'model', e.target.value)}
                                >
                                    {models.map(model => (
                                        <option key={model} value={model}>
                                            {model}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Test Connection */}
                            <div className={styles.testRow}>
                                <button
                                    className={`btn btn-secondary ${styles.testBtn}`}
                                    onClick={testConnection}
                                    disabled={testing || (!isLocalProvider && !currentSettings.apiKey)}
                                >
                                    {testing ? (
                                        <>
                                            <Loader2 size={16} className={styles.spinner} />
                                            Testing...
                                        </>
                                    ) : (
                                        'Test Connection'
                                    )}
                                </button>
                                {testResult === 'success' && (
                                    <span className={styles.testSuccess}>
                                        <Check size={16} />
                                        Connected!
                                    </span>
                                )}
                                {testResult === 'error' && (
                                    <span className={styles.testError}>
                                        <AlertCircle size={16} />
                                        {testError || 'Connection failed'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className={styles.footer}>
                        <button className="btn btn-secondary" onClick={onCancel}>
                            Cancel
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={saveAndContinue}
                            disabled={!canContinue || fetchingRepo}
                        >
                            {fetchingRepo ? (
                                <>
                                    <RefreshCw size={16} className={styles.spinner} />
                                    Fetching...
                                </>
                            ) : (
                                <>
                                    Continue
                                    <ArrowRight size={16} />
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Loading step
    if (step === 'loading') {
        return (
            <div className={styles.overlay}>
                <div className={styles.loadingState}>
                    <div className={styles.loadingAnimation}>
                        <Sparkles size={48} className={styles.loadingIcon} />
                    </div>
                    <h2>Analyzing Repository</h2>
                    <p className={styles.loadingText}>
                        {fetchingRepo ? 'Fetching repository data...' : 'Generating AI summary...'}
                    </p>
                    <div className={styles.loadingProgress}>
                        <div className={styles.loadingBar} />
                    </div>
                </div>
            </div>
        );
    }

    // Summary step
    return (
        <div className={styles.overlay}>
            <div className={styles.summaryModal}>
                <div className={styles.summaryHeader}>
                    <div className={styles.repoTitle}>
                        <h1>{repoData?.owner}/{repoData?.name}</h1>
                        {repoData?.description && (
                            <p className={styles.repoDescription}>{repoData.description}</p>
                        )}
                    </div>
                </div>

                <div className={styles.summaryContent}>
                    <div className={styles.summaryText}>
                        {summary.split('\n').map((line, i) => {
                            if (line.startsWith('**') && line.endsWith('**')) {
                                return <h3 key={i}>{line.replace(/\*\*/g, '')}</h3>;
                            }
                            if (line.startsWith('- ')) {
                                return <li key={i}>{line.substring(2)}</li>;
                            }
                            if (line.trim()) {
                                return <p key={i}>{line}</p>;
                            }
                            return <br key={i} />;
                        })}
                    </div>
                </div>

                <div className={styles.summaryFooter}>
                    <button className="btn btn-secondary" onClick={onCancel}>
                        Back to Home
                    </button>
                    <button className="btn btn-primary" onClick={viewTimeline}>
                        View Timeline
                        <ArrowRight size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
