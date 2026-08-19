import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOpenAIProvider } from '../src/services/api/transformers.ts';
import {
  buildOpenAIProviderFromForm,
  buildOpenAIProviderCard,
} from '../src/components/providers/groupedProviderUtils.ts';
import type { OpenAIFormState } from '../src/components/providers/types.ts';
import {
  blocksToStatusBarData,
  buildCandidateUsageSourceIds,
  EMPTY_STATUS_BAR,
} from '../src/utils/usage.ts';

test('normalizeOpenAIProvider preserves api key disabled flags', () => {
  const provider = normalizeOpenAIProvider({
    name: 'demo',
    'base-url': 'https://example.com/v1',
    'auth-index': 'provider-auth',
    'api-key-entries': [
      { 'api-key': 'sk-a', 'auth-index': 'auth-a', disabled: true },
      { 'api-key': 'sk-b', auth_index: 'auth-b', disabled: false },
    ],
  });

  assert.ok(provider);
  assert.equal(provider.authIndex, 'provider-auth');
  assert.equal(provider.apiKeyEntries[0]?.authIndex, 'auth-a');
  assert.equal(provider.apiKeyEntries[1]?.authIndex, 'auth-b');
  assert.equal(provider.apiKeyEntries[0]?.disabled, true);
  assert.equal(provider.apiKeyEntries[1]?.disabled, false);
});

test('buildOpenAIProviderCard prefers stable per-key auth-index stats', () => {
  const authStatus = {
    ...EMPTY_STATUS_BAR,
    successRate: 90,
    totalSuccess: 9,
    totalFailure: 1,
  };
  const card = buildOpenAIProviderCard(
    {
      name: 'demo',
      baseUrl: 'https://example.com/v1',
      apiKeyEntries: [{ apiKey: 'rotated-secret', authIndex: 'stable-auth' }],
    },
    0,
    {
      bySource: {},
      byAuthIndex: { 'stable-auth': { success: 9, failure: 1 } },
    },
    new Map([['stable-auth', authStatus]])
  );

  assert.equal(card.success, 9);
  assert.equal(card.failure, 1);
  assert.equal(card.statusData, authStatus);
});

test('buildOpenAIProviderFromForm persists disabled api keys', () => {
  const form: OpenAIFormState = {
    name: 'demo',
    priority: 1,
    prefix: 'team',
    baseUrl: 'https://example.com/v1',
    headers: [],
    excludedText: '',
    testModel: 'gpt-4o-mini',
    modelEntries: [{ name: 'gpt-4o-mini', alias: 'mini' }],
    apiKeyEntries: [
      { apiKey: 'sk-a', proxyUrl: '', headers: {}, disabled: true },
      { apiKey: 'sk-b', proxyUrl: '', headers: {}, disabled: false },
    ],
  };

  const provider = buildOpenAIProviderFromForm(form, form.testModel);

  assert.equal(provider.apiKeyEntries[0]?.disabled, true);
  assert.equal(provider.apiKeyEntries[1]?.disabled, false);
});

test('buildOpenAIProviderCard treats provider as enabled when only part of keys are disabled', () => {
  const card = buildOpenAIProviderCard(
    {
      name: 'demo',
      baseUrl: 'https://example.com/v1',
      apiKeyEntries: [
        { apiKey: 'sk-a', disabled: true },
        { apiKey: 'sk-b', disabled: false },
      ],
      excludedModels: [],
    },
    0,
    { bySource: {}, byAuthIndex: {} },
    new Map()
  );

  assert.equal(card.disabledKeyCount, 1);
  assert.equal(card.enabledKeyCount, 1);
  assert.equal(card.enabled, true);
});

test('buildOpenAIProviderCard treats provider as disabled when all keys are disabled', () => {
  const card = buildOpenAIProviderCard(
    {
      name: 'demo',
      baseUrl: 'https://example.com/v1',
      apiKeyEntries: [
        { apiKey: 'sk-a', disabled: true },
        { apiKey: 'sk-b', disabled: true },
      ],
      excludedModels: [],
    },
    0,
    { bySource: {}, byAuthIndex: {} },
    new Map()
  );

  assert.equal(card.disabledKeyCount, 2);
  assert.equal(card.enabledKeyCount, 0);
  assert.equal(card.enabled, false);
});

test('buildOpenAIProviderCard keeps historical stats when part of keys are disabled', () => {
  const disabledKeySource = buildCandidateUsageSourceIds({ apiKey: 'sk-a' })[0];
  const enabledKeySource = buildCandidateUsageSourceIds({ apiKey: 'sk-b' })[0];

  const card = buildOpenAIProviderCard(
    {
      name: 'demo',
      baseUrl: 'https://example.com/v1',
      apiKeyEntries: [
        { apiKey: 'sk-a', disabled: true },
        { apiKey: 'sk-b', disabled: false },
      ],
      excludedModels: [],
    },
    0,
    {
      bySource: {
        [disabledKeySource]: { success: 3, failure: 1 },
        [enabledKeySource]: { success: 2, failure: 4 },
      },
      byAuthIndex: {},
    },
    new Map([
      [disabledKeySource, blocksToStatusBarData([{ success: 3, failure: 1 }], 0, 1)],
      [enabledKeySource, blocksToStatusBarData([{ success: 2, failure: 4 }], 0, 1)],
    ])
  );

  assert.equal(card.success, 5);
  assert.equal(card.failure, 5);
  assert.equal(card.statusData.totalSuccess, 5);
  assert.equal(card.statusData.totalFailure, 5);
});

test('buildOpenAIProviderCard keeps historical stats when all keys are disabled', () => {
  const firstKeySource = buildCandidateUsageSourceIds({ apiKey: 'sk-a' })[0];
  const secondKeySource = buildCandidateUsageSourceIds({ apiKey: 'sk-b' })[0];

  const card = buildOpenAIProviderCard(
    {
      name: 'demo',
      baseUrl: 'https://example.com/v1',
      apiKeyEntries: [
        { apiKey: 'sk-a', disabled: true },
        { apiKey: 'sk-b', disabled: true },
      ],
      excludedModels: [],
    },
    0,
    {
      bySource: {
        [firstKeySource]: { success: 1, failure: 2 },
        [secondKeySource]: { success: 4, failure: 3 },
      },
      byAuthIndex: {},
    },
    new Map([
      [firstKeySource, blocksToStatusBarData([{ success: 1, failure: 2 }], 0, 1)],
      [secondKeySource, blocksToStatusBarData([{ success: 4, failure: 3 }], 0, 1)],
    ])
  );

  assert.equal(card.enabled, false);
  assert.equal(card.success, 5);
  assert.equal(card.failure, 5);
  assert.equal(card.statusData.totalSuccess, 5);
  assert.equal(card.statusData.totalFailure, 5);
});
