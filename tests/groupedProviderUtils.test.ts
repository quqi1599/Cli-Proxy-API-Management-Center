import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProviderGroupCard,
  buildProviderConfigsFromGroupForm,
  buildProviderGroupFormState,
  findProviderGroupBySignature,
  groupProviderConfigs,
} from '../src/components/providers/groupedProviderUtils.ts';
import { normalizeConfigResponse } from '../src/services/api/transformers.ts';
import type { GeminiKeyConfig, ProviderKeyConfig } from '../src/types/provider.ts';
import { EMPTY_STATUS_BAR } from '../src/utils/usage.ts';

test('normalizeConfigResponse preserves auth indexes for grouped providers', () => {
  const config = normalizeConfigResponse({
    'gemini-api-key': [{ 'api-key': 'gemini-key', 'auth-index': 'gemini-auth' }],
    'codex-api-key': [{ 'api-key': 'codex-key', auth_index: 'codex-auth' }],
    'claude-api-key': [{ 'api-key': 'claude-key', authIndex: 'claude-auth' }],
  });

  assert.equal(config.geminiApiKeys?.[0]?.authIndex, 'gemini-auth');
  assert.equal(config.codexApiKeys?.[0]?.authIndex, 'codex-auth');
  assert.equal(config.claudeApiKeys?.[0]?.authIndex, 'claude-auth');
});

test('buildProviderGroupCard prefers stable auth-index stats and status blocks', () => {
  const group = groupProviderConfigs('codex', [
    {
      apiKey: 'rotated-secret',
      authIndex: 'stable-auth',
      baseUrl: 'https://example.com',
    },
  ] satisfies ProviderKeyConfig[])[0]!;
  const authStatus = {
    ...EMPTY_STATUS_BAR,
    successRate: 80,
    totalSuccess: 8,
    totalFailure: 2,
  };

  const card = buildProviderGroupCard(
    group,
    {
      bySource: {},
      byAuthIndex: { 'stable-auth': { success: 8, failure: 2 } },
    },
    new Map([['stable-auth', authStatus]])
  );

  assert.equal(card.success, 8);
  assert.equal(card.failure, 2);
  assert.equal(card.statusData, authStatus);
});

test('groupProviderConfigs splits gemini groups when headers differ', () => {
  const groups = groupProviderConfigs('gemini', [
    {
      apiKey: 'k1',
      baseUrl: 'https://example.com',
      prefix: 'team',
      headers: { 'X-Env': 'a' },
    },
    {
      apiKey: 'k2',
      baseUrl: 'https://example.com',
      prefix: 'team',
      headers: { 'X-Env': 'b' },
    },
  ] satisfies GeminiKeyConfig[]);

  assert.equal(groups.length, 2);
  assert.notEqual(groups[0]?.id, groups[1]?.id);
});

test('groupProviderConfigs keeps equivalent headers in one gemini group', () => {
  const groups = groupProviderConfigs('gemini', [
    {
      apiKey: 'k1',
      baseUrl: 'https://example.com',
      prefix: 'team',
      headers: { 'X-Env': 'a', 'X-Region': 'us' },
    },
    {
      apiKey: 'k2',
      baseUrl: 'https://example.com',
      prefix: 'team',
      headers: { 'x-region': 'us', 'x-env': 'a' },
    },
  ] satisfies GeminiKeyConfig[]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.configs.length, 2);
});

