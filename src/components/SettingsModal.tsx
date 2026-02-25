import { useState, useEffect } from 'react';
import { X, Key, Check, AlertCircle, Loader2, Zap } from 'lucide-react';
import styles from './SettingsModal.module.css';
import { type AIProviderType, PROVIDER_NAMES, getAvailableModels } from '@/services/ai-providers';
import { secureStorage } from '@/lib/.client/secure-storage';
import { api } from '@/lib/api-client';
import { TOAST_EVENT_NAME, type ToastEventDetail } from './ToastHost';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface ProviderSettings {
    apiKey: string;
    model: string;
    baseUrl?: string;
}

interface PersistedProviderSettings {
    model: string;
    baseUrl?: string;
}

const STORAGE_KEY = 'ai_settings';
const PROVIDERS: AIProviderType[] = ['gemini', 'openai', 'anthropic', 'ollama', 'lmstudio', 'glm', 'kimi'];

interface StoredSettings extends Record<AIProviderType, PersistedProviderSettings> {
    activeProvider?: AIProviderType;
    autoExplain?: boolean;
}

const GEMINI_LEGACY_MODEL_ALIASES: Record<string, string> = {
    'gemini-2.0-pro-exp-02-05': 'gemini-2.5-pro',
};

function normalizeProviderModel(provider: AIProviderType, model: string): string {
    if (provider !== 'gemini') return model;
    return GEMINI_LEGACY_MODEL_ALIASES[model] || model;
}

