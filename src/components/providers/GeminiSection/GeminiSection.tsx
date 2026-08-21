import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import iconGemini from '@/assets/icons/gemini.svg';
import type { GeminiKeyConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import type { KeyStats, StatusBarData } from '@/utils/usage';
import styles from '@/pages/AiProvidersPage.module.scss';
import { ProviderList } from '../ProviderList';
import { ProviderStatusBar } from '../ProviderStatusBar';
import {
  buildProviderIdentityPresentation,
  formatProviderEndpoint,
  summarizeMappings,
} from '../utils';
import { buildProviderGroupCard, groupProviderConfigs } from '../groupedProviderUtils';
import type { ProviderConfigGroup } from '../types';

interface GeminiSectionProps {
  configs: GeminiKeyConfig[];
  keyStats: KeyStats;
  statusBarBySource: Map<string, StatusBarData>;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  onAdd: () => void;
  onDuplicate: (signature: string) => void;
  onEdit: (signature: string) => void;
  onDelete: (signature: string) => void;
  onToggle: (signature: string, enabled: boolean) => void;
}

export function GeminiSection({
  configs,
  keyStats,
  statusBarBySource,
  loading,
  disableControls,
  isSwitching,
  onAdd,
  onDuplicate,
  onEdit,
  onDelete,
  onToggle,
}: GeminiSectionProps) {
  const { t } = useTranslation();
  const actionsDisabled = disableControls || loading || isSwitching;
  const toggleDisabled = disableControls || loading || isSwitching;
  const groups = groupProviderConfigs('gemini', configs);

  return (
    <>
      <Card
        title={
          <span className={styles.cardTitle}>
            <img src={iconGemini} alt="" className={styles.cardTitleIcon} />
            {t('ai_providers.gemini_title')}
          </span>
        }
        extra={
          <Button size="sm" onClick={onAdd} disabled={actionsDisabled}>
            {t('ai_providers.gemini_add_button')}
          </Button>
        }
      >
        <ProviderList<ProviderConfigGroup<GeminiKeyConfig>>
          items={groups}
          loading={loading}
          keyField={(item) => item.id}
          getActionIndex={(item) => item.id}
          listClassName={styles.providerTableList}
          rowClassName={styles.providerTableRow}
          metaClassName={styles.providerTableMeta}
          actionsClassName={styles.providerTableActions}
          actionButtonClassName={styles.providerActionButton}
          emptyTitle={t('ai_providers.gemini_empty_title')}
          emptyDescription={t('ai_providers.gemini_empty_desc')}
          onEdit={(action) => onEdit(String(action))}
          onDelete={(action) => onDelete(String(action))}
          actionsDisabled={actionsDisabled}
          getRowDisabled={(item) => !item.enabled}
          extraActionButtons={(item) => (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onDuplicate(item.id)}
              disabled={actionsDisabled}
              className={styles.providerActionButton}
            >
              {t('common.copy')}
            </Button>
          )}
          renderExtraActions={(item) => (
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.providerActionButton} ${
                item.enabled ? styles.providerDisableButton : styles.providerEnableButton
              }`}
              disabled={toggleDisabled}
              onClick={() => void onToggle(item.id, !item.enabled)}
            >
              {item.enabled ? '禁用' : '启用'}
            </Button>
          )}
          renderContent={(item, index) => {
            const card = buildProviderGroupCard(item, keyStats, statusBarBySource);
            const excludedModels = item.excludedModels ?? [];
            const mappingSummary = summarizeMappings(
              [
                ...(item.models ?? []).map((model) => ({
                  source: model.alias || model.name,
                  target: model.name,
                })),
                ...excludedModels.map((model) => ({
                  source: model,
                  target: '已排除',
                  muted: true,
                })),
              ],
              6
            );
            const endpoint = formatProviderEndpoint(item.baseUrl);
            const identity = buildProviderIdentityPresentation({
              primary: item.prefix?.trim(),
              endpoint,
              fallback: `${t('ai_providers.gemini_item_title')} #${index + 1}`,
            });
            const maskedKeys = item.configs
              .slice(0, 2)
              .map((config) => maskApiKey(config.apiKey))
              .join(' / ');

            return (
              <Fragment>
                <div className={styles.providerCardHeader}>
                  <div className={styles.providerCardLead}>
                    <div className={`${styles.providerMetaLine} ${styles.providerMetaInline}`}>
                      <span>{t('common.priority')}:</span>
                      <span className={styles.providerPriorityBadge}>{item.priority ?? 0}</span>
                    </div>
                    <div className={styles.providerMainTitle}>
                      {t('ai_providers.gemini_item_title')} #{index + 1}
                    </div>
                    <div
                      className={`${styles.providerKeyGroup} ${
                        identity.titleTone === 'endpoint' ? styles.providerEndpointTitle : ''
                      }`}
                    >
                      {identity.title}
                    </div>
                    {identity.subtitle && (
                      <div className={styles.providerKeyGroup}>{identity.subtitle}</div>
                    )}
                  </div>
                  <div className={styles.providerMetricGrid}>
                    <div className={styles.providerStatusStats}>
                      <span className={`${styles.statPill} ${styles.statSuccess}`}>
                        {t('stats.success')}: {card.success}
                      </span>
                      <span className={`${styles.statPill} ${styles.statFailure}`}>
                        {t('stats.failure')}: {card.failure}
                      </span>
                    </div>
                    <div className={styles.providerStatusMeta}>
                      {t('common.api_key')}: {card.keyCount}
                    </div>
                    <div className={styles.providerStatusMeta}>
                      {item.disabledCount > 0
                        ? `启用 ${item.enabledCount} / 禁用 ${item.disabledCount}`
                        : item.enabledCount === 0
                          ? '禁用'
                          : '启用'}
                    </div>
                  </div>
                </div>
                <div className={styles.providerCardBody}>
                  <div className={styles.providerStatusRow}>
                    <ProviderStatusBar statusData={card.statusData} />
                  </div>
                  <div className={styles.providerModelsColumn}>
                    <div className={styles.providerModelList}>
                      {mappingSummary.visible.map((model, summaryIndex) => (
                        <div
                          key={`${model.source}-${model.target}-${summaryIndex}`}
                          className={`${styles.providerModelItem} ${model.muted ? styles.providerModelMuted : ''}`}
                        >
                          <span className={styles.providerModelSource}>{model.source}</span>
                          <span className={styles.providerModelArrow}>-&gt;</span>
                          <span className={styles.providerModelTarget}>{model.target}</span>
                        </div>
                      ))}
                      {mappingSummary.hiddenCount > 0 && (
                        <div className={styles.providerModelMore}>
                          +{mappingSummary.hiddenCount}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={styles.providerInfoSummary}>
                    <div className={styles.providerInfoCluster}>
                      <div className={`${styles.providerMetaLine} ${styles.providerMetaKey}`}>
                        {maskedKeys}
                        {item.configs.length > 2 ? ` +${item.configs.length - 2}` : ''}
                      </div>
                    </div>
                    <div className={styles.providerInfoCluster}>
                      {item.prefix && (
                        <div className={styles.providerMetaLine}>
                          {t('common.prefix')}: {item.prefix}
                        </div>
                      )}
                      {item.proxyUrls[0] && (
                        <div className={styles.providerMetaLine}>
                          {t('common.proxy_url')}: {formatProviderEndpoint(item.proxyUrls[0])}
                        </div>
                      )}
                    </div>
                    {!item.enabled && (
                      <div className={styles.providerMetaLine}>
                        {t('ai_providers.config_disabled_badge')}
                      </div>
                    )}
                  </div>
                </div>
              </Fragment>
            );
          }}
        />
      </Card>
    </>
  );
}