test('groupProviderConfigs keeps enabled and disabled keys in one provider group', () => {
  const groups = groupProviderConfigs('claude', [
    {
      apiKey: 'disabled-key',
      baseUrl: 'https://api.anthropic.com',
      prefix: 'team',
      priority: 5,
      models: [{ name: 'claude-sonnet', alias: 'claude-sonnet' }],
      excludedModels: ['legacy-model', '*'],
    },
    {
      apiKey: 'enabled-key',
      baseUrl: 'https://api.anthropic.com',
      prefix: 'team',
      priority: 5,
      models: [{ name: 'claude-sonnet', alias: 'claude-sonnet' }],
      excludedModels: ['legacy-model'],
    },
  ] satisfies ProviderKeyConfig[]);

  assert.equal(groups.length, 1);
  const group = groups[0]!;
  assert.equal(group.configs.length, 2);
  assert.equal(group.enabledCount, 1);
  assert.equal(group.disabledCount, 1);
  assert.equal(group.enabled, true);
  assert.deepEqual(group.excludedModels, ['legacy-model']);

  const form = buildProviderGroupFormState(group);
  assert.deepEqual(
    form.keyEntries.map((entry) => entry.enabled),
    [false, true]
  );

  const rebuilt = buildProviderConfigsFromGroupForm(form);
  assert.equal(rebuilt[0]?.excludedModels?.includes('*'), true);
  assert.equal(rebuilt[1]?.excludedModels?.includes('*'), false);
});

test('groupProviderConfigs still splits groups with different model exclusions', () => {
  const groups = groupProviderConfigs('claude', [
    {
      apiKey: 'disabled-key',
      baseUrl: 'https://api.anthropic.com',
      excludedModels: ['model-a', '*'],
    },
    {
      apiKey: 'enabled-key',
      baseUrl: 'https://api.anthropic.com',
      excludedModels: ['model-b'],
    },
  ] satisfies ProviderKeyConfig[]);

  assert.equal(groups.length, 2);
});

test('groupProviderConfigs splits claude groups when cloak differs', () => {
  const groups = groupProviderConfigs('claude', [
    {
      apiKey: 'k1',
      baseUrl: 'https://api.anthropic.com',
      cloak: { mode: 'auto' },
    },
    {
      apiKey: 'k2',
      baseUrl: 'https://api.anthropic.com',
      cloak: { mode: 'always' },
    },
  ] satisfies ProviderKeyConfig[]);

  assert.equal(groups.length, 2);
});

test('groupProviderConfigs splits codex groups when websockets differs', () => {
  const groups = groupProviderConfigs('codex', [
    {
      apiKey: 'k1',
      baseUrl: 'https://example.com',
      websockets: false,
    },
    {
      apiKey: 'k2',
      baseUrl: 'https://example.com',
      websockets: true,
    },
  ] satisfies ProviderKeyConfig[]);

  assert.equal(groups.length, 2);
});

test('findProviderGroupBySignature returns only the matching group', () => {
  const groups = groupProviderConfigs('gemini', [
    {
      apiKey: 'k1',
      baseUrl: 'https://example.com',
      prefix: 'team',
      headers: { 'X-Env': 'a' },
    },
    {
      apiKey: 'k2',
      baseUrl: 'https://example.com',
      prefix: 'team',
      headers: { 'X-Env': 'b' },
    },
  ] satisfies GeminiKeyConfig[]);

  const target = groups[1];
  const found = findProviderGroupBySignature(groups, target?.id);

  assert.equal(found?.id, target?.id);
  assert.deepEqual(found?.indexes, [1]);
});

test('buildProviderConfigsFromGroupForm preserves one group with multiple keys and per-key proxy urls', () => {
  const groups = groupProviderConfigs('gemini', [
    {
      apiKey: 'k1',
      baseUrl: 'https://example.com',
      prefix: 'team',
      proxyUrl: 'http://proxy-a',
      headers: { 'X-Env': 'a' },
    },
    {
      apiKey: 'k2',
      baseUrl: 'https://example.com',
      prefix: 'team',
      proxyUrl: 'http://proxy-b',
      headers: { 'X-Env': 'a' },
    },
  ] satisfies GeminiKeyConfig[]);

  const form = buildProviderGroupFormState(groups[0]!);
  const rebuilt = buildProviderConfigsFromGroupForm(form);

  assert.equal(rebuilt.length, 2);
  assert.equal(rebuilt[0]?.proxyUrl, 'http://proxy-a');
  assert.equal(rebuilt[1]?.proxyUrl, 'http://proxy-b');
  assert.deepEqual(
    rebuilt.map((entry) => entry.headers),
    [{ 'X-Env': 'a' }, { 'X-Env': 'a' }]
  );
});
