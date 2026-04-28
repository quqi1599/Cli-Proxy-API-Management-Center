/**
 * Generic API call helper (proxied via management API).
 */

import type { AxiosRequestConfig } from 'axios';
import { apiClient } from './client';
import type { ApiCallResponse, ApiCallStreamEventPayload, ApiResponseValue } from '@/types';
import { isRecord, parseJsonRecord } from '@/utils/errors';

export interface ApiCallRequest {
  authIndex?: string;
  method: string;
  url: string;
  header?: Record<string, string>;
  data?: string;
  proxy?: string;
  stream?: boolean;
}

export interface ApiCallResult<T = ApiResponseValue> {
  statusCode: number;
  header: Record<string, string[]>;
  bodyText: string;
  body: T | null;
}

export interface ApiCallStreamEvent {
  type: 'response' | 'chunk' | 'done' | 'error';
  statusCode?: number;
  header?: Record<string, string[]>;
  chunk?: string;
  error?: string;
}

export interface ApiCallStreamConfig {
  signal?: AbortSignal;
  timeout?: number;
}

const normalizeBody = (
  input: ApiResponseValue | undefined
): { bodyText: string; body: ApiResponseValue | null } => {
  if (input === undefined || input === null) {
    return { bodyText: '', body: null };
  }

  if (typeof input === 'string') {
    const text = input;
    const trimmed = text.trim();
    if (!trimmed) {
      return { bodyText: text, body: null };
    }
    try {
      return { bodyText: text, body: JSON.parse(trimmed) };
    } catch {
      return { bodyText: text, body: text };
    }
  }

  try {
    return { bodyText: JSON.stringify(input), body: input };
  } catch {
    return { bodyText: String(input), body: input };
  }
};

const normalizeStreamEvent = (input: ApiCallStreamEventPayload): ApiCallStreamEvent => ({
  type: String(input.type ?? '') as ApiCallStreamEvent['type'],
  statusCode: Number(input.statusCode ?? input.status_code ?? 0) || undefined,
  header: input.header ?? input.headers,
  chunk: typeof input.chunk === 'string' ? input.chunk : undefined,
  error: typeof input.error === 'string' ? input.error : undefined,
});

export const getApiCallErrorMessage = (result: ApiCallResult): string => {
  const status = result.statusCode;
  const body = result.body;
  const bodyText = result.bodyText;
  let message = '';

  if (isRecord(body)) {
    const errorValue = body.error;
    if (isRecord(errorValue) && typeof errorValue.message === 'string') {
      message = errorValue.message;
    } else if (typeof errorValue === 'string') {
      message = errorValue;
    }
    if (!message && typeof body.message === 'string') {
      message = body.message;
    }
  } else if (typeof body === 'string') {
    message = body;
  }

  if (!message && bodyText) {
    message = bodyText;
  }

  if (status && message) return `${status} ${message}`.trim();
  if (status) return `HTTP ${status}`;
  return message || 'Request failed';
};

const buildAbortSignal = (config?: ApiCallStreamConfig) => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abortWithReason = (reason: unknown) => {
    if (controller.signal.aborted) {
      return;
    }
    controller.abort(reason);
  };

  const timeoutReason =
    typeof DOMException === 'function'
      ? new DOMException('Request timed out', 'TimeoutError')
      : new Error('Request timed out');

  const handleExternalAbort = () => {
    abortWithReason(config?.signal?.reason ?? new Error('Request aborted'));
  };
  if (config?.signal) {
    if (config.signal.aborted) {
      handleExternalAbort();
    } else {
      config.signal.addEventListener('abort', handleExternalAbort, { once: true });
    }
  }

  if (config?.timeout && Number.isFinite(config.timeout) && config.timeout > 0) {
    timeoutId = setTimeout(() => abortWithReason(timeoutReason), config.timeout);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      if (config?.signal) {
        config.signal.removeEventListener('abort', handleExternalAbort);
      }
    },
  };
};

export const apiCallApi = {
  request: async (payload: ApiCallRequest, config?: AxiosRequestConfig): Promise<ApiCallResult> => {
    const response = await apiClient.post<ApiCallResponse>('/api-call', payload, config);
    const statusCode = Number(response?.status_code ?? response?.statusCode ?? 0);
    const header = (response?.header ?? response?.headers ?? {}) as Record<string, string[]>;
    const { bodyText, body } = normalizeBody(response?.body);

    return {
      statusCode,
      header,
      bodyText,
      body,
    };
  },

  requestStream: async (
    payload: ApiCallRequest,
    onEvent: (event: ApiCallStreamEvent) => void,
    config?: ApiCallStreamConfig
  ): Promise<void> => {
    const { baseUrl, managementKey } = apiClient.getFetchContext();
    const { signal, cleanup } = buildAbortSignal(config);

    try {
      const response = await fetch(`${baseUrl}/api-call`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managementKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...payload, stream: payload.stream ?? true }),
        signal,
      });

      if (!response.ok) {
        const message = (await response.text().catch(() => '')).trim();
        throw new Error(message || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Stream response body is unavailable');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parsed = parseJsonRecord(trimmed);
          if (parsed) {
            onEvent(normalizeStreamEvent(parsed));
          }
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        const parsed = parseJsonRecord(buffer.trim());
        if (parsed) {
          onEvent(normalizeStreamEvent(parsed));
        }
      }
    } finally {
      cleanup();
    }
  },
};
