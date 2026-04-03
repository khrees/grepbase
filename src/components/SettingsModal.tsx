import { useState, useRef } from 'react';
import { X, Key, Check, AlertCircle, Loader2, Zap } from 'lucide-react';
import styles from './SettingsModal.module.css';
import { type AIProviderType, PROVIDER_NAMES, getAvailableModels } from '@/services/ai-providers';
import { api } from '@/lib/api-client';
import { fireToast } from '@/stores/toast-store';
import {
    useSettingsStore,
    PROVIDERS,
    normalizeProviderModel,
    type ProviderSettings,
} from '@/stores/settings-store';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const {
        settings,
        activeProvider,
        autoExplain,
        loadFromStorage,
        setActiveProvider,
        updateSetting,
        setAutoExplain,
        persist,
        clearKeys,
    } = useSettingsStore();

    const [detectedModels, setDetectedModels] = useState<Partial<Record<AIProviderType, string[]>>>({});
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
    const [testError, setTestError] = useState<string | null>(null);

    // Load settings once (render-phase)
    const settingsLoadedRef = useRef(false);
    if (!settingsLoadedRef.current) {
        settingsLoadedRef.current = true;
        loadFromStorage();
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

    async function saveSettings() {
        setSaving(true);
        setTestResult(null);
        setTestError(null);

        try {
            await persistEnteredApiKeys(settings);

            persist();
            clearKeys();

            const normalizedModel = normalizeProviderModel(activeProvider, settings[activeProvider].model);
            fireToast(`Now using ${normalizedModel} model`, 'success', 3200);
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
            const payload: { provider: AIProviderType; baseUrl?: string; apiKey?: string } = {
                provider: activeProvider,
                baseUrl: currentSettings.baseUrl,
            };

            if (currentSettings.apiKey.trim().length > 0) {
                payload.apiKey = currentSettings.apiKey.trim();
            }

            const data = await api.post<{
                models?: string[];
            }>('/api/test-connection', payload);

            setTestResult('success');
            if (data.models?.length) {
                setDetectedModels(prev => ({
                    ...prev,
                    [activeProvider]: data.models!,
                }));

                const currentModel = normalizeProviderModel(activeProvider, currentSettings.model);
                const nextModel = data.models.includes(currentModel)
                    ? currentModel
                    : data.models[0];

                updateSetting(activeProvider, 'model', nextModel);

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
                                    onChange={e => {
                                        updateSetting(activeProvider, 'apiKey', e.target.value);
                                        setTestResult(null);
                                    }}
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
                                    onChange={e => {
                                        updateSetting(activeProvider, 'baseUrl', e.target.value);
                                        setTestResult(null);
                                    }}
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
                                    onChange={e => {
                                        updateSetting(activeProvider, 'model', e.target.value);
                                        setTestResult(null);
                                    }}
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
                                onChange={e => {
                                    updateSetting(activeProvider, 'model', e.target.value);
                                    setTestResult(null);
                                }}
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

// Re-export helpers for backward compat during migration
export { getAISettings, getAutoExplainEnabled } from '@/stores/settings-store';
