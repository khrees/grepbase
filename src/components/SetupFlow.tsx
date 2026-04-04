

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Key, Check, AlertCircle, Loader2, Sparkles, ArrowRight, RefreshCw } from 'lucide-react';
import styles from './SetupFlow.module.css';
import { type AIProviderType, PROVIDER_NAMES, getAvailableModels } from '@/services/ai-providers';
import { api } from '@/lib/api-client';
import {
    useSettingsStore,
    PROVIDERS,
    type ProviderSettings,
} from '@/stores/settings-store';
import { useAICredentials } from '@/hooks/use-ai-credentials';
import { useIngestJob } from '@/hooks/use-ingest-job';

interface SetupFlowProps {
    repoUrl: string;
    onCancel: () => void;
}

type SetupStep = 'config' | 'loading' | 'summary';

import type { RepoData } from '@/types';

export default function SetupFlow({ repoUrl, onCancel }: SetupFlowProps) {
    const router = useRouter();
    const [step, setStep] = useState<SetupStep>('config');

    // Settings from Zustand store
    const {
        settings,
        activeProvider,
        loadFromStorage,
        setActiveProvider,
        updateSetting,
        persist,
    } = useSettingsStore();

    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
    const [testError, setTestError] = useState<string | null>(null);

    // AI credentials from query hook
    const { data: storedCredentials } = useAICredentials();

    // Background fetch state
    const [repoData, setRepoData] = useState<RepoData | null>(null);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [fetchingRepo, setFetchingRepo] = useState(true);
    const [jobId, setJobId] = useState<string | null>(null);
    const fetchStarted = useRef(false);

    // AI Summary state
    const [summary, setSummary] = useState('');
    const [generatingSummary, setGeneratingSummary] = useState(false);
    const summaryAbortRef = useRef<AbortController | null>(null);

    // Use ingest job polling
    const { data: jobData } = useIngestJob(jobId, { enabled: fetchingRepo && !!jobId });

    // Load settings once
    const settingsLoadedRef = useRef(false);
    if (!settingsLoadedRef.current) {
        settingsLoadedRef.current = true;
        loadFromStorage();
    }


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

                if (data.cached && data.repository) {
                    setRepoData(data.repository);
                    setFetchingRepo(false);
                    return;
                }

                if (data.jobId) {
                    setJobId(data.jobId);
                    return;
                }

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

    // React to ingest job polling results — render-phase
    const lastJobStatusRef = useRef<string | null>(null);
    const jobStatus = jobData?.status ?? null;
    if (jobData && jobStatus !== lastJobStatusRef.current) {
        lastJobStatusRef.current = jobStatus;
        const hasProcessedCommits = Number(jobData.processedCommits || 0) > 0;
        const shouldResolve = jobData.status === 'completed' || jobData.ready || hasProcessedCommits;

        if (shouldResolve && (jobData.repository || jobData.repoId)) {
            const resolvedRepo = jobData.repository as RepoData | undefined;
            if (resolvedRepo) {
                Promise.resolve().then(() => {
                    setRepoData(resolvedRepo);
                    setFetchingRepo(false);
                });
            } else if (jobData.repoId) {
                api.get<{ repository: RepoData }>(
                    `/api/repos/${jobData.repoId}/commits?page=1&limit=1`
                ).then(response => {
                    setRepoData(response.repository);
                    setFetchingRepo(false);
                }).catch(() => { /* Retry on next poll */ });
            }
        } else if (jobData.status === 'failed') {
            Promise.resolve().then(() => {
                setFetchError(jobData.error || 'Failed to ingest repository');
                setFetchingRepo(false);
            });
        }
    }

    async function persistEnteredApiKeys(current: Record<AIProviderType, ProviderSettings>): Promise<void> {
        const pendingWrites = PROVIDERS
            .map(provider => ({
                provider,
                apiKey: current[provider].apiKey.trim(),
            }))
            .filter(entry => entry.apiKey.length > 0)
            .map(entry =>
                api.post('/api/ai/credentials', {
                    provider: entry.provider,
                    apiKey: entry.apiKey,
                })
            );

        if (pendingWrites.length === 0) return;
        await Promise.all(pendingWrites);
    }

    async function testConnection() {
        setTesting(true);
        setTestResult(null);
        setTestError(null);

        try {
            const currentSettings = settings[activeProvider];
            const payload: { provider: AIProviderType; baseUrl?: string; apiKey?: string } = {
                provider: activeProvider,
                baseUrl: currentSettings.baseUrl,
            };

            if (currentSettings.apiKey.trim().length > 0) {
                payload.apiKey = currentSettings.apiKey.trim();
            }

            await api.post('/api/test-connection', payload);

            setTestResult('success');
        } catch (err) {
            setTestResult('error');
            setTestError(err instanceof Error ? err.message : 'Connection failed');
        } finally {
            setTesting(false);
        }
    }

    async function saveAndContinue() {
        setSaving(true);
        setTestResult(null);
        setTestError(null);

        try {
            await persistEnteredApiKeys(settings);
            persist();

            setStep('loading');
            generateSummary();
        } catch (error) {
            setTestResult('error');
            setTestError(error instanceof Error ? error.message : 'Failed to save API credentials');
        } finally {
            setSaving(false);
        }
    }

    async function generateSummary() {
        if (!repoData) return;

        setGeneratingSummary(true);
        summaryAbortRef.current?.abort();
        const abortController = new AbortController();
        summaryAbortRef.current = abortController;

        try {
            const currentSettings = settings[activeProvider];
            const response = await api.postStream(`/api/repos/${repoData.id}/summarize`, {
                provider: activeProvider,
                model: currentSettings.model,
                baseUrl: currentSettings.baseUrl,
            }, {
                signal: abortController.signal,
            });

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
            setSummary(`**${repoData.name}** is a project by ${repoData.owner}.\n\n${repoData.description || 'No description available.'}\n\n*AI summary generation failed. Click "View Timeline" to explore the commit history.*`);
            setStep('summary');
        } finally {
            if (summaryAbortRef.current === abortController) {
                setGeneratingSummary(false);
            }
        }
    }

    // Trigger summary when loading step + repo data ready — render-phase
    const summaryTriggeredRef = useRef(false);
    if (step === 'loading' && repoData && !generatingSummary && !summary && !summaryTriggeredRef.current) {
        summaryTriggeredRef.current = true;
        Promise.resolve().then(() => generateSummary());
    }

    function viewTimeline() {
        if (repoData) {
            router.push(`/explore/${repoData.id}/timeline`);
        }
    }

    const currentSettings = settings[activeProvider];
    const models = getAvailableModels(activeProvider);
    const isLocalProvider = activeProvider === 'ollama' || activeProvider === 'lmstudio';
    const hasStoredCredential = Boolean(storedCredentials?.[activeProvider]);
    const canContinue = isLocalProvider || hasStoredCredential || currentSettings.apiKey.trim().length > 10;
    const jobProgress = jobData?.progress ? Number(jobData.progress) : 0;

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
                            {PROVIDERS.map(provider => (
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
                                    {hasStoredCredential && (
                                        <small style={{ color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                                            A stored key is available for this provider in your current session.
                                        </small>
                                    )}
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
                                    disabled={testing}
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
                            onClick={() => void saveAndContinue()}
                            disabled={saving || !canContinue || fetchingRepo}
                        >
                            {saving ? (
                                <>
                                    <RefreshCw size={16} className={styles.spinner} />
                                    Saving...
                                </>
                            ) : fetchingRepo ? (
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
