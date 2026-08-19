import type {
  AmpcodeConfig,
  AmpcodeModelMapping,
  AmpcodeUpstreamApiKeyMapping,
  ApiKeyEntry,
} from '@/types';
import type { HeaderEntry } from '@/utils/headers';
import { normalizeHeaderEntries } from '@/utils/headers';
import {
  DISABLE_ALL_MODELS_RULE,
  hasDisableAllModelsRule,
  stripDisableAllModelsRule,
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/utils/providerRules';
import { buildCandidateUsageSourceIds, type KeyStatBucket, type KeyStats } from '@/utils/usage';
import type {
  AmpcodeFormState,
  AmpcodeUpstreamApiKeyEntry,
  ModelEntry,
  ProviderKeyEntryDraft,
} from './types';

export {
  DISABLE_ALL_MODELS_RULE,
  hasDisableAllModelsRule,
  stripDisableAllModelsRule,
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
};

export const parseTextList = (text: string): string[] =>
  text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const parseExcludedModels = parseTextList;

export const excludedModelsToText = (models?: string[]) =>
  Array.isArray(models) ? models.join('\n') : '';

export const normalizeOpenAIBaseUrl = (baseUrl: string): string => {
  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) return '';
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed;
};

export const normalizeClaudeBaseUrl = (baseUrl: string): string => {
  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) {
    return 'https://api.anthropic.com';
  }
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed;
};

export const buildOpenAIModelsEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeOpenAIBaseUrl(baseUrl);
  if (!trimmed) return '';
  return `${trimmed}/models`;
};

const stripOpenAIEndpointSuffix = (baseUrl: string): string =>
  baseUrl.replace(/\/(?:chat\/completions|responses)\/?$/i, '');

export const buildOpenAIChatCompletionsEndpoint = (baseUrl: string): string => {
  const trimmed = stripOpenAIEndpointSuffix(normalizeOpenAIBaseUrl(baseUrl));
  if (!trimmed) return '';
  return `${trimmed}/chat/completions`;
};

export const buildOpenAIResponsesEndpoint = (baseUrl: string): string => {
  const trimmed = stripOpenAIEndpointSuffix(normalizeOpenAIBaseUrl(baseUrl));
  if (!trimmed) return '';
  return `${trimmed}/responses`;
};

