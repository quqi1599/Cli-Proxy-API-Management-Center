import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { buildHeaderObject } from '@/utils/headers';
import {
  buildClaudeMessagesEndpoint,
  buildOpenAIChatCompletionsEndpoint,
  buildOpenAIResponsesEndpoint,
  normalizeOpenAIBaseUrl,
} from './utils';
import type { HeaderEntry } from '@/utils/headers';
import type { ProviderKind } from './types';

const TEST_TIMEOUT_MS = 30_000;
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

type HeaderInput = HeaderEntry[] | Record<string, string | undefined | null> | undefined;

type ProviderConnectivityAuthInput = {
  headers?: HeaderInput;
  keyHeaders?: HeaderInput;
  apiKey?: string;
};

type OpenAIStyleConnectivityRequest = {
  endpoint: string;
  data: string;
  invalidEndpointMessage: string;
};

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

const hasHeader = (headers: Record<string, string>, name: string) =>
  Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());

const resolveBearerTokenFromAuthorization = (headers: Record<string, string>) => {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization');
  if (!entry) return '';
  const value = String(entry[1] ?? '').trim();
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
};

const mergeHeaders = (...inputs: HeaderInput[]) => {
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

const buildResolvedHeaders = (input: ProviderConnectivityAuthInput) =>
  mergeHeaders(input.headers, input.keyHeaders);

const buildGeminiGenerateEndpoint = (baseUrl: string, model: string) => {
  const normalized = normalizeOpenAIBaseUrl(baseUrl) || 'https://generativelanguage.googleapis.com';
  let trimmed = normalized.replace(/\/+$/g, '');
  trimmed = trimmed.replace(/\/v1beta\/models\/.*$/i, '');
  trimmed = trimmed.replace(/\/v1beta(?:\/.*)?$/i, '');
  const normalizedModel = String(model ?? '')
    .trim()
    .replace(/^\/?models\//i, '');
  if (!normalizedModel) return '';
  return `${trimmed}/v1beta/models/${normalizedModel}:streamGenerateContent?alt=sse`;
};

export const buildOpenAIStyleConnectivityRequest = (input: {
  provider: ProviderKind;
  baseUrl: string;
  testModel: string;
  stream: boolean;
}): OpenAIStyleConnectivityRequest => {
  if (input.provider === 'codex') {
    return {
      endpoint: buildOpenAIResponsesEndpoint(normalizeOpenAIBaseUrl(input.baseUrl)),
      data: JSON.stringify({
        model: input.testModel,
        input: 'Hi',
        stream: input.stream,
        max_output_tokens: 8,
      }),
      invalidEndpointMessage: 'Invalid Codex endpoint',
    };
  }

  return {
    endpoint: buildOpenAIChatCompletionsEndpoint(input.baseUrl),
    data: JSON.stringify({
      model: input.testModel,
      messages: [{ role: 'user', content: 'Hi' }],
      stream: input.stream,
      max_tokens: 8,
    }),
    invalidEndpointMessage: 'Invalid OpenAI-compatible endpoint',
  };
};

const getErrorMessageFromObject = (input: unknown): string => {
  if (!input || typeof input !== 'object') return '';

  const record = input as Record<string, unknown>;
  const errorValue = record.error;
  if (typeof errorValue === 'string' && errorValue.trim()) {
    return errorValue.trim();
  }
  if (errorValue && typeof errorValue === 'object') {
    const nested = errorValue as Record<string, unknown>;
    const nestedMessage = nested.message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
      return nestedMessage.trim();
    }
    const nestedError = nested.error;
    if (nestedError && typeof nestedError === 'object') {
      const nestedErrorMessage = (nestedError as Record<string, unknown>).message;
      if (typeof nestedErrorMessage === 'string' && nestedErrorMessage.trim()) {
        return nestedErrorMessage.trim();
      }
    }
  }
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim();
  }

  return '';
};

const getErrorMessageFromJSONText = (input: string): string => {
  const text = input.trim();
  if (!text) return '';
  if (text[0] !== '{' && text[0] !== '[') {
    return '';
  }

  try {
    return getErrorMessageFromObject(JSON.parse(text) as unknown);
  } catch {
    return '';
  }
};

const detectErrorFromStreamText = (input: string): string => {
  const text = input.trim();
  if (!text) return '';

  if (/^<!doctype html/i.test(text) || /^<html/i.test(text)) {
    return 'Unexpected HTML response';
  }

  const directError = getErrorMessageFromJSONText(text);
  if (directError) {
    return directError;
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    const payloadError = getErrorMessageFromJSONText(payload);
    if (payloadError) {
      return payloadError;
    }
  }

  return '';
};

