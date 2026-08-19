import type {
  CloakConfig,
  GeminiKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';
import { modelsToEntries } from '@/components/ui/modelInputListUtils';
import { buildHeaderObject, headersToEntries } from '@/utils/headers';
import {
  excludedModelsToText,
  formatProviderEndpoint,
  getOpenAIProviderStats,
  getStatsBySource,
  hasDisableAllModelsRule,
  normalizeClaudeBaseUrl,
  parseExcludedModels,
  stripDisableAllModelsRule,
  withDisableAllModelsRule,
} from './utils';
import type {
  OpenAIFormState,
  ProviderConfigGroup,
  ProviderGroupFormState,
  ProviderKeyEntryDraft,
  GroupedProviderKind,
  ProviderFormState,
  VertexFormState,
} from './types';
import type { KeyStats, StatusBarData } from '@/utils/usage';
import { buildCandidateUsageSourceIds, lookupStatusBar } from '@/utils/usage';

const normalizeGroupBaseUrl = (provider: GroupedProviderKind, value: string | undefined) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  if (provider === 'claude') {
    return normalizeClaudeBaseUrl(trimmed).replace(/\/+$/g, '');
  }
  return trimmed.replace(/\/+$/g, '');
};
const normalizeGroupPrefix = (value: string | undefined) => String(value ?? '').trim();

const normalizeGroupHeaders = (headers?: Record<string, string>) => {
  const normalized = buildHeaderObject(headers);
  const folded = new Map<string, { key: string; value: string }>();

  Object.entries(normalized).forEach(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    folded.set(normalizedKey, { key: normalizedKey, value });
  });

  return Array.from(folded.values()).sort((left, right) =>
    left.key.toLowerCase().localeCompare(right.key.toLowerCase())
  );
};

const normalizeGroupModels = (
  models?: Array<{ name: string; alias?: string; priority?: number }>
) =>
  (models ?? [])
    .map((model) => ({
      name: String(model?.name ?? '').trim(),
      alias: String(model?.alias ?? '').trim(),
      priority: model?.priority,
    }))
    .filter((model) => model.name)
    .sort((left, right) => {
      const byName = left.name.toLowerCase().localeCompare(right.name.toLowerCase());
      if (byName !== 0) return byName;
      const byAlias = left.alias.toLowerCase().localeCompare(right.alias.toLowerCase());
      if (byAlias !== 0) return byAlias;
      return (left.priority ?? 0) - (right.priority ?? 0);
    });

const normalizeGroupExcludedModels = (models?: string[]) =>
  Array.from(
    new Set((models ?? []).map((model) => String(model ?? '').trim()).filter(Boolean))
  ).sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));

const normalizeGroupCloak = (cloak: CloakConfig | undefined) => {
  if (!cloak) return null;
  return {
    mode: String(cloak.mode ?? '').trim(),
    strictMode: Boolean(cloak.strictMode),
    sensitiveWords: Array.from(
      new Set((cloak.sensitiveWords ?? []).map((word) => String(word ?? '').trim()).filter(Boolean))
    ).sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase())),
  };
};

export const buildProviderGroupSignature = (
  provider: GroupedProviderKind,
  config: Pick<
    ProviderKeyConfig | GeminiKeyConfig,
    'baseUrl' | 'prefix' | 'headers' | 'priority' | 'models' | 'excludedModels'
  > &
    Partial<Pick<ProviderKeyConfig, 'websockets' | 'cloak'>>
) =>
  JSON.stringify({
    provider,
    baseUrl: normalizeGroupBaseUrl(provider, config.baseUrl),
    prefix: normalizeGroupPrefix(config.prefix),
    priority: config.priority ?? null,
    headers: normalizeGroupHeaders(config.headers),
    models: normalizeGroupModels(config.models),
    excludedModels: normalizeGroupExcludedModels(config.excludedModels),
    websockets: provider === 'codex' ? Boolean(config.websockets) : null,
    cloak: provider === 'claude' ? normalizeGroupCloak(config.cloak) : null,
  });

