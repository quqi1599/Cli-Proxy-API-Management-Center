import type { ApiKeyEntry, GeminiKeyConfig, ProviderKeyConfig } from '@/types';
import type { HeaderEntry } from '@/utils/headers';
import type { KeyStats, StatusBarData, UsageDetail } from '@/utils/usage';

export interface ModelEntry {
  name: string;
  alias: string;
}

export interface OpenAIFormState {
  name: string;
  priority?: number;
  prefix: string;
  baseUrl: string;
  headers: HeaderEntry[];
  excludedText: string;
  testModel?: string;
  modelEntries: ModelEntry[];
  apiKeyEntries: ApiKeyEntry[];
}

export type ProviderKind = 'gemini' | 'codex' | 'claude' | 'openai' | 'vertex';

export type GroupedProviderKind = 'gemini' | 'codex' | 'claude';

export type ProviderSemanticGroup =
  | 'g1-flat-grouped'
  | 'g2-provider-with-keys'
  | 'g3-special-compatible';

export type ProviderActivationStrategy = 'excluded-models-disable-all';

export type ProviderMutationSubject = 'grouped-configs' | 'provider' | 'single-config' | 'special';

export interface ProviderVisualAdapter {
  provider: ProviderKind;
  semanticGroup: ProviderSemanticGroup;
  activationStrategy: ProviderActivationStrategy;
  mutationSubject: ProviderMutationSubject;
  useSharedVisualShell: boolean;
  supportsGroupedPersistence: boolean;
  supportsMultiKeyEditing: boolean;
}

export const PROVIDER_VISUAL_ADAPTERS: Record<ProviderKind, ProviderVisualAdapter> = {
  gemini: {
    provider: 'gemini',
    semanticGroup: 'g1-flat-grouped',
    activationStrategy: 'excluded-models-disable-all',
    mutationSubject: 'grouped-configs',
    useSharedVisualShell: true,
    supportsGroupedPersistence: true,
    supportsMultiKeyEditing: true,
  },
  codex: {
    provider: 'codex',
    semanticGroup: 'g1-flat-grouped',
    activationStrategy: 'excluded-models-disable-all',
    mutationSubject: 'grouped-configs',
    useSharedVisualShell: true,
    supportsGroupedPersistence: true,
    supportsMultiKeyEditing: true,
  },
  openai: {
    provider: 'openai',
    semanticGroup: 'g2-provider-with-keys',
    activationStrategy: 'excluded-models-disable-all',
    mutationSubject: 'provider',
    useSharedVisualShell: true,
    supportsGroupedPersistence: false,
    supportsMultiKeyEditing: true,
  },
  claude: {
    provider: 'claude',
    semanticGroup: 'g1-flat-grouped',
    activationStrategy: 'excluded-models-disable-all',
    mutationSubject: 'grouped-configs',
    useSharedVisualShell: true,
    supportsGroupedPersistence: true,
    supportsMultiKeyEditing: true,
  },
  vertex: {
    provider: 'vertex',
    semanticGroup: 'g3-special-compatible',
    activationStrategy: 'excluded-models-disable-all',
    mutationSubject: 'single-config',
    useSharedVisualShell: true,
    supportsGroupedPersistence: false,
    supportsMultiKeyEditing: false,
  },
};

export interface ProviderKeyEntryDraft {
  apiKey: string;
  authIndex?: string;
  proxyUrl: string;
  headers: HeaderEntry[];
  enabled?: boolean;
  testStatus: 'idle' | 'loading' | 'success' | 'error';
  testMessage: string;
}

export interface ProviderGroupFormState {
  name?: string;
  baseUrl: string;
  prefix: string;
  priority?: number;
  headers: HeaderEntry[];
  modelEntries: ModelEntry[];
  excludedText: string;
  testModel: string;
  keyEntries: ProviderKeyEntryDraft[];
  websockets?: boolean;
  cloak?: ProviderFormState['cloak'];
}

export interface ProviderConfigGroup<TConfig> {
  id: string;
  provider: GroupedProviderKind;
  title: string;
  baseUrl: string;
  prefix: string;
  priority?: number;
  headers: Record<string, string>;
  models: Array<{ name: string; alias?: string }>;
  excludedModels: string[];
  configs: TConfig[];
  indexes: number[];
  primaryIndex: number;
  enabled: boolean;
  enabledCount: number;
  disabledCount: number;
  proxyUrls: string[];
  websockets?: boolean;
  cloak?: ProviderKeyConfig['cloak'];
}

export interface GroupedProviderLocationState {
  fromAiProviders?: boolean;
  groupSignature?: string;
  copySignature?: string;
}

export interface AmpcodeUpstreamApiKeyEntry {
  upstreamApiKey: string;
  clientApiKeysText: string;
}

export interface AmpcodeFormState {
  upstreamUrl: string;
  upstreamApiKey: string;
  forceModelMappings: boolean;
  mappingEntries: ModelEntry[];
  upstreamApiKeyEntries: AmpcodeUpstreamApiKeyEntry[];
}

export type GeminiFormState = Omit<GeminiKeyConfig, 'headers' | 'models'> & {
  headers: HeaderEntry[];
  modelEntries: ModelEntry[];
  excludedText: string;
};

export type ProviderFormState = Omit<ProviderKeyConfig, 'headers'> & {
  headers: HeaderEntry[];
  modelEntries: ModelEntry[];
  excludedText: string;
  apiKeys?: string[];
};

export type VertexFormState = Omit<ProviderKeyConfig, 'headers'> & {
  headers: HeaderEntry[];
  modelEntries: ModelEntry[];
  excludedText: string;
};

export interface ProviderSectionProps<TConfig> {
  configs: TConfig[];
  keyStats: KeyStats;
  statusBarBySource: Map<string, StatusBarData>;
  usageDetails: UsageDetail[];
  disabled: boolean;
  onEdit: (index: number) => void;
  onAdd: () => void;
  onDelete: (index: number) => void;
  onToggle?: (index: number, enabled: boolean) => void;
}