const runStreamingConnectivityTest = async (input: {
  url: string;
  header: Record<string, string>;
  data: string;
  proxy?: string;
}) => {
  let responseStatus = 0;
  let responseHeaders: Record<string, string[]> = {};
  let responseBody = '';
  let sawSuccessChunk = false;

  await apiCallApi.requestStream(
    {
      method: 'POST',
      url: input.url,
      header: input.header,
      proxy: input.proxy,
      data: input.data,
      stream: true,
    },
    (event) => {
      if (event.type === 'response') {
        responseStatus = Number(event.statusCode ?? 0);
        responseHeaders = event.header ?? {};
        return;
      }
      if (event.type === 'chunk') {
        const chunk = String(event.chunk ?? '');
        if (!chunk) return;
        responseBody += chunk;
        const errorMessage = detectErrorFromStreamText(responseBody);
        if (errorMessage) throw new Error(errorMessage);
        if (
          !sawSuccessChunk &&
          responseStatus >= 200 &&
          responseStatus < 300 &&
          responseBody.trim()
        ) {
          sawSuccessChunk = true;
        }
        return;
      }
      if (event.type === 'error') {
        throw new Error(String(event.error ?? 'Request failed'));
      }
    },
    { timeout: TEST_TIMEOUT_MS }
  );

  if (sawSuccessChunk) {
    return;
  }

  if (responseStatus < 200 || responseStatus >= 300) {
    throw new Error(
      getApiCallErrorMessage({
        statusCode: responseStatus,
        header: responseHeaders,
        bodyText: responseBody,
        body: null,
      })
    );
  }

  if (!sawSuccessChunk && responseBody.trim()) {
    return;
  }

  if (!sawSuccessChunk) {
    throw new Error('No streamed content received');
  }
};

export const hasProviderConnectivityAuth = (
  provider: ProviderKind,
  input: ProviderConnectivityAuthInput
): boolean => {
  const headers = buildResolvedHeaders(input);
  const apiKey = String(input.apiKey ?? '').trim();

  if (provider === 'claude') {
    return Boolean(
      apiKey || hasHeader(headers, 'x-api-key') || resolveBearerTokenFromAuthorization(headers)
    );
  }

  if (provider === 'gemini') {
    return Boolean(
      apiKey || hasHeader(headers, 'x-goog-api-key') || hasHeader(headers, 'authorization')
    );
  }

  return Boolean(apiKey || hasHeader(headers, 'authorization'));
};