export const findProviderGroupBySignature = <TConfig>(
  groups: ProviderConfigGroup<TConfig>[],
  signature: string | null | undefined
) => {
  const target = String(signature ?? '').trim();
  if (!target) return undefined;
  return groups.find((group) => group.id === target);
};

const toKeyEntryDraft = (
  apiKey: string | undefined,
  proxyUrl: string | undefined,
  headers?: Record<string, string>,
  excludedModels?: string[],
  disabled?: boolean,
  authIndex?: string
): ProviderKeyEntryDraft => ({
  apiKey: String(apiKey ?? ''),
  authIndex: String(authIndex ?? '').trim() || undefined,
  proxyUrl: String(proxyUrl ?? ''),
  headers: headersToEntries(headers),
  enabled: disabled === undefined ? !hasDisableAllModelsRule(excludedModels) : !disabled,
  testStatus: 'idle',
  testMessage: '',
});

const mergeHeaderObjects = (
  ...inputs: Array<Record<string, string | undefined> | undefined>
): Record<string, string> => {
  const merged: Record<string, string> = {};

  inputs.forEach((input) => {
    const headers = buildHeaderObject(input);
    Object.entries(headers).forEach(([key, value]) => {
      const existingKey = Object.keys(merged).find(
        (currentKey) => currentKey.toLowerCase() === key.toLowerCase()
      );
      if (existingKey) {
        delete merged[existingKey];
      }
      merged[key] = value;
    });
  });

  return merged;
};

const cloneCloak = (cloak: CloakConfig | undefined) =>
  cloak
    ? {
        mode: cloak.mode,
        strictMode: cloak.strictMode,
        sensitiveWords: cloak.sensitiveWords ? [...cloak.sensitiveWords] : undefined,
      }
    : undefined;

const countGroupEnabledStates = (configs: Array<ProviderKeyConfig | GeminiKeyConfig>) => {
  const enabledCount = configs.filter(
    (config) => !hasDisableAllModelsRule(config.excludedModels)
  ).length;
  return {
    enabledCount,
    disabledCount: Math.max(configs.length - enabledCount, 0),
    enabled: enabledCount > 0,
  };
};

export const groupProviderConfigs = (
  provider: GroupedProviderKind,
  configs: ProviderKeyConfig[] | GeminiKeyConfig[]
): ProviderConfigGroup<ProviderKeyConfig | GeminiKeyConfig>[] => {
  const groups = new Map<string, ProviderConfigGroup<ProviderKeyConfig | GeminiKeyConfig>>();

  configs.forEach((item, index) => {
    const key = buildProviderGroupSignature(provider, item);
    const existing = groups.get(key);
    if (existing) {
      existing.configs.push(item);
      existing.indexes.push(index);
      existing.proxyUrls = Array.from(
        new Set([...existing.proxyUrls, String(item.proxyUrl ?? '').trim()].filter(Boolean))
      );
      const counts = countGroupEnabledStates(existing.configs);
      existing.enabled = counts.enabled;
      existing.enabledCount = counts.enabledCount;
      existing.disabledCount = counts.disabledCount;
      return;
    }

    const endpoint = formatProviderEndpoint(item.baseUrl);
    const prefix = normalizeGroupPrefix(item.prefix);
    const providerConfig = item as ProviderKeyConfig;
    const hasWebsocketsField = Object.prototype.hasOwnProperty.call(item, 'websockets');
    const hasCloakField = Object.prototype.hasOwnProperty.call(item, 'cloak');
    const counts = countGroupEnabledStates([item]);
    groups.set(key, {
      id: key,
      provider,
      title: prefix || endpoint || `${provider.toUpperCase()} #${index + 1}`,
      baseUrl:
        provider === 'claude'
          ? normalizeClaudeBaseUrl(String(item.baseUrl ?? ''))
          : String(item.baseUrl ?? ''),
      prefix: String(item.prefix ?? ''),
      priority: item.priority,
      headers: item.headers ?? {},
      models: item.models ?? [],
      excludedModels: item.excludedModels ?? [],
      configs: [item],
      indexes: [index],
      primaryIndex: index,
      enabled: counts.enabled,
      enabledCount: counts.enabledCount,
      disabledCount: counts.disabledCount,
      proxyUrls: String(item.proxyUrl ?? '').trim() ? [String(item.proxyUrl ?? '').trim()] : [],
      websockets: hasWebsocketsField ? Boolean(providerConfig.websockets) : undefined,
      cloak: hasCloakField ? cloneCloak(providerConfig.cloak) : undefined,
    });
  });

  return Array.from(groups.values()).sort((left, right) => left.primaryIndex - right.primaryIndex);
};

