import { useState, useRef, useEffect } from 'react';
import {
    X,
    Key,
    Check,
    AlertCircle,
    Loader2,
    Zap,
    GitBranch,
    Settings,
    Lock,
    Eye,
    EyeOff,
    HelpCircle,
    Terminal,
    Filter,
} from 'lucide-react';
import styles from './SettingsModal.module.css';
import { type AIProviderType, PROVIDER_NAMES, getAvailableModels, MODEL_DESCRIPTIONS } from '@/services/ai-providers';
import { api } from '@/lib/api-client';
import { fireToast } from '@/stores/toast-store';
import { useGithubToken } from '@/hooks/use-github-token';
import {
    useSettingsStore,
    PROVIDERS,
    type ProviderSettings,
} from '@/stores/settings-store';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type TabType = 'ai' | 'github' | 'preferences';

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const {
        settings,
        activeProvider,
        autoExplain,
        onlyChangedFiles,
        loadFromStorage,
        setActiveProvider,
        updateSetting,
        setAutoExplain,
        setOnlyChangedFiles,
        persist,
        clearKeys,
    } = useSettingsStore();

    const { data: hasStoredGithubToken, refetch: refetchGithubTokenStatus } = useGithubToken();

    // Tab state
    const [activeTab, setActiveTab] = useState<TabType>('ai');

    // GitHub token states
    const [enteredGithubToken, setEnteredGithubToken] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [isGithubTokenCleared, setIsGithubTokenCleared] = useState(false);
    
    // GitHub verification states
    const [isVerifyingGithub, setIsVerifyingGithub] = useState(false);
    const [githubVerifyResult, setGithubVerifyResult] = useState<'success' | 'error' | null>(null);
    const [githubVerifyError, setGithubVerifyError] = useState<string | null>(null);
    const [githubVerifyStats, setGithubVerifyStats] = useState<{
        username: string;
        avatar: string;
        limit: string;
        remaining: string;
        scopes: string;
    } | null>(null);

    // AI Provider states
    const [detectedModels, setDetectedModels] = useState<Partial<Record<AIProviderType, string[]>>>({});
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
    const [testError, setTestError] = useState<string | null>(null);

    // Load settings once
    useEffect(() => {
        loadFromStorage();
    }, [loadFromStorage]);

    // Reset local state when modal closes/opens
    useEffect(() => {
        if (!isOpen) {
            setEnteredGithubToken('');
            setGithubVerifyResult(null);
            setGithubVerifyStats(null);
            setGithubVerifyError(null);
            setIsGithubTokenCleared(false);
            setTestResult(null);
            setTestError(null);
        }
    }, [isOpen]);

    async function getModelsForProvider(provider: AIProviderType, baseUrl?: string): Promise<string[]> {
        try {
            const currentSettings = settings[provider];
            const data = await api.post<{ models?: string[] }>('/api/test-connection', {
                provider,
                baseUrl: baseUrl || currentSettings?.baseUrl,
                apiKey: currentSettings?.apiKey?.trim() || undefined,
            });
            if (data.models && data.models.length > 0) {
                return data.models;
            }
        } catch {
            // Ignore failure
        }
        return [];
    }

    // Auto-detect installed models for local providers when modal opens or provider changes
    useEffect(() => {
        if (!isOpen) return;

        if (activeProvider === 'ollama' || activeProvider === 'lmstudio') {
            const baseUrl = settings[activeProvider].baseUrl;
            getModelsForProvider(activeProvider, baseUrl).then(models => {
                if (models.length > 0) {
                    setDetectedModels(prev => ({
                        ...prev,
                        [activeProvider]: models,
                    }));
                    const currentModel = settings[activeProvider].model;
                    if (!models.includes(currentModel)) {
                        updateSetting(activeProvider, 'model', models[0]);
                    }
                }
            });
        }
    }, [isOpen, activeProvider, settings, updateSetting]);

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

    async function saveSettings() {
        setSaving(true);
        setTestResult(null);
        setTestError(null);

        try {
            // 1. Save AI Keys
            await persistEnteredApiKeys(settings);

            // 2. Save GitHub token if changed or cleared
            if (enteredGithubToken.trim().length > 0 || isGithubTokenCleared) {
                await api.post('/api/github/token', {
                    token: enteredGithubToken.trim(),
                });
                await refetchGithubTokenStatus();
            }

            // 3. Persist local storage settings
            persist();
            clearKeys();
            setEnteredGithubToken('');
            setIsGithubTokenCleared(false);

            fireToast('Settings updated successfully', 'success', 3000);
            onClose();
        } catch (error) {
            setTestResult('error');
            setTestError(error instanceof Error ? error.message : 'Failed to save secure settings');
        } finally {
            setSaving(false);
        }
    }

    async function testConnection() {
        setTesting(true);
        setTestResult(null);
        setTestError(null);

        try {
            const currentSettings = settings[activeProvider];
            const discoveredModels = await getModelsForProvider(activeProvider, currentSettings.baseUrl);

            if (discoveredModels.length > 0) {
                setTestResult('success');
                setDetectedModels(prev => ({
                    ...prev,
                    [activeProvider]: discoveredModels,
                }));

                const currentModel = currentSettings.model;
                const nextModel = discoveredModels.includes(currentModel)
                    ? currentModel
                    : discoveredModels[0];

                updateSetting(activeProvider, 'model', nextModel);
                setTestError(`Found ${discoveredModels.length} installed model(s): ${discoveredModels.slice(0, 3).join(', ')}${discoveredModels.length > 3 ? '...' : ''}`);
            } else {
                setTestResult('error');
                const targetUrl = currentSettings.baseUrl || (activeProvider === 'ollama' ? 'http://localhost:11434' : 'http://127.0.0.1:1234');
                setTestError(`Could not detect installed models. Ensure ${PROVIDER_NAMES[activeProvider]} is running at ${targetUrl}`);
            }
        } catch (error) {
            setTestResult('error');
            setTestError(error instanceof Error ? error.message : 'Connection failed');
        } finally {
            setTesting(false);
        }
    }

    async function verifyGithubToken() {
        const tokenToTest = enteredGithubToken.trim();
        if (!tokenToTest) {
            setGithubVerifyResult('error');
            setGithubVerifyError('Please enter a GitHub access token.');
            return;
        }

        setIsVerifyingGithub(true);
        setGithubVerifyResult(null);
        setGithubVerifyError(null);
        setGithubVerifyStats(null);

        try {
            const res = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `token ${tokenToTest}`,
                    'Accept': 'application/vnd.github.v3+json',
                },
            });

            if (!res.ok) {
                if (res.status === 401) {
                    throw new Error('Invalid token: Unauthorized (401)');
                }
                throw new Error(`GitHub API returned status ${res.status} ${res.statusText}`);
            }

            const data = await res.json() as { login: string; avatar_url: string };
            const limit = res.headers.get('x-ratelimit-limit') || '5000';
            const remaining = res.headers.get('x-ratelimit-remaining') || '5000';
            const scopes = res.headers.get('x-oauth-scopes') || 'none';

            setGithubVerifyResult('success');
            setGithubVerifyStats({
                username: data.login,
                avatar: data.avatar_url,
                limit,
                remaining,
                scopes,
            });
        } catch (error) {
            setGithubVerifyResult('error');
            setGithubVerifyError(error instanceof Error ? error.message : 'Connection failed');
        } finally {
            setIsVerifyingGithub(false);
        }
    }

    function clearGithubToken() {
        setEnteredGithubToken('');
        setIsGithubTokenCleared(true);
        setGithubVerifyResult(null);
        setGithubVerifyStats(null);
        fireToast('Token marked for deletion. Click Save to apply.', 'info', 3000);
    }

    // Close on Escape key
    useEffect(() => {
        if (!isOpen) return;
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const currentSettings = settings[activeProvider];
    const models = detectedModels[activeProvider] || getAvailableModels(activeProvider);
    const isLocal = activeProvider === 'ollama' || activeProvider === 'lmstudio';

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div 
                className={styles.modal} 
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Settings"
            >
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.titleArea}>
                        <Settings size={20} className={styles.headerIcon} />
                        <h2>Workspace Settings</h2>
                    </div>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close settings">
                        <X size={18} />
                    </button>
                </div>

                {/* Body container with Sidebar + Main Panel layout */}
                <div className={styles.body}>
                    {/* Left Sidebar */}
                    <div className={styles.sidebar}>
                        <button
                            className={`${styles.sidebarBtn} ${activeTab === 'ai' ? styles.sidebarBtnActive : ''}`}
                            onClick={() => setActiveTab('ai')}
                        >
                            <Key size={16} />
                            <span>AI Provider</span>
                        </button>
                        <button
                            className={`${styles.sidebarBtn} ${activeTab === 'github' ? styles.sidebarBtnActive : ''}`}
                            onClick={() => setActiveTab('github')}
                        >
                            <GitBranch size={16} />
                            <span>GitHub Auth</span>
                            {hasStoredGithubToken && !isGithubTokenCleared && (
                                <span className={styles.activeDot} title="Token loaded" />
                            )}
                        </button>
                        <button
                            className={`${styles.sidebarBtn} ${activeTab === 'preferences' ? styles.sidebarBtnActive : ''}`}
                            onClick={() => setActiveTab('preferences')}
                        >
                            <Zap size={16} />
                            <span>Preferences</span>
                        </button>
                    </div>

                    {/* Right Main Panel */}
                    <div className={styles.mainContent}>
                        {/* Tab Content: AI Provider */}
                        {activeTab === 'ai' && (
                            <div className={styles.tabSection}>
                                <div className={styles.sectionTitle}>
                                    <h3>Language Models</h3>
                                    <p>Configure provider details. Your credentials are sent encrypted and retained server-side in secure session memory.</p>
                                </div>

                                <div className={styles.providerGrid}>
                                    {PROVIDERS.map(p => (
                                        <button
                                            key={p}
                                            className={`${styles.providerCard} ${activeProvider === p ? styles.providerCardActive : ''}`}
                                            onClick={() => {
                                                setActiveProvider(p);
                                                setTestResult(null);
                                                setTestError(null);
                                            }}
                                        >
                                            <div className={styles.providerCardContent}>
                                                <span className={styles.providerName}>{PROVIDER_NAMES[p]}</span>
                                            </div>
                                            {activeProvider === p && <span className={styles.providerCheck}><Check size={12} /></span>}
                                        </button>
                                    ))}
                                </div>

                                <div className={styles.formGroup}>
                                    {!isLocal ? (
                                        <div className={styles.field}>
                                            <label className={styles.fieldLabel}>
                                                <Lock size={12} />
                                                <span>API Access Key</span>
                                            </label>
                                            <input
                                                type="password"
                                                className={styles.inputField}
                                                placeholder={`Enter your secret ${PROVIDER_NAMES[activeProvider]} key`}
                                                value={currentSettings.apiKey}
                                                onChange={e => {
                                                    updateSetting(activeProvider, 'apiKey', e.target.value);
                                                    setTestResult(null);
                                                }}
                                                autoComplete="off"
                                            />
                                            <span className={styles.helperText}>
                                                Leave empty to continue using your previously saved key.
                                            </span>
                                        </div>
                                    ) : (
                                        <div className={styles.field}>
                                            <label className={styles.fieldLabel}>Local Endpoint URL</label>
                                            <input
                                                type="text"
                                                className={styles.inputField}
                                                placeholder={activeProvider === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : 'http://localhost:11434/v1'}
                                                value={currentSettings.baseUrl || ''}
                                                onChange={e => {
                                                    updateSetting(activeProvider, 'baseUrl', e.target.value);
                                                    setTestResult(null);
                                                }}
                                            />
                                        </div>
                                    )}

                                    {isLocal && (
                                        <div className={styles.field}>
                                            <label className={styles.fieldLabel}>Local Model Identifier</label>
                                            <input
                                                type="text"
                                                className={styles.inputField}
                                                placeholder="e.g., deepseek-r1:8b, qwen2.5:7b"
                                                value={currentSettings.model}
                                                onChange={e => {
                                                    updateSetting(activeProvider, 'model', e.target.value);
                                                    setTestResult(null);
                                                }}
                                            />
                                        </div>
                                    )}

                                    <div className={styles.field}>
                                        <label className={styles.fieldLabel}>
                                            <span>Model Selection ({PROVIDER_NAMES[activeProvider]})</span>
                                        </label>
                                        <select
                                            className={styles.selectField}
                                            value={currentSettings.model}
                                            onChange={e => {
                                                updateSetting(activeProvider, 'model', e.target.value);
                                                setTestResult(null);
                                            }}
                                        >
                                            {models.map(model => (
                                                <option key={model} value={model}>
                                                    {model}{MODEL_DESCRIPTIONS[model] ? ` \u2014 ${MODEL_DESCRIPTIONS[model]}` : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Test Connection Action */}
                                    <div className={styles.testActionBlock}>
                                        <button
                                            type="button"
                                            className={styles.testButton}
                                            onClick={testConnection}
                                            disabled={testing}
                                        >
                                            {testing ? (
                                                <>
                                                    <Loader2 size={14} className={styles.spinner} />
                                                    <span>Testing API connection...</span>
                                                </>
                                            ) : (
                                                <span>Verify Provider Connection</span>
                                            )}
                                        </button>

                                        {testResult === 'success' && (
                                            <div className={`${styles.statusBadge} ${styles.badgeSuccess}`}>
                                                <Check size={14} />
                                                <span>Connection verified. {testError}</span>
                                            </div>
                                        )}

                                        {testResult === 'error' && (
                                            <div className={`${styles.statusBadge} ${styles.badgeError}`}>
                                                <AlertCircle size={14} />
                                                <span>{testError || 'Failed to authenticate.'}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Tab Content: GitHub Auth */}
                        {activeTab === 'github' && (
                            <div className={styles.tabSection}>
                                <div className={styles.sectionTitle}>
                                    <h3>GitHub Access Token</h3>
                                    <p>Configure a Personal Access Token (PAT) to override public rate limits (60/hr) with your individual quota (5,000/hr).</p>
                                </div>

                                {/* Active Token Status Card */}
                                <div className={styles.tokenStatusCard}>
                                    <div className={styles.statusLabel}>Current Server Quota:</div>
                                    {hasStoredGithubToken && !isGithubTokenCleared ? (
                                        <div className={styles.statusActiveBadge}>
                                            <span className={styles.pulsingDot} />
                                            <span>Personal Access Token Active (5,000 requests/hour limit)</span>
                                        </div>
                                    ) : (
                                        <div className={styles.statusInactiveBadge}>
                                            <span>Unauthenticated / Shared Rate Limit (60 requests/hour limit)</span>
                                        </div>
                                    )}
                                </div>

                                <div className={styles.formGroup}>
                                    <div className={styles.field}>
                                        <label className={styles.fieldLabel}>
                                            <GitBranch size={12} />
                                            <span>GitHub Personal Access Token (PAT)</span>
                                        </label>
                                        <div className={styles.passwordWrapper}>
                                            <input
                                                type={showToken ? 'text' : 'password'}
                                                className={styles.inputField}
                                                placeholder={hasStoredGithubToken && !isGithubTokenCleared ? '••••••••••••••••••••••••••••••••••••' : 'ghp_... or github_pat_...'}
                                                value={enteredGithubToken}
                                                onChange={e => {
                                                    setEnteredGithubToken(e.target.value);
                                                    setGithubVerifyResult(null);
                                                    setGithubVerifyStats(null);
                                                    setIsGithubTokenCleared(false);
                                                }}
                                                autoComplete="off"
                                            />
                                            <button
                                                type="button"
                                                className={styles.passwordToggle}
                                                onClick={() => setShowToken(!showToken)}
                                            >
                                                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                                            </button>
                                        </div>

                                        <div className={styles.tokenInstructions}>
                                            <HelpCircle size={14} className={styles.helpIcon} />
                                            <span>
                                                Need a token? Create a fine-grained token with <strong>metadata: read</strong> and <strong>contents: read</strong> repository scopes, or a classic token with <strong>repo</strong> scope.{' '}
                                                <a
                                                    href="https://github.com/settings/tokens"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className={styles.docsLink}
                                                >
                                                    Generate GitHub PAT
                                                </a>
                                            </span>
                                        </div>
                                    </div>

                                    {/* Verification and Delete actions */}
                                    <div className={styles.actionsFlex}>
                                        <button
                                            type="button"
                                            className={styles.testButton}
                                            onClick={verifyGithubToken}
                                            disabled={isVerifyingGithub || !enteredGithubToken.trim()}
                                        >
                                            {isVerifyingGithub ? (
                                                <>
                                                    <Loader2 size={14} className={styles.spinner} />
                                                    <span>Checking scopes...</span>
                                                </>
                                            ) : (
                                                <span>Validate & Inspect Token</span>
                                            )}
                                        </button>

                                        {hasStoredGithubToken && !isGithubTokenCleared && (
                                            <button
                                                type="button"
                                                className={styles.deleteTokenBtn}
                                                onClick={clearGithubToken}
                                            >
                                                Clear Saved Token
                                            </button>
                                        )}
                                    </div>

                                    {/* Verification Console Signature */}
                                    {(githubVerifyResult || isVerifyingGithub) && (
                                        <div className={styles.terminalConsole}>
                                            <div className={styles.terminalHeader}>
                                                <Terminal size={12} />
                                                <span>github-auth-debugger</span>
                                                <div className={styles.terminalDots}>
                                                    <span className={styles.dotRed} />
                                                    <span className={styles.dotYellow} />
                                                    <span className={styles.dotGreen} />
                                                </div>
                                            </div>
                                            <div className={styles.terminalBody}>
                                                {isVerifyingGithub && (
                                                    <div className={styles.terminalLog}>
                                                        <span className={styles.logPrompt}>$</span> curl -I https://api.github.com/user
                                                        <br />
                                                        <span className={styles.logText}>&gt; Verifying access credentials...</span>
                                                    </div>
                                                )}

                                                {githubVerifyResult === 'error' && (
                                                    <div className={styles.terminalLog}>
                                                        <span className={styles.logPrompt}>$</span> curl -I https://api.github.com/user
                                                        <br />
                                                        <span className={styles.logError}>&gt; Error: {githubVerifyError}</span>
                                                    </div>
                                                )}

                                                {githubVerifyResult === 'success' && githubVerifyStats && (
                                                    <div className={styles.terminalLog}>
                                                        <span className={styles.logPrompt}>$</span> curl -I https://api.github.com/user
                                                        <br />
                                                        <span className={styles.logSuccess}>&gt; Status: 200 OK</span>
                                                        <br />
                                                        <div className={styles.inspectUserCard}>
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img src={githubVerifyStats.avatar} alt={githubVerifyStats.username} className={styles.userAvatar} />
                                                            <div>
                                                                <span className={styles.userLogin}>@{githubVerifyStats.username}</span>
                                                                <span className={styles.userLimits}>Rate limits: {githubVerifyStats.remaining} / {githubVerifyStats.limit}</span>
                                                            </div>
                                                        </div>
                                                        <span className={styles.logLabel}>Token Scopes:</span>{' '}
                                                        <span className={styles.logScopes}>{githubVerifyStats.scopes}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Tab Content: Preferences */}
                        {activeTab === 'preferences' && (
                            <div className={styles.tabSection}>
                                <div className={styles.sectionTitle}>
                                    <h3>User Preferences</h3>
                                    <p>Adjust system configurations to customize your repository exploration workflow.</p>
                                </div>

                                <div className={styles.preferenceItem}>
                                    <div className={styles.prefText}>
                                        <div className={styles.prefTitle}>
                                            <Zap size={14} className={styles.prefTitleIcon} />
                                            <span>Auto-explain commits</span>
                                        </div>
                                        <p className={styles.prefDesc}>Instructs AI to automatically run explanation prompts whenever you click on a commit in the timeline.</p>
                                    </div>
                                    <label className={styles.customToggle}>
                                        <input
                                            type="checkbox"
                                            checked={autoExplain}
                                            onChange={e => setAutoExplain(e.target.checked)}
                                        />
                                        <span className={styles.customToggleSlider} />
                                    </label>
                                </div>

                                <div className={styles.preferenceItem}>
                                    <div className={styles.prefText}>
                                        <div className={styles.prefTitle}>
                                            <Filter size={14} className={styles.prefTitleIcon} />
                                            <span>Only show changed files in Explore</span>
                                        </div>
                                        <p className={styles.prefDesc}>Restricts the sidebar file tree in Explore to display only files and folders modified, added, or created in the selected commit.</p>
                                    </div>
                                    <label className={styles.customToggle}>
                                        <input
                                            type="checkbox"
                                            checked={onlyChangedFiles}
                                            onChange={e => setOnlyChangedFiles(e.target.checked)}
                                        />
                                        <span className={styles.customToggleSlider} />
                                    </label>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className={styles.footer}>
                    {testResult === 'error' && (
                        <span className={styles.footerSaveError}>
                            <AlertCircle size={14} />
                            {testError}
                        </span>
                    )}
                    <button className={styles.cancelBtn} onClick={onClose} disabled={saving}>
                        Cancel
                    </button>
                    <button className={styles.saveBtn} onClick={saveSettings} disabled={saving}>
                        {saving ? (
                            <>
                                <Loader2 size={14} className={styles.spinner} />
                                <span>Saving settings...</span>
                            </>
                        ) : (
                            <span>Apply Changes</span>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
