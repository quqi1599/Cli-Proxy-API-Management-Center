import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { copyToClipboard } from '@/utils/clipboard';
import type { StatusBarData } from '@/utils/usage';
import { useNotificationStore } from '@/stores';
import { hasProviderConnectivityAuth } from './providerConnectivity';
import { ProviderStatusBar } from './ProviderStatusBar';
import type { ProviderKeyEntryDraft, ProviderKind } from './types';
import styles from '@/pages/AiProvidersPage.module.scss';

type ProviderKeyEntriesEditorProps = {
  provider: ProviderKind;
  entries: ProviderKeyEntryDraft[];
  disabled?: boolean;
  testing?: boolean;
  hasConfiguredModels?: boolean;
  globalHeaders?: Array<{ key: string; value: string }>;
  showStatusColumn?: boolean;
  showProxyColumn?: boolean;
  showEnabledToggle?: boolean;
  highlightIndexes?: number[];
  statusBarDataByEntry?: StatusBarData[];
  singleEntryMode?: boolean;
  onChange: (entries: ProviderKeyEntryDraft[]) => void;
  onTestOne?: (index: number) => Promise<void> | void;
  onAdd?: () => void;
};

const buildEmptyEntry = (): ProviderKeyEntryDraft => ({
  apiKey: '',
  proxyUrl: '',
  headers: [],
  testStatus: 'idle',
  testMessage: '',
});