export const buildProviderGroupFormState = (
  group: ProviderConfigGroup<ProviderKeyConfig | GeminiKeyConfig>
): ProviderGroupFormState => ({
  baseUrl: group.baseUrl ?? '',
  prefix: group.prefix ?? '',
  priority: group.priority,
  headers: headersToEntries(group.headers),
  modelEntries: modelsToEntries(group.models),
  excludedText: excludedModelsToText(stripDisableAllModelsRule(group.excludedModels)),
  testModel: group.models[0]?.name ?? '',
  keyEntries: group.configs.map((item) =>
    toKeyEntryDraft(
      item.apiKey,
      item.proxyUrl,
      item.headers,
      item.excludedModels,
      undefined,
      item.authIndex
    )
  ),
  websockets: group.websockets,
  cloak: cloneCloak(group.cloak),
});

export const buildOpenAIGroupFormState = (
  config?: OpenAIProviderConfig
): ProviderGroupFormState => ({
  name: config?.name ?? '',
  baseUrl: config?.baseUrl ?? '',
  prefix: config?.prefix ?? '',
  priority: config?.priority,
  headers: headersToEntries(config?.headers),
  modelEntries: modelsToEntries(config?.models),
  excludedText: excludedModelsToText(config?.excludedModels),
  testModel: config?.testModel ?? config?.models?.[0]?.name ?? '',
  keyEntries: config?.apiKeyEntries?.length
    ? config.apiKeyEntries.map((entry) =>
        toKeyEntryDraft(
          entry.apiKey,
          entry.proxyUrl,
          entry.headers,
          undefined,
          entry.disabled,
          entry.authIndex ?? config.authIndex
        )
      )
    : [toKeyEntryDraft('', '', undefined)],
});

const normalizeGroupKeyEntries = (entries: ProviderKeyEntryDraft[]) => {
  const seen = new Set<string>();
  return entries.reduce<
    Array<{
      apiKey: string;
      proxyUrl?: string;
      headers?: Record<string, string>;
      enabled?: boolean;
    }>
  >((acc, entry) => {
    const apiKey = String(entry.apiKey ?? '').trim();
    const proxyUrl = String(entry.proxyUrl ?? '').trim();
    const headersObject = buildHeaderObject(entry.headers);
    const signature = [apiKey, proxyUrl, JSON.stringify(headersObject)].join('||');
    if (!apiKey || seen.has(signature)) return acc;
    seen.add(signature);
    acc.push({
      apiKey,
      proxyUrl: proxyUrl || undefined,
      headers: Object.keys(headersObject).length ? headersObject : undefined,
      enabled: entry.enabled ?? true,
    });
    return acc;
  }, []);
};

