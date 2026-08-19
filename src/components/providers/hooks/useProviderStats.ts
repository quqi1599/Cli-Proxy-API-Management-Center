import { useCallback, useRef, useState } from 'react';
import { useInterval } from '@/hooks/useInterval';
import { monitorApi, type MonitorKeyStatsResponse } from '@/services/api/monitor';
import {
  blocksToStatusBarData,
  normalizeUsageSourceId,
  type KeyStats,
  type StatusBarData,
} from '@/utils/usage';

const STALE_TIME_MS = 240_000;

const EMPTY_KEY_STATS: KeyStats = { bySource: {}, byAuthIndex: {} };

function processKeyStatsResponse(response: MonitorKeyStatsResponse) {
  const { by_source, by_auth_index, block_config } = response;

  const bySource: Record<string, { success: number; failure: number }> = {};
  const byAuthIndex: Record<string, { success: number; failure: number }> = {};
  const statusBarBySource = new Map<string, StatusBarData>();
  const registerSource = (sourceKey: string, entry: (typeof by_source)[string]) => {
    const statusBar = blocksToStatusBarData(
      entry.blocks,
      block_config.window_start_ms,
      block_config.duration_ms
    );
    const normalizedKey = normalizeUsageSourceId(sourceKey);
    const aliases = normalizedKey && normalizedKey !== sourceKey ? [sourceKey, normalizedKey] : [sourceKey];

    aliases.forEach((alias) => {
      if (!alias) return;
      if (!(alias in bySource)) {
        bySource[alias] = { success: entry.success, failure: entry.failure };
      }
      if (!statusBarBySource.has(alias)) {
        statusBarBySource.set(alias, statusBar);
      }
    });
  };

  for (const [key, entry] of Object.entries(by_source)) {
    registerSource(key, entry);
  }
  for (const [key, entry] of Object.entries(by_auth_index)) {
    byAuthIndex[key] = { success: entry.success, failure: entry.failure };
  }

  return {
    keyStats: { bySource, byAuthIndex } as KeyStats,
    statusBarBySource,
  };
}

export const useProviderStats = () => {
  const [keyStats, setKeyStats] = useState<KeyStats>(EMPTY_KEY_STATS);
  const [statusBarBySource, setStatusBarBySource] = useState<Map<string, StatusBarData>>(
    () => new Map()
  );
  const [isLoading, setIsLoading] = useState(false);
  const lastRefreshedAt = useRef<number | null>(null);

  const loadKeyStats = useCallback(async () => {
    if (lastRefreshedAt.current && Date.now() - lastRefreshedAt.current < STALE_TIME_MS) {
      return;
    }
    setIsLoading(true);
    try {
      const keyStatsResponse = await monitorApi.getKeyStats();
      const result = processKeyStatsResponse(keyStatsResponse);
      setKeyStats(result.keyStats);
      setStatusBarBySource(result.statusBarBySource);
      lastRefreshedAt.current = Date.now();
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshKeyStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const keyStatsResponse = await monitorApi.getKeyStats();
      const result = processKeyStatsResponse(keyStatsResponse);
      setKeyStats(result.keyStats);
      setStatusBarBySource(result.statusBarBySource);
      lastRefreshedAt.current = Date.now();
    } finally {
      setIsLoading(false);
    }
  }, []);

  useInterval(() => {
    void refreshKeyStats().catch(() => {});
  }, 240_000);

  return { keyStats, statusBarBySource, loadKeyStats, refreshKeyStats, isLoading };
};
