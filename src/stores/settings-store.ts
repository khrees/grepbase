import { create } from 'zustand';
import { type AIProviderType } from '@/services/ai-providers';
import { secureStorage } from '@/lib/.client/secure-storage';

interface ProviderSettings {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

interface PersistedProviderSettings {
  model: string;
  baseUrl?: string;
}

interface StoredSettings extends Record<AIProviderType, PersistedProviderSettings> {
  activeProvider?: AIProviderType;
  autoExplain?: boolean;
}

const STORAGE_KEY = 'ai_settings';
const PROVIDERS: AIProviderType[] = ['gemini', 'openai', 'anthropic', 'ollama', 'lmstudio', 'glm', 'kimi'];

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
  return Object.fromEntries(
    PROVIDERS.map(p => [p, { model: settings[p].model, baseUrl: settings[p].baseUrl }])
  ) as Record<AIProviderType, PersistedProviderSettings>;
}

function clearApiKeys(
  settings: Record<AIProviderType, ProviderSettings>
): Record<AIProviderType, ProviderSettings> {
  return Object.fromEntries(
    PROVIDERS.map(p => [p, { ...settings[p], apiKey: '' }])
  ) as Record<AIProviderType, ProviderSettings>;
}

interface SettingsState {
  settings: Record<AIProviderType, ProviderSettings>;
  activeProvider: AIProviderType;
  autoExplain: boolean;
  loaded: boolean;

  loadFromStorage: () => void;
  setActiveProvider: (provider: AIProviderType) => void;
  updateSetting: (provider: AIProviderType, key: keyof ProviderSettings, value: string) => void;
  setAutoExplain: (enabled: boolean) => void;
  persist: () => void;
  clearKeys: () => void;

  /** Get the active provider config. Returns null when not configured. */
  getActiveConfig: () => { provider: AIProviderType; config: ProviderSettings } | null;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: getDefaultSettings(),
  activeProvider: 'gemini',
  autoExplain: false,
  loaded: false,

  loadFromStorage: () => {
    if (typeof window === 'undefined') return;

    // Try session first (sync)
    const sessionData = secureStorage.getSessionItem<StoredSettings>(STORAGE_KEY);
    if (sessionData) {
      const merged = mergePersistedSettings(getDefaultSettings(), sessionData);
      const migrated: StoredSettings = {
        ...toPersistedSettings(merged),
        activeProvider: sessionData.activeProvider,
        autoExplain: sessionData.autoExplain,
      };

      set({
        settings: merged,
        activeProvider: migrated.activeProvider || 'gemini',
        autoExplain: migrated.autoExplain ?? false,
        loaded: true,
      });

      secureStorage.setSessionItem(STORAGE_KEY, migrated);
      secureStorage.setSecureItem(STORAGE_KEY, migrated);
      return;
    }

    // Fallback to encrypted storage (async)
    secureStorage.getSecureItem<StoredSettings>(STORAGE_KEY).then(saved => {
      if (!saved) {
        set({ loaded: true });
        return;
      }

      const merged = mergePersistedSettings(getDefaultSettings(), saved);
      const migrated: StoredSettings = {
        ...toPersistedSettings(merged),
        activeProvider: saved.activeProvider,
        autoExplain: saved.autoExplain,
      };

      set({
        settings: merged,
        activeProvider: migrated.activeProvider || 'gemini',
        autoExplain: migrated.autoExplain ?? false,
        loaded: true,
      });

      secureStorage.setSessionItem(STORAGE_KEY, migrated);
      secureStorage.setSecureItem(STORAGE_KEY, migrated);
    });
  },

  setActiveProvider: (provider) => set({ activeProvider: provider }),

  updateSetting: (provider, key, value) =>
    set(state => ({
      settings: {
        ...state.settings,
        [provider]: {
          ...state.settings[provider],
          [key]: value,
        },
      },
    })),

  setAutoExplain: (enabled) => set({ autoExplain: enabled }),

  persist: () => {
    const { settings, activeProvider, autoExplain } = get();
    const normalizedModel = normalizeProviderModel(activeProvider, settings[activeProvider].model);
    const normalizedSettings: Record<AIProviderType, ProviderSettings> = {
      ...settings,
      [activeProvider]: {
        ...settings[activeProvider],
        model: normalizedModel,
      },
    };

    const data: StoredSettings = {
      ...toPersistedSettings(normalizedSettings),
      activeProvider,
      autoExplain,
    };

    secureStorage.setSessionItem(STORAGE_KEY, data);
    secureStorage.setSecureItem(STORAGE_KEY, data);

    set({ settings: normalizedSettings });
  },

  clearKeys: () => {
    set(state => ({ settings: clearApiKeys(state.settings) }));
  },

  getActiveConfig: () => {
    const { settings, activeProvider, loaded } = get();
    if (!loaded) return null;

    // Check if there's either a key entered or we can assume one is stored server-side
    const config = settings[activeProvider];
    const isLocal = activeProvider === 'ollama' || activeProvider === 'lmstudio';

    // For session reads, we need at least a model
    if (!config.model && !isLocal) return null;

    return {
      provider: activeProvider,
      config: {
        apiKey: '',
        baseUrl: config.baseUrl,
        model: normalizeProviderModel(activeProvider, config.model),
      },
    };
  },
}));

/**
 * Convenience for reading settings outside React (e.g. in callbacks).
 * Drop-in replacement for the old getAISettings().
 */
export function getAISettings() {
  return useSettingsStore.getState().getActiveConfig();
}

export function getAutoExplainEnabled(): boolean {
  return useSettingsStore.getState().autoExplain;
}

export { PROVIDERS, STORAGE_KEY, type ProviderSettings, type PersistedProviderSettings, type StoredSettings };
export { normalizeProviderModel, getDefaultSettings, mergePersistedSettings, toPersistedSettings, clearApiKeys };