export const buildProviderConfigsFromGroupForm = (
  form: ProviderGroupFormState
): ProviderKeyConfig[] => {
  const keyEntries = normalizeGroupKeyEntries(form.keyEntries);
  const headersObject = buildHeaderObject(form.headers);
  const models = form.modelEntries
    .map((entry) => {
      const name = entry.name.trim();
      if (!name) return null;
      const alias = entry.alias.trim();
      return alias ? { name, alias } : { name };
    })
    .filter(Boolean) as ProviderKeyConfig['models'];
  const excludedModels = parseExcludedModels(form.excludedText);

  return keyEntries.map((entry) => {
    const mergedHeaders = mergeHeaderObjects(headersObject, entry.headers);

    return {
      apiKey: entry.apiKey,
      priority: form.priority !== undefined ? Math.trunc(form.priority) : undefined,
      prefix: form.prefix.trim() || undefined,
      baseUrl: form.baseUrl.trim() || undefined,
      proxyUrl: entry.proxyUrl,
      headers: Object.keys(mergedHeaders).length ? mergedHeaders : undefined,
      models,
      excludedModels:
        entry.enabled === false ? withDisableAllModelsRule(excludedModels) : excludedModels,
      websockets: form.websockets,
      cloak: cloneCloak(form.cloak),
    };
  });
};

export const buildGeminiConfigsFromGroupForm = (form: ProviderGroupFormState): GeminiKeyConfig[] =>
  buildProviderConfigsFromGroupForm(form).map((item) => ({
    apiKey: item.apiKey,
    priority: item.priority,
    prefix: item.prefix,
    baseUrl: item.baseUrl,
    proxyUrl: item.proxyUrl,
    headers: item.headers,
    models: item.models,
    excludedModels: item.excludedModels,
  }));

export const buildOpenAIProviderFromGroupForm = (
  form: ProviderGroupFormState
): OpenAIProviderConfig => {
  const headersObject = buildHeaderObject(form.headers);
  const models = form.modelEntries
    .map((entry) => {
      const name = entry.name.trim();
      if (!name) return null;
      const alias = entry.alias.trim();
      return alias ? { name, alias } : { name };
    })
    .filter(Boolean) as OpenAIProviderConfig['models'];
  const apiKeyEntries = normalizeGroupKeyEntries(form.keyEntries).map((entry) => ({
    apiKey: entry.apiKey,
    proxyUrl: entry.proxyUrl,
    headers: entry.headers,
    disabled: entry.enabled === false,
  }));

  return {
    name: String(form.name ?? '').trim(),
    baseUrl: form.baseUrl.trim(),
    prefix: form.prefix.trim() || undefined,
    priority: form.priority !== undefined ? Math.trunc(form.priority) : undefined,
    headers: Object.keys(headersObject).length ? headersObject : undefined,
    apiKeyEntries,
    models,
    excludedModels: parseExcludedModels(form.excludedText),
    testModel: form.testModel.trim() || undefined,
  };
};

export const buildVertexConfigFromForm = (form: VertexFormState): ProviderKeyConfig => {
  const trimmedBaseUrl = (form.baseUrl ?? '').trim();

  return {
    apiKey: form.apiKey.trim(),
    priority:
      form.priority !== undefined && Number.isFinite(form.priority)
        ? Math.trunc(form.priority)
        : undefined,
    prefix: form.prefix?.trim() || undefined,
    baseUrl: trimmedBaseUrl || undefined,
    proxyUrl: form.proxyUrl?.trim() || undefined,
    headers: buildHeaderObject(form.headers),
    models: form.modelEntries
      .map((entry) => {
        const name = entry.name.trim();
        const alias = entry.alias.trim();
        if (!name || !alias) return null;
        return { name, alias };
      })
      .filter(Boolean) as ProviderKeyConfig['models'],
    excludedModels: parseExcludedModels(form.excludedText),
  };
};