export async function runProviderConnectivityTest(input: {
  provider: ProviderKind;
  baseUrl: string;
  testModel: string;
  headers?: HeaderInput;
  keyHeaders?: HeaderInput;
  apiKey: string;
  proxyUrl?: string;
  stream?: boolean;
}) {
  const provider = input.provider;
  const shouldStream = input.stream ?? true;
  const headers = buildResolvedHeaders(input);
  const apiKey = input.apiKey.trim();
  const proxyUrl = String(input.proxyUrl ?? '').trim();

  if (provider === 'claude') {
    const endpoint = buildClaudeMessagesEndpoint(input.baseUrl);
    if (!endpoint) {
      throw new Error('Invalid Claude endpoint');
    }

    const resolvedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    const hasApiKeyHeader = hasHeader(resolvedHeaders, 'x-api-key');
    const apiKeyFromAuthorization = resolveBearerTokenFromAuthorization(resolvedHeaders);
    const resolvedApiKey = apiKey || apiKeyFromAuthorization;

    if (!hasHeader(resolvedHeaders, 'anthropic-version')) {
      resolvedHeaders['anthropic-version'] = DEFAULT_ANTHROPIC_VERSION;
    }
    if (!Object.prototype.hasOwnProperty.call(resolvedHeaders, 'Anthropic-Version')) {
      resolvedHeaders['Anthropic-Version'] =
        resolvedHeaders['anthropic-version'] ?? DEFAULT_ANTHROPIC_VERSION;
    }
    if (!hasApiKeyHeader && resolvedApiKey) {
      resolvedHeaders['x-api-key'] = resolvedApiKey;
    }
    if (!Object.prototype.hasOwnProperty.call(resolvedHeaders, 'X-Api-Key') && resolvedApiKey) {
      resolvedHeaders['X-Api-Key'] = resolvedApiKey;
    }
    if (shouldStream && !hasHeader(resolvedHeaders, 'accept')) {
      resolvedHeaders.Accept = 'text/event-stream';
    }

    const requestData = JSON.stringify({
      model: input.testModel,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Hi' }],
      stream: shouldStream,
    });

    if (shouldStream) {
      await runStreamingConnectivityTest({
        url: endpoint,
        header: resolvedHeaders,
        proxy: proxyUrl || undefined,
        data: requestData,
      });
      return;
    }

    const result = await apiCallApi.request(
      {
        method: 'POST',
        url: endpoint,
        header: resolvedHeaders,
        proxy: proxyUrl || undefined,
        data: requestData,
      },
      { timeout: TEST_TIMEOUT_MS }
    );
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(getApiCallErrorMessage(result));
    }
    return;
  }

  if (provider === 'gemini') {
    const endpoint = buildGeminiGenerateEndpoint(input.baseUrl, input.testModel);
    if (!endpoint) {
      throw new Error('Invalid Gemini endpoint');
    }

    const resolvedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (apiKey && !hasHeader(resolvedHeaders, 'x-goog-api-key')) {
      resolvedHeaders['x-goog-api-key'] = apiKey;
    }
    if (shouldStream && !hasHeader(resolvedHeaders, 'accept')) {
      resolvedHeaders.Accept = 'text/event-stream';
    }

    const requestData = JSON.stringify({
      contents: [{ parts: [{ text: 'Hi' }] }],
      generationConfig: { maxOutputTokens: 8 },
    });

    if (shouldStream) {
      await runStreamingConnectivityTest({
        url: endpoint,
        header: resolvedHeaders,
        proxy: proxyUrl || undefined,
        data: requestData,
      });
      return;
    }

    const result = await apiCallApi.request(
      {
        method: 'POST',
        url: endpoint,
        header: resolvedHeaders,
        proxy: proxyUrl || undefined,
        data: requestData,
      },
      { timeout: TEST_TIMEOUT_MS }
    );
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(getApiCallErrorMessage(result));
    }
    return;
  }

  const {
    endpoint,
    data: requestData,
    invalidEndpointMessage,
  } = buildOpenAIStyleConnectivityRequest({
    provider,
    baseUrl: input.baseUrl,
    testModel: input.testModel,
    stream: shouldStream,
  });
  if (!endpoint) {
    throw new Error(invalidEndpointMessage);
  }

  const resolvedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };
  if (apiKey && !hasHeader(resolvedHeaders, 'authorization')) {
    resolvedHeaders.Authorization = `Bearer ${apiKey}`;
  }
  if (shouldStream && !hasHeader(resolvedHeaders, 'accept')) {
    resolvedHeaders.Accept = 'text/event-stream';
  }

  if (shouldStream) {
    await runStreamingConnectivityTest({
      url: endpoint,
      header: resolvedHeaders,
      proxy: proxyUrl || undefined,
      data: requestData,
    });
    return;
  }

  const result = await apiCallApi.request(
    {
      method: 'POST',
      url: endpoint,
      header: resolvedHeaders,
      proxy: proxyUrl || undefined,
      data: requestData,
    },
    { timeout: TEST_TIMEOUT_MS }
  );
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(getApiCallErrorMessage(result));
  }
}

export const resolveConnectivityErrorMessage = (
  provider: ProviderKind,
  err: unknown,
  t: (key: string, options?: Record<string, unknown>) => string
) => {
  const message = getErrorMessage(err);
  const errorCode =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: string }).code)
      : '';
  const lowerMessage = message.toLowerCase();
  const isAbort =
    errorCode === 'ERR_CANCELED' ||
    lowerMessage.includes('abort') ||
    lowerMessage.includes('signal is aborted');
  const isTimeout =
    errorCode === 'ECONNABORTED' ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    isAbort;
  if (!isTimeout) {
    return message;
  }
  if (provider === 'claude') {
    return t('ai_providers.claude_test_timeout', { seconds: TEST_TIMEOUT_MS / 1000 });
  }
  if (provider === 'gemini') {
    return t('ai_providers.gemini_test_timeout', { seconds: TEST_TIMEOUT_MS / 1000 });
  }
  if (provider === 'codex') {
    return t('ai_providers.codex_test_timeout', { seconds: TEST_TIMEOUT_MS / 1000 });
  }
  return t('ai_providers.openai_test_timeout', { seconds: TEST_TIMEOUT_MS / 1000 });
};