function getDefaultSettings(): Record<AIProviderType, ProviderSettings> {
    return {
        gemini: { apiKey: '', model: 'gemini-3.1-pro' },
        openai: { apiKey: '', model: 'gpt-5.2' },
        anthropic: { apiKey: '', model: 'claude-sonnet-4.6' },
        ollama: { apiKey: '', model: 'llama-4-scout', baseUrl: 'http://localhost:11434/v1' },
        lmstudio: { apiKey: '', model: 'deepseek-r1-distill-llama-8b', baseUrl: 'http://127.0.0.1:1234/v1' },
        glm: { apiKey: '', model: 'glm-5', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/' },
        kimi: { apiKey: '', model: 'kimi-k2.5', baseUrl: 'https://api.moonshot.cn/v1' },
    };
}

function mergePersistedSettings(
    defaults: Record<AIProviderType, ProviderSettings>,
    saved: Partial<Record<AIProviderType, PersistedProviderSettings>>
): Record<AIProviderType, ProviderSettings> {
    const merged: Record<AIProviderType, ProviderSettings> = { ...defaults };

    for (const provider of PROVIDERS) {
        const next = saved[provider];
        if (!next) continue;
        merged[provider] = {
            ...merged[provider],
            model: next.model || merged[provider].model,
            baseUrl: next.baseUrl || merged[provider].baseUrl,
            apiKey: '',
        };
    }

    merged.gemini = {
        ...merged.gemini,
        model: normalizeProviderModel('gemini', merged.gemini.model),
    };

    return merged;
}

function toPersistedSettings(
    settings: Record<AIProviderType, ProviderSettings>
): Record<AIProviderType, PersistedProviderSettings> {
    return {
        gemini: { model: settings.gemini.model, baseUrl: settings.gemini.baseUrl },
        openai: { model: settings.openai.model, baseUrl: settings.openai.baseUrl },
        anthropic: { model: settings.anthropic.model, baseUrl: settings.anthropic.baseUrl },
        ollama: { model: settings.ollama.model, baseUrl: settings.ollama.baseUrl },
        lmstudio: { model: settings.lmstudio.model, baseUrl: settings.lmstudio.baseUrl },
        glm: { model: settings.glm.model, baseUrl: settings.glm.baseUrl },
        kimi: { model: settings.kimi.model, baseUrl: settings.kimi.baseUrl },
    };
}

function clearApiKeys(
    settings: Record<AIProviderType, ProviderSettings>
): Record<AIProviderType, ProviderSettings> {
    return {
        gemini: { ...settings.gemini, apiKey: '' },
        openai: { ...settings.openai, apiKey: '' },
        anthropic: { ...settings.anthropic, apiKey: '' },
        ollama: { ...settings.ollama, apiKey: '' },
        lmstudio: { ...settings.lmstudio, apiKey: '' },
        glm: { ...settings.glm, apiKey: '' },
        kimi: { ...settings.kimi, apiKey: '' },
    };
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const [activeProvider, setActiveProvider] = useState<AIProviderType>('gemini');
    const [settings, setSettings] = useState<Record<AIProviderType, ProviderSettings>>(getDefaultSettings);
    const [detectedModels, setDetectedModels] = useState<Partial<Record<AIProviderType, string[]>>>({});
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
    const [testError, setTestError] = useState<string | null>(null);
    const [autoExplain, setAutoExplain] = useState(false);

    // Load non-sensitive settings from storage on mount.
    useEffect(() => {
        const sessionData = secureStorage.getSessionItem<StoredSettings>(STORAGE_KEY);
        if (sessionData) {
            const merged = mergePersistedSettings(getDefaultSettings(), sessionData);
            const migrated: StoredSettings = {
                ...toPersistedSettings(merged),
                activeProvider: sessionData.activeProvider,
                autoExplain: sessionData.autoExplain,
            };

            setSettings(merged);
            secureStorage.setSessionItem(STORAGE_KEY, migrated);
            secureStorage.setSecureItem(STORAGE_KEY, migrated);

            if (migrated.activeProvider) setActiveProvider(migrated.activeProvider);
            if (typeof migrated.autoExplain === 'boolean') setAutoExplain(migrated.autoExplain);
            return;
        }

        // Load from encrypted storage (async).
        secureStorage.getSecureItem<StoredSettings>(STORAGE_KEY).then(saved => {
            if (!saved) return;

            const merged = mergePersistedSettings(getDefaultSettings(), saved);
            const migrated: StoredSettings = {
                ...toPersistedSettings(merged),
                activeProvider: saved.activeProvider,
                autoExplain: saved.autoExplain,
            };

            setSettings(merged);
            if (migrated.activeProvider) setActiveProvider(migrated.activeProvider);
            if (typeof migrated.autoExplain === 'boolean') setAutoExplain(migrated.autoExplain);

            // Also populate session storage so sync reads work this session.
            secureStorage.setSessionItem(STORAGE_KEY, migrated);
            secureStorage.setSecureItem(STORAGE_KEY, migrated);
        });
    }, []);

    // Update a specific provider setting.
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

    // Save settings and securely persist entered keys server-side.
    async function saveSettings() {
        setSaving(true);
        setTestResult(null);
        setTestError(null);

        const normalizedModel = normalizeProviderModel(activeProvider, settings[activeProvider].model);
        const normalizedSettings: Record<AIProviderType, ProviderSettings> = {
            ...settings,
            [activeProvider]: {
                ...settings[activeProvider],
                model: normalizedModel,
            },
        };

        try {
            await persistEnteredApiKeys(normalizedSettings);

            const persistedProviders = toPersistedSettings(normalizedSettings);
            const persistedSettings: StoredSettings = {
                ...persistedProviders,
                activeProvider,
                autoExplain,
            };

            secureStorage.setSessionItem(STORAGE_KEY, persistedSettings);
            secureStorage.setSecureItem(STORAGE_KEY, persistedSettings); // fire-and-forget async

            // Clear keys from component state after secure server-side persistence.
            setSettings(clearApiKeys(normalizedSettings));

            if (typeof window !== 'undefined') {
                const detail: ToastEventDetail = {
                    kind: 'success',
                    message: `Now using ${normalizedModel} model`,
                    durationMs: 3200,
                };
                window.dispatchEvent(new CustomEvent<ToastEventDetail>(TOAST_EVENT_NAME, { detail }));
            }

            onClose();
        } catch (error) {
            setTestResult('error');
            setTestError(error instanceof Error ? error.message : 'Failed to save secure settings');
        } finally {
            setSaving(false);
        }
    }

    // Test the current provider connection.
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

            // Use backend API to test connection and model listing.
            const data = await api.post<{
                models?: string[];
            }>('/api/test-connection', payload);

            setTestResult('success');
            if (data.models?.length) {
                setDetectedModels(prev => ({
                    ...prev,
                    [activeProvider]: data.models!,
                }));

                setSettings(prev => {
                    const current = prev[activeProvider];
                    const currentModel = normalizeProviderModel(activeProvider, current.model);
                    const nextModel = data.models!.includes(currentModel)
                        ? currentModel
                        : data.models![0];

                    return {
                        ...prev,
                        [activeProvider]: {
                            ...current,
                            model: nextModel,
                        },
                    };
                });

                setTestError(`Found ${data.models.length} model(s): ${data.models.slice(0, 3).join(', ')}${data.models.length > 3 ? '...' : ''}`);
            }
        } catch (error) {
            setTestResult('error');
            setTestError(error instanceof Error ? error.message : 'Connection failed');
        } finally {
            setTesting(false);
        }
    }

    if (!isOpen) return null;

    const currentSettings = settings[activeProvider];
    const models = detectedModels[activeProvider] || getAvailableModels(activeProvider);
    const isLocalProvider = activeProvider === 'ollama' || activeProvider === 'lmstudio';

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
                        Choose your provider and models. API keys are kept in memory while editing and stored server-side using encrypted, session-scoped storage after saving.
                    </p>

                    <div className={styles.sectionHeader}>
                        <h3>AI Provider</h3>
                    </div>

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
                                    autoComplete="off"
                                />
                                <small style={{ color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                                    Leave blank to keep the previously stored key for this session.
                                </small>
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
                        {isLocalProvider && (
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
                                    Leave empty to use default, or enter your model name.
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
                    <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>
                        {saving ? (
                            <>
                                <Loader2 size={16} className={styles.spinner} />
                                Saving...
                            </>
                        ) : (
                            'Save Settings'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Helper to get current AI settings (sync — reads from sessionStorage only).
export function getAISettings(): { provider: AIProviderType; config: ProviderSettings } | null {
    if (typeof window === 'undefined') return null;

    const sessionData = secureStorage.getSessionItem<StoredSettings>(STORAGE_KEY);
    if (sessionData) {
        const provider = sessionData.activeProvider || 'gemini';
        const config = sessionData[provider];
        if (config) {
            return {
                provider,
                config: {
                    apiKey: '',
                    baseUrl: config.baseUrl,
                    model: normalizeProviderModel(provider, config.model),
                },
            };
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