export const buildOpenAIProviderFromForm = (
  form: OpenAIFormState,
  testModel?: string
): OpenAIProviderConfig => {
  const headersObject = buildHeaderObject(form.headers);
  const models = form.modelEntries
    .map((entry) => {
      const name = entry.name.trim();
      if (!name) return null;
      const alias = entry.alias.trim();
      return alias ? { name, alias } : { name };
    })
    .filter(Boolean) as OpenAIProviderConfig['models'];
  const apiKeyEntries = (form.apiKeyEntries ?? []).map((entry) => {
    const normalizedHeaders = buildHeaderObject(headersToEntries(entry.headers));
    return {
      apiKey: String(entry.apiKey ?? '').trim(),
      proxyUrl: String(entry.proxyUrl ?? '').trim() || undefined,
      headers: Object.keys(normalizedHeaders).length ? normalizedHeaders : undefined,
      disabled: Boolean(entry.disabled),
    };
  });

  return {
    name: String(form.name ?? '').trim(),
    baseUrl: form.baseUrl.trim(),
    prefix: form.prefix.trim() || undefined,
    priority: form.priority !== undefined ? Math.trunc(form.priority) : undefined,
    headers: Object.keys(headersObject).length ? headersObject : undefined,
    apiKeyEntries,
    models,
    excludedModels: parseExcludedModels(form.excludedText),
    testModel: String(testModel ?? form.testModel ?? '').trim() || undefined,
  };
};

export const buildNextProviderList = <T>(
  configs: T[],
  replacements: T[],
  options?: {
    indexes?: number[];
    copyIndexes?: number[];
  }
) => {
  const indexes = options?.indexes ?? [];
  if (indexes.length) {
    return replaceGroupedConfigs(configs, indexes, replacements);
  }

  const copyIndexes = options?.copyIndexes ?? [];
  if (copyIndexes.length) {
    return replaceGroupedConfigs(configs, [], replacements, Math.max(...copyIndexes) + 1);
  }

  return [...configs, ...replacements];
};

export const buildProviderGroupEditSignature = (form: ProviderGroupFormState) =>
  JSON.stringify({
    name: String(form.name ?? '').trim(),
    baseUrl: String(form.baseUrl ?? '').trim(),
    prefix: String(form.prefix ?? '').trim(),
    priority:
      form.priority !== undefined && Number.isFinite(form.priority)
        ? Math.trunc(form.priority)
        : null,
    headers: headersToEntries(buildHeaderObject(form.headers)),
    modelEntries: form.modelEntries
      .map((entry) => ({ name: entry.name.trim(), alias: entry.alias.trim() }))
      .filter((entry) => entry.name || entry.alias),
    excludedText: String(form.excludedText ?? '').trim(),
    testModel: String(form.testModel ?? '').trim(),
    keyEntries: form.keyEntries
      .map((entry) => ({
        apiKey: entry.apiKey.trim(),
        proxyUrl: entry.proxyUrl.trim(),
        headers: headersToEntries(buildHeaderObject(entry.headers)),
      }))
      .filter((entry) => entry.apiKey || entry.proxyUrl || entry.headers.length > 0),
    websockets: Boolean(form.websockets),
    cloak: form.cloak
      ? {
          mode: String(form.cloak.mode ?? '').trim(),
          strictMode: Boolean(form.cloak.strictMode),
          sensitiveWords: (form.cloak.sensitiveWords ?? [])
            .map((item) => String(item).trim())
            .filter(Boolean),
        }
      : null,
  });

export const replaceGroupedConfigs = <T>(
  list: T[],
  indexes: number[],
  replacements: T[],
  insertIndex?: number
) => {
  const indexSet = new Set(indexes);
  const next = list.filter((_, index) => !indexSet.has(index));
  const targetIndex =
    typeof insertIndex === 'number'
      ? insertIndex
      : indexes.length
        ? Math.min(...indexes)
        : next.length;
  next.splice(targetIndex, 0, ...replacements);
  return next;
};

export const buildProviderGroupCard = (
  group: ProviderConfigGroup<ProviderKeyConfig | GeminiKeyConfig>,
  keyStats: KeyStats,
  statusBarBySource: Map<string, StatusBarData>
) => {
  const stats = group.configs.reduce(
    (acc, item) => {
      const current = getStatsBySource(item.apiKey, keyStats, item.prefix, item.authIndex);
      acc.success += current.success;
      acc.failure += current.failure;
      return acc;
    },
    { success: 0, failure: 0 }
  );
  const candidates = group.configs.flatMap((item) => {
    const authIndex = String(item.authIndex ?? '').trim();
    return authIndex && statusBarBySource.has(authIndex)
      ? [authIndex]
      : buildCandidateUsageSourceIds({ apiKey: item.apiKey, prefix: item.prefix });
  });

  return {
    primaryIndex: group.primaryIndex,
    title: group.title,
    baseUrl: formatProviderEndpoint(group.baseUrl),
    keyCount: group.configs.length,
    modelCount: group.models.length,
    statusData: lookupStatusBar(statusBarBySource, candidates),
    success: stats.success,
    failure: stats.failure,
    enabled: group.enabled,
  };
};