export const buildClaudeMessagesEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeClaudeBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (trimmed.endsWith('/v1/messages')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/messages`;
  }
  return `${trimmed}/v1/messages`;
};

// 根据 source (apiKey) 获取统计数据 - 与旧版逻辑一致
export const getStatsBySource = (
  apiKey: string,
  keyStats: KeyStats,
  prefix?: string,
  authIndex?: string
): KeyStatBucket => {
  const normalizedAuthIndex = String(authIndex ?? '').trim();
  const authIndexStats = normalizedAuthIndex
    ? keyStats.byAuthIndex?.[normalizedAuthIndex]
    : undefined;
  if (authIndexStats) {
    return authIndexStats;
  }

  const bySource = keyStats.bySource ?? {};
  const candidates = buildCandidateUsageSourceIds({ apiKey, prefix });
  if (!candidates.length) {
    return { success: 0, failure: 0 };
  }

  let success = 0;
  let failure = 0;
  candidates.forEach((candidate) => {
    const stats = bySource[candidate];
    if (!stats) return;
    success += stats.success;
    failure += stats.failure;
  });

  return { success, failure };
};

// 对于 OpenAI 提供商，汇总所有 apiKeyEntries 的统计 - 与旧版逻辑一致
export const getOpenAIProviderStats = (
  apiKeyEntries: ApiKeyEntry[] | undefined,
  keyStats: KeyStats,
  providerPrefix?: string
): KeyStatBucket => {
  const authIndexes = new Set<string>();
  const sourceFallbackEntries: ApiKeyEntry[] = [];
  (apiKeyEntries ?? []).forEach((entry) => {
    const authIndex = String(entry?.authIndex ?? '').trim();
    if (authIndex && keyStats.byAuthIndex?.[authIndex]) {
      authIndexes.add(authIndex);
      return;
    }
    sourceFallbackEntries.push(entry);
  });
  if (authIndexes.size) {
    let success = 0;
    let failure = 0;
    authIndexes.forEach((authIndex) => {
      const stats = keyStats.byAuthIndex[authIndex];
      if (!stats) return;
      success += stats.success;
      failure += stats.failure;
    });
    const sourceIds = new Set<string>();
    sourceFallbackEntries.forEach((entry) => {
      buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => sourceIds.add(id));
    });
    sourceIds.forEach((sourceId) => {
      const stats = keyStats.bySource?.[sourceId];
      if (!stats) return;
      success += stats.success;
      failure += stats.failure;
    });
    return { success, failure };
  }

  const bySource = keyStats.bySource ?? {};

  const sourceIds = new Set<string>();
  buildCandidateUsageSourceIds({ prefix: providerPrefix }).forEach((id) => sourceIds.add(id));
  (apiKeyEntries || []).forEach((entry) => {
    buildCandidateUsageSourceIds({ apiKey: entry?.apiKey }).forEach((id) => sourceIds.add(id));
  });

  let success = 0;
  let failure = 0;
  sourceIds.forEach((id) => {
    const stats = bySource[id];
    if (!stats) return;
    success += stats.success;
    failure += stats.failure;
  });

  return { success, failure };
};

export const getTotalRequests = (stats: KeyStatBucket): number => stats.success + stats.failure;

export const formatProviderEndpoint = (value?: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const url = new URL(normalized);
    const path = url.pathname.replace(/\/+$/g, '');
    return `${url.host}${path && path !== '/' ? path : ''}`;
  } catch {
    return trimmed.replace(/^https?:\/\//i, '').replace(/\/+$/g, '');
  }
};

export type ProviderIdentityPresentation = {
  title: string;
  subtitle: string;
  titleTone: 'default' | 'endpoint';
};

export const buildProviderIdentityPresentation = (input: {
  primary?: string;
  endpoint?: string;
  fallback: string;
}): ProviderIdentityPresentation => {
  const primary = String(input.primary ?? '').trim();
  const endpoint = String(input.endpoint ?? '').trim();
  const fallback = String(input.fallback ?? '').trim();

  if (primary) {
    return {
      title: primary,
      subtitle: endpoint && endpoint !== primary ? endpoint : '',
      titleTone: endpoint && endpoint === primary ? 'endpoint' : 'default',
    };
  }

  if (endpoint) {
    return {
      title: endpoint,
      subtitle: '',
      titleTone: 'endpoint',
    };
  }

  return {
    title: fallback,
    subtitle: '',
    titleTone: 'default',
  };
};

export type MappingSummaryItem = {
  source: string;
  target: string;
  muted?: boolean;
};

export const summarizeMappings = (
  items: MappingSummaryItem[],
  limit: number = 3
): { visible: MappingSummaryItem[]; hiddenCount: number } => {
  const normalized = items.filter((item) => item.source.trim() || item.target.trim());
  return {
    visible: normalized.slice(0, limit),
    hiddenCount: Math.max(normalized.length - limit, 0),
  };
};

export const buildApiKeyEntry = (input?: Partial<ApiKeyEntry>): ApiKeyEntry => ({
  apiKey: input?.apiKey ?? '',
  proxyUrl: input?.proxyUrl ?? '',
  headers: input?.headers ?? {},
  disabled: input?.disabled ?? false,
});

export type ProviderKeyTestStatus = {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string;
};

export const PROVIDER_KEY_TEST_BATCH_CONCURRENCY = 4;

export const runProviderKeyTestBatch = async (
  indexes: number[],
  runTest: (index: number) => Promise<boolean>,
  concurrency: number = PROVIDER_KEY_TEST_BATCH_CONCURRENCY
): Promise<boolean[]> => {
  if (indexes.length === 0) {
    return [];
  }

  const workerCount = Math.min(
    indexes.length,
    Math.max(
      1,
      Math.floor(Number.isFinite(concurrency) ? concurrency : PROVIDER_KEY_TEST_BATCH_CONCURRENCY)
    )
  );
  const results = new Array<boolean>(indexes.length).fill(false);
  let cursor = 0;

  const runWorker = async () => {
    for (;;) {
      const current = cursor;
      cursor += 1;
      if (current >= indexes.length) {
        return;
      }

      try {
        results[current] = await runTest(indexes[current]!);
      } catch {
        results[current] = false;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
};

const normalizeDraftHeaderEntries = (headers: HeaderEntry[] | undefined) =>
  normalizeHeaderEntries(headers ?? []).map((entry) => ({
    key: entry.key.trim(),
    value: entry.value.trim(),
  }));

const buildKeyEntryIdentity = (
  entry: Pick<ProviderKeyEntryDraft, 'apiKey' | 'proxyUrl' | 'headers'>
) =>
  JSON.stringify({
    apiKey: String(entry.apiKey ?? '').trim(),
    proxyUrl: String(entry.proxyUrl ?? '').trim(),
    headers: normalizeDraftHeaderEntries(entry.headers),
  });

const isKeyConnectivitySame = (
  left: Pick<ProviderKeyEntryDraft, 'apiKey' | 'proxyUrl' | 'headers'>,
  right: Pick<ProviderKeyEntryDraft, 'apiKey' | 'proxyUrl' | 'headers'>
) => buildKeyEntryIdentity(left) === buildKeyEntryIdentity(right);

export const haveProviderKeyConnectivityChanged = (
  previous: ProviderKeyEntryDraft[],
  next: ProviderKeyEntryDraft[]
): boolean => {
  if (previous.length !== next.length) {
    return false;
  }
  return previous.some((entry, index) => !isKeyConnectivitySame(entry, next[index]!));
};

export const remapProviderKeyTestStatuses = (
  previousEntries: ProviderKeyEntryDraft[],
  previousStatuses: ProviderKeyTestStatus[],
  nextEntries: ProviderKeyEntryDraft[]
): ProviderKeyTestStatus[] => {
  const pools = new Map<string, ProviderKeyTestStatus[]>();

  previousEntries.forEach((entry, index) => {
    const key = buildKeyEntryIdentity(entry);
    const existing = pools.get(key) ?? [];
    existing.push(previousStatuses[index] ?? { status: 'idle', message: '' });
    pools.set(key, existing);
  });

  return nextEntries.map((entry) => {
    const key = buildKeyEntryIdentity(entry);
    const pool = pools.get(key);
    if (!pool?.length) {
      return { status: 'idle', message: '' };
    }
    return pool.shift() ?? { status: 'idle', message: '' };
  });
};

export const ampcodeMappingsToEntries = (mappings?: AmpcodeModelMapping[]): ModelEntry[] => {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return [{ name: '', alias: '' }];
  }
  return mappings.map((mapping) => ({
    name: mapping.from ?? '',
    alias: mapping.to ?? '',
  }));
};

export const entriesToAmpcodeMappings = (entries: ModelEntry[]): AmpcodeModelMapping[] => {
  const seen = new Set<string>();
  const mappings: AmpcodeModelMapping[] = [];

  entries.forEach((entry) => {
    const from = entry.name.trim();
    const to = entry.alias.trim();
    if (!from || !to) return;
    const key = from.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    mappings.push({ from, to });
  });

  return mappings;
};

export const ampcodeUpstreamApiKeysToEntries = (
  mappings?: AmpcodeUpstreamApiKeyMapping[]
): AmpcodeUpstreamApiKeyEntry[] => {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return [{ upstreamApiKey: '', clientApiKeysText: '' }];
  }

  return mappings.map((mapping) => ({
    upstreamApiKey: mapping.upstreamApiKey ?? '',
    clientApiKeysText: Array.isArray(mapping.apiKeys) ? mapping.apiKeys.join('\n') : '',
  }));
};

export const entriesToAmpcodeUpstreamApiKeys = (
  entries: AmpcodeUpstreamApiKeyEntry[]
): AmpcodeUpstreamApiKeyMapping[] => {
  const seen = new Set<string>();
  const mappings: AmpcodeUpstreamApiKeyMapping[] = [];

  entries.forEach((entry) => {
    const upstreamApiKey = String(entry?.upstreamApiKey ?? '').trim();
    if (!upstreamApiKey || seen.has(upstreamApiKey)) return;

    const apiKeys = Array.from(new Set(parseTextList(String(entry?.clientApiKeysText ?? ''))));
    if (!apiKeys.length) return;

    seen.add(upstreamApiKey);
    mappings.push({ upstreamApiKey, apiKeys });
  });

  return mappings;
};

export const buildAmpcodeFormState = (ampcode?: AmpcodeConfig | null): AmpcodeFormState => ({
  upstreamUrl: ampcode?.upstreamUrl ?? '',
  upstreamApiKey: '',
  forceModelMappings: ampcode?.forceModelMappings ?? false,
  mappingEntries: ampcodeMappingsToEntries(ampcode?.modelMappings),
  upstreamApiKeyEntries: ampcodeUpstreamApiKeysToEntries(ampcode?.upstreamApiKeys),
});
