import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import iconVertex from '@/assets/icons/vertex.svg';
import type { ProviderKeyConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import {
  buildCandidateUsageSourceIds,
  lookupStatusBar,
  type KeyStats,
  type StatusBarData,
} from '@/utils/usage';
import styles from '@/pages/AiProvidersPage.module.scss';
import { ProviderList } from '../ProviderList';
import { ProviderStatusBar } from '../ProviderStatusBar';
import {
  buildProviderIdentityPresentation,
  formatProviderEndpoint,
  getStatsBySource,
  getTotalRequests,
  hasDisableAllModelsRule,
  summarizeMappings,
} from '../utils';

interface VertexSectionProps {
  configs: ProviderKeyConfig[];
  keyStats: KeyStats;
  statusBarBySource: Map<string, StatusBarData>;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
}

export function VertexSection({
  configs,
  keyStats,
  statusBarBySource,
  loading,
  disableControls,
  isSwitching,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}: VertexSectionProps) {
  const { t } = useTranslation();
  const actionsDisabled = disableControls || loading || isSwitching;
  const toggleDisabled = disableControls || loading || isSwitching;

  return (
    <>
      <Card
        title={
          <span className={styles.cardTitle}>
            <img src={iconVertex} alt="" className={styles.cardTitleIcon} />
            {t('ai_providers.vertex_title')}
          </span>
        }
        extra={
          <Button size="sm" onClick={onAdd} disabled={actionsDisabled}>
            {t('ai_providers.vertex_add_button')}
          </Button>
        }
      >
        <ProviderList<ProviderKeyConfig>
          items={configs}
          loading={loading}
          keyField={(item, index) => `${item.apiKey}-${index}`}
          listClassName={styles.providerTableList}
          rowClassName={styles.providerTableRow}
          metaClassName={styles.providerTableMeta}
          actionsClassName={styles.providerTableActions}
          actionButtonClassName={styles.providerActionButton}
          emptyTitle={t('ai_providers.vertex_empty_title')}
          emptyDescription={t('ai_providers.vertex_empty_desc')}
          onEdit={(action) => onEdit(Number(action))}
          onDelete={(action) => onDelete(Number(action))}
          actionsDisabled={actionsDisabled}
          getRowDisabled={(item) => hasDisableAllModelsRule(item.excludedModels)}
          renderExtraActions={(item, index) => (
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.providerActionButton} ${
                hasDisableAllModelsRule(item.excludedModels)
                  ? styles.providerEnableButton
                  : styles.providerDisableButton
              }`}
              disabled={toggleDisabled}
              onClick={() => void onToggle(index, hasDisableAllModelsRule(item.excludedModels))}
            >
              {hasDisableAllModelsRule(item.excludedModels) ? '启用' : '禁用'}
            </Button>
          )}
          renderContent={(item, index) => {
            const stats = getStatsBySource(item.apiKey, keyStats, item.prefix, item.authIndex);
            const configDisabled = hasDisableAllModelsRule(item.excludedModels);
            const excludedModels = item.excludedModels ?? [];
            const totalRequests = getTotalRequests(stats);
            const statusData = lookupStatusBar(
              statusBarBySource,
              item.authIndex && statusBarBySource.has(item.authIndex)
                ? [item.authIndex]
                : buildCandidateUsageSourceIds({ apiKey: item.apiKey, prefix: item.prefix })
            );
            const mappingSummary = summarizeMappings(
              (item.models ?? []).map((model) => ({
                source: model.alias || model.name,
                target: model.name,
              })),
              6
            );
            const mappingCount = mappingSummary.visible.length + mappingSummary.hiddenCount;
            const endpoint = formatProviderEndpoint(item.baseUrl);
            const identity = buildProviderIdentityPresentation({
              primary: item.prefix?.trim(),
              endpoint,
              fallback: `${t('ai_providers.vertex_item_title')} #${index + 1}`,
            });

            return (
              <Fragment>
                <div className={styles.providerCardHeader}>
                  <div className={styles.providerCardLead}>
                    <div className={`${styles.providerMetaLine} ${styles.providerMetaInline}`}>
                      <span>{t('common.priority')}:</span>
                      <span className={styles.providerPriorityBadge}>{item.priority ?? 0}</span>
                    </div>
                    <div className={styles.providerMainTitle}>
                      {t('ai_providers.vertex_item_title')} #{index + 1}
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
                        {t('stats.success')}: {stats.success}
                      </span>
                      <span className={`${styles.statPill} ${styles.statFailure}`}>
                        {t('stats.failure')}: {stats.failure}
                      </span>
                    </div>
                  </div>
                </div>
                <div className={styles.providerCardBody}>
                  <div className={styles.providerStatusRow}>
                    <div className={styles.providerRequestMeta}>
                      <span className={styles.providerRequestCount}>
                        Req <strong>{totalRequests}</strong>
                      </span>
                    </div>
                    <ProviderStatusBar statusData={statusData} />
                  </div>
                  <div className={styles.providerModelsColumn}>
                    <div className={styles.providerModelHeader}>
                      <div className={styles.providerColumnTitle}>模型映射</div>
                      <span className={styles.providerRequestCount}>
                        映射 <strong>{mappingCount}</strong>
                      </span>
                    </div>
                    <div className={styles.providerModelList}>
                      {mappingSummary.visible.map((model, summaryIndex) => (
                        <div
                          key={`${model.source}-${model.target}-${summaryIndex}`}
                          className={styles.providerModelItem}
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
                        {maskApiKey(item.apiKey)}
                      </div>
                    </div>
                    <div className={styles.providerInfoCluster}>
                      {item.prefix && (
                        <div className={styles.providerMetaLine}>
                          {t('common.prefix')}: {item.prefix}
                        </div>
                      )}
                      {item.proxyUrl && (
                        <div className={styles.providerMetaLine}>
                          {t('common.proxy_url')}: {formatProviderEndpoint(item.proxyUrl)}
                        </div>
                      )}
                    </div>
                  </div>
                  {configDisabled && (
                    <div className="status-badge warning" style={{ marginTop: 8, marginBottom: 0 }}>
                      {t('ai_providers.config_disabled_badge')}
                    </div>
                  )}
                  {item.models?.length ? (
                    <div className={styles.modelTagList}>
                      <span className={styles.modelCountLabel}>
                        {t('ai_providers.vertex_models_count')}: {item.models.length}
                      </span>
                    </div>
                  ) : null}
                  {excludedModels.length ? (
                    <div className={styles.excludedModelsSection}>
                      <div className={styles.excludedModelsLabel}>
                        {t('ai_providers.excluded_models_count', { count: excludedModels.length })}
                      </div>
                      <div className={styles.modelTagList}>
                        {excludedModels.map((model) => (
                          <span
                            key={model}
                            className={`${styles.modelTag} ${styles.excludedModelTag}`}
                          >
                            <span className={styles.modelName}>{model}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Fragment>
            );
          }}
        />
      </Card>
    </>
  );
}