export const buildOpenAIProviderCard = (
  config: OpenAIProviderConfig,
  index: number,
  keyStats: KeyStats,
  statusBarBySource: Map<string, StatusBarData>
) => {
  const totalKeyCount = config.apiKeyEntries?.length ?? 0;
  const enabledKeyCount = (config.apiKeyEntries ?? []).filter((entry) => !entry.disabled).length;
  const disabledKeyCount = (config.apiKeyEntries ?? []).filter((entry) => entry.disabled).length;
  const candidates = new Set<string>();
  (config.apiKeyEntries || []).forEach((entry) => {
    const authIndex = String(entry.authIndex ?? '').trim();
    if (authIndex && statusBarBySource.has(authIndex)) {
      candidates.add(authIndex);
      return;
    }
    buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => candidates.add(id));
  });
  const providerAuthIndex = String(config.authIndex ?? '').trim();
  if (!candidates.size && providerAuthIndex && statusBarBySource.has(providerAuthIndex)) {
    candidates.add(providerAuthIndex);
  }
  if (!candidates.size) {
    buildCandidateUsageSourceIds({ prefix: config.prefix }).forEach((id) => candidates.add(id));
  }
  const stats = getOpenAIProviderStats(config.apiKeyEntries, keyStats, config.prefix);

  return {
    primaryIndex: index,
    title:
      config.name ||
      config.prefix ||
      formatProviderEndpoint(config.baseUrl) ||
      `OpenAI #${index + 1}`,
    baseUrl: formatProviderEndpoint(config.baseUrl),
    keyCount: totalKeyCount,
    enabledKeyCount,
    disabledKeyCount,
    modelCount: config.models?.length ?? 0,
    statusData: lookupStatusBar(statusBarBySource, Array.from(candidates)),
    success: stats.success,
    failure: stats.failure,
    enabled: totalKeyCount === 0 || enabledKeyCount > 0,
  };
};

export const buildLegacyProviderFormState = (
  groupForm: ProviderGroupFormState
): ProviderFormState => ({
  apiKey: groupForm.keyEntries[0]?.apiKey ?? '',
  apiKeys: groupForm.keyEntries.map((entry) => entry.apiKey),
  priority: groupForm.priority,
  prefix: groupForm.prefix,
  baseUrl: groupForm.baseUrl,
  proxyUrl: groupForm.keyEntries[0]?.proxyUrl ?? '',
  headers: groupForm.headers,
  models: [],
  excludedModels: [],
  modelEntries: groupForm.modelEntries,
  excludedText: groupForm.excludedText,
  websockets: groupForm.websockets,
  cloak: cloneCloak(groupForm.cloak),
});

export const buildLegacyOpenAIFormState = (groupForm: ProviderGroupFormState): OpenAIFormState => ({
  name: groupForm.name ?? '',
  priority: groupForm.priority,
  prefix: groupForm.prefix,
  baseUrl: groupForm.baseUrl,
  headers: groupForm.headers,
  excludedText: groupForm.excludedText,
  modelEntries: groupForm.modelEntries,
  apiKeyEntries: groupForm.keyEntries.map((entry) => ({
    apiKey: entry.apiKey,
    proxyUrl: entry.proxyUrl || undefined,
    headers: buildHeaderObject(entry.headers),
    disabled: entry.enabled === false,
  })),
  testModel: groupForm.testModel || undefined,
});
