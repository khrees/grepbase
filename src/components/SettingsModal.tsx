

import { useState, useEffect } from 'react';
import { X, Key, Check, AlertCircle, Loader2, Zap } from 'lucide-react';
import styles from './SettingsModal.module.css';
import { type AIProviderType, PROVIDER_NAMES, getAvailableModels } from '@/services/ai-providers';
import { secureStorage } from '@/lib/.client/secure-storage';
import { api } from '@/lib/api-client';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface ProviderSettings {
    apiKey: string;
    model: string;
    baseUrl?: string;
}

const STORAGE_KEY = 'ai_settings';

interface StoredSettings extends Record<AIProviderType, ProviderSettings> {
    activeProvider?: AIProviderType;
    autoExplain?: boolean;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
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
    const [autoExplain, setAutoExplain] = useState(false);

    // Load settings from secure storage on mount
    useEffect(() => {
        const sessionData = secureStorage.getSessionItem<StoredSettings>(STORAGE_KEY);
        if (sessionData) {
            setSettings(prev => ({ ...prev, ...sessionData }));
            if (sessionData.activeProvider) setActiveProvider(sessionData.activeProvider);
            if (sessionData.autoExplain) setAutoExplain(sessionData.autoExplain);
            return;
        }
        // Load from encrypted storage (async)
        secureStorage.getSecureItem<StoredSettings>(STORAGE_KEY).then(saved => {
            if (saved) {
                setSettings(prev => ({ ...prev, ...saved }));
                if (saved.activeProvider) setActiveProvider(saved.activeProvider);
                if (saved.autoExplain) setAutoExplain(saved.autoExplain);
                // Also populate session storage so sync reads work this session
                secureStorage.setSessionItem(STORAGE_KEY, saved);
            }
        });
    }, []);

    // Save settings to secure storage
    function saveSettings() {
        const data = {
            ...settings,
            activeProvider,
            autoExplain,
        };

        secureStorage.setSessionItem(STORAGE_KEY, data);
        secureStorage.setSecureItem(STORAGE_KEY, data); // fire-and-forget async

        onClose();
    }

    // Update a specific provider's setting
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
    // Test the current provider connection
    async function testConnection() {
        setTesting(true);
        setTestResult(null);
        setTestError(null);

        try {
            const currentSettings = settings[activeProvider];
            const isLocalProvider = activeProvider === 'ollama' || activeProvider === 'lmstudio';

            // Validate API key for non-local providers
            if (!isLocalProvider && !currentSettings.apiKey) {
                throw new Error('API key is required');
            }

            // Use our backend API to test connection (avoids CORS issues)
            const data = await api.post<{
                models?: string[];
            }>('/api/test-connection', {
                provider: activeProvider,
                baseUrl: currentSettings.baseUrl,
                apiKey: currentSettings.apiKey,
            });

            setTestResult('success');
            if (data.models?.length) {
                setTestError(`Found ${data.models.length} model(s): ${data.models.slice(0, 3).join(', ')}${data.models.length > 3 ? '...' : ''}`);
            }
        } catch (err) {
            setTestResult('error');
            setTestError(err instanceof Error ? err.message : 'Connection failed');
        } finally {
            setTesting(false);
        }
    }

    if (!isOpen) return null;

    const providers: AIProviderType[] = ['gemini', 'openai', 'anthropic', 'ollama', 'lmstudio', 'glm', 'kimi'];
    const currentSettings = settings[activeProvider];
    const models = getAvailableModels(activeProvider);

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <div className={styles.header}>
                    <h2>Settings</h2>
                    <button className={styles.closeBtn} onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.content}>
                    <p className={styles.description}>
                        Personalize your AI experience. Choose your preferred provider, configure API keys, and manage how the application interacts with your codebase. All settings are encrypted and stored locally in your browser for maximum privacy.
                    </p>

                    <div className={styles.sectionHeader}>
                        <h3>AI Provider</h3>
                    </div>

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
                        {activeProvider !== 'ollama' && activeProvider !== 'lmstudio' ? (
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

                        {/* Custom Model Input for local providers */}
                        {(activeProvider === 'ollama' || activeProvider === 'lmstudio') && (
                            <div className={styles.field}>
                                <label className={styles.label}>Custom Model Name (optional)</label>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="e.g., deepseek-r1:8b, qwen2.5:7b"
                                    value={currentSettings.model}
                                    onChange={e => updateSetting(activeProvider, 'model', e.target.value)}
                                />
                                <small style={{ color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                                    Leave empty to use default, or enter your model name
                                </small>
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

                    <div className={styles.sectionHeader} style={{ marginTop: '24px' }}>
                        <h3>Preferences</h3>
                    </div>

                    <div className={styles.form}>
                        <div className={styles.preferenceRow}>
                            <div className={styles.preferenceInfo}>
                                <div className={styles.preferenceTitle}>
                                    <Zap size={16} />
                                    <span>Auto-explain commits</span>
                                </div>
                                <p className={styles.preferenceDesc}>
                                    Automatically generate explanations when selecting a commit
                                </p>
                            </div>
                            <label className={styles.toggle}>
                                <input
                                    type="checkbox"
                                    checked={autoExplain}
                                    onChange={e => setAutoExplain(e.target.checked)}
                                />
                                <span className={styles.toggleSlider}></span>
                            </label>
                        </div>
                    </div>
                </div>

                <div className={styles.footer}>
                    <button className="btn btn-secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button className="btn btn-primary" onClick={saveSettings}>
                        Save Settings
                    </button>
                </div>
            </div>
        </div>
    );
}

// Helper to get current AI settings (sync — reads from sessionStorage only)
export function getAISettings(): { provider: AIProviderType; config: ProviderSettings } | null {
    if (typeof window === 'undefined') return null;

    const sessionData = secureStorage.getSessionItem<StoredSettings>(STORAGE_KEY);
    if (sessionData) {
        const provider = sessionData.activeProvider || 'gemini';
        const config = sessionData[provider];
        if (config) {
            return { provider, config };
        }
    }

    return null;
}

export function getAutoExplainEnabled(): boolean {
    if (typeof window === 'undefined') return false;

    const sessionData = secureStorage.getSessionItem<StoredSettings>(STORAGE_KEY);
    if (sessionData && typeof sessionData.autoExplain === 'boolean') {
        return sessionData.autoExplain;
    }

    return false;
}