export function ProviderKeyEntriesEditor({
  provider,
  entries,
  disabled = false,
  testing = false,
  hasConfiguredModels = true,
  globalHeaders = [],
  showStatusColumn = true,
  showProxyColumn = true,
  showEnabledToggle = true,
  highlightIndexes = [],
  statusBarDataByEntry = [],
  singleEntryMode = false,
  onChange,
  onTestOne,
  onAdd,
}: ProviderKeyEntriesEditorProps) {
  const { t } = useTranslation();
  const [detailEntryIndex, setDetailEntryIndex] = useState<number | null>(null);
  const tableColumns = showProxyColumn
    ? `${showStatusColumn ? '38px 172px ' : '38px '}minmax(0, 1.95fr) minmax(0, 1.9fr) 268px`
    : `${showStatusColumn ? '38px 172px ' : '38px '}minmax(0, 1.95fr) 268px`;
  const testKey =
    provider === 'gemini'
      ? 'gemini'
      : provider === 'codex'
        ? 'codex'
        : provider === 'claude'
          ? 'claude'
          : 'openai';
  const { showNotification } = useNotificationStore();
  const list = entries.length ? entries : [buildEmptyEntry()];
  const keyPlaceholderKey =
    provider === 'openai'
      ? 'ai_providers.openai_key_placeholder'
      : `ai_providers.${provider}_add_modal_key_placeholder`;
  const proxyPlaceholderKey =
    provider === 'openai'
      ? 'ai_providers.openai_proxy_placeholder'
      : `ai_providers.${provider}_add_modal_proxy_placeholder`;

  const toggleEnabled = (index: number) => {
    updateEntries(
      list.map((entry, currentIndex) =>
        currentIndex === index ? { ...entry, enabled: !(entry.enabled ?? true) } : entry
      )
    );
  };

  const updateEntries = useCallback(
    (next: ProviderKeyEntryDraft[]) => {
      onChange(next.length ? next : [buildEmptyEntry()]);
    },
    [onChange]
  );

  const updateEntry = (index: number, patch: Partial<ProviderKeyEntryDraft>) => {
    updateEntries(
      list.map((entry, currentIndex) => {
        if (currentIndex !== index) return entry;
        const connectivityChanged =
          ('apiKey' in patch && patch.apiKey !== entry.apiKey) ||
          ('proxyUrl' in patch && patch.proxyUrl !== entry.proxyUrl) ||
          ('headers' in patch && patch.headers !== entry.headers);
        return {
          ...entry,
          ...patch,
          authIndex: connectivityChanged ? undefined : (patch.authIndex ?? entry.authIndex),
          testStatus: patch.testStatus ?? 'idle',
          testMessage: patch.testMessage ?? '',
        };
      })
    );
  };

  const addEntry = () => {
    if (singleEntryMode) {
      return;
    }
    if (onAdd) {
      onAdd();
      return;
    }
    updateEntries([...list, buildEmptyEntry()]);
  };

  const removeEntry = (index: number) => {
    if (singleEntryMode) {
      return;
    }
    updateEntries(list.filter((_, currentIndex) => currentIndex !== index));
  };

  const copyApiKey = async (value: string) => {
    const copied = await copyToClipboard(value);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  };

  const detailEntry = detailEntryIndex === null ? null : list[detailEntryIndex];

  return (
    <>
      <div className={styles.keyEntriesList}>
        <div className={styles.keyEntriesToolbar}>
          <span className={styles.keyEntriesCount}>
            {t('ai_providers.openai_keys_count', { defaultValue: '密钥数量' })}: {list.length}
          </span>
          <div className={styles.modelTestPanelActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={addEntry}
              disabled={disabled || testing || singleEntryMode}
              className={styles.addKeyButton}
            >
              {t('ai_providers.openai_keys_add_btn', { defaultValue: '添加密钥' })}
            </Button>
          </div>
        </div>
        <div className={styles.keyTableShell}>
          <div
            className={styles.keyTableHeader}
            style={{
              gridTemplateColumns: tableColumns,
              minWidth: 0,
            }}
          >
            <div className={styles.keyTableColIndex}>#</div>
            {showStatusColumn ? (
              <div className={styles.keyTableColStatus}>{t('common.status')}</div>
            ) : null}
            <div className={styles.keyTableColKey}>{t('common.api_key')}</div>
            {showProxyColumn ? (
              <div className={styles.keyTableColProxy}>{t('common.proxy_url')}</div>
            ) : null}
            <div className={styles.keyTableColAction}>{t('common.action')}</div>
          </div>
          {list.map((entry, index) => {
            const canTestKey =
              hasConfiguredModels &&
              hasProviderConnectivityAuth(provider, {
                headers: globalHeaders,
                keyHeaders: entry.headers,
                apiKey: entry.apiKey,
              });
            return (
              <div
                key={index}
                className={`${styles.keyTableRow} ${highlightIndexes.includes(index) ? styles.keyTableRowDuplicate : ''}`}
                style={{
                  gridTemplateColumns: tableColumns,
                  minWidth: 0,
                }}
              >
                <div className={styles.keyTableColIndex}>{index + 1}</div>
                {showStatusColumn ? (
                  <div className={styles.keyTableColStatus}>
                    <div className={styles.keyTableStatusCell}>
                      <ProviderStatusBar
                        statusData={statusBarDataByEntry[index]}
                        styles={{
                          statusBar: styles.statusBar,
                          statusBlocks: `${styles.statusBlocks} ${styles.keyTableStatusBlocks}`,
                          statusBlockWrapper: `${styles.statusBlockWrapper} ${styles.keyTableStatusBlockWrapper}`,
                          statusBlockActive: styles.statusBlockActive,
                          statusBlock: styles.statusBlock,
                          statusBlockIdle: styles.statusBlockIdle,
                          statusTooltip: styles.statusTooltip,
                          tooltipTime: styles.tooltipTime,
                          tooltipStats: styles.tooltipStats,
                          tooltipSuccess: styles.tooltipSuccess,
                          tooltipFailure: styles.tooltipFailure,
                          tooltipRate: styles.tooltipRate,
                          statusRate: `${styles.statusRate} ${styles.keyTableStatusRateHidden}`,
                          statusRateHigh: styles.statusRateHigh,
                          statusRateMedium: styles.statusRateMedium,
                          statusRateLow: styles.statusRateLow,
                        }}
                      />
                      <div className={styles.keyTableStatusStatsColumn}>
                        <div className={styles.keyTableStatusStatsTop}>
                          <span className={`${styles.statPill} ${styles.statSuccess}`}>
                            {t('status_bar.success_short', { defaultValue: '成' })}
                            {statusBarDataByEntry[index]?.totalSuccess ?? 0}
                          </span>
                        </div>
                        <div className={styles.keyTableStatusStatsBottom}>
                          <span className={`${styles.statPill} ${styles.statFailure}`}>
                            {t('status_bar.failure_short', { defaultValue: '败' })}
                            {statusBarDataByEntry[index]?.totalFailure ?? 0}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className={styles.keyTableColKey}>
                  <input
                    type="text"
                    value={entry.apiKey}
                    onChange={(event) => updateEntry(index, { apiKey: event.target.value })}
                    onKeyDown={(event) => {
                      if (singleEntryMode) return;
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      updateEntries([
                        ...list.slice(0, index + 1),
                        buildEmptyEntry(),
                        ...list.slice(index + 1),
                      ]);
                    }}
                    onPaste={(event) => {
                      if (singleEntryMode) return;
                      const pasted = event.clipboardData.getData('text');
                      if (!/[\r\n]+/.test(pasted)) return;
                      event.preventDefault();
                      const values = pasted
                        .split(/\r?\n+/)
                        .map((value) => value.trim())
                        .filter(Boolean)
                        .map((apiKey) => ({ ...buildEmptyEntry(), apiKey }));
                      if (!values.length) return;
                      updateEntries([...list.slice(0, index), ...values, ...list.slice(index + 1)]);
                    }}
                    disabled={disabled || testing}
                    className={`input ${styles.keyTableInput} ${highlightIndexes.includes(index) ? styles.keyTableInputDuplicate : ''}`}
                    placeholder={t(keyPlaceholderKey, { defaultValue: t('common.api_key') })}
                  />
                </div>
                {showProxyColumn ? (
                  <div className={styles.keyTableColProxy}>
                    <input
                      type="text"
                      value={entry.proxyUrl}
                      onChange={(event) => updateEntry(index, { proxyUrl: event.target.value })}
                      disabled={disabled || testing}
                      className={`input ${styles.keyTableInput} ${highlightIndexes.includes(index) ? styles.keyTableInputDuplicate : ''}`}
                      placeholder={t(proxyPlaceholderKey, { defaultValue: t('common.proxy_url') })}
                    />
                  </div>
                ) : null}
                <div className={styles.keyTableColAction}>
                  {showEnabledToggle ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => toggleEnabled(index)}
                      disabled={disabled || testing}
                      className={`${styles.providerActionButtonCompact} ${styles.keyTableActionButton} ${(entry.enabled ?? true) ? styles.providerDisableButton : styles.providerEnableButton}`}
                    >
                      {(entry.enabled ?? true)
                        ? t('common.disable', { defaultValue: '禁用' })
                        : t('common.enable', { defaultValue: '启用' })}
                    </Button>
                  ) : null}
                  {onTestOne ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onTestOne(index)}
                      disabled={disabled || testing || !canTestKey}
                      loading={entry.testStatus === 'loading'}
                      className={`${styles.providerActionButtonCompact} ${styles.keyTableActionButton}`}
                    >
                      {t(`ai_providers.${testKey}_test_single_action`, { defaultValue: '测试' })}
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void copyApiKey(entry.apiKey)}
                    disabled={disabled || testing || !entry.apiKey.trim()}
                    className={`${styles.providerActionButtonCompact} ${styles.keyTableActionButton}`}
                  >
                    {t('common.copy')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => removeEntry(index)}
                    disabled={disabled || testing || singleEntryMode || list.length <= 1}
                    className={`${styles.providerActionButtonCompact} ${styles.keyTableActionButton} ${styles.providerDisableButton}`}
                  >
                    {t('common.delete')}
                  </Button>
                  {entry.testStatus === 'error' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className={`${styles.providerActionButtonCompact} ${styles.keyTableActionButton} ${styles.providerDisableButton} ${styles.keyInlineResultButton} ${styles.keyInlineStatusBadgeClickable}`}
                      onClick={() => setDetailEntryIndex(index)}
                    >
                      {t('common.failure', { defaultValue: '失败' })}
                    </Button>
                  ) : entry.testStatus === 'success' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled
                      className={`${styles.providerActionButtonCompact} ${styles.keyTableActionButton} ${styles.providerEnableButton} ${styles.keyInlineResultButton}`}
                    >
                      {t('common.success', { defaultValue: '成功' })}
                    </Button>
                  ) : entry.testStatus === 'loading' ? (
                    <span className={`status-badge warning ${styles.keyInlineStatusBadge}`}>
                      {t('common.loading', { defaultValue: '测试中' })}
                    </span>
                  ) : (
                    <span
                      className={`${styles.keyInlineTestResult} ${styles.keyInlineTestResultIdle}`}
                    >
                      {t('common.not_tested', { defaultValue: '未测试' })}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Modal
        open={detailEntry !== null}
        title={t('ai_providers.openai_test_failed', { defaultValue: '测试失败' })}
        onClose={() => setDetailEntryIndex(null)}
        width={520}
        footer={
          <Button variant="secondary" size="sm" onClick={() => setDetailEntryIndex(null)}>
            {t('common.close')}
          </Button>
        }
      >
        <div className={styles.keyStatusModalContent}>
          <div className={styles.keyStatusModalRow}>
            <div className={styles.keyStatusModalLabel}>{t('common.api_key')}</div>
            <div className={styles.keyStatusModalMessage}>{detailEntry?.apiKey || '--'}</div>
          </div>
          <div className={styles.keyStatusModalRow}>
            <div className={styles.keyStatusModalLabel}>{t('common.status')}</div>
            <span className="status-badge error">
              {t('common.failure', { defaultValue: '失败' })}
            </span>
          </div>
          <div className={styles.keyStatusModalRow}>
            <div className={styles.keyStatusModalLabel}>
              {t('common.details', { defaultValue: '详情' })}
            </div>
            <div className={styles.keyStatusModalMessage}>
              {detailEntry?.testMessage || t('common.no_data', { defaultValue: '暂无详情' })}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
